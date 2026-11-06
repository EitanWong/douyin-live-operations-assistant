import {TEXT_MODELS} from '../src/ai/device-policy.js';
import {MODEL_PREPARATION_KEY} from './model-preparation.js';
export function installEdgeBridge(chrome){
 let creating;const clients=new Set();
 const ensure=async()=>{
  const url=chrome.runtime.getURL('edge-offscreen.html');
  if((await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]})).length)return;
  creating ||= chrome.offscreen.createDocument({url:'edge-offscreen.html',reasons:['WORKERS'],justification:'运行用户已启用的中文本地模型 Worker，提供离线推理。'}).finally(()=>{creating=null;});
  await creating;
 };
 const restore=async()=>{try{const state=(await chrome.storage.local.get(MODEL_PREPARATION_KEY))[MODEL_PREPARATION_KEY];if(Object.values(state || {}).some(row=>['queued','loading','ready'].includes(row.phase)))await ensure();}catch{}};
 void restore();chrome.runtime.onStartup?.addListener(restore);chrome.runtime.onInstalled?.addListener(restore);
 chrome.runtime.onMessage?.addListener((message,sender,reply)=>{
  if(message?.target!=='edge-background' || sender.id!==chrome.runtime.id || sender.url!==chrome.runtime.getURL('edge-offscreen.html'))return;
  if(['preparation-read','preparation-write'].includes(message.action)){
   const operation=message.action==='preparation-read' ? chrome.storage.local.get(MODEL_PREPARATION_KEY).then(value=>value[MODEL_PREPARATION_KEY]) : chrome.storage.local.set({[MODEL_PREPARATION_KEY]:message.state});
   void operation.then(value=>reply({value}),()=>reply({error:'模型准备状态无法保存，请检查扩展存储'}));return true;
  }
  for(const client of clients)try{client.postMessage({type:'edge-state',value:message.state});}catch{}
 });
 chrome.runtime.onConnect?.addListener(port=>{
  if(port.name!=='edge-ai')return;
  const sender=port.sender;let valid=false;
  try{valid=sender.frameId===0 && new URL(sender.url).origin==='https://live.douyin.com' && sender.url===sender.tab.url;}catch{}
  if(!valid){port.disconnect();return;}
  clients.add(port);
  const active=new Set(),cancelled=new Set();let closed=false;
  const send=async m=>chrome.runtime.sendMessage({...m,target:'edge-offscreen'});
  port.onMessage.addListener(m=>{
   if(closed || typeof m?.id!=='string' || !/^[a-z0-9-]{36}$/iu.test(m.id))return;
   void (async()=>{
    try{
     if(!['status','device','prepare','infer','cancel','release'].includes(m.action) || JSON.stringify(m).length>810000)throw new Error('端侧请求无效');
     if(m.action==='prepare' && (!['text','audio'].includes(m.kind) || m.kind==='text' && m.model && m.model!=='auto' && !TEXT_MODELS[m.model]))throw new Error('端侧模型无效');
     if(m.action==='infer' && (m.kind==='text' ? !Array.isArray(m.messages) || JSON.stringify(m.messages).length>8000 || !Number.isInteger(m.maxLength) || m.maxLength<1 || m.maxLength>(m.intentRouting===true ? 600 : 50) : m.kind==='vision' ? typeof m.data!=='string' || m.data.length>400000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/u.test(m.data) : m.kind!=='audio' || typeof m.data!=='string' || m.data.length>800000))throw new Error('端侧输入超出预算');
     if(m.action==='cancel'){cancelled.add(m.id);while(cancelled.size>128)cancelled.delete(cancelled.values().next().value);await send({...m,id:`${sender.tab.id}:${m.id}`});return;}
     await ensure();if(closed && m.action!=='prepare')return;if(cancelled.has(m.id))throw new Error('端侧请求已取消');if(m.action==='infer')active.add(m.id);
     const value=await send({...m,id:`${sender.tab.id}:${m.id}`});if(!closed)port.postMessage({...value,id:m.id});
    }catch{if(!closed)port.postMessage({id:m.id,error:'端侧服务不可用，请重新准备模型。'});}finally{active.delete(m.id);}
   })();
  });
  port.onDisconnect.addListener(()=>{closed=true;clients.delete(port);for(const id of active)void send({action:'cancel',id:`${sender.tab.id}:${id}`}).catch(()=>{});});
 });
}
