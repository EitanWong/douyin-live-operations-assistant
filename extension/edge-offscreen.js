import {detectDevice} from '../src/browser/device-capabilities.js';
const slots=new Map();
function release(kind){const slot=slots.get(kind);slot?.worker.terminate();slot?.job?.reply({error:'端侧请求已取消'});slots.delete(kind);}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(m?.target!=='edge-offscreen' || sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')))return;
 if(m.action==='device'){void detectDevice().then(value=>reply({value}),()=>reply({error:'设备检测失败'}));return true;}
 if(m.action==='status'){reply({value:Object.fromEntries([...slots].map(([kind,s])=>[kind,{...s.status,busy:Boolean(s.job)}]))});return;}
 if(m.action==='release'){for(const kind of slots.keys())release(kind);reply({value:true});return;}
 if(m.action==='cancel'){for(const [kind,s] of slots)if(s.job?.id===m.id)release(kind);reply({value:true});return;}
 if(!['text','audio'].includes(m.kind)){reply({error:'模型类型无效'});return;}
 let slot=slots.get(m.kind);
 if(slot?.job){reply({error:'端侧推理忙，本次跳过'});return;}
 if(m.action==='prepare'){
  release(m.kind);const worker=new Worker(chrome.runtime.getURL('edge-worker.js'),{type:'module'});slot={worker,status:{phase:'loading'}};slots.set(m.kind,slot);
  worker.onmessage=({data})=>{if(slot.job?.id!==data.id)return;const job=slot.job;slot.job=null;if(data.error)slot.status={phase:'error'};else if(job.action==='prepare')slot.status=data.value;job.reply(data);};
  worker.onerror=()=>{release(m.kind);};
 }else if(m.action!=='infer' || slot?.status.phase!=='ready'){reply({error:'端侧模型未就绪或性能不满足实时要求'});return;}
 slot.job={id:m.id,action:m.action,reply};slot.worker.postMessage(m);return true;
});
