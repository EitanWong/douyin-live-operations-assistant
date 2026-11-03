import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine,mergeConfig} from '../../src/core/engine.js';
import {createAIClient} from '../../src/services/ai.js';
import {createResilientAI} from '../../src/services/ai-resilience.js';
const flush=()=>new Promise(setImmediate);
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
