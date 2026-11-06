import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createResearchAgent} from '../../src/ai/agent.js';
import {mergeConfig} from '../../src/core/engine.js';
const ai=mergeConfig().ai;
const job={scope:'1:10',question:'明天天气',input:{anchor:'10',ai:{...ai,endpoint:'https://model.test/chat/completions',model:'test',search:{enabled:true,provider:'tavily',endpoint:'https://search.test/search',maxResults:2,maxPerHour:10}},context:{now:Date.now(),context:[]},sources:[]}};
test('受限Agent按计划实际搜索并带来源综合，最多两次模型，持久步骤可见',async()=>{
 const requests=[],steps=[];let models=0,reserved=0;
 const execute=createResearchAgent({getKey:()=> 'test',reserve:async()=>reserved++,readPublicPage:async()=>{},request:details=>{requests.push(details.operation);let data;
 if(details.operation==='search')data={results:[{title:'天气预报',url:'https://weather.example/tomorrow',content:'明天小雨'}]};
 else{models++;data={choices:[{message:{content:models===1 ? '{"action":"search","query":"北京明天天气"}' : '{"action":"finish","answer":"明天小雨","citations":[1]}'}}]};}
 details.onload({status:200,responseText:JSON.stringify(data)});}});
 const result=await execute(job,{signal:new AbortController().signal,checkpoint:async step=>steps.push(step)});
 assert.deepEqual(requests,['ai','search','ai']);assert.equal(result.answer,'明天小雨');assert.deepEqual(result.citationIndices,[1]);assert.equal(result.sources[0].url,'https://weather.example/tomorrow');assert.equal(models,2);assert.equal(reserved,2);assert.ok(steps.includes('plan'));
});
test('Agent输入不携带额外密钥字段，取消不会发模型请求',async()=>{
 let sent=0;const execute=createResearchAgent({getKey:()=> 'test',request:()=>{sent++;},readPublicPage:async()=>{}});const c=new AbortController();c.abort();
 await assert.rejects(execute({...job,input:{...job.input,sources:['https://example.com']}},{signal:c.signal,checkpoint:async()=>{}}),/取消/);assert.equal(sent,0);
});

test('后台研究使用研究输出预算和Agent技能，不受公屏短句模板限制',async()=>{
 let body;const execute=createResearchAgent({getKey:()=> 'test',readPublicPage:async()=>{},request:details=>{body=JSON.parse(details.data);details.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:'{"action":"finish","answer":"资料核对结果","citations":[]}'}}]})});}});
 const custom={version:1,id:'research',name:'研究核对',scenes:['agent'],instructions:'先核对来源再总结可确认范围'};
 await execute({...job,input:{...job.input,ai:{...job.input.ai,assistant:{memoryEnabled:true,skills:[custom]}}}},{signal:new AbortController().signal,checkpoint:async()=>{}});
 assert.match(body.messages[0].content,/先核对来源再总结/);assert.ok(body.max_tokens>=1000);assert.doesNotMatch(body.messages[0].content,/只输出一条可直接发公屏/);
});

test('三份长公开资料经过预算裁剪仍可研究，并披露读取范围',async()=>{
 let body;const execute=createResearchAgent({getKey:()=> 'test',readPublicPage:async url=>({url,title:'资料',text:'公开茶具保养资料'.repeat(1000),coverage:'text only'}),request:details=>{body=JSON.parse(details.data);details.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:'{"action":"finish","answer":"仅依据提供资料核对","citations":[1,2,3]}'}}]})});}});
 const result=await execute({...job,question:'公开茶具保养',input:{...job.input,sources:['https://example.com/a','https://example.com/b','https://example.com/c']}},{signal:new AbortController().signal,checkpoint:async()=>{}});
 const data=JSON.parse(body.messages[1].content);assert.equal(data.target.agent_state.catalog.length,3);assert.equal(data.target.public_sources,undefined);assert.ok(data.target.agent_state.evidence.every(row=>row.content.length<=600));assert.equal(result.publicSources[0].truncated,true);assert.equal(result.sources[0].content.length,6000);
});
