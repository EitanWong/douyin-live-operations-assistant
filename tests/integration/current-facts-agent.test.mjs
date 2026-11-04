import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createResearchAgent} from '../../src/ai/agent.js';
import {mergeConfig} from '../../src/core/engine.js';
test('后台Agent直接调用免密钥汇率工具，两次模型调用即可返回有来源答案',async()=>{
 const calls=[],trace=[];let reserves=0;
 const at=Date.now(),date=new Date(at).toISOString().slice(0,10);
 const ai=mergeConfig({ai:{search:{enabled:false}}}).ai;
 const agent=createResearchAgent({getKey:()=> 'model-secret',reserve:async()=>reserves++,request:d=>{
  calls.push(d);
  const content=calls.length===1 ? '{"intent":"public-data","call":{"tool":"exchange-rate","base":"CNY","quote":"USD","amount":100,"date":"latest"}}' : '{"answer":"100人民币约合14美元，按日参考汇率。","sources":[1]}';
  d.onload({status:200,responseText:JSON.stringify(d.operation==='public-data' ? {date,base:'CNY',quote:'USD',rate:0.14} : {choices:[{message:{content}}]}),finalUrl:d.url});
 }});
 const result=await agent({scope:'1:123',question:'100人民币现在大约合多少美元？',input:{anchor:'123',ai,context:{now:at},sources:[]}},{signal:new AbortController().signal,checkpoint:async(stage,detail)=>trace.push({stage,detail})});
 assert.equal(result.modelCalls,2);assert.equal(calls.length,3);assert.equal(calls[1].headers.Authorization,undefined);assert.equal(reserves,2);assert.match(result.answer,/14美元/u);assert.equal(result.sources.length,1);assert.deepEqual(result.citationIndices,[1]);
});
