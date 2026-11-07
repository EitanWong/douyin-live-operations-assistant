import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {createBackgroundAI} from '../../extension/ai-background.js';
import {createAgentTaskStore} from '../../src/ai/task-store.js';
import {AgentHarness} from '../../src/ai/harness.js';
import {mergeConfig} from '../../src/core/engine.js';

const until=async fn=>{for(let i=0;i<300;i++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,5));}assert.fail('研究未完成');};

test('真实后台使用 Responses 深度推理连续执行12轮与11次搜索，不受原8轮或20次小时额度截断',async()=>{
 const store=createAgentTaskStore({indexedDB:new IDBFactory(),IDBKeyRange});
 const config=mergeConfig({anchorId:'10',ai:{enabled:true,taskModels:{research:{enabled:true,endpoint:'https://relay.test/v1/responses',model:'best-reasoner',reasoningEffort:'high'}},search:{enabled:true,provider:'tavily',endpoint:'https://search.test/search'}}});
 const values={'live-assistant:config:1':config,'live-assistant:task-key:research:https://relay.test':'model-fixture','live-assistant:search-key:https://search.test':'search-fixture'};
 let models=0,searches=0;
 const host=createBackgroundAI({store,chrome:{permissions:{contains:async()=>true}},readRecord:async key=>values[key],fetch:async(url,options)=>{
  const body=JSON.parse(options.body);
  if(url.includes('search.test')){searches++;return new Response(JSON.stringify({results:[{url:`https://evidence.test/${searches}`,content:'公开证据'+searches}]}));}
  models++;assert.equal(body.reasoning.effort,'high');assert.equal(body.max_output_tokens,undefined);assert.equal(options.headers.Authorization,'Bearer model-fixture');
  const decision=models===12 ? {action:'finish',answer:'11项证据核对完成。',citations:[11]} : {action:'search',query:'证据'+models};
  return new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(decision)}]}]}));
 }});
 try{
  await Promise.all(Array.from({length:50},()=>store.reserve('unlimited-hour')));
  await host.handle({type:'agent-submit',id:'unlimited-research',question:'核对所有公开证据',input:{context:{},sources:[]}},'1');
  const result=await until(async()=>{const row=(await host.handle({type:'agent-list'},'1'))[0];return ['succeeded','failed'].includes(row?.status) && row;});
  assert.equal(result.status,'succeeded',result.error);assert.equal(result.result.modelCalls,12);assert.equal(searches,11);assert.equal(result.result.sources.length,11);assert.equal(result.result.answer,'11项证据核对完成。');
 }finally{await host.close();}
});

test('默认可排队超过8个任务，同房间仍串行，人工取消会终止请求',async()=>{
 const rows=new Map();let signal;
 const harness=new AgentHarness({store:{all:async()=>[],put:async row=>rows.set(row.id,structuredClone(row))},execute:async(_job,options)=>{signal=options.signal;return new Promise(()=>{});}});
 try{
  for(let i=0;i<12;i++)await harness.submit({id:'queued-task-'+i,scope:'1:10',question:'核对资料'+i,input:{}});
  await until(()=>signal);assert.equal(harness.jobs.size,12);assert.equal(harness.active.size,1);
  const original=signal;await harness.cancel('queued-task-0','1:10');assert.equal(original.aborted,true);
 }finally{await harness.close();}
});

test('不限时任务超过一天、排队超过100个仍持久保留并可恢复，恢复超过两次不丢弃',async()=>{
 const store=createAgentTaskStore({indexedDB:new IDBFactory(),IDBKeyRange}),createdAt=Date.now()-2*86400000;
 for(let i=0;i<110;i++)await store.put({id:'persisted-task-'+i,scope:'1:10',question:'持续研究',input:{},createdAt,status:i ? 'queued' : 'running',runtime:'langgraph-v1',recoveries:4});
 assert.equal((await store.all()).length,110);
 const harness=new AgentHarness({store,resumable:true,execute:async()=>new Promise(()=>{})});
 try{await harness.ready;assert.equal(harness.jobs.size,110);assert.equal(harness.list('1:10').length,110,'所有未完成任务都可见并可取消');assert.equal(harness.jobs.get('persisted-task-0').recoveries,5);}
 finally{await harness.close();store.close();}
});

test('长任务的检查点和手动单任务额度不会被一天过期清理重置',async()=>{
 const store=createAgentTaskStore({indexedDB:new IDBFactory(),IDBKeyRange}),at=Date.now()-2*86400000;
 try{
  await store.put({id:'old-task',scope:'1:10',createdAt:at,status:'running',runtime:'langgraph-v1'});
  const db=store.checkpointer.db,thread='research-v1:1:10:old-task';
  await db.checkpoints.put({thread,ns:'',id:'checkpoint',checkpoint:{id:'checkpoint',channel_values:{answer:'已取得证据'}},metadata:{},at});
  await db.usage.put({scope:'task:1:10:old-task',calls:[at],updatedAt:at});
  await store.writeLoop({scope:'1:10',updatedAt:at,seen:[{key:'finished-evidence',at}],calls:[],nextAt:0});
  await store.all();assert.equal((await store.checkpointer.getTuple({configurable:{thread_id:thread}})).checkpoint.channel_values.answer,'已取得证据');
  assert.equal((await store.readLoop('1:10'))?.seen[0].key,'finished-evidence','长程循环的去重水位不能按一天清除');
  await assert.rejects(store.reserve('task:1:10:old-task',1,{lifetime:true}),/额度已用完/);
 }finally{store.close();}
});
