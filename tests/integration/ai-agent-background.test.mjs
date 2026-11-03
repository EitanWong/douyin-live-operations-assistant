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
  const reservations=await Promise.allSettled(Array.from({length:25},()=>reopened.reserve('1:10')));assert.equal(reservations.filter(r=>r.status==='fulfilled').length,20);
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

test('Harness每个房间串行、跨房并发，有执行截止和幂等提交',async()=>{
 const rows=new Map(),store={all:async()=>[],put:async row=>rows.set(row.id,structuredClone(row))};let signals=[];
 const h=new AgentHarness({store,timeoutMs:40,execute:async(job,{signal})=>{signals.push({scope:job.scope,signal});return new Promise(()=>{});}});
 try{
  await Promise.all([h.submit({id:'task-one',scope:'1:10',question:'一',input:{}}),h.submit({id:'task-one',scope:'1:10',question:'一',input:{}}),h.submit({id:'task-two',scope:'1:10',question:'二',input:{}}),h.submit({id:'task-three',scope:'2:20',question:'三',input:{}})]);
  await until(()=>signals.length===2);assert.deepEqual(signals.map(s=>s.scope),['1:10','2:20']);await until(()=>rows.get('task-two')?.status==='failed');assert.equal(signals.length,3);assert.ok(signals.every(s=>s.signal.aborted));assert.match(rows.get('task-two').error,/时限/);
 }finally{h.close();}
});
