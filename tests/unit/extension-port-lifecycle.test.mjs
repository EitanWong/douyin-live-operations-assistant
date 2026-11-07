import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEdgeClient} from '../../src/browser/edge-client.js';
import {createNativeASRClient} from '../../src/browser/native-asr-client.js';
import {readNativeSession,checkNativeComponent,createNativeCapture} from '../../src/browser/native-perception.js';
import {installEdgeBridge} from '../../extension/edge-background.js';
import {installNativeASRBridge} from '../../extension/native-asr.js';
import {installNativePerceptionBridge} from '../../extension/native-perception.js';
import {createPublicMediaWorkerClient} from '../../extension/public-media-worker-client.js';

const bfcacheError='The page keeping the extension port is moved into back/forward cache, so the message channel is closed.';
const flush=()=>new Promise(setImmediate);
const events=()=>{const listeners=[];return {addListener:fn=>listeners.push(fn),emit:value=>listeners.forEach(fn=>fn(value))};};
const config={inputSource:'native',transport:'webrtc',realtimeEndpoint:'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen3.8-omni-flash-realtime',realtimeModel:'qwen3.8-omni-flash-realtime',sessionMinutes:1,sessionTokens:1000,maxPerHour:10};
function port(name){
 const url='https://live.douyin.com/123';
 return {name,sender:{frameId:0,url,tab:{id:7,url}},sent:[],closed:0,onMessage:events(),onDisconnect:events(),postMessage(value){this.sent.push(value);},disconnect(){this.closed++;}};
}
function runtimeFixture(t,{global=false}={}){
 let current=null,unchecked=0,checked=0;
 const runtime={id:'ext',onConnect:events(),onMessage:events(),getURL:path=>`chrome-extension://ext/${path}`,
  get lastError(){if(current){current.read=true;checked++;return {message:bfcacheError};}}
 };
 const chrome={runtime};
 if(global){const original=globalThis.chrome;globalThis.chrome=chrome;t.after(()=>{if(original===undefined)delete globalThis.chrome;else globalThis.chrome=original;});}
 return {chrome,runtime,get unchecked(){return unchecked;},get checked(){return checked;},lost(p){
  current={read:false};try{p.onDisconnect.emit();}finally{if(!current.read)unchecked++;current=null;}
 }};
}

for(const [name,create,query,error] of [
 ['edge',createEdgeClient,c=>c.status(),/连接已断开/],
 ['native ASR',createNativeASRClient,c=>c.prepare(),/连接已关闭/]
])test(`${name}: BFCache disconnect rejects pending work, reconnects, and consumes stale-port errors synchronously`,async t=>{
 const f=runtimeFixture(t,{global:true}),ports=[];
 const client=create({connect:()=>{const p=port();ports.push(p);return p;}});t.after(()=>client.close());
 const pending=query(client),rejected=assert.rejects(pending,error);
 f.lost(ports[0]);await rejected;
 if(name==='native ASR')assert.equal(await client.ready(),false);
 const next=query(client);assert.equal(ports.length,2);
 f.lost(ports[0]);
 const p=ports[1];p.onMessage.emit({id:p.sent[0].id,value:{phase:'ready'}});
 assert.equal((await next).phase,'ready');
 assert.equal(f.unchecked,0);assert.equal(f.checked,2);
});

for(const [name,read] of [['session status',readNativeSession],['component probe',checkNativeComponent]])test(`${name}: BFCache disconnect settles the request and releases the port`,async t=>{
 const f=runtimeFixture(t,{global:true}),p=port();
 const pending=read(()=>p),rejected=assert.rejects(pending,/本地感知组件/);
 f.lost(p);await rejected;assert.equal(p.closed,1);
 assert.equal(f.unchecked,0);assert.equal(f.checked,1);
});

for(const ready of [false,true])test(`native capture: BFCache disconnect ${ready?'ends an active capture':'rejects setup'} without leaving unchecked errors`,async t=>{
 const f=runtimeFixture(t,{global:true}),p=port(),errors=[];let ended=0;
 const pending=createNativeCapture({connect:()=>p,getKey:()=> 'fixture-key',room:'123'})({config,onError:error=>errors.push(error.message),onEnded:()=>ended++});
 if(ready){p.onMessage.emit({type:'ready'});await pending;f.lost(p);assert.equal(ended,1);assert.match(errors[0],/本地感知组件/);}
 else{const rejected=assert.rejects(pending,/本地感知组件/);f.lost(p);await rejected;assert.equal(ended,0);}
 assert.equal(p.closed,1);assert.equal(f.unchecked,0);assert.equal(f.checked,1);
});

test('edge background: BFCache detaches the page and cancels inference while model preparation continues',async t=>{
 const f=runtimeFixture(t),sent=[],jobs=new Map();
 f.chrome.storage={local:{get:async()=>({})}};f.runtime.getContexts=async()=>[{}];
 f.runtime.sendMessage=async message=>{sent.push(message);if(['prepare','infer'].includes(message.action))return new Promise(resolve=>jobs.set(message.id,resolve));return {};};
 installEdgeBridge(f.chrome);const p=port('edge-ai');f.runtime.onConnect.emit(p);
 const prepare=crypto.randomUUID(),infer=crypto.randomUUID();
 p.onMessage.emit({id:prepare,action:'prepare',kind:'text',model:'auto'});
 p.onMessage.emit({id:infer,action:'infer',kind:'text',messages:[],maxLength:40});await flush();
 assert.equal(jobs.size,2);f.lost(p);await flush();
 assert.deepEqual(sent.filter(m=>m.action==='cancel').map(m=>m.id),[`7:${infer}`]);
 for(const resolve of jobs.values())resolve({value:{phase:'ready'}});await flush();assert.deepEqual(p.sent,[]);
 assert.equal(f.unchecked,0);assert.equal(f.checked,1);
});

test('native ASR background: BFCache closes the page-owned host and releases model ownership',t=>{
 const f=runtimeFixture(t),host=port();f.runtime.connectNative=()=>host;
 const ownership=installNativeASRBridge(f.chrome),p=port('native-asr');f.runtime.onConnect.emit(p);
 p.onMessage.emit({id:'status',action:'status'});assert.equal(ownership.backgroundAllowed(),false);
 f.lost(p);assert.equal(host.closed,1);assert.equal(ownership.backgroundAllowed(),true);
 assert.equal(f.unchecked,0);assert.equal(f.checked,1);
});

test('native perception background: BFCache preserves the room session and observations for a returning page',async t=>{
 const f=runtimeFixture(t),host=port(),saved=[];let connections=0;
 f.runtime.connectNative=()=>{connections++;return host;};
 installNativePerceptionBridge(f.chrome,{onObservation:async(room,row)=>saved.push({room,...row})});
 const p=port('native-perception');f.runtime.onConnect.emit(p);p.onMessage.emit({type:'start',room:'123',key:'fixture-key',config});
 host.onMessage.emit({type:'ready'});f.lost(p);assert.equal(host.closed,0);
 const at=Date.now();host.onMessage.emit({type:'observation',row:{kind:'omni',id:'during-bfcache',at,endedAt:at,text:'Background observation'}});await flush();
 assert.equal(saved[0].text,'Background observation');assert.equal(saved[0].room,'123');
 const resumed=port('native-perception');f.runtime.onConnect.emit(resumed);resumed.onMessage.emit({type:'resume',room:'123'});
 assert.equal(connections,1);assert.equal(resumed.sent[0].type,'ready');assert.equal(resumed.sent.at(-1).row.id,'during-bfcache');
 resumed.onMessage.emit({type:'stop'});assert.equal(host.closed,1);
 assert.equal(f.unchecked,0);assert.equal(f.checked,1);
});

test('public media worker: disconnect settles the capability check, permits retry, and ignores stale ports',async t=>{
 const f=runtimeFixture(t,{global:true}),ports=[];
 const client=createPublicMediaWorkerClient({connect:()=>{const p=port();ports.push(p);return p;}});t.after(()=>client.close());
 const pending=client.ready();f.lost(ports[0]);assert.equal(await pending,false);
 const next=client.ready();assert.equal(ports.length,2);f.lost(ports[0]);
 const p=ports[1];p.onMessage.emit({id:p.sent[0].id,value:{publicMedia:5,modelLease:1,keyframes:1,visualRelease:1}});
 assert.equal(await next,true);assert.equal(p.closed,0);
 assert.equal(f.unchecked,0);assert.equal(f.checked,2);
});
