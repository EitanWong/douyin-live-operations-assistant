import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {Engine,mergeConfig} from '../../src/core/engine.js';
import {makeAIRequest} from '../../src/services/ai.js';

const at=1800000000000,day=86400000;
const chat=(id,text,user='1',time=at)=>({id,type:'chat',source:'socket',receivedAt:time,user:{id:user,name:'观众'+user},text});
test('长期记忆越过100人、30天和3条仍可按问题找回原话，模型上下文保持有界',()=>{
 let time=at;let memory=new AudienceMemory({anchor:'10',now:()=>time});
 memory.observe(chat('tea','我喜欢陶瓷茶具，尤其白瓷'));
 for(let i=0;i<8;i++)memory.observe(chat('other'+i,'今天聊点其他内容'+i));
 for(let i=2;i<110;i++)memory.observe(chat('viewer'+i,'你好',String(i)));
 time+=90*day;memory=new AudienceMemory({anchor:'10',state:memory.snapshot(),now:()=>time});
 const context=memory.context({id:'1'},'喜欢什么茶具');
 assert.ok(context?.recentStatements.some(row=>row.text.includes('白瓷')));
 assert.ok(context.recentStatements.length<=3);assert.match(context.coverage,/historical/);
 assert.equal(memory.snapshot().viewers.length,109);
 for(let i=0;i<6;i++)memory.annotate('uid:1','核实补充'+i);
 assert.equal(memory.snapshot().viewers.find(row=>row.key==='uid:1').notes.length,6);
 assert.ok(memory.context({id:'1'}).verifiedOperatorNotes.length<=3);
});

test('断网后直接提问自动答复，普通自言自语与取消保持安静；本地精确计算不调用模型',async()=>{
 let calls=0;const engine=new Engine({config:mergeConfig({ai:{enabled:true,chatEnabled:true,intervalSec:0,userCooldownSec:0}}),now:()=>at,ai:async()=>{calls++;throw new Error('offline');}});
 engine.start();
 try{
  const task={kind:'ai',data:{replyMode:'direct'}};
  await engine.requestAI(chat('math','12.5乘以4等于多少'),task);
  assert.match(engine.queue.at(-1)?.text || '',/50/);assert.equal(calls,0);
  await engine.requestAI(chat('question','这款怎么保养'),task);
  assert.match(engine.queue.at(-1)?.text || '',/暂时|不可用/);assert.equal(calls,1);
  const count=engine.queue.length;
  await engine.requestAI({type:'speech',text:'我先把东西收起来。'},{kind:'ai',data:{proactive:true}});
  assert.equal(engine.queue.length,count);
 }finally{engine.stop();}
});

test('云端及端侧额度耗尽仍会本地回复，后台没有重复付费调用',async()=>{
 let calls=0;const engine=new Engine({config:mergeConfig({ai:{enabled:true,chatEnabled:true,maxPerHour:1,edge:{enabled:false}}}),now:()=>at,ai:async()=>{calls++;return '不该调用';}});
 engine.start();engine.calls=[at];
 try{engine.requestChatAI(chat('quota','场控在吗'),true);await new Promise(setImmediate);assert.equal(calls,0);assert.ok(engine.queue.length);assert.match(engine.queue[0].text,/在|不可用|暂时/);}finally{engine.stop();}
});

test('最短公屏长度也能发送故障回复；目标记忆按当前问题检索',async()=>{
 let query;const engine=new Engine({config:mergeConfig({sending:{maxLength:10},ai:{enabled:true,chatEnabled:true}}),now:()=>at,viewerMemory:(_user,text)=>{query=text;return null;},ai:async()=>{throw Error('offline');}});
 engine.start();try{await engine.requestAI(chat('short','这款怎么保养'),{kind:'ai',data:{replyMode:'direct'}});assert.equal(query,'这款怎么保养');assert.ok(engine.queue.length);assert.ok([...engine.queue[0].text].length<=10);}finally{engine.stop();}
});

test('语音故障只回应明确向公屏提问',async()=>{
 const engine=new Engine({config:mergeConfig({ai:{enabled:true,proactiveEnabled:true,intervalSec:0}}),now:()=>at,ai:async()=>{throw new Error('offline');}});
 engine.start();
 try{await engine.requestAI({type:'speech',text:'大家听得到吗？'},{kind:'ai'});assert.match(engine.queue[0]?.text || '',/语音|收到/);}finally{engine.stop();}
});

test('故障到达前停止或换场不会产生本地补发，模型主动SKIP也不触发兜底',async()=>{
 for(const action of ['stop','skip']){
  let reject;const engine=new Engine({config:mergeConfig({ai:{enabled:true,chatEnabled:true}}),now:()=>at,ai:()=>action==='skip' ? Promise.resolve('[SKIP]') : new Promise((_,no)=>reject=no)});
  engine.start();try{const pending=engine.requestAI(chat('cancel','这款怎么保养'),{kind:'ai',data:{replyMode:'direct'}});if(action==='stop'){engine.stop();reject(Error('offline'));}await pending;assert.equal(engine.queue.length,0);}finally{engine.stop();}
 }
});

test('近期聊天只进入请求一次，预算缩减不修改原始上下文',()=>{
 const unique='这句弹幕只有唯一原文',config=mergeConfig(),context=[{text:unique,at}];
 const request=makeAIRequest({target:{text:'你好'},context,liveContext:{recentChat:context},maxLength:50},config.ai);
 assert.equal(request.messages[1].content.split(unique).length-1,1);assert.equal(context.length,1);
});
