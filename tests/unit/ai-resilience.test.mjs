import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withDeadline,createResilientAI} from '../../src/services/ai-resilience.js';
import {Engine,mergeConfig} from '../../src/core/engine.js';

test('联网问答等待语义路由和查证完成，端侧不抢先用未核实回复取消云端',async()=>{
 let local=0;const ai=createResilientAI({cloud:async p=>{await new Promise(r=>setTimeout(r,15));p.onLookup({query:'上海天气'});await new Promise(r=>setTimeout(r,20));return '上海晴。[1]';},
  edge:{ready:async()=>true,reply:async()=>{local++;return '没有天气资料。';}}});
 const answer=await ai({task:{kind:'ai'},target:{text:'上海今天天气怎么样'}},{search:{enabled:true},edge:{enabled:true},latency:{cloudMs:25,totalMs:30,edgeDelayMs:1}});
 assert.equal(answer,'上海晴。[1]');assert.equal(local,0);
});

test('deadline aborts transport and discards late completion',async()=>{
 let aborted=false;
 await assert.rejects(withDeadline(signal=>new Promise(resolve=>{signal.addEventListener('abort',()=>{aborted=true;resolve('late');});}),{timeout:10}),/超时/);
 assert.equal(aborted,true);
});
test('prepared local fallback receives current prompt after cloud timeout, no cold download',async()=>{
 let local=0,aborted=false;const traces=[];
 const ai=createResilientAI({cloud:(_p,_c,{signal})=>new Promise(()=>signal.addEventListener('abort',()=>{aborted=true;})),
  edge:{ready:async()=>true,reply:async p=>{local++;assert.equal(p.target.text,'中文问题');return '可以试试蓝色。';}},onTrace:r=>traces.push(r)});
 assert.equal(await ai({target:{text:'中文问题'},isCurrent:()=>true},{edge:{enabled:true},latency:{cloudMs:10,totalMs:200}}),'可以试试蓝色。');
 assert.equal(aborted,true);assert.equal(local,1);assert.equal(traces.at(-1).provider,'edge');
 const unavailable=createResilientAI({cloud:async()=>{throw Error('offline');},edge:{ready:async()=>false,reply:async()=>{local++;}}});
 await assert.rejects(unavailable({},{edge:{enabled:true}}),/offline/);assert.equal(local,1);
});
test('cancellation never starts fallback or accepts stale answers',async()=>{
 const c=new AbortController();let local=0;
 const ai=createResilientAI({cloud:async()=>{c.abort();throw Error('cancelled');},edge:{ready:async()=>true,reply:async()=>{local++;}}});
 await assert.rejects(ai({signal:c.signal},{edge:{enabled:true}}),/取消/);assert.equal(local,0);
});
test('slow cloud races a prepared local model after the latency budget, loser is aborted and only one answer wins',async()=>{
 let aborted=false;const traces=[];
 const ai=createResilientAI({cloud:(_p,_c,{signal})=>new Promise(()=>signal.addEventListener('abort',()=>{aborted=true;})),edge:{ready:async()=>true,reply:async()=> '先说重点。'},onTrace:r=>traces.push(r)});
 assert.equal(await ai({},{edge:{enabled:true},latency:{cloudMs:1000,totalMs:2000,edgeDelayMs:10}}),'先说重点。');
 assert.equal(aborted,true);assert.ok(traces.at(-1).elapsedMs<500);assert.equal(traces.filter(r=>r.status==='ok').length,1);
});
test('a failed local race still accepts a valid cloud answer',async()=>{
 const ai=createResilientAI({cloud:async()=>{await new Promise(r=>setTimeout(r,30));return '云端答复';},edge:{ready:async()=>true,reply:async()=>{throw Error('local invalid');}}});
 assert.equal(await ai({},{edge:{enabled:true},latency:{cloudMs:1000,totalMs:2000,edgeDelayMs:10}}),'云端答复');
});
test('repeated cloud failures open a provider-specific circuit while local replies remain available',async()=>{
 let calls=0;const ai=createResilientAI({cloud:async()=>{calls++;throw Error('offline');},edge:{ready:async()=>true,reply:async()=> '本地回复'}});
 for(let i=0;i<3;i++)assert.equal(await ai({},{endpoint:'https://service.example',model:'a',edge:{enabled:true}}),'本地回复');
 assert.equal(calls,2);await ai({},{endpoint:'https://service.example',model:'b',edge:{enabled:true}});assert.equal(calls,3);
});
test('stopping engine aborts active inference and a late result cannot unlock a newer call',async()=>{
 const pending=[];const engine=new Engine({config:mergeConfig({ai:{enabled:true,intervalSec:0,userCooldownSec:0}}),ai:p=>new Promise(resolve=>pending.push({p,resolve}))});
 engine.start();const old=engine.requestAI();assert.equal(pending.length,1);
 engine.stop();assert.equal(pending[0].p.signal.aborted,true);engine.start();const next=engine.requestAI();assert.equal(pending.length,2);
 pending[0].resolve('旧回复');await old;assert.equal(engine.aiBusy,true);assert.equal(engine.queue.length,0);
 pending[1].resolve('新回复');await next;assert.equal(engine.aiBusy,false);assert.equal(engine.queue[0].text,'新回复');engine.stop();
});
test('local-only and exhausted operator quota never invoke cloud; unavailable local fails explicitly',async()=>{
 let cloud=0;const ai=createResilientAI({cloud:async()=>{cloud++;return '云端';},edge:{ready:async()=>true,reply:async()=> '本地'}});
 assert.equal(await ai({cloudAllowed:false},{edge:{enabled:true}}),'本地');
 assert.equal(await ai({},{edge:{enabled:true,localOnly:true}}),'本地');assert.equal(cloud,0);
 const unavailable=createResilientAI({cloud:async()=>cloud++,edge:{ready:async()=>false}});
 await assert.rejects(unavailable({cloudAllowed:false},{edge:{enabled:true}}),/本地|端侧/);assert.equal(cloud,0);
});
test('billing exhaustion pauses only the affected provider and automatically serves prepared local replies',async()=>{
 let cloud=0,now=1000;const ai=createResilientAI({now:()=>now,cloud:async()=>{cloud++;throw Object.assign(Error('quota'),{status:402,aiQuota:true});},edge:{ready:async()=>true,reply:async()=> '本地'}});
 const c={endpoint:'https://service.example',model:'a',edge:{enabled:true}};
 assert.equal(await ai({},c),'本地');assert.equal(await ai({},c),'本地');assert.equal(cloud,1);
 await ai({},{...c,model:'b'});assert.equal(cloud,2);now+=300001;await ai({},c);assert.equal(cloud,3);
});
test('engine reaches prepared local inference after its cloud quota is exhausted',async()=>{
 let cloud=0;const ai=createResilientAI({cloud:async()=>{cloud++;return '云端';},edge:{ready:async()=>true,reply:async()=> '端侧兜底'}});
 const engine=new Engine({config:mergeConfig({ai:{enabled:true,maxPerHour:1,edge:{enabled:true}}}),ai});engine.start();
 try{await engine.requestAI();await engine.requestAI();assert.equal(cloud,1);assert.ok(engine.queue.some(r=>r.text==='端侧兜底'));}finally{engine.stop();}
});
test('addressed chat can use local quota after cloud cap without bypassing the local cap',async()=>{
 let now=1800000000000,cloud=0;const ai=createResilientAI({cloud:async()=>{cloud++;return '{"intent":"chat","reply":"云端"}';},edge:{ready:async()=>true,reply:async()=> '本地回复'}});
 const engine=new Engine({now:()=>now,config:mergeConfig({ai:{enabled:true,chatEnabled:true,maxPerHour:1,edge:{enabled:true,maxPerHour:1}}}),ai});engine.start();engine.calls=[now];
 try{
  engine.requestChatAI({type:'chat',user:{id:'a',name:'观众'},text:'你好呀'},true);await new Promise(setImmediate);
  assert.equal(cloud,0);assert.equal(engine.queue[0]?.text,'本地回复');assert.equal(engine.localCalls.length,1);
  now+=21000;engine.requestChatAI({type:'chat',user:{id:'b',name:'其他人'},text:'再聊一句'},true);await new Promise(setImmediate);assert.equal(engine.localCalls.length,1);
 }finally{engine.stop();}
});
