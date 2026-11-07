import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installNativeASRBridge} from '../../extension/native-asr.js';
function events(){const listeners=[];return {addListener:fn=>listeners.push(fn),emit:value=>listeners.forEach(fn=>fn(value))};}
test('存在未知或旧 ASR 宿主时不启动后台模型，确认租约能力或断开后才允许',()=>{
 let connect;const host={onMessage:events(),onDisconnect:events(),postMessage(){},disconnect(){}};
 const ownership=installNativeASRBridge({runtime:{onConnect:{addListener:fn=>connect=fn},connectNative:()=>host}});
 assert.equal(ownership.backgroundAllowed(),true);
 const url='https://live.douyin.com/1',client={name:'native-asr',sender:{frameId:0,url,tab:{url}},onMessage:events(),onDisconnect:events(),postMessage(){},disconnect(){}};
 connect(client);client.onMessage.emit({id:'status',action:'status'});
 assert.equal(ownership.backgroundAllowed(),false);
 host.onMessage.emit({id:'status',value:{phase:'ready'}});assert.equal(ownership.backgroundAllowed(),false);
 host.onMessage.emit({id:'status',value:{phase:'ready',modelLease:1}});assert.equal(ownership.backgroundAllowed(),true);
 client.onDisconnect.emit();assert.equal(ownership.backgroundAllowed(),true);
});
