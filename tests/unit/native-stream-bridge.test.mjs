import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installNativePerceptionBridge} from '../../extension/native-perception.js';

function events(){const listeners=[];return {addListener:fn=>listeners.push(fn),emit:value=>listeners.forEach(fn=>fn(value))};}
function fixture(){
 let connect;const sent=[],requests=[];
 const host={onMessage:events(),onDisconnect:events(),postMessage:value=>sent.push(value),disconnect(){}};
 const chrome={runtime:{onConnect:{addListener:fn=>connect=fn},connectNative:()=>host},scripting:{executeScript:async input=>{
  requests.push(input);return [{documentId:'current-doc',result:[{url:'https://pull.douyincdn.com/live/test.flv?sign=private'}]}];
 }}};
 installNativePerceptionBridge(chrome);
 const client={name:'native-perception',onMessage:events(),onDisconnect:events(),postMessage(){},disconnect(){},
  sender:{frameId:0,documentId:'current-doc',url:'https://live.douyin.com/123',tab:{id:7,url:'https://live.douyin.com/123'}}};
 connect(client);client.onMessage.emit({type:'start',room:'123',key:'secret',config:{inputSource:'native',transport:'webrtc',
  realtimeEndpoint:'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen3.8-omni-flash-realtime',realtimeModel:'qwen3.8-omni-flash-realtime',sessionMinutes:1,sessionTokens:1000,maxPerHour:10}});
 return {client,host,sent,requests,chrome};
}
test('原生自动抓流只读取绑定文档，不传 Cookie、无关字段或跨房间结果',async()=>{
 const f=fixture(),id='a'.repeat(32);
 f.host.onMessage.emit({type:'stream-request',id,room:'123'});await new Promise(setImmediate);
 assert.deepEqual(f.requests[0].target,{tabId:7,documentIds:['current-doc']});
 assert.deepEqual(f.requests[0].args,['123',{type:'resolve-stream'}]);
 assert.deepEqual(f.sent.at(-1),{type:'streams',id,room:'123',candidates:[{url:'https://pull.douyincdn.com/live/test.flv?sign=private'}]});
 const count=f.sent.length;f.host.onMessage.emit({type:'stream-request',id,room:'456'});await new Promise(setImmediate);assert.equal(f.sent.length,count);
});
test('离页、接口失败或旧文档返回空候选，由原生独立解析；停止后迟到结果丢弃',async()=>{
 for(const mode of ['detach','failure','old-document','stopped']){
  const f=fixture(),id='b'.repeat(32);let finish;
  if(mode==='detach')f.client.onDisconnect.emit();
  if(mode==='failure')f.chrome.scripting.executeScript=async()=>{throw Error('private-cookie');};
  if(mode==='old-document')f.chrome.scripting.executeScript=async()=>[{documentId:'old',result:[{url:'https://evil.test/a.flv'}]}];
  if(mode==='stopped')f.chrome.scripting.executeScript=()=>new Promise(resolve=>finish=resolve);
  f.host.onMessage.emit({type:'stream-request',id,room:'123'});
  if(mode==='stopped'){f.client.onMessage.emit({type:'stop'});finish([]);}
  await new Promise(setImmediate);
  assert.equal(f.sent.filter(row=>row.type==='streams').length,mode==='stopped'?0:1);
  if(mode!=='stopped')assert.deepEqual(f.sent.at(-1).candidates,[]);
  assert.doesNotMatch(JSON.stringify(f.sent),/private-cookie|evil\.test/);
 }
});
