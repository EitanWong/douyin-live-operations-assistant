import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine,mergeConfig} from '../../src/core/engine.js';
import {createAIClient} from '../../src/services/ai.js';
import {createResilientAI} from '../../src/services/ai-resilience.js';
import {createSearchClient} from '../../src/services/search.js';
const flush=()=>new Promise(setImmediate);
test('搜索服务正文经过长上下文和真实调度后成为公屏回复的依据',async()=>{
 const spoken=[],records=[];let modelCalls=0,searchCalls=0;
 const request=details=>{
  let response;
  if(details.operation==='search'){
   searchCalls++;
   response={code:200,data:{webPages:{value:Array.from({length:3},(_,i)=>({name:`观测报告${i+1}`,url:`https://observatory.example/${i+1}`,summary:'观测背景。'.repeat(200)+(i===2 ? '本次测得赤鹤星周期为73天。' : '未发布周期。')}))}}};
  }else{
   modelCalls++;const body=JSON.parse(details.data),input=JSON.parse(body.messages[1].content);
   const source=input.web_search?.results.find(row=>/周期为\d+天/u.test(row.content));
   const days=source?.content.match(/周期为(\d+)天/u)?.[1];
   const output=input.web_search ? days ? `赤鹤星周期为${days}天。[${source.index}]` : '缺少测量结果。' : JSON.stringify({intent:'web-search',query:'赤鹤星观测周期',reply:''});
   response={choices:[{message:{content:output}}]};
  }
  details.onload({status:200,responseText:JSON.stringify(response)});
 };
 const search=createSearchClient({request,getKey:()=> 'search-key'});
 const ai=createAIClient({request,getKey:()=> 'model-key',search,onSearch:row=>records.push(row)});
 const engine=new Engine({ai,config:mergeConfig({mode:'preview',ai:{enabled:true,chatEnabled:true,knowledge:'本场背景。'.repeat(2000),pipeline:{contextBudgetChars:16000},search:{enabled:true}}}),log:(kind,text)=>{if(kind==='preview')spoken.push(text);}});
 engine.setIdentity({self:{id:'self',name:'助手'}});engine.start();
 try{
  engine.ingest({type:'chat',id:'period',user:{id:'viewer',name:'小鱼'},text:'赤鹤星观测周期是多少？'});
  for(let tries=0;tries<20 && !engine.queue.length;tries++)await flush();
  await engine.tick();
  assert.deepEqual(spoken,['赤鹤星周期为73天。[3]']);
  assert.equal(records[0].answer,spoken[0]);assert.match(records[0].results[2].content,/73天/u);
  assert.equal(modelCalls,2);assert.equal(searchCalls,1);assert.equal(engine.researchAI.size,0);
 }finally{engine.stop();}
});

test('真实问答调度经语义路由与搜索完成后自动回复，期间继续响应其他@且不重复搜索',async()=>{
 let now=1800000000000,finishSearch,searches=0,local=0;const spoken=[],sources=[],requests=[];
 const cloud=createAIClient({getKey:()=> 'test-key',search:async query=>{
  searches++;assert.equal(query,'上海明天天气');return new Promise(resolve=>{finishSearch=()=>resolve({query,results:[{index:1,title:'天气',content:'上海明天晴',url:'https://weather.example'}]});});
 },onSearch:row=>sources.push(row),request:details=>{
  const body=JSON.parse(details.data),input=JSON.parse(body.messages[1].content);requests.push(input);
  const output=input.web_search ? '上海明天晴。[1]' : JSON.stringify(input.target.text.includes('天气') ? {intent:'web-search',query:'上海明天天气',reply:''} : {intent:'chat',query:'',reply:'你好。'});
  details.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:output}}]})});
 }});
 const ai=createResilientAI({cloud,edge:{ready:async()=>true,reply:async()=>{local++;return '未查证回复';}}});
 const engine=new Engine({ai,now:()=>now,config:mergeConfig({mode:'preview',ai:{enabled:true,chatEnabled:true,search:{enabled:true}}}),log:(kind,text)=>{if(kind==='preview')spoken.push(text);}});
 engine.setIdentity({self:{id:'self',name:'助手'}});engine.start();
 try{
  engine.ingest({type:'chat',id:'weather',user:{id:'a',name:'甲'},text:'@助手 上海明天天气怎么样'});await flush();assert.equal(searches,1);
  engine.ingest({type:'chat',id:'greeting',user:{id:'b',name:'乙'},text:'@助手 你好'});await flush();await engine.tick();assert.deepEqual(spoken,['你好。']);
  now+=60000;finishSearch();await flush();await engine.tick();
  assert.ok(spoken.includes('上海明天晴。[1]'));assert.equal(searches,1);assert.equal(local,0);assert.equal(sources.length,1);
  assert.equal(requests.length,3);assert.equal(engine.calls.length,3);assert.equal(engine.researchAI.size,0);
 }finally{engine.stop();}
});

test('观众普通PK提问主动查证，后续改写问题经持久知识路由回复且不重复请求搜索',async()=>{
 const {IDBFactory,IDBKeyRange}=await import('fake-indexeddb');
 const {createWebKnowledge}=await import('../../src/services/web-knowledge.js');
 const indexedDB=new IDBFactory();let now=1800000000000,searches=0,calls=0;const spoken=[],history=[];
 const config=mergeConfig({mode:'preview',ai:{enabled:true,chatEnabled:true,search:{enabled:true}}});
 for(let turn=0;turn<2;turn++){
  const knowledge=createWebKnowledge({indexedDB,IDBKeyRange,now:()=>now});
  const cloud=createAIClient({knowledge,getKey:()=> 'test-key',search:async query=>{searches++;return {provider:'bocha',query,searchedAt:now,results:[{index:1,title:'抖音PK规则',url:'https://www.douyin.com/rules',content:'活动规则以平台页面为准。',publishedAt:null}]};},onSearch:r=>history.push(r),request:details=>{
   calls++;const body=JSON.parse(details.data),input=JSON.parse(body.messages[1].content);
   assert.match(body.messages[0].content,input.web_search ? /查证阶段已经完成/ : /主动查证/);assert.match(body.messages[0].content,/抖音官方/);
   const candidate=input.knowledge_candidates[0],output=input.web_search ? '活动规则以平台页面为准。[1]' : JSON.stringify(candidate ? {intent:'knowledge',query:candidate.id,reply:'活动规则以平台页面为准。[1]'} : {intent:'web-search',query:'抖音PK规则',reply:'',freshness:'rules'});
   details.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:output}}]})});
  }});
  const ai=createResilientAI({cloud,edge:{ready:async()=>true,reply:()=>assert.fail('不应抢先返回未核实回复')}});
  const engine=new Engine({ai,config,now:()=>now,log:(kind,text)=>{if(kind==='preview')spoken.push(text);}});
  engine.setIdentity({self:{id:'self',name:'助手'}});engine.start();
  try{
   engine.ingest({type:'chat',id:`pk${turn}`,user:{id:`u${turn}`,name:'观众'},text:turn ? '@助手 PK机制是什么？' : '@助手 抖音PK有什么规则？'});
   for(let tries=0;tries<100 && !engine.queue.length;tries++)await flush();
   await engine.tick();assert.equal(spoken.length,turn+1);assert.match(spoken.at(-1),/活动规则/);assert.equal(engine.researchAI.size,0);assert.deepEqual(engine.config.ai.memory.entries,[]);
  }finally{engine.stop();knowledge.close();}
  now+=10000;
 }
 assert.equal(searches,1);assert.equal(calls,3);assert.equal(history.at(-1).cached,true);
});
