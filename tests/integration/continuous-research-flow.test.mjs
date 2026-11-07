import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {createAgentTaskStore} from '../../src/ai/task-store.js';
import {createBackgroundAI} from '../../extension/ai-background.js';
import {createKnowledgeCorpus} from '../../src/ai/knowledge-corpus.js';
import {createAutomaticKnowledge,createKnowledgeMemory} from '../../src/services/automatic-knowledge.js';
import {createWebKnowledge} from '../../src/services/web-knowledge.js';
import {createAIClient} from '../../src/services/ai.js';
import {mergeConfig} from '../../src/core/engine.js';
import {AudienceMemory} from '../../src/ai/audience-memory.js';

const until=async check=>{for(let i=0;i<200;i++){const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,5));}assert.fail('研究流程未到达预期状态');};
function fixture(){
 const config=mergeConfig({anchorId:'10',ai:{enabled:true,endpoint:'https://model.test/chat/completions',model:'test',search:{enabled:true,provider:'tavily',endpoint:'https://search.test/search'},assistant:{research:{enabled:true,intervalSec:60,maxPerHour:2}}}});
 const values={'live-assistant:config:1':config,'live-assistant:api-key:https://model.test':'test-key','live-assistant:search-key:https://search.test':'test-search',
  'live-assistant:live-memory:1:10':{anchor:'10',audience:{viewers:[{statements:[{text:'赤鹤星周期是多少天？',at:Date.now()}]}]},perception:{observations:[]}}};
 const readRecord=async key=>structuredClone(values[key]),corpus=createKnowledgeCorpus({read:readRecord,write:async(k,v)=>{values[k]=structuredClone(v);}});
 const knowledge=createAutomaticKnowledge({corpus,readConfig:async()=>config});
 const indexedDB=new IDBFactory(),storeOptions={indexedDB,IDBKeyRange};
 return {config,values,corpus,knowledge,storeOptions,options:{chrome:{permissions:{contains:async()=>true}},readRecord,readConfigs:async()=>({'live-assistant:config:1':config}),knowledge}};
}
const response=content=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}));

test('网页研究入库使用原始采集时间，不被冗余公开来源副本改成模型完成时间',async t=>{
 const start=Date.now();let now=start;t.mock.method(Date,'now',()=>now);const f=fixture();
 const host=createBackgroundAI({...f.options,store:createAgentTaskStore(f.storeOptions),fetch:async url=>{
  if(url==='https://example.org/report')return new Response('陶瓷茶具只限冷水清洗。',{headers:{'content-type':'text/plain'}});
  now=start+1000;return response({action:'finish',answer:'只限冷水清洗。',citations:[1]});
 }});
 try{
  await host.handle({type:'agent-submit',id:'original-source-date',question:'陶瓷茶具怎么清洗',input:{context:{},sources:['https://example.org/report']}},'1');
  await until(async()=>{const row=(await host.handle({type:'agent-list'},'1')).find(row=>row.id==='original-source-date');return row?.status==='succeeded';});
  const rows=await f.corpus.list('1','10');assert.equal(rows.length,1);assert.equal(rows[0].at,start);
 }finally{await host.close();}
});

test('新近对话→持久后台多步研究→原文知识→前台单次模型回答，重启不重研',async()=>{
 const f=fixture();let models=0,searches=0;
 const fetcher=async url=>{if(url.includes('search.test')){searches++;return new Response(JSON.stringify({results:[{title:'赤鹤星观测',url:'https://example.org/star',content:'赤鹤星是虚构天体，周期73天。'}]}));}models++;return response(models===1 ? {action:'search',query:'赤鹤星周期'} : {action:'finish',answer:'周期73天。',citations:[1]});};
 let host=createBackgroundAI({...f.options,store:createAgentTaskStore(f.storeOptions),fetch:fetcher});
 try{
  await host.wake();const task=await until(async()=>{const row=(await host.handle({type:'agent-list'},'1'))[0];return row?.status==='succeeded' && row;});
  assert.equal(task.result.runtime,'langgraph');assert.equal(models,2);assert.equal(searches,1);assert.match((await f.corpus.list('1','10'))[0].text,/73/);
  const cache=createWebKnowledge({indexedDB:null}),memory=createKnowledgeMemory({cache,anchor:()=> '10',transport:(action,input)=>f.knowledge.handle('1',action,input)});let frontCalls=0;
  const reply=createAIClient({knowledge:memory,getKey:()=> 'test-key',search:()=>assert.fail('已有来源不应再搜索'),request:d=>{
   frontCalls++;const candidate=JSON.parse(JSON.parse(d.data).messages[1].content).knowledge_candidates[0];assert.match(candidate.results[0].content,/73/);
   d.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:JSON.stringify({intent:'knowledge',query:candidate.id,reply:'周期73天。',sources:[1]})}}]})});
  }});
  assert.equal(await reply({task:{kind:'ai'},target:{text:'赤鹤星周期'},maxLength:100},f.config.ai),'周期73天。');assert.equal(frontCalls,1);cache.close();
  await host.close();host=createBackgroundAI({...f.options,store:createAgentTaskStore(f.storeOptions),fetch:fetcher});await host.wake();assert.equal(models,2);assert.equal((await host.handle({type:'agent-list'},'1')).length,1);
 }finally{await host.close();}
});

test('默认不限间隔的后台研究完成后立即接续新候选，无需等待alarm',async()=>{
 const f=fixture();Object.assign(f.config.ai.assistant.research,{intervalSec:0,maxPerHour:0});
 const memory=new AudienceMemory({anchor:'10'});
 for(const id of [2,3,4])memory.observe({source:'socket',type:'chat',id:'q-'+id,text:'陶瓷茶杯问题'+id,user:{id:String(id),name:'观众'+id},receivedAt:Date.now()});
 f.values['live-assistant:live-memory:1:10'].audience=memory.snapshot();
 let models=0;const host=createBackgroundAI({...f.options,store:createAgentTaskStore(f.storeOptions),fetch:async()=>{models++;return response({action:'finish',answer:'现有信息尚不足，需要更多原文。',citations:[]});}});
 try{
  await host.wake();await until(async()=>{const rows=await host.handle({type:'agent-list'},'1');return rows.filter(row=>row.status==='succeeded').length===3;});
  assert.equal(models,3);await host.wake();assert.equal(models,3,'同一原始对话不重复研究');
 }finally{await host.close();}
});

test('持续研究关闭会取消真正的在途请求，已关闭模型不能由alarm恢复',async()=>{
 const f=fixture();let signal;
 const host=createBackgroundAI({...f.options,store:createAgentTaskStore(f.storeOptions),fetch:async(_url,options)=>{signal=options.signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 try{await host.wake();await until(()=>signal);f.config.ai.assistant.research.enabled=false;await host.wake();assert.equal(signal.aborted,true);assert.equal((await host.handle({type:'agent-list'},'1'))[0].status,'cancelled');}finally{await host.close();}
});

test('生成期间删除知识使结果失效，不把旧检查点来源重新写回知识库',async()=>{
 const f=fixture();let release;
 const host=createBackgroundAI({...f.options,store:createAgentTaskStore(f.storeOptions),fetch:async()=>new Promise(resolve=>{release=()=>resolve(response({action:'finish',answer:'旧结论',citations:[]}));})});
 try{
  await host.wake();await until(()=>release);await f.corpus.clear('1','10');release();
  const failed=await until(async()=>{const row=(await host.handle({type:'agent-list'},'1'))[0];return row?.status==='failed' && row;});
  assert.match(failed.error,/知识|删除|变化/);assert.deepEqual(await f.corpus.list('1','10'),[]);
 }finally{await host.close();}
});

test('扩展宿主中断后从搜索检查点继续，设置变更拒绝旧检查点恢复',async t=>{
 for(const change of [false,true])await t.test(String(change),async()=>{
  const f=fixture();let models=0,searches=0,inFlight;
  const fetcher=async(url,options)=>{
   if(url.includes('search.test')){searches++;return new Response(JSON.stringify({results:[{title:'观测',url:'https://example.org/a',content:'周期73天'}]}));}
   models++;if(models===1)return response({action:'search',query:'赤鹤星周期'});
   if(models===2){inFlight=options.signal;return new Promise((_,reject)=>inFlight.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}
   return response({action:'finish',answer:'周期73天',citations:[1]});
  };
  let host=createBackgroundAI({...f.options,store:createAgentTaskStore(f.storeOptions),fetch:fetcher});
  try{await host.wake();await until(()=>inFlight);await host.close();assert.equal(inFlight.aborted,true);
   if(change)f.config.ai.model='changed';
   host=createBackgroundAI({...f.options,store:createAgentTaskStore(f.storeOptions),fetch:fetcher});await host.ready;
   const row=await until(async()=>{const r=(await host.handle({type:'agent-list'},'1'))[0];return ['succeeded','failed'].includes(r?.status) && r;});
   assert.equal(row.status,change ? 'failed' : 'succeeded');assert.equal(searches,1);assert.equal(models,change ? 2 : 3);
   if(change)assert.match(row.error,/变化|检查点/);
  }finally{await host.close();}
 });
});
