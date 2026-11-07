import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAIClient,makeAIRequest} from '../../src/services/ai.js';
import {makeEdgeMessages} from '../../src/ai/edge-prompt.js';
import {mergeConfig} from '../../src/core/engine.js';
import {withDeadline} from '../../src/services/ai-resilience.js';

test('前台云端与端侧的意图协议均明确允许后台研究',()=>{
 const ai=mergeConfig().ai,prompt={task:{kind:'ai'},target:{text:'研究这条线索'},intentRouting:true,backgroundResearchAvailable:true};
 const systems=[makeAIRequest(prompt,ai).messages[0].content,makeEdgeMessages(prompt,ai)[0].content];
 for(const system of systems){
  const choices=system.match(/"intent":"([^"{}]+\|[^"{}]+)"/u)?.[1].split('|');
  assert.ok(choices?.includes('research'),'模型输出协议必须允许 research，不能与后文的交接指令矛盾');
 }
});

test('前台只判断需求和组织回复，研究交给后台，等待期间仍可响应另一条对话',async()=>{
 const calls=[];let finish,researching=false,noticed=false;
 const client=createAIClient({generate:async(prompt,ai)=>{
  calls.push({prompt,model:ai.model});
  if(prompt.intentRouting)return prompt.target.text==='你好' ? '{"intent":"chat","query":"","reply":"你好呀。"}' : '{"intent":"research","query":"核对人物原话和经历","reply":""}';
  assert.equal(prompt.answerDraft,'后台已核对原话，兴趣是陶瓷；其他经历未知。');
  return '{"answer":"他提过喜欢陶瓷，其他经历还不清楚。","sources":[1]}';
 },search:()=>assert.fail('前台不能直接执行研究搜索'),research:async({question})=>{
  assert.equal(question,'研究他的兴趣和经历');researching=true;
  return new Promise(resolve=>{finish=()=>resolve({answer:'后台已核对原话，兴趣是陶瓷；其他经历未知。',citationIndices:[1],sources:[{index:1,url:'https://evidence.test/a',content:'我喜欢陶瓷。'}],stopReason:'complete'});});
 }});
 const ai=mergeConfig().ai;
 const pending=client({task:{kind:'ai'},target:{text:'研究他的兴趣和经历'},maxLength:80,onLookup:()=>{noticed=true;}},ai);
 await new Promise(setImmediate);assert.equal(researching,true);assert.equal(noticed,true);
 assert.equal(await client({task:{kind:'ai'},target:{text:'你好'},maxLength:80},ai),'你好呀。');
 finish();assert.equal(await pending,'他提过喜欢陶瓷，其他经历还不清楚。');
 assert.equal(calls.length,3);assert.ok(calls.every(row=>row.model===ai.model));
});

test('不限时后台等待跨越旧两分钟截止，显式取消仍中止',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let finish,signal;const controller=new AbortController();
 const pending=withDeadline(current=>{signal=current;return new Promise(resolve=>{finish=resolve;});},{signal:controller.signal,timeout:Infinity});
 t.mock.timers.tick(3600000);assert.equal(signal.aborted,false);finish('完成');assert.equal(await pending,'完成');
 const cancelled=withDeadline(()=>new Promise(()=>{}),{signal:controller.signal,timeout:Infinity});
 const rejected=assert.rejects(cancelled,{name:'AbortError'});controller.abort();await rejected;
});
