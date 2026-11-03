import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine,mergeConfig,validateConfig} from '../../src/core/engine.js';
import {TurnTaking} from '../../src/ai/turn-taking.js';
import {makeAIRequest} from '../../src/services/ai.js';
import {aiDiagnostics} from '../../src/ai/diagnostics.js';
const flush=()=>new Promise(setImmediate);
function fixture(replyFrequency){
 let now=1800000000000,serial=0,observations=[];const prompts=[],spoken=[];
 const engine=new Engine({config:mergeConfig({mode:'preview',ai:{enabled:true,chatEnabled:true,proactiveEnabled:true,replyFrequency}}),now:()=>now,mediaContext:()=>({observations}),ai:async p=>{prompts.push(p);return `回答${prompts.length}`;},log:(kind,text)=>{if(kind==='preview')spoken.push(text);}});
 engine.setIdentity({self:{id:'self',name:'场控'}});engine.start();
 return {engine,prompts,spoken,advance:ms=>now+=ms,chat:async(text)=>{engine.ingest({type:'chat',id:`c${++serial}`,user:{id:`v${serial}`,name:'观众'},text});await flush();},tick:async()=>{await engine.tick();await flush();},speech:async(id,text='蓝色真好看')=>{observations=[{kind:'audio',id,text,at:now-1000,endedAt:now,isFinal:true}];engine.requestProactive(now);await flush();}};
}
test('滑块两端可保存校验，旧三档保持原值，未知档位被拒绝',()=>{
 for(const replyFrequency of ['off','mentions','quiet','natural','every'])assert.equal(validateConfig(mergeConfig({ai:{replyFrequency}})).ai.replyFrequency,replyFrequency);
 assert.throws(()=>validateConfig(mergeConfig({ai:{replyFrequency:'invalid'}})),/接话频率/);
});
test('最低档连明确@和主播语音都不调用AI，感知数据仍保留',async()=>{
 const f=fixture('off');try{await f.chat('@场控 你好');await f.chat('怎么清洗');await f.speech('a');await f.tick();assert.equal(f.prompts.length,0);assert.equal(f.spoken.length,0);assert.ok(f.engine.aiContext().mediaContext.observations.length);}finally{f.engine.stop();}
});
test('最高档热聊和已有十分钟发言不限制逐条接话，重复观察不重复调用',async()=>{
 const f=fixture('every');try{
  for(let i=0;i<12;i++){await f.chat(`消息${i}`);await f.tick();f.advance(1000);}
  assert.equal(f.prompts.length,12);assert.equal(f.spoken.length,12);
  f.advance(31000);await f.speech('a');await f.tick();assert.equal(f.prompts.length,13);
  await f.speech('a');assert.equal(f.prompts.length,13);
  f.advance(1000);await f.speech('b');await f.tick();assert.equal(f.prompts.length,14,'相同原话的新片段也可回应');
  const prompt=f.prompts.at(-1),body=makeAIRequest(prompt,f.engine.config.ai);assert.match(body.messages[0].content,/每句都接/);assert.doesNotMatch(body.messages[0].content,/只有音画证据清楚表明主播正在向公屏|未点名时默认旁听/);
 }finally{f.engine.stop();}
});
test('最高档模型忙时有界排队普通弹幕，按顺序处理而非只留最后一条',async()=>{
 const f=fixture('every');let release;try{
  f.engine.ai=async p=>{f.prompts.push(p);if(f.prompts.length===1)await new Promise(r=>release=r);return `回答${f.prompts.length}`;};
  await f.chat('第一句');await f.chat('第二句');await f.chat('第三句');release();await flush();
  for(let i=0;i<6;i++){await f.tick();f.advance(1000);}
  assert.deepEqual(f.prompts.map(p=>p.target.text),['第一句','第二句','第三句']);assert.equal(f.spoken.length,3);
 }finally{release?.();f.engine.stop();}
});
test('改到最低档撤销已经生成的待发送对话，其他规则功能不被滑块关闭',async()=>{
 const f=fixture('every');try{await f.chat('@场控 你好');f.engine.config.ai.replyFrequency='off';await f.tick();assert.equal(f.spoken.length,0);assert.equal(f.engine.conversationReady({kind:'gift'}),true);}finally{f.engine.stop();}
});
test('最高档仍尊重模型额度、功能开关及已过期语境',async()=>{
 const f=fixture('every');try{f.engine.config.ai.edge.enabled=false;f.engine.config.ai.maxPerHour=1;await f.chat('第一句');await f.tick();f.advance(1000);await f.chat('第二句');await f.tick();assert.equal(f.prompts.length,1);f.advance(46000);f.engine.config.ai.maxPerHour=3600;await f.tick();assert.equal(f.prompts.length,1);f.engine.config.ai.chatEnabled=false;await f.chat('关闭后');assert.equal(f.prompts.length,1);}finally{f.engine.stop();}
});
test('最高档与最低档运行诊断不再展示固定20秒判断限制',()=>{
 for(const replyFrequency of ['off','every']){
 const config=mergeConfig({ai:{replyFrequency,proactiveEnabled:true}}),text=aiDiagnostics({config,context:{context:[]},memoryCount:0,knownGaps:0}).join('\n');
 assert.match(text,replyFrequency==='off' ? /完全不接话/ : /每句都接/);assert.doesNotMatch(text,/至少隔20秒/);
 }
});
test('最低档阻止所有AI对话轮次，最高档取消轮次额度而不清空记录',()=>{
 const t=new TurnTaking(),now=1800000000000;
 for(let i=0;i<20;i++)t.record({kind:'ai',text:'回复',aiChat:{replyMode:'direct'}},'room',now);
 for(const mode of ['direct','continuation','contextual','speech','proactive']){
  assert.equal(t.canSpeak({mode,scope:'room',now,ai:mergeConfig({ai:{replyFrequency:'off'}}).ai}),false);
  assert.equal(t.canSpeak({mode,scope:'room',now,roomMessages:20,ai:mergeConfig({ai:{replyFrequency:'every'}}).ai}),mode!=='proactive','逐句回应不等于连续另起话题');
 }
 assert.equal(t.turns.length,20);
});
test('保存完全不接话会清掉待判断消息，重新开启不补答关闭前的话',async()=>{
 const f=fixture('every');let release;try{
  f.engine.ai=async p=>{f.prompts.push(p);await new Promise(r=>release=r);return '旧回应';};
  await f.chat('正在处理');await f.chat('等待处理');
  f.engine.update(mergeConfig({...f.engine.config,ai:{...f.engine.config.ai,replyFrequency:'off'}}));
  assert.equal(f.engine.chatAIQueue.length,0);release();await flush();await f.tick();assert.equal(f.spoken.length,0);
  f.engine.update(mergeConfig({...f.engine.config,ai:{...f.engine.config.ai,replyFrequency:'every'}}));await f.tick();assert.equal(f.prompts.length,1);
 }finally{release?.();f.engine.stop();}
});
