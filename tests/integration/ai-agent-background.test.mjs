import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {createAgentTaskStore} from '../../src/ai/task-store.js';
import {createBackgroundAI} from '../../extension/ai-background.js';
import {AgentHarness} from '../../src/ai/harness.js';
import {mergeConfig} from '../../src/core/engine.js';
const until=async check=>{for(let i=0;i<150;i++){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,3));}assert.fail('后台任务未达到预期状态');};

test('Dexie任务和额度跨宿主重启持久保存，原子额度不能并发穿透',async()=>{
 const indexedDB=new IDBFactory(),options={indexedDB,IDBKeyRange},store=createAgentTaskStore(options),now=Date.now();
 try {
  await store.put({id:'test-task',scope:'1:10',createdAt:now,status:'queued',question:'测试',input:{},trace:[]});store.close();
  const reopened=createAgentTaskStore(options);assert.equal((await reopened.all())[0].question,'测试');
  const reservations=await Promise.allSettled(Array.from({length:25},()=>reopened.reserve('1:10',20)));assert.equal(reservations.filter(r=>r.status==='fulfilled').length,20);
  await reopened.reserve('2:10');reopened.close();
 }finally{store.close();}
});

test('后台使用已保存设置和密钥，提交不等模型，房间隔离且取消实际中止HTTP',async()=>{
 const store=createAgentTaskStore({indexedDB:new IDBFactory(),IDBKeyRange});let signal,requests=0;
 const config=mergeConfig({anchorId:'10',ai:{enabled:true,endpoint:'https://model.test/chat/completions',model:'test'}});
 const values={'live-assistant:config:1':config,'live-assistant:api-key:https://model.test':'stored-key','live-assistant:config:2':{...config,anchorId:'20'}};
 const host=createBackgroundAI({store,chrome:{permissions:{contains:async()=>true}},readRecord:async key=>values[key],fetch:async(_url,options)=>{signal=options.signal;requests++;assert.equal(options.headers.Authorization,'Bearer stored-key');return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 try {
  const receipt=await host.handle({type:'agent-submit',id:'research-1',question:'今天聊什么',input:{context:{context:[]},sources:[],ai:{key:'must-not-persist'}}},'1');assert.equal(receipt.status,'queued');assert.equal(receipt.input,undefined);
  await until(()=>signal);assert.equal(requests,1);assert.equal(JSON.stringify(await store.all()).includes('stored-key'),false);assert.equal(JSON.stringify(await store.all()).includes('must-not-persist'),false);
  assert.deepEqual(await host.handle({type:'agent-list'},'2'),[]);await assert.rejects(host.handle({type:'agent-cancel',id:'research-1'},'2'),/范围/);
  await host.handle({type:'agent-cancel',id:'research-1'},'1');assert.equal(signal.aborted,true);assert.equal((await host.handle({type:'agent-list'},'1'))[0].status,'cancelled');
 }finally{host.close();}
});

for(const local of [false,true])test(`独立后台API缺权限时指出实际域名，授权后可重新执行${local ? '（本地带端口）' : ''}`,async()=>{
 const endpoint=local ? 'http://localhost:11434/v1/chat/completions' : 'https://research.example/v1/responses',pattern=local ? 'http://localhost/*' : 'https://research.example/*';
 const config=mergeConfig({anchorId:'10',ai:{enabled:true,endpoint:'https://reply.example/v1/chat/completions',model:'reply',taskModels:{research:{enabled:true,endpoint,model:'research'}}}});
 const store=createAgentTaskStore({indexedDB:new IDBFactory(),IDBKeyRange}),patterns=[];let allowed=false,calls=0;
 const host=createBackgroundAI({store,chrome:{permissions:{contains:async value=>{patterns.push(value.origins[0]);return allowed && value.origins[0]===pattern;}}},readRecord:async key=>key==='live-assistant:config:1' ? config : 'fixture-key',fetch:async url=>{
  calls++;assert.equal(url,endpoint);const text=JSON.stringify({action:'finish',answer:'现有资料不足。',citations:[]});
  return {status:200,url,text:async()=>JSON.stringify(local ? {choices:[{message:{content:text}}]} : {output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]})};
 }});
 const run=async id=>{await host.handle({type:'agent-submit',id,question:'整理已有知识',input:{context:{},sources:[]}},'1');return until(async()=>{const row=(await host.handle({type:'agent-list'},'1')).find(row=>row.id===id);return ['succeeded','failed'].includes(row?.status) && row;});};
 try{
  const denied=await run('denied');assert.equal(denied.status,'failed');assert.equal(calls,0);assert.match(denied.error,/后台研究/);assert.ok(denied.error.includes(new URL(endpoint).origin),denied.error);
  allowed=true;const result=await run('allowed');assert.equal(result.status,'succeeded',result.error);assert.equal(calls,1);assert.ok(patterns.every(value=>value===pattern));
 }finally{await host.close();}
});

test('Harness每个房间串行、跨房并发，有执行截止和幂等提交',async()=>{
 const rows=new Map(),store={all:async()=>[],put:async row=>rows.set(row.id,structuredClone(row))};let signals=[];
 const h=new AgentHarness({store,timeoutMs:40,execute:async(job,{signal})=>{signals.push({scope:job.scope,signal});return new Promise(()=>{});}});
 try{
  await Promise.all([h.submit({id:'task-one',scope:'1:10',question:'一',input:{}}),h.submit({id:'task-one',scope:'1:10',question:'一',input:{}}),h.submit({id:'task-two',scope:'1:10',question:'二',input:{}}),h.submit({id:'task-three',scope:'2:20',question:'三',input:{}})]);
  await until(()=>signals.length===2);assert.deepEqual(signals.map(s=>s.scope),['1:10','2:20']);await until(()=>rows.get('task-two')?.status==='failed');assert.equal(signals.length,3);assert.ok(signals.every(s=>s.signal.aborted));assert.match(rows.get('task-two').error,/时限/);
 }finally{h.close();}
});

for(const dedicated of [false,true])test(`图谱问答经真实后台LangGraph执行，稳定人物范围保留且关系工具实际被调用${dedicated ? '（独立后台模型）' : ''}`,async()=>{
 const store=createAgentTaskStore({indexedDB:new IDBFactory(),IDBKeyRange}),config=mergeConfig({anchorId:'10',ai:{enabled:true,endpoint:'https://model.test/chat/completions',model:'test',taskModels:{research:{enabled:dedicated,endpoint:'https://model.test/chat/completions',model:'deep'}}}});
 const context={focus:{scope:'single',entityIds:['person:uid%3A1'],names:['小雨']}},queries=[];let requests=0,provided,remembered=0;
 const graph={entities:[{id:'person:uid%3A1',name:'小雨',role:'观众',dossier:{facets:[{category:'interests',text:'陶艺',source:'弹幕',trust:'unverified'}],events:[]}},{id:'person:uid%3A2',name:'小雨',role:'观众'}],relations:[],ambiguities:[]};
 const host=createBackgroundAI({store,chrome:{permissions:{contains:async()=>true}},readRecord:async key=>key==='live-assistant:config:1' ? config : key==='live-assistant:task-key:research:https://model.test' ? 'fixture-deep-key' : '',knowledge:{handle:async(room,action)=>{if(action==='remember')remembered++;return action==='version' ? 0 : [];}},relationships:async(room,question,options)=>{queries.push(options);return graph;},fetch:async(_url,options)=>{
  requests++;const body=JSON.parse(options.body);assert.equal(body.model,dedicated ? 'deep' : 'test');if(dedicated)assert.equal(options.headers.Authorization,'Bearer fixture-deep-key');provided=JSON.parse(body.messages[1].content);
  const content=requests===1 ? '{"action":"relationships","query":"小雨的兴趣与原话"}' : '{"action":"finish","answer":"所选小雨自述喜欢陶艺，尚未独立核实。","citations":[]}';
  return {status:200,url:'https://model.test/chat/completions',text:async()=>JSON.stringify({choices:[{message:{content}}]})};
 }});
 try{
  await host.handle({type:'agent-submit',id:'relationship-research',question:'核对选定人物画像',input:{context:{relationshipContext:context},sources:[]}},'1');
  const completed=await until(async()=>{const row=(await host.handle({type:'agent-list'},'1'))[0];return ['succeeded','failed'].includes(row?.status) && row;});
  assert.equal(completed.status,'succeeded',completed.error);assert.equal(completed.result.runtime,'langgraph');assert.equal(requests,2);
  assert.ok(queries.every(o=>o?.browse && o.entityIds[0]==='person:uid%3A1'),'每轮关系工具与复核均沿用稳定人物范围');
  assert.ok(completed.trace.some(row=>row.step==='tool:relationships'));
  assert.deepEqual(provided.evidence_context.relationships.focus,context.focus);assert.equal(remembered,0,'问答来源保留任务中，不通过写入知识库使自己的证据快照失效');
 }finally{await host.close();}
});
