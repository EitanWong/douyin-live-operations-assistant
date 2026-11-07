import {NATIVE_HOST} from './native-perception.js';

export function createPublicMediaWorkerClient({connect,onResult=()=>{},analyzeVisual=async()=>{throw Error('作品视觉分析不可用');},allowed=()=>true,timeoutMs=3000}){
 let port=null,probe=null,running=false,starting=null;const pending=new Map(),visuals=new Map();
 const close=()=>{
  const previous=port;port=null;running=false;probe=null;
  for(const controller of visuals.values())controller.abort();visuals.clear();
  for(const row of pending.values()){clearTimeout(row.timer);row.reject(Error('公开视频后台连接已关闭'));}pending.clear();
  previous?.disconnect();
 };
 const visual=(current,message)=>{
  const {id}=message;if(typeof id!=='string' || !/^[a-z0-9-]{1,80}$/u.test(id) || visuals.has(id))return;
  if(visuals.size || !allowed()){current.postMessage({id,type:'public-media',action:'visual-result',error:true});return;}
  const controller=new AbortController();visuals.set(id,controller);
  const active=()=>port===current && visuals.get(id)===controller && !controller.signal.aborted;
  void Promise.resolve().then(()=>analyzeVisual({job:message.job,frame:message.frame},{signal:controller.signal})).then(result=>{
   if(active() && allowed())current.postMessage({id,type:'public-media',action:'visual-result',text:result.text,model:result.model});
  }).catch(()=>{if(active())current.postMessage({id,type:'public-media',action:'visual-result',error:true});}).finally(()=>{if(visuals.get(id)===controller)visuals.delete(id);});
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
     if(message.type==='public-media-visual'){visual(current,message);return;}
     if(message.type==='public-media-visual-cancel'){visuals.get(message.id)?.abort();visuals.delete(message.id);return;}
     if(message.type==='public-media-result'){onResult(message.value);return;}
     if(message.type==='public-media-idle'){close();return;}
     const row=pending.get(message.id);if(!row)return;
     pending.delete(message.id);clearTimeout(row.timer);
     if(message.error)row.reject(Error('本机公开视频任务不可用'));else row.resolve(message.value);
    });
    const value=await ask('capabilities');
    if(value?.publicMedia!==3 || value.modelLease!==1 || value.keyframes!==1){close();return false;}
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
