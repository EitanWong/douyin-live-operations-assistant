import {detectDevice} from '../src/browser/device-capabilities.js';
import {createModelPreparation} from './model-preparation.js';

// Offscreen documents support chrome.runtime only; the service worker owns storage.
async function persistence(action,state){
 const result=await chrome.runtime.sendMessage({target:'edge-background',action,state});
 if(!result || result.error)throw new Error(result?.error || '模型准备状态暂不可用');return result.value;
}

const manager=createModelPreparation({
 read:()=>persistence('preparation-read'),
 write:state=>persistence('preparation-write',state),
 createWorker:()=>new Worker(chrome.runtime.getURL('edge-worker.js'),{type:'module'}),detect:detectDevice,
 onChange:state=>{void chrome.runtime.sendMessage({target:'edge-background',state}).catch(()=>{});}
});
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(m?.target!=='edge-offscreen' || sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')))return;
 void (async()=>{
  await manager.ready;
  if(m.action==='device')return detectDevice();
  if(m.action==='status')return manager.status();
  if(m.action==='prepare')return manager.prepare(m.kind,m.model);
  if(m.action==='release')return manager.release();
  if(m.action==='cancel')return manager.cancel(m.id);
  if(m.action==='infer')return manager.infer(m);
  throw new Error('端侧请求无效');
 })().then(value=>reply({value}),()=>reply({error:'端侧模型暂不可用，请查看准备进度后重试。'}));return true;
});
