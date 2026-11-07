import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {createKnowledgeCorpus} from '../../src/ai/knowledge-corpus.js';
import {createKnowledgeMemory} from '../../src/services/automatic-knowledge.js';
import {createWebKnowledge} from '../../src/services/web-knowledge.js';
import {createAIClient} from '../../src/services/ai.js';
import {createLocalReply} from '../../src/services/local-search.js';
import {mergeConfig} from '../../src/core/engine.js';

const query='赤鹤星观测周期',question='赤鹤星观测周期是多少？';
const config=mergeConfig({ai:{search:{enabled:true,rememberKnowledge:true}}}).ai;
const prompt={task:{kind:'ai'},target:{text:question,memory:{key:'uid:3'}},maxLength:100};
const missing='这部分资料已变化，暂时还不能确定。';
async function fixture(){
 const now=Date.now(),values={},corpus=createKnowledgeCorpus({read:async k=>values[k],write:async(k,v)=>{values[k]=structuredClone(v);}});
 const source={url:'https://example.org/observations',title:'公开观测资料',content:'赤鹤星观测周期为73天。',publishedAt:null};
 await corpus.remember('1','10',[{...source,at:now-1000,expiresAt:now+60000}],{subject:'uid:10'});
 let rows=await corpus.list('1','10');
 const indexedDB=new IDBFactory(),open=()=>createWebKnowledge({indexedDB,IDBKeyRange});let cache=open();
 await cache.remember({query,searchedAt:now-1000,provider:'bocha',results:[{...source,index:1}]},config.search,{freshness:'stable'});
 cache.close();cache=open();
 const memory=createKnowledgeMemory({cache,anchor:()=> '10',transport:async action=>action==='list' ? rows : 0});
 return {now,source,cache,memory,close:()=>cache.close(),change:fn=>{rows=fn(rows);}};
}
const changes={
 deleted:async f=>f.change(()=>[]),
 expired:async f=>f.change(rows=>rows.map(r=>({...r,expiresAt:Date.now()-1}))),
 scope:async f=>f.change(rows=>rows.map(r=>({...r,subject:'uid:99'}))),
 content:async f=>f.change(rows=>rows.map(r=>({...r,text:'赤鹤星观测周期尚未确定。'}))),
 clear:async f=>f.cache.clear(),
 replaced:async f=>{
  f.change(rows=>rows.map(r=>({...r,text:'赤鹤星观测周期为81天。'})));
  await f.cache.remember({query,searchedAt:Date.now(),provider:'bocha',results:[{...f.source,index:1,content:'赤鹤星观测周期为81天。'}]},config.search,{freshness:'stable'});
 }
};

for(const mode of ['cloud','edge'])for(const phase of ['answer','refinement'])for(const [kind,change] of Object.entries(changes))test(`${mode} ${phase} ${kind}：普通搜索命中持久缓存后也不交付失效原文`,async()=>{
 const f=await fixture(),records=[];let calls=0,reserves=0;
 try{
  const options={knowledge:f.memory,search:()=>assert.fail('已命中资料，失效后不自动扩大搜索'),onSearch:r=>records.push(r),generate:async p=>{
   calls++;if(p.intentRouting)return JSON.stringify({intent:'web-search',query});
   assert.equal(p.searchResults.cached,true);assert.match(p.searchResults.results[0].content,/73天/u);
   if(phase==='answer' || p.answerDraft)await change(f);
   return JSON.stringify({answer:'观测周期73天。',sources:phase==='refinement' && !p.answerDraft ? [99] : [1]});
  }};
  const client=mode==='cloud' ? createAIClient(options) : createLocalReply({...options,edge:{reply:options.generate}});
  const reserve=()=>{reserves++;return true;};
  assert.equal(await client({...prompt,reserveFollowup:reserve,reserveLocal:reserve},config),missing);
  assert.deepEqual(records,[]);assert.equal(calls,phase==='answer' ? 2 : 3);assert.equal(reserves,phase==='answer' ? 1 : 2);
 }finally{f.close();}
});

test('缓存原文未变或仅新增无关资料时仍正常交付，无额外生成、不回写或延寿',async()=>{
 for(const unrelated of [false,true]){
  const f=await fixture(),before=await f.cache.list(),records=[];let calls=0,remembers=0;
  try{
   const client=createAIClient({knowledge:{...f.memory,remember:()=>remembers++},onSearch:r=>records.push(r),search:()=>assert.fail(),generate:async p=>{
    calls++;if(p.intentRouting)return JSON.stringify({intent:'web-search',query});
    if(unrelated)f.change(rows=>[...rows,{...rows[0],id:'b'.repeat(64),source:'https://example.org/other',text:'其他观测。'}]);
    return JSON.stringify({answer:'观测周期73天。',sources:[1]});
   }});
   assert.equal(await client({...prompt,reserveFollowup:()=>true},config),'观测周期73天。');
   assert.equal(calls,2);assert.equal(remembers,0);assert.equal(records[0].cached,true);assert.deepEqual(await f.cache.list(),before);
  }finally{f.close();}
 }
});

test('生成、修订或交付重读期间取消均返回SKIP且不通知旧来源',async()=>{
 for(const stop of ['answer','refinement','recheck']){
  const f=await fixture(),controller=new AbortController(),records=[];let calls=0,reads=0;
  const knowledge={...f.memory,find:async(...args)=>{const found=await f.memory.find(...args);if(++reads===2 && stop==='recheck')controller.abort();return found;}};
  try{
   const client=createAIClient({knowledge,onSearch:r=>records.push(r),search:()=>assert.fail(),generate:async p=>{
    calls++;if(p.intentRouting)return JSON.stringify({intent:'web-search',query});
    if(stop==='answer' || stop==='refinement' && p.answerDraft)controller.abort();
    return JSON.stringify({answer:'观测周期73天。',sources:stop==='refinement' && !p.answerDraft ? [99] : [1]});
   }});
   assert.equal(await client({...prompt,signal:controller.signal,reserveFollowup:()=>true},config),'[SKIP]');
   assert.deepEqual(records,[]);assert.equal(calls,stop==='refinement' ? 3 : 2);
  }finally{f.close();}
 }
});

test('新查得的公开来源仍可正常交付和学习，缓存读取故障不阻断新检索',async()=>{
 for(const broken of [false,true]){
  const records=[];let calls=0,remembers=0,searches=0;
  const knowledge={revision:async()=>0,candidates:async()=>[],find:async()=>{if(broken)throw Error('storage unavailable');return null;},remember:async()=>remembers++};
  const client=createAIClient({knowledge,onSearch:r=>records.push(r),search:async()=>{searches++;return {query,searchedAt:Date.now(),results:[{index:1,url:'https://example.org/new',content:'赤鹤星观测周期为73天。'}]};},generate:async p=>{calls++;return JSON.stringify(p.intentRouting ? {intent:'web-search',query} : {answer:'观测周期73天。',sources:[1]});}});
  assert.equal(await client(prompt,config),'观测周期73天。');assert.equal(calls,2);assert.equal(searches,1);assert.equal(remembers,1);assert.deepEqual(records.at(-1).citationIndices,[1]);
 }
});
