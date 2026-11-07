import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeConfig,validateConfig} from '../../src/core/engine.js';
import {validateAgentInput} from '../../src/ai/agent.js';
import {validateEndpoint,makeAIRequest} from '../../src/services/ai.js';
import {requestJSON} from '../../src/services/search.js';

test('研究默认预算允许持续深度查证，保存与任务边界保留用户预算',()=>{
 const config=mergeConfig({ai:{assistant:{research:{intervalSec:30,maxPerHour:120,modelCalls:64,searches:32,reads:48,sources:100,modelCallsPerHour:6000,searchesPerHour:2400,requestTimeoutSec:300,timeoutSec:3600,maxOutputTokens:32768}}}});
 assert.doesNotThrow(()=>validateConfig(config));
 const input=validateAgentInput({anchor:'10',ai:config.ai,context:{}});
 assert.equal(input.ai.assistant.research.modelCalls,64);
 assert.equal(input.ai.assistant.research.requestTimeoutSec,300);
 assert.ok(mergeConfig({}).ai.search.maxResults>=10);
 const defaults=mergeConfig({}).ai.assistant.research;
 assert.equal(defaults.enabled,true);assert.equal(defaults.profileEnabled,true);
 for(const [key,value] of Object.entries(defaults))if(typeof value==='number')assert.equal(value,0,key+' 默认不限');
});

test('Responses 中转接口贯通端点校验、推理预算、请求转换和最终文本解析',async()=>{
 const endpoint='https://relay.example/v1/responses';
 assert.equal(validateEndpoint(endpoint),endpoint);
 const ai=mergeConfig({ai:{endpoint,model:'deep-model'}}).ai;
 const body=makeAIRequest({task:{kind:'agent'},researchInstruction:'只输出JSON',target:{text:'核对资料'},maxLength:1000},ai);
 let sent;
 const result=await requestJSON(details=>{
  sent=JSON.parse(details.data);
  details.onload({status:200,responseText:JSON.stringify({status:'completed',output:[{type:'reasoning',summary:[]},{type:'message',role:'assistant',content:[{type:'output_text',text:'{"action":"finish","answer":"核对完成","citations":[]}'}]}]})});
 },{url:endpoint,key:'test',body});
 assert.equal(sent.messages,undefined);
 assert.equal(sent.input[0].role,'system');
 assert.equal(sent.max_output_tokens,undefined,'默认由服务商决定输出上限');
 assert.equal(result.choices[0].message.content,'{"action":"finish","answer":"核对完成","citations":[]}');
});

test('Responses 不完整输出不能被当作研究已完成',async()=>{
 await assert.rejects(requestJSON(d=>d.onload({status:200,responseText:JSON.stringify({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output_text:'部分结论'})}),{url:'https://relay.example/v1/responses',body:{model:'test',messages:[]}}),/未完成|incomplete/);
});

test('0等待时限不会在旧25秒处中断，手动正数时限仍取消请求',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let waiting,aborted=false;
 const request=details=>{waiting=details;return {abort(){aborted=true;}};};
 const unlimited=requestJSON(request,{url:'https://model.test/chat/completions',body:{},timeout:0});
 t.mock.timers.tick(3600000);assert.equal(aborted,false);assert.equal(waiting.timeout,0);
 waiting.onload({status:200,responseText:'{"choices":[{"message":{"content":"完成"}}]}'});
 assert.equal((await unlimited).choices[0].message.content,'完成');
 const limited=requestJSON(request,{url:'https://model.test/chat/completions',body:{},timeout:20});
 const rejected=assert.rejects(limited,/超时/);t.mock.timers.tick(20);await rejected;assert.equal(aborted,true);
});
