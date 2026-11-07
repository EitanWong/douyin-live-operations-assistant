import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {createAgentTaskStore} from '../../src/ai/task-store.js';
import {createBackgroundAI} from '../../extension/ai-background.js';
import {createSharedKnowledge} from '../../src/services/shared-knowledge.js';
import {createRelationshipLibrary} from '../../src/ai/relationship-library.js';
import {createBackgroundResearch} from '../../src/services/relationship-research.js';
import {mergeConfig} from '../../src/core/engine.js';
const until=async check=>{for(let i=0;i<400;i++){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,3));}assert.fail('后台任务未完成');};
const original='小雨现在住杭州，是阿明的助理。请补充茶具清洗知识。';
function fixture({invalid=false}={}){
 const values={'live-assistant:config:1':mergeConfig({anchorId:'10',ai:{enabled:true,endpoint:'https://model.test/chat/completions',model:'test',search:{enabled:true,provider:'tavily',endpoint:'https://search.test/search'}}}),'live-assistant:search-key:https://search.test':'fixture-key','live-assistant:config:2':mergeConfig({anchorId:'20'})};
 const shared=createSharedKnowledge({read:async k=>values[k],all:async()=>values,commit:async rows=>{for(const [k,v] of rows)values[k]=structuredClone(v);}});
 const all=async()=>{await shared.ensure();return values;},library=createRelationshipLibrary({all}),store=createAgentTaskStore({indexedDB:new IDBFactory(),IDBKeyRange});let calls=0,searches=0,read=0,mode='initial';
 const host=createBackgroundAI({store,chrome:{permissions:{contains:async()=>true}},readRecord:async key=>/^live-assistant:config:/u.test(key) ? shared.config(key.split(':').at(-1)) : values[key],saveSupplement:(...args)=>shared.supplement(...args),relationships:(room,q,o)=>library.query(room,q,{},o),knowledge:{handle:async(_r,action)=>action==='version' ? 0 : []},fetch:async(url,options)=>{
  if(url==='https://search.test/search'){searches++;return {status:200,url,text:async()=>JSON.stringify({results:[{title:'茶具说明',url:'https://example.org/tea',content:'茶具用温水清洗。'}]})};}
  if(url==='https://example.org/tea'){read++;return new Response('<html><head><title>茶具说明</title></head><body><article><p>茶具用温水清洗。</p></article></body></html>',{headers:{'content-type':'text/html'}});}
  const body=JSON.parse(options.body),data=JSON.parse(body.messages[1].content);assert.ok(data.target.supplement);assert.match(body.messages[0].content,/updates/);calls++;
  let action;
  if(mode==='initial'){
   const actions=[{action:'relationships',query:'小雨阿明'},{action:'knowledge',query:'茶具清洗'},{action:'search',query:'茶具清洗温水'},{action:'read',source:1}];
   action=actions[calls-1] || {action:'finish',answer:'已整理人物与茶具知识。',citations:[1],updates:[{title:'小雨资料',content:'人物：小雨。当前居住地：杭州。小雨是阿明的助理。',evidence:[{source:0,quote:invalid ? '杜撰原话' : '小雨现在住杭州，是阿明的助理。'}]},{title:'茶具清洗',content:'茶具用温水清洗。',evidence:[{source:1,quote:'茶具用温水清洗。'}]}]};
  }else{
   const id=data.target.supplement.entryId;assert.ok(data.target.supplementEntries.some(row=>row.id===id));
   action={action:'finish',answer:'更正当前住址并撤销旧关系。',citations:[],updates:[{id,title:'小雨资料',content:'人物：小雨。当前居住地：横店。小雨不是阿明的助理。',evidence:[{source:0,quote:'小雨现在住横店，不是阿明的助理。'}]}]};
  }
  return {status:200,url,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify(action)}}]})};
 }});
 const run=async(text,entryId)=>{const id=crypto.randomUUID();await host.handle({type:'agent-submit',id,question:'补充知识并更新人物关系',input:{context:{},supplement:{text,...(entryId ? {entryId} : {})}}},'1');return until(async()=>{const row=(await host.handle({type:'agent-list'},'1')).find(j=>j.id===id);return ['succeeded','failed'].includes(row?.status) && row;});};
 return {host,shared,library,run,setCorrection:()=>mode='correction',counts:()=>({calls,searches,read})};
}
test('单段原话经真实后台Agent检索、搜索、读原文，自动保存跨房间知识；再次补充更新同一人物和关系',async()=>{
 const f=fixture();try{
  const job=await f.run(original);assert.equal(job.status,'succeeded',job.error);assert.equal(job.result.knowledgeStored,true);assert.deepEqual(f.counts(),{calls:5,searches:1,read:1});
  assert.ok(job.trace.some(row=>row.step==='knowledge:save'));assert.ok(job.trace.some(row=>row.step==='tool:relationships'));
  const entries=(await f.shared.config('2')).ai.memory.entries;assert.equal(entries.length,2);assert.equal(entries[0].origin.room,'1');assert.equal(entries[0].supplement.text,original);assert.equal(entries[1].supplement.evidence[0].source,'https://example.org/tea');
  let graph=await f.library.query('2','小雨阿明');assert.equal(graph.relations.find(r=>r.predicate==='助理').negative,false);assert.equal(graph.relations[0].status,'unverified');
  f.setCorrection();const updated=await f.run('小雨现在住横店，不是阿明的助理。',entries[0].id);assert.equal(updated.status,'succeeded',updated.error);assert.equal((await f.shared.config('1')).ai.memory.entries.length,2);
  graph=await f.library.query('2','小雨阿明');assert.equal(graph.relations.find(r=>r.predicate==='助理').negative,true);const person=graph.entities.find(n=>n.name==='小雨');assert.ok(person.dossier.facets.some(row=>row.text==='横店'));assert.ok(!person.dossier.facets.some(row=>row.text==='杭州'));
 }finally{await f.host.close();}
});
test('模型杜撰依据时整个补充失败，没有部分写入知识库',async()=>{
 const f=fixture({invalid:true});try{const job=await f.run(original);assert.equal(job.status,'failed');assert.match(job.error,/原话/);assert.deepEqual((await f.shared.config('1')).ai.memory.entries,[]);}finally{await f.host.close();}
});
test('前台观察自动保存回执时允许本任务的知识更新，不把成功保存误判为设置变化',async()=>{
 let config=mergeConfig({anchorId:'10',ai:{enabled:true}}),id;
 const service=createBackgroundResearch({getConfig:()=>config,getContext:()=>({}),tasks:async()=>({submit:async job=>{id=job.id;assert.equal(job.input.supplement.text,'补充原话');return {id};},list:async()=>{config=structuredClone(config);config.ai.memory.entries.push({id:'saved'});return [{id,status:'succeeded',result:{knowledgeStored:true,entries:[],answer:'已完成'}}];},cancel:async()=>assert.fail('成功保存不应取消')})});
 assert.equal((await service.run({question:'补充知识',supplement:{text:'补充原话'}})).knowledgeStored,true);
});
