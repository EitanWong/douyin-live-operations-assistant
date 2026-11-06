import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createResearchAgent} from '../../src/ai/agent.js';
import {mergeConfig} from '../../src/core/engine.js';
import {createResearchGraph} from '../../src/ai/research-graph.js';

const job={id:'research-loop',scope:'1:10',question:'赤鹤星周期和颜色分别是什么？',input:{anchor:'10',ai:mergeConfig({ai:{endpoint:'https://model.test/chat/completions',model:'test',search:{enabled:true,provider:'tavily',endpoint:'https://search.test/search'}}}).ai,context:{},sources:[]}};
function fixture(plans){
 const calls=[],steps=[];let reservations=0;
 const execute=createResearchAgent({getKey:()=> 'test-key',reserve:async()=>reservations++,readPublicPage:async url=>({url,title:'观测报告',text:'赤鹤星的颜色为蓝色。',readAt:Date.now()}),request:details=>{
  calls.push(details.operation);const data=details.operation==='search' ? {results:[{title:'观测记录',url:'https://example.org/period',content:'赤鹤星周期73天，颜色参见观测报告 https://example.org/color 。'}]} : {choices:[{message:{content:JSON.stringify(plans.shift())}}]};
  details.onload({status:200,responseText:JSON.stringify(data)});
 }});
 return {run:()=>execute(structuredClone(job),{signal:new AbortController().signal,checkpoint:async step=>steps.push(step)}),calls,steps,reservations:()=>reservations};
}
test('研究Agent按新证据继续选择工具，完成多跳查证并返回可核对引用',async()=>{
 const f=fixture([{action:'search',query:'赤鹤星周期'},{action:'read',url:'https://example.org/period'},{action:'finish',answer:'周期73天，颜色为蓝色。',citations:[1,2]}]);
 const result=await f.run();assert.equal(result.answer,'周期73天，颜色为蓝色。');assert.equal(result.modelCalls,3);
 assert.equal(f.reservations(),3);assert.deepEqual(result.citationIndices,[1,2]);assert.equal(result.sources.length,2);
 assert.ok(f.steps.includes('tool:search'));assert.ok(f.steps.includes('tool:read'));assert.equal(result.runtime,'langgraph');
});
test('模型不能读取尚未发现的任意链接，工具失败反馈回循环而不执行',async()=>{
 const f=fixture([{action:'read',url:'https://private.example.org/arbitrary'},{action:'finish',answer:'没有可核对的来源。',citations:[]}]);
 const result=await f.run();assert.equal(result.publicSources.length,0);assert.match(JSON.stringify(result.observations),/未在/);
});
test('反复搜索同一问题被去重；循环在固定预算内终止并披露未完成',async()=>{
 const f=fixture(Array.from({length:8},()=>({action:'search',query:'重复查询'})));
 const result=await f.run();assert.equal(f.calls.filter(v=>v==='search').length,1);
 assert.ok(result.modelCalls<=4);assert.equal(result.stopReason,'budget');assert.match(result.answer,/预算|未完成/);
});
test('伪造来源编号不能成为成功的研究结果',async()=>{
 const f=fixture([{action:'search',query:'赤鹤星'},{action:'finish',answer:'无依据结论',citations:[99]}]);
 await assert.rejects(f.run(),/引用|来源/);
});
test('来源已满时阅读已有链接仍把原文交给下一轮模型，引用保持有界',async()=>{
 let plans=0;
 const graph=createResearchGraph({search:async()=>({results:Array.from({length:8},(_,i)=>({url:`https://example.org/${i}`,title:'摘要',content:'最终数值只在原文'}))}),
  read:async url=>({url,title:'原文',text:'最终数值为42'}),plan:async state=>{
   if(++plans===1)return JSON.stringify({action:'search',query:'岚叶实验'});
   if(plans===2)return JSON.stringify({action:'read',url:'https://example.org/0'});
   assert.equal(state.sources.length,8);assert.equal(state.sources[0].content,'最终数值为42');
   return JSON.stringify({action:'finish',answer:'最终数值为42',citations:[1]});
  }});
 const result=await graph.run({id:'full-sources'});assert.equal(result.answer,'最终数值为42');assert.deepEqual(result.citationIndices,[1]);
});
