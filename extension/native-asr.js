import {NATIVE_HOST} from './native-perception.js';
import {onPortDisconnect} from '../src/browser/extension-port.js';

export function installNativeASRBridge(chrome){
 const owners=new Map();
 chrome.runtime.onConnect?.addListener(client=>{
  if(client.name!=='native-asr')return;
  let valid=false;try{const s=client.sender;valid=s.frameId===0 && new URL(s.url).origin==='https://live.douyin.com' && s.url===s.tab.url;}catch{}
  if(!valid){client.disconnect();return;}
  let host,closed=false;
  onPortDisconnect(client,()=>{closed=true;owners.delete(client);host?.disconnect();},chrome.runtime);
  client.onMessage.addListener(m=>{
   if(!['prepare','infer','status'].includes(m?.action) || typeof m.id!=='string' || m.id.length>80 || m.action==='infer' && (typeof m.data!=='string' || m.data.length>640100))return;
   try{
    if(!host){
     host=chrome.runtime.connectNative(NATIVE_HOST);
     owners.set(client,false);
     host.onMessage.addListener(value=>{if(closed)return;if(value?.value?.modelLease===1)owners.set(client,true);client.postMessage(value);});
     host.onDisconnect.addListener(()=>{owners.delete(client);void chrome.runtime.lastError;if(!closed)client.disconnect();});
    }
    host.postMessage({...m,type:'local-asr'});
   }catch{client.disconnect();}
  });
 });
 return {backgroundAllowed:()=>[...owners.values()].every(Boolean)};
}
