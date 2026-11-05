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
test('离屏文档仅使用runtime，通过后台读写持久任务；其他来源不能改写任务',async()=>{
 let saved={},handler;const oldChrome=globalThis.chrome,oldWorker=globalThis.Worker;
 const listeners=[],workers=[];
 const background={storage:{local:{get:async key=>({[key]:saved}),set:async value=>{saved=value['local-model-preparation-v1'];}}},runtime:{id:'ext',getURL:path=>`chrome-extension://ext/${path}`,onConnect:events(),onMessage:{addListener:fn=>listeners.push(fn)}}};
 installEdgeBridge(background);
 const request=(message,sender={id:'ext',url:'chrome-extension://ext/edge-offscreen.html'})=>new Promise(resolve=>{
  const result=listeners[0](message,sender,resolve);if(result!==true)resolve(undefined);
 });
 globalThis.chrome={runtime:{id:'ext',getURL:background.runtime.getURL,sendMessage:request,onMessage:{addListener:fn=>{handler=fn;}}}};
 globalThis.Worker=class{constructor(){workers.push(this);}postMessage(message){this.message=message;}terminate(){}};
 try{
  await import(`../../extension/edge-offscreen.js?runtime-only=${crypto.randomUUID()}`);
  const send=message=>new Promise(resolve=>handler({...message,target:'edge-offscreen'},{id:'ext',url:'chrome-extension://ext/background.js'},resolve));
  const result=await send({action:'prepare',kind:'audio'});
  assert.equal(result.value.phase,'loading');assert.equal(saved.audio.id,result.value.id);assert.equal(workers.length,1);
  const loaded=await request({target:'edge-background',action:'preparation-read'});assert.equal(loaded.value.audio.id,saved.audio.id);
  await request({target:'edge-background',action:'preparation-write',state:{}},{id:'ext',url:'https://live.douyin.com/123'});
  assert.equal(saved.audio.phase,'loading');await send({action:'release'});assert.equal(saved.audio.phase,'released');
 }finally{globalThis.chrome=oldChrome;globalThis.Worker=oldWorker;}
});
