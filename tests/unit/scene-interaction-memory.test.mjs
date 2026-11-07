import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine,mergeConfig} from '../../src/core/engine.js';
import {MediaEvidence} from '../../src/services/media.js';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {PerceptionMemory,LiveMemoryArchive,mergeLiveMemory} from '../../src/ai/live-memory.js';
import {AccountContext,accountSource,normalizeAccountPayload} from '../../src/ai/account-context.js';
import {makeAIRequest} from '../../src/services/ai.js';
import {makeEdgeMessages} from '../../src/ai/edge-prompt.js';
const flush=()=>new Promise(setImmediate),start=1800000000000;
function fixture(){
 let now=start,answer;const prompts=[],spoken=[],evidence=new MediaEvidence({now:()=>now});
 const engine=new Engine({config:mergeConfig({mode:'preview',ai:{enabled:true,proactiveEnabled:true}}),now:()=>now,mediaContext:()=>evidence.context(60),ai:p=>{prompts.push(p);return new Promise(r=>answer=r);},log:(kind,text)=>{if(kind==='preview')spoken.push(text);}});
 engine.start();now+=100000;
 const speech=text=>{for(const kind of ['audio','video'])evidence.add({kind,id:kind+now,text:kind==='audio' ? text : '主画面的人拿着茶杯面对镜头说话。',at:now-1000,endedAt:now,isFinal:true});};
 return {engine,prompts,spoken,speech,advance:ms=>now+=ms,now:()=>now,answer:text=>answer(text),assess:async()=>{engine.requestProactive(now);await flush();},tick:async()=>{await engine.tick();await flush();}};
}

test('明确向公屏提问有独立回应机会；热聊中到达的新弹幕不自动撤销，但新语音会撤销',async()=>{
 const f=fixture();try{
  const scope=f.engine.chatContextKey();
  for(let i=0;i<2;i++)f.engine.turnTaking.record({kind:'ai',text:'之前的普通接话'},scope,f.now()-80000+i*20000);
  for(let i=0;i<8;i++)f.engine.contextChat.push({at:f.now(),text:'杯子的花纹挺好看',name:'观众'});
  f.speech('大家觉得这个茶杯蓝色还是绿色好看？');await f.assess();
  assert.equal(f.prompts.length,1);assert.equal(f.prompts[0].task.data.engagement.priority,'host-question');
  f.engine.ingest({type:'chat',id:'new',user:{id:'11',name:'小雨'},text:'我觉得蓝色更好看'});
  assert.equal(f.prompts[0].isCurrent(),true);
  f.answer('蓝色配这个花纹挺协调。');await flush();await f.tick();assert.deepEqual(f.spoken,['蓝色配这个花纹挺协调。']);
  f.advance(21000);f.speech('大家平时喝茶用什么杯子？');await f.assess();assert.equal(f.prompts.length,2);
  f.advance(1000);f.speech('先不聊杯子了，我说件别的事。');assert.equal(f.prompts[1].isCurrent(),false);
  f.answer('不该发送');await flush();await f.tick();assert.equal(f.spoken.length,1);
 }finally{f.engine.stop();}
});

test('主播问题仍遵守关闭/仅@模式和实际发言间隔，普通自言自语不享受优先机会',async()=>{
 for(const frequency of ['off','mentions','quiet']){
  const f=fixture();try{
   f.engine.config.ai.replyFrequency=frequency;
   if(frequency==='quiet')f.engine.turnTaking.record({kind:'ai',text:'刚回答过'},f.engine.chatContextKey(),f.now()-1000);
   f.speech('大家觉得哪个颜色好看？');await f.assess();assert.equal(f.prompts.length,0);
  }finally{f.engine.stop();}
 }
 const f=fixture();try{for(let i=0;i<8;i++)f.engine.contextChat.push({at:f.now(),text:'热聊'});f.speech('我想想，怎么会这样呢？');await f.assess();assert.equal(f.prompts.length,0);}finally{f.engine.stop();}
});

test('其他观众原话与主播叙事跨恢复检索并进入云端和本地回复，保持来源与历史边界',()=>{
 let now=start;const memory=new AudienceMemory({anchor:'10',now:()=>now});
 memory.observe({type:'chat',id:'tea',source:'socket',receivedAt:now,user:{id:'1',name:'小雨'},text:'想看主播做白瓷茶具'});
 const saved=new AudienceMemory({anchor:'10',state:memory.snapshot(),now:()=>now});
 const perception=new PerceptionMemory({now:()=>now});perception.observe({kind:'audio',id:'story',at:now-3000,endedAt:now-1000,text:'小时候我跟爷爷一起学做白瓷茶具。'});
 now+=86400000;
 const prompt={now,target:{type:'speech',text:'大家还记得我跟爷爷做茶具的事吗？'},task:{kind:'ai'},getConversationMemory:q=>saved.conversation(q),getPerceptionMemory:q=>perception.context(q),maxLength:50};
 const cloud=JSON.parse(makeAIRequest(prompt,mergeConfig().ai).messages[1].content),edge=JSON.parse(makeEdgeMessages(prompt,mergeConfig().ai)[1].content);
 assert.equal(cloud.evidence_context.conversationHistory.records[0].name,'小雨');
 assert.match(cloud.evidence_context.conversationHistory.records[0].text,/白瓷/);
 assert.match(cloud.evidence_context.perceptionHistory.records[0].text,/爷爷/);
 assert.match(JSON.stringify(edge),/爷爷/);assert.match(JSON.stringify(edge),/小雨/);
 saved.forget('uid:1');assert.equal(saved.conversation('白瓷').records.length,0);
});

test('协议@身份仅用于本机图谱归并，原话进入云端和本地回复时不携带被@账号标识',()=>{
 const audience=new AudienceMemory({anchor:'10',now:()=>start});
 audience.observe({id:'mention',type:'chat',source:'socket',receivedAt:start,user:{id:'900',name:'记录者'},text:'@Lucy小露 白瓷茶具很好看',atUser:{id:'1234567891011',secUid:'internal-mention-account',name:'Lucy小露'}});
 const restored=new AudienceMemory({anchor:'10',state:audience.snapshot(),now:()=>start});
 assert.equal(restored.snapshot().viewers[0].statements[0].mentions[0].key,'uid:1234567891011');
 const prompt={now:start,target:{type:'speech',text:'白瓷茶具'},task:{kind:'ai'},getConversationMemory:q=>restored.conversation(q),maxLength:50};
 for(const context of [restored.conversation('白瓷茶具'),makeAIRequest(prompt,mergeConfig().ai),makeEdgeMessages(prompt,mergeConfig().ai)]){
  assert.match(JSON.stringify(context),/Lucy小露/);
  assert.doesNotMatch(JSON.stringify(context),/mentions|1234567891011|internal-mention-account/);
 }
});

test('近期作品按发布时间提供兜底，相关旧作品仍可检索，不能把采集时间当发布时间',()=>{
 const store=new AccountContext({now:()=>start}),source=accountSource('https://www.douyin.com/user/MS4wLjAB-test');
 const rows=normalizeAccountPayload({aweme_list:[
  {aweme_id:'1',desc:'去年的白瓷制作',create_time:start/1000-86400*200,author:{sec_uid:source.id}},
  {aweme_id:'2',desc:'昨天的海边日落',create_time:start/1000-86400,author:{sec_uid:source.id}},
  {aweme_id:'3',desc:'今天的厨房日常',create_time:start/1000-3600,author:{sec_uid:source.id}}
 ]},source,start);store.replace('10',source.url,rows);
 const current=store.context('10','最近视频');assert.ok(current.some(r=>r.kind==='work' && r.publishedAt===start-3600000));
 const related=store.context('10','白瓷');assert.ok(related.some(r=>r.content.includes('白瓷')));
 assert.ok(related.some(r=>r.content.includes('厨房')));assert.ok(related.length<=4);assert.equal(store.context('other','白瓷').length,0);
});

test('无稳定身份的弹幕也持久保存为房间原话，同名不归人，跨页合并与清空水位有效',async()=>{
 let now=start;const rows=new Map(),options={room:'1',now:()=>now,get:(k,f)=>rows.get(k) ?? f,set:async(k,v)=>rows.set(k,structuredClone(v))};
 const store=new LiveMemoryArchive(options),memory=store.current('10').audience;
 const message={id:'anonymous',type:'screen-chat',source:'socket',receivedAt:now,user:{name:'小雨'},text:'白瓷茶杯要配蓝色花纹'};
 assert.equal(memory.observe(message),true);assert.equal(memory.observe(message),false);
 memory.observe({...message,id:'stable',type:'chat',user:{id:'1',name:'小雨'},text:'我喜欢跑步'});
 assert.doesNotMatch(JSON.stringify(memory.context({id:'1'})),/白瓷/);
 await store.persist(store.capture());const restored=new LiveMemoryArchive(options);
 assert.match(JSON.stringify(restored.current('10').audience.conversation('白瓷')),/蓝色/);
 const old=store.capture()[0]?.state || rows.values().next().value;
 now++;restored.current('10').audience.clear();
 const merged=mergeLiveMemory(old,restored.capture()[0].state);
 assert.equal(new AudienceMemory({anchor:'10',state:merged.audience,now:()=>now}).conversation('白瓷').records.length,0);
});

test('本场短期记忆跨感知会话保留故事，只取当前开播边界内相关片段与最近原话',()=>{
 const memory=new PerceptionMemory({now:()=>start});
 for(const [id,text,age] of [['old','上一场的事情',86400000],['story','今天说起爷爷的白瓷茶杯',3600000],['recent','刚才讲的是茶杯上的蓝色花纹',1000]])memory.observe({kind:'audio',id,text,at:start-age-1000,endedAt:start-age,isFinal:true});
 const restored=new PerceptionMemory({state:memory.snapshot(),now:()=>start});
 const session=restored.sessionContext('爷爷',{since:start-7200000});
 assert.ok(session.records.some(r=>r.id==='story'));assert.ok(session.records.some(r=>r.id==='recent'));assert.ok(!session.records.some(r=>r.id==='old'));
 const input=JSON.parse(makeAIRequest({now:start,target:{text:'刚才说的茶杯呢'},task:{kind:'ai'},getSessionMemory:()=>session,maxLength:50},mergeConfig().ai).messages[1].content);
 assert.ok(input.evidence_context.sessionMemory.records.some(r=>r.id==='story'));
});
