import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {createAgentTaskStore} from '../../src/ai/task-store.js';
import {createResearchGraph} from '../../src/ai/research-graph.js';
import {createResearchAgent} from '../../src/ai/agent.js';
import {mergeConfig} from '../../src/core/engine.js';

test('原文读取检查点也保留时效，恢复不能用过期网页回答实时问题',async t=>{
 let now=Date.now(),calls=0;t.mock.method(Date,'now',()=>now);
 const store=createAgentTaskStore({indexedDB:new IDBFactory(),IDBKeyRange});
 const ai=mergeConfig({ai:{endpoint:'https://model.test/chat/completions',model:'test'}}).ai;
 const job={id:'read-expiry',scope:'1:10',question:'明天天气怎样',input:{anchor:'10',ai,context:{},sources:['https://example.org/weather']}};
 const run=createResearchAgent({getKey:()=>'',checkpointer:store.checkpointer,readPublicPage:async url=>({url,title:'预报',text:'明天小雨',readAt:now}),request:d=>{
  if(++calls===1)d.onerror();else d.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:'{"action":"finish","answer":"明天小雨","citations":[1]}'}}]})});
 }});
 try{
  await assert.rejects(run(job,{signal:new AbortController().signal,checkpoint:async()=>{}}));now+=120001;
  await assert.rejects(run(job,{signal:new AbortController().signal,checkpoint:async()=>{}}),/过期/);assert.equal(calls,1);
 }finally{store.close();}
});

test('同一研究的调用预算跨小时重启仍累计，普通小时额度可以恢复',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const options={indexedDB:new IDBFactory(),IDBKeyRange},first=createAgentTaskStore(options);
 await first.reserve('task:1:budget',2,{lifetime:true});
 await first.reserve('task:1:budget',2,{lifetime:true});
 await first.reserve('1:budget',1);first.close();now+=3600001;
 const second=createAgentTaskStore(options);
 try{
  await assert.rejects(second.reserve('task:1:budget',2,{lifetime:true}),/额度/);
  await second.reserve('1:budget',1);
  const calls=await Promise.allSettled(Array.from({length:8},()=>second.reserve('task:2:budget',3,{lifetime:true})));
  assert.equal(calls.filter(r=>r.status==='fulfilled').length,3);
  await second.all();await assert.rejects(second.reserve('task:2:budget',3,{lifetime:true}),/额度/);
  now+=86400001;await second.all();await second.reserve('task:2:budget',3,{lifetime:true});
 }finally{second.close();}
});

test('IndexedDB检查点跨宿主恢复已完成工具，不重复搜索，取消后不再调用模型',async()=>{
 const options={indexedDB:new IDBFactory(),IDBKeyRange},first=createAgentTaskStore(options);let searches=0,plans=0;
 const controller=new AbortController();
 const deps={search:async()=>{searches++;return {results:[{url:'https://example.org/a',title:'记录',content:'周期73天'}]};},plan:async()=>{plans++;if(plans===2){controller.abort();throw Error('模拟后台挂起');}return JSON.stringify({action:'search',query:'周期'});}};
 try{
  await assert.rejects(createResearchGraph({...deps,checkpointer:first.checkpointer}).run({id:'resume-task',signal:controller.signal}));
  first.close();const second=createAgentTaskStore(options);
  try{
   const graph=createResearchGraph({...deps,checkpointer:second.checkpointer,plan:async()=>{plans++;return JSON.stringify({action:'finish',answer:'周期73天',citations:[1]});}});
   const result=await graph.run({id:'resume-task',signal:new AbortController().signal});
   assert.equal(result.answer,'周期73天');assert.equal(searches,1);assert.equal(plans,3);assert.equal(result.modelCalls,2);
   const repeated=await graph.run({id:'resume-task',signal:new AbortController().signal});assert.equal(repeated.answer,'周期73天');assert.equal(plans,3);
  }finally{second.close();}
 }finally{first.close();}
});

test('检查点写入失败不能继续下一轮模型，任务来源按线程隔离',async()=>{
 const store=createAgentTaskStore({indexedDB:new IDBFactory(),IDBKeyRange});let models=0;
 try{
  const cp=store.checkpointer,put=cp.put.bind(cp);cp.put=async(...args)=>{if(models)throw Error('磁盘已满');return put(...args);};
  await assert.rejects(createResearchGraph({checkpointer:cp,plan:async()=>{models++;return JSON.stringify({action:'search',query:'茶具'});},search:async()=>({results:[]})}).run({id:'failed-write'}),/磁盘/);
  assert.equal(models,1);assert.equal(await cp.getTuple({configurable:{thread_id:'other-thread'}}),undefined);
 }finally{store.close();}
});
