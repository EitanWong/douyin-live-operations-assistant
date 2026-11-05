import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installEdgeBridge} from '../../extension/edge-background.js';
import {createEdgeClient} from '../../src/browser/edge-client.js';
const events=()=>{const listeners=[];return {addListener:f=>listeners.push(f),emit:(...args)=>listeners.forEach(f=>f(...args))};};
const flush=()=>new Promise(setImmediate);
test('页面断开只取消推理，不撤销准备；后台启动恢复已有模型任务',async()=>{
 const sent=[];let created=0;
 const chrome={storage:{local:{get:async()=>({'local-model-preparation-v1':{text:{phase:'loading'}}})}},offscreen:{createDocument:async()=>{created++;}},runtime:{id:'ext',getURL:path=>`chrome-extension://ext/${path}`,getContexts:async()=>[],onConnect:events(),onMessage:events(),onStartup:events(),onInstalled:events(),sendMessage:async m=>{sent.push(m);return {value:{phase:'loading'}};}}};
 installEdgeBridge(chrome);await flush();assert.equal(created,1);
 const port={name:'edge-ai',sender:{frameId:0,url:'https://live.douyin.com/123',tab:{id:7,url:'https://live.douyin.com/123'}},onMessage:events(),onDisconnect:events(),postMessage(){},disconnect(){}};
 chrome.runtime.onConnect.emit(port);port.onMessage.emit({id:crypto.randomUUID(),action:'prepare',kind:'text',model:'auto'});await flush();
 assert.ok(sent.some(m=>m.action==='prepare' && m.model==='auto'));port.onDisconnect.emit();await flush();assert.equal(sent.filter(m=>m.action==='cancel').length,0);
});
test('客户端加入后台任务并订阅实际下载进度；关闭页面不向准备任务发送取消',async()=>{
 const messages=events(),disconnect=events(),sent=[],progress=[];let phase='loading';
 const client=createEdgeClient({pollMs:1,connect:()=>({onMessage:messages,onDisconnect:disconnect,disconnect(){},postMessage:m=>{
  sent.push(m);queueMicrotask(()=>messages.emit({id:m.id,value:m.action==='prepare' ? {id:'job',phase:'loading'} : {text:{id:'job',phase,progress:{stage:'download',loaded:5,total:10}}}}));
 }})});
 const unsubscribe=client.subscribe(state=>progress.push(state));const pending=client.prepare('text');await flush();
 messages.emit({type:'edge-state',value:{text:{phase:'loading',progress:{stage:'download',loaded:5,total:10}}}});phase='ready';
 assert.equal((await pending).phase,'ready');assert.equal(progress.at(-1).text.phase,'ready');
 phase='loading';const detached=client.prepare('text');await flush();client.close();await assert.rejects(detached,/关闭|断开/);
 assert.equal(sent.filter(m=>m.action==='cancel').length,0);unsubscribe();
});
