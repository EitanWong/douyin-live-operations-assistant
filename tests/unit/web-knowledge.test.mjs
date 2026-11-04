import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {createWebKnowledge,knowledgeLifetime} from '../../src/services/web-knowledge.js';
import {createAIClient} from '../../src/services/ai.js';
import {createLocalReply} from '../../src/services/local-search.js';
import {mergeConfig} from '../../src/core/engine.js';

const settings=mergeConfig({ai:{search:{enabled:true}}}).ai;
const sources=(query,at)=>({provider:'bocha',query,searchedAt:at,results:[{index:1,title:'抖音直播PK规则',url:'https://www.douyin.com/rules',content:'PK活动规则以平台活动页面公布的信息为准。',publishedAt:null}]});
const prompt={task:{kind:'ai',data:{replyMode:'direct'}},target:{text:'抖音直播PK有什么规则？'},context:[],maxLength:80};
const plan=(intent,query='',reply='',freshness)=>JSON.stringify({intent,query,reply,...(freshness ? {freshness} : {})});
function setup(){let at=1800000000000;const indexedDB=new IDBFactory();return {indexedDB,now:()=>at,advance:ms=>at+=ms,open:()=>createWebKnowledge({indexedDB,IDBKeyRange,now:()=>at})};}

test('已查证网页资料跨实例复用；相关问题召回来源，配置隔离，过期不返回',async()=>{
 const env=setup(),first=env.open();
 await first.remember(sources('抖音直播PK规则',env.now()),settings.search,{freshness:'rules'});first.close();
 const second=env.open();try{
  const exact=await second.find(' 抖音直播PK规则 ',settings.search);assert.equal(exact.results[0].url,'https://www.douyin.com/rules');
  const related=await second.candidates('PK机制是什么',settings.search);assert.equal(related.length,1);assert.equal(related[0].id,exact.id);
  assert.equal(await second.find('抖音直播PK规则',{...settings.search,endpoint:'https://other.test/web-search'}),null);
  env.advance(86400000);assert.equal(await second.find('抖音直播PK规则',settings.search),null);assert.deepEqual(await second.candidates('PK',settings.search),[]);
 }finally{second.close();}
});

test('天气短时过期、规则不永久有效、稳定知识最多七天，未知默认短期且刷新请求跳过缓存',async()=>{
 assert.equal(knowledgeLifetime('上海天气','stable'),120000);
 assert.equal(knowledgeLifetime('抖音PK机制','stable'),86400000);
 assert.equal(knowledgeLifetime('水的化学式','stable'),604800000);
 assert.equal(knowledgeLifetime('不确定的问题'),600000);
 const env=setup(),cache=env.open();try{
  await cache.remember(sources('上海天气',env.now()),settings.search,{freshness:'stable'});
  assert.ok(await cache.find('上海天气',settings.search));assert.equal(await cache.find('上海天气',settings.search,{question:'请重新查上海天气'}),null);
  assert.deepEqual(await cache.candidates('最新天气重新查',settings.search),[]);
  env.advance(120000);assert.equal(await cache.find('上海天气',settings.search),null);
 }finally{cache.close();}
});

test('并发实例独立写入、容量有界；非法或未来来源不保存，清空和删除持久生效',async()=>{
 const env=setup(),a=env.open(),b=env.open();try{
  await Promise.all(Array.from({length:105},(_,i)=>(i%2 ? a : b).remember(sources(`常识${i}`,env.now()),settings.search,{freshness:'stable'})));
  let rows=await a.list();assert.equal(rows.length,100);const id=rows[0].id;await b.remove(id);assert.equal((await a.list()).length,99);
  for(const found of [{...sources('未来',env.now()+1)},{...sources('空结果',env.now()),results:[]},{...sources('非法网址',env.now()),results:[{index:1,url:'javascript:alert(1)',title:'x',content:'x'}]}])await a.remember(found,settings.search,{});
  assert.equal((await a.list()).length,99);
  const revision=await a.revision();await b.clear();await a.remember(sources('清空前在途查询',env.now()),settings.search,{revision});assert.deepEqual(await a.list(),[]);
 }finally{a.close();b.close();}
});

test('云端首次主动查询并学习；重启后改写提问复用来源，搜索和后续调用均不发生',async()=>{
 const env=setup();let cache=env.open(),searches=0;const history=[];
 let ai=createAIClient({knowledge:cache,generate:async p=>p.intentRouting ? plan('web-search','抖音直播PK规则','','rules') : '规则以活动页公布的信息为准。[1]',search:async query=>{searches++;return sources(query,env.now());},onSearch:r=>history.push(r)});
 assert.equal(await ai(prompt,settings),'规则以活动页公布的信息为准。');assert.deepEqual(history.at(-1).citationIndices,[1]);assert.equal(searches,2);assert.equal((await cache.list()).length,1);cache.close();
 cache=env.open();ai=createAIClient({knowledge:cache,generate:async p=>{assert.ok(p.knowledgeCandidates[0].results.length);return plan('knowledge',p.knowledgeCandidates[0].id,'规则以活动页为准。[1]');},search:()=>assert.fail('不应重复搜索'),onSearch:r=>history.push(r)});
 try{assert.equal(await ai({...prompt,target:{text:'直播PK机制是什么？'},reserveFollowup:()=>assert.fail('命中无第二次模型调用')},settings),'规则以活动页为准。');assert.equal(history.at(-1).cached,true);assert.deepEqual(settings.memory.entries,[]);}finally{cache.close();}
});

test('精确命中不消耗搜索额度；强制更新确实重查；停用学习不读写缓存',async()=>{
 const env=setup(),cache=env.open();let searches=0;
 const ai=createAIClient({knowledge:cache,generate:async p=>p.intentRouting ? plan('web-search','抖音直播PK规则','','rules') : '以活动页为准。[1]',search:async q=>{searches++;return sources(q,env.now());}});
 try{
  await ai(prompt,settings);await ai(prompt,settings);assert.equal(searches,2);
  await ai({...prompt,target:{text:'重新查一下最新抖音PK规则'}},settings);assert.equal(searches,4);
  await ai(prompt,{...settings,search:{...settings.search,rememberKnowledge:false}});assert.equal(searches,6);
 }finally{cache.close();}
});

test('未引用的答案、空结果、失败不学习；伪造缓存ID与引用不能直接发出',async()=>{
 const env=setup(),cache=env.open();try{
  for(const answer of ['没有来源的断言','无法确认。[99]','[SKIP]']){
   const ai=createAIClient({knowledge:cache,generate:async p=>p.intentRouting ? plan('web-search','抖音PK规则','','rules') : answer,search:async q=>sources(q,env.now())});await ai(prompt,settings);
  }
  assert.deepEqual(await cache.list(),[]);
  const ai=createAIClient({knowledge:cache,generate:async()=>plan('knowledge','00000000-0000-4000-8000-000000000000','编造结论。[1]')});assert.match(await ai(prompt,settings),/还不能确定/);
 }finally{cache.close();}
});

test('本地模型使用同一份长期资料，知识存储失败不会吞掉已完成回复',async()=>{
 const env=setup(),cache=env.open();try{
  await cache.remember(sources('抖音PK规则',env.now()),settings.search,{freshness:'rules'});
  const local=createLocalReply({knowledge:cache,edge:{reply:async p=>plan('knowledge',p.knowledgeCandidates[0].id,'以活动页为准。[1]')},search:()=>assert.fail()});assert.equal(await local(prompt,settings),'以活动页为准。');
  const broken={revision:async()=>{throw Error('storage denied');},candidates:async()=>{throw Error('storage denied');},find:async()=>{throw Error('storage denied');},remember:async()=>{throw Error('storage denied');}};
  const ai=createAIClient({knowledge:broken,generate:async p=>p.intentRouting ? plan('web-search','抖音PK规则','','rules') : '以活动页为准。[1]',search:async q=>sources(q,env.now())});assert.equal(await ai(prompt,settings),'以活动页为准。');
 }finally{cache.close();}
});

test('路由期间过期的缓存自动重查，停用搜索时仍可使用有效知识；虚构引用移除不吞答案',async()=>{
 const env=setup(),cache=env.open();let searches=0;
 try{
  await cache.remember(sources('抖音PK规则',env.now()),settings.search,{freshness:'rules'});
  const generate=async p=>p.intentRouting ? plan('knowledge',p.knowledgeCandidates[0].id,'以活动页为准。[1]') : '更新后以活动页为准。[1]';
  const offline=createAIClient({knowledge:cache,generate});assert.equal(await offline(prompt,{...settings,search:{...settings.search,enabled:false}}),'以活动页为准。');
  const invalid=createAIClient({knowledge:cache,generate:async p=>plan('knowledge',p.knowledgeCandidates[0].id,'错误引用。[99]')});assert.equal(await invalid(prompt,settings),'错误引用。');
  const expires=createAIClient({knowledge:cache,generate:async p=>{if(p.intentRouting)env.advance(86400000);return generate(p);},search:async q=>{searches++;return sources(q,env.now());}});
  assert.equal(await expires(prompt,settings),'更新后以活动页为准。');assert.equal(searches,2);
 }finally{cache.close();}
});

test('搜索空结果、网络失败、取消及私有后台研究不写入自动知识',async()=>{
 const env=setup(),cache=env.open();try{
  for(const mode of ['empty','failure','cancel']){
   let current=true;const ai=createAIClient({knowledge:cache,generate:async p=>p.intentRouting ? plan('web-search','抖音PK规则','','rules') : '本次活动规则未查到，请提供活动名称。',search:async q=>{if(mode==='failure')throw Error('network');if(mode==='cancel')current=false;return mode==='empty' ? {results:[]} : sources(q,env.now());}});
   const answer=await ai({...prompt,isCurrent:()=>current},settings);assert.match(answer,mode==='cancel' ? /SKIP/ : /活动规则未查到/);
  }
  const privateAI=createAIClient({knowledge:cache,generate:async p=>p.intentRouting ? plan('web-search','抖音PK规则','','rules') : '后台结论。[1]',search:async q=>sources(q,env.now())});await privateAI({...prompt,task:{kind:'agent'}},settings);
  assert.deepEqual(await cache.list(),[]);
 }finally{cache.close();}
});

test('相对日期的天气缓存不过北京时间午夜，避免把昨日的明天当成今天的明天',async()=>{
 let now=Date.parse('2026-11-04T23:59:30+08:00');const cache=createWebKnowledge({indexedDB:new IDBFactory(),IDBKeyRange,now:()=>now});
 try{await cache.remember(sources('上海明天天气',now),settings.search,{freshness:'realtime'});assert.ok(await cache.find('上海明天天气',settings.search));now+=30000;assert.equal(await cache.find('上海明天天气',settings.search),null);}finally{cache.close();}
});
