import {textCandidates} from '../src/ai/device-policy.js';

export const MODEL_PREPARATION_KEY='local-model-preparation-v1';
const kinds=['text','audio'];
const resumable=new Set(['queued','loading','ready']);
export function createModelPreparation({read,write,createWorker,detect,onChange=()=>{}}){
 const states={},slots=new Map();let closed=false,writing=Promise.resolve();
 const status=()=>structuredClone(states);
 const persist=()=>{const snapshot=status();const result=writing.then(()=>write(snapshot));writing=result.catch(()=>{});return result.then(()=>onChange(snapshot));};
 const current=slot=>!closed && slots.get(slot.kind)===slot;
 const update=async(slot,patch)=>{if(!current(slot))return;states[slot.kind]={...states[slot.kind],...patch,updatedAt:Date.now()};await persist();};
 const terminate=slot=>{slot.worker?.terminate();slot.inference?.reject(new Error('端侧请求已取消'));slot.inference=null;};
 async function load(slot){
  if(!current(slot))return;
  slot.worker=createWorker();const worker=slot.worker;
  worker.onmessage=({data})=>{
   if(!current(slot) || slot.worker!==worker)return;
   if(data.id===slot.id && states[slot.kind].phase==='loading'){
    if(data.progress){void update(slot,{progress:data.progress}).catch(()=>{});return;}
    void complete(slot,data).catch(()=>{});return;
   }
   if(slot.inference?.id===data.id){const job=slot.inference;slot.inference=null;data.error ? job.reject(new Error(data.error)) : job.resolve(data.value);}
  };
  worker.onerror=()=>{if(current(slot) && slot.worker===worker)void complete(slot,{error:'模型执行器中断，请重试'}).catch(()=>{});};
  worker.postMessage({action:'prepare',kind:slot.kind,id:slot.id,model:slot.candidates[slot.index]});
 }
 async function complete(slot,data){
  if((data.error || data.value?.phase==='slow') && slot.index+1<slot.candidates.length){
   terminate(slot);slot.index++;await update(slot,{progress:{stage:'fallback'}});await load(slot);return;
  }
  if(data.error || data.value?.phase==='slow')terminate(slot);
  await update(slot,data.error ? {phase:'error',error:'本地模型准备失败，请检查网络、WebGPU和存储后重试',progress:{stage:'error'}} : {...data.value,progress:{stage:data.value?.phase==='ready' ? 'ready' : 'slow'}});
 }
 async function begin(kind,selection,previous){
  const active=slots.get(kind);
  if(active && active.selection===selection && ['queued','loading','ready'].includes(states[kind]?.phase))return states[kind];
  if(active && ['queued','loading'].includes(states[kind]?.phase))throw new Error('模型正在后台准备，请先释放后再更换');
  if(active)terminate(active);
  const slot={kind,selection,id:previous?.id || crypto.randomUUID(),index:0,candidates:[]};slots.set(kind,slot);
  states[kind]={id:slot.id,kind,selection,phase:'queued',updatedAt:Date.now(),progress:{stage:previous ? 'restoring' : 'queued'}};
  try{
   await persist();if(!current(slot))return states[kind];
   slot.candidates=kind==='text' ? textCandidates(selection,await detect()) : [undefined];
   if(!slot.candidates.length)throw new Error('此设备不支持本地文字模型');
   await update(slot,{phase:'loading'});await load(slot);
  }catch(error){if(current(slot)){states[kind]={...states[kind],phase:'error',error:error.message,progress:{stage:'error'}};await persist().catch(()=>{});}throw error;}
  return states[kind];
 }
 const ready=(async()=>{
  const saved=await read() || {};
  for(const kind of kinds){const row=saved[kind];if(row?.kind===kind && typeof row.id==='string')states[kind]=row;}
  for(const kind of kinds){const row=states[kind];if(row && resumable.has(row.phase))await begin(kind,row.selection,row).catch(()=>{});}
 })();
 return {ready,status,async prepare(kind,selection='auto'){
   await ready;if(!kinds.includes(kind))throw new Error('模型类型无效');return begin(kind,selection);
  },async release(){await ready;for(const slot of slots.values())terminate(slot);slots.clear();for(const kind of kinds)if(states[kind])states[kind]={...states[kind],phase:'released',progress:{stage:'released'}};await persist();},
  async infer(message){await ready;const kind=message.kind==='vision' ? 'text' : message.kind,slot=slots.get(kind);if(states[kind]?.phase!=='ready' || !slot?.worker || message.kind==='vision' && states.text.vision?.phase!=='ready')throw new Error('端侧模型尚未就绪');if(slot.inference)throw new Error('端侧推理繁忙');
   return new Promise((resolve,reject)=>{slot.inference={id:message.id,resolve,reject};slot.worker.postMessage(message);});
  },cancel(id){for(const slot of slots.values())if(slot.inference?.id===id){terminate(slot);void update(slot,{phase:'loading',vision:{phase:'unavailable'},progress:{stage:'restoring'}}).then(()=>load(slot)).catch(()=>{});}},
  close(){closed=true;for(const slot of slots.values())terminate(slot);slots.clear();}};
}
