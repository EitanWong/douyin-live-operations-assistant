import {NATIVE_HOST} from './native-perception.js';

export function createPublicMediaWorkerClient({connect,onResult=()=>{},allowed=()=>true,timeoutMs=3000}){
 let port=null,probe=null,running=false,starting=null;const pending=new Map();
 const close=()=>{
  const previous=port;port=null;running=false;probe=null;
  for(const row of pending.values()){clearTimeout(row.timer);row.reject(Error('公开视频后台连接已关闭'));}pending.clear();
  previous?.disconnect();
 };
 const ask=action=>new Promise((resolve,reject)=>{
  const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('请更新本机组件以支持公开视频任务'));close();},timeoutMs);
  pending.set(id,{resolve,reject,timer});
  try{port.postMessage({id,type:'public-media',action});}catch{clearTimeout(timer);pending.delete(id);reject(Error('本机组件不可用'));close();}
 });
 const ready=()=>{
  if(!allowed())return Promise.resolve(false);
  if(probe)return probe;
  probe=(async()=>{
   try{
    const current=connect();port=current;
    current.onDisconnect.addListener(()=>{if(port===current)close();});
    current.onMessage.addListener(message=>{
     if(port!==current)return;
     if(message.type==='public-media-result'){onResult(message.value);return;}
     if(message.type==='public-media-idle'){close();return;}
     const row=pending.get(message.id);if(!row)return;
     pending.delete(message.id);clearTimeout(row.timer);
     if(message.error)row.reject(Error('本机公开视频任务不可用'));else row.resolve(message.value);
    });
    const value=await ask('capabilities');
    if(value?.publicMedia!==2 || value.modelLease!==1){close();return false;}
    return true;
   }catch{close();return false;}
  })();return probe;
 };
 return {ready,close,release:()=>{if(!running && !starting)close();},run:()=>{
  if(running)return Promise.resolve(true);if(starting)return starting;
  starting=(async()=>{if(!await ready())return false;const result=await ask('run');running=result?.accepted===true;return running;})().finally(()=>{starting=null;});return starting;
 }};
}

export const publicMediaWorkerClient=(chrome,options={})=>createPublicMediaWorkerClient({...options,connect:()=>chrome.runtime.connectNative(NATIVE_HOST)});
