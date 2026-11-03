import {NATIVE_HOST} from './native-perception.js';

export function installNativeASRBridge(chrome){
 chrome.runtime.onConnect?.addListener(client=>{
  if(client.name!=='native-asr')return;
  let valid=false;try{const s=client.sender;valid=s.frameId===0 && new URL(s.url).origin==='https://live.douyin.com' && s.url===s.tab.url;}catch{}
  if(!valid){client.disconnect();return;}
  let host,closed=false;
  client.onDisconnect.addListener(()=>{closed=true;host?.disconnect();});
  client.onMessage.addListener(m=>{
   if(!['prepare','infer','status'].includes(m?.action) || typeof m.id!=='string' || m.id.length>80 || m.action==='infer' && (typeof m.data!=='string' || m.data.length>640100))return;
   try{
    if(!host){
     host=chrome.runtime.connectNative(NATIVE_HOST);
     host.onMessage.addListener(value=>{if(!closed)client.postMessage(value);});
     host.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(!closed)client.disconnect();});
    }
    host.postMessage({...m,type:'local-asr'});
   }catch{client.disconnect();}
  });
 });
}
