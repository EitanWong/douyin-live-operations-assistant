import {TEXT_MODELS} from '../src/ai/device-policy.js';
export function installEdgeBridge(chrome){
 let creating;
 const ensure=async()=>{
  const url=chrome.runtime.getURL('edge-offscreen.html');
  if((await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[url]})).length)return;
  creating ||= chrome.offscreen.createDocument({url:'edge-offscreen.html',reasons:['WORKERS'],justification:'运行用户已启用的中文本地模型 Worker，提供离线推理。'}).finally(()=>{creating=null;});
  await creating;
 };
 chrome.runtime.onConnect?.addListener(port=>{
  if(port.name!=='edge-ai')return;
  const sender=port.sender;let valid=false;
  try{valid=sender.frameId===0 && new URL(sender.url).origin==='https://live.douyin.com' && sender.url===sender.tab.url;}catch{}
  if(!valid){port.disconnect();return;}
  const active=new Set(),cancelled=new Set();let closed=false;
  const send=async m=>chrome.runtime.sendMessage({...m,target:'edge-offscreen'});
  port.onMessage.addListener(m=>{
   if(closed || typeof m?.id!=='string' || !/^[a-z0-9-]{36}$/iu.test(m.id))return;
   void (async()=>{
    try{
     if(!['status','device','prepare','infer','cancel','release'].includes(m.action) || JSON.stringify(m).length>810000)throw new Error('端侧请求无效');
     if(m.action==='prepare' && m.kind==='text' && m.model && !TEXT_MODELS[m.model])throw new Error('端侧模型无效');
     if(m.action==='infer' && (m.kind==='text' ? !Array.isArray(m.messages) || JSON.stringify(m.messages).length>8000 || !Number.isInteger(m.maxLength) || m.maxLength<1 || m.maxLength>50 : m.kind!=='audio' || typeof m.data!=='string' || m.data.length>800000))throw new Error('端侧输入超出预算');
     if(m.action==='cancel'){cancelled.add(m.id);while(cancelled.size>128)cancelled.delete(cancelled.values().next().value);await send({...m,id:`${sender.tab.id}:${m.id}`});return;}
     await ensure();if(closed)return;if(cancelled.has(m.id))throw new Error('端侧请求已取消');active.add(m.id);
     const value=await send({...m,id:`${sender.tab.id}:${m.id}`});if(!closed)port.postMessage({...value,id:m.id});
    }catch{if(!closed)port.postMessage({id:m.id,error:'端侧服务不可用，请重新准备模型。'});}finally{active.delete(m.id);}
   })();
  });
  port.onDisconnect.addListener(()=>{closed=true;for(const id of active)void send({action:'cancel',id:`${sender.tab.id}:${id}`}).catch(()=>{});});
 });
}
