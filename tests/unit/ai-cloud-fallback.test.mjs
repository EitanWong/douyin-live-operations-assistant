import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createResilientAI} from '../../src/services/ai-resilience.js';
import {Engine,mergeConfig,validateConfig} from '../../src/core/engine.js';
import {createAIClient} from '../../src/services/ai.js';

const flush=()=>new Promise(setImmediate);

for(const autoTune of [true,false])for(const ready of [true,false])test(`慢云端超过旧等待预算仍用云端（自动${autoTune}，端侧就绪${ready}）`,async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 let resolveCloud,signal,readyCalls=0,localCalls=0;const traces=[];
 const ai=createResilientAI({cloud:p=>{signal=p.signal;return new Promise(resolve=>{resolveCloud=resolve;});},
  edge:{tuning:()=>({cloudMs:8000,totalMs:16000}),ready:async()=>{readyCalls++;return ready;},reply:async()=>{localCalls++;return '本地';}},onTrace:row=>traces.push(row)});
 const pending=ai({target:{text:'今天穿什么'}},{edge:{enabled:true,autoTune},latency:{cloudMs:8000,totalMs:16000}});pending.catch(()=>{});
 try{
  t.mock.timers.tick(18000);await flush();
  assert.equal(signal.aborted,false);assert.equal(readyCalls,0);assert.equal(localCalls,0);
  resolveCloud('云端回复');assert.equal(await pending,'云端回复');assert.equal(traces.at(-1).provider,'cloud');
 }finally{resolveCloud('清理');await pending.catch(()=>{});}
});

test('实际云端失败后才检查端侧，端侧有独立的完整等待预算',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 let rejectCloud,resolveLocal,readyCalls=0,localCalls=0;const traces=[];
 const ai=createResilientAI({cloud:()=>new Promise((_,reject)=>{rejectCloud=reject;}),
  edge:{ready:async()=>{readyCalls++;return true;},reply:async p=>{localCalls++;assert.equal(p.target.text,'中文问题');return new Promise(resolve=>{resolveLocal=resolve;});}},onTrace:row=>traces.push(row)});
 const pending=ai({target:{text:'中文问题'}},{edge:{enabled:true},latency:{cloudMs:8000,totalMs:16000}});
 try{
  t.mock.timers.tick(26000);await flush();assert.equal(readyCalls,0);assert.equal(localCalls,0);
  rejectCloud(Object.assign(Error('服务端返回 HTTP 503'),{status:503}));await flush();
  assert.equal(readyCalls,1);assert.equal(localCalls,1);
  t.mock.timers.tick(15000);await flush();resolveLocal('端侧兜底');
  assert.equal(await pending,'端侧兜底');assert.equal(traces.at(-1).provider,'edge');
 }finally{rejectCloud(Error('清理'));resolveLocal?.('清理');await pending.catch(()=>{});}
});

test('停止慢云端请求会取消传输，不探测或调用端侧',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const controller=new AbortController();let signal,readyCalls=0;
 const ai=createResilientAI({cloud:p=>{signal=p.signal;return new Promise(()=>{});},edge:{ready:async()=>{readyCalls++;return true;},reply:async()=> '本地'}});
 const pending=ai({signal:controller.signal},{edge:{enabled:true}});const rejected=assert.rejects(pending,/取消/);
 t.mock.timers.tick(18000);await flush();controller.abort();await rejected;
 assert.equal(signal.aborted,true);assert.equal(readyCalls,0);
});

test('场控外层不在旧总时限取消仍在等待的云端回复',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let resolveCloud,signal,localCalls=0;
 const ai=createResilientAI({cloud:p=>{signal=p.signal;return new Promise(resolve=>{resolveCloud=resolve;});},edge:{ready:async()=>true,reply:async()=>{localCalls++;return '本地';}}});
 const engine=new Engine({config:mergeConfig({ai:{enabled:true,edge:{enabled:true,autoTune:false},latency:{cloudMs:8000,totalMs:16000}}}),ai});engine.start();
 const pending=engine.requestAI();
 try{
  t.mock.timers.tick(18000);await flush();assert.equal(signal.aborted,false);assert.equal(engine.aiBusy,true);assert.equal(localCalls,0);
  resolveCloud('蓝白搭配很清爽。');await pending;assert.ok(engine.queue.some(job=>job.text==='蓝白搭配很清爽。'));
 }finally{resolveCloud('清理');engine.stop();await pending;}
});

test('端侧等待预算不再受旧云端等待数值约束',()=>{
 const config=mergeConfig({ai:{latency:{cloudMs:25000,totalMs:2000}}});
 assert.doesNotThrow(()=>validateConfig(config));
});

test('真实HTTP回复入口等到18秒的云端成功，不探测端侧',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let request,aborts=0,readyCalls=0;
 const cloud=createAIClient({getKey:()=> 'fixture-key',request:details=>{request=details;return {abort(){aborts++;}};}});
 const ai=createResilientAI({cloud,edge:{ready:async()=>{readyCalls++;return true;},reply:async()=> '本地'}});
 const pending=ai({maxLength:50},mergeConfig().ai);pending.catch(()=>{});
 t.mock.timers.tick(18000);await flush();assert.equal(aborts,0);assert.equal(readyCalls,0);
 request.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:'云端回答'}}]})});
 assert.equal(await pending,'云端回答');
});

test('显式取消类错误不启动端侧；实际端侧推理仍受独立时限约束',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let readyCalls=0,signal;
 const cancelled=createResilientAI({cloud:async()=>{throw Object.assign(Error('取消'),{name:'AbortError'});},edge:{ready:async()=>{readyCalls++;return true;}}});
 await assert.rejects(cancelled({},{edge:{enabled:true}}),/取消/);assert.equal(readyCalls,0);
 const ai=createResilientAI({cloud:async()=>{throw Error('503');},edge:{ready:async()=>true,reply:p=>{signal=p.signal;return new Promise(()=>{});}}});
 const pending=ai({},{edge:{enabled:true},latency:{totalMs:16000}}),rejected=assert.rejects(pending,/超时/);
 await flush();t.mock.timers.tick(16000);await rejected;assert.equal(signal.aborted,true);
});

test('普通等待转入查询后仍执行明确设置的研究时限',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let lookup,signal,readyCalls=0;
 const ai=createResilientAI({cloud:p=>{lookup=p.onLookup;signal=p.signal;return new Promise(()=>{});},edge:{ready:async()=>{readyCalls++;return true;}}});
 const pending=ai({},{edge:{enabled:true},assistant:{research:{timeoutSec:1}}}),rejected=assert.rejects(pending,/超时/);
 t.mock.timers.tick(500);lookup({query:'关系资料'});t.mock.timers.tick(501);await rejected;
 assert.equal(signal.aborted,true);assert.equal(readyCalls,0);
});
