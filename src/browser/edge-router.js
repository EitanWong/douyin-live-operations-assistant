import {recommendDevice,automaticLatency,TEXT_MODELS} from '../ai/device-policy.js';

export function createEdgeRouter({browser,native,config}){
 let autoAudio='browser-whisper',textStatus={},generation=0;const preparing=new Map();
 const audioBackend=()=>config().audioBackend==='auto' ? autoAudio : config().audioBackend;
 const audio=(backend=audioBackend())=>backend==='native-sensevoice' ? native : browser;
 const detect=async()=>{
  const [gpu,asr]=await Promise.allSettled([browser?.detect?.(),native?.inspect?.()]);
  const device=gpu.status==='fulfilled' ? gpu.value || {} : {},local=asr.status==='fulfilled' ? asr.value || {} : {};
  return {device,native:local,recommendation:recommendDevice(device,local)};
 };
 const runPrepare=async(kind,selection,epoch)=>{
  if(kind==='text'){
   if(!browser)throw new Error('浏览器端侧推理需要 Chrome 扩展');
   const result=await browser.prepare(kind,selection || config().textModel || 'auto');
   if(epoch!==generation)throw new Error('模型准备已取消');textStatus=result;return result;
  }
  const requested=selection || config().audioBackend;
  const selected=requested==='auto' ? (await detect()).recommendation.audioBackend : requested;
  if(epoch!==generation)throw new Error('模型准备已取消');
  const candidates=requested==='auto' ? [selected,selected==='native-sensevoice' ? 'browser-whisper' : 'native-sensevoice'] : [selected];
  const attempts=[];let best,error;
  for(const backend of candidates){
   if(!audio(backend)?.prepare)continue;
   try{
    const result={...await audio(backend).prepare(kind),backend};
    if(epoch!==generation)throw new Error('模型准备已取消');
    attempts.push({backend,phase:result.phase,elapsedMs:result.elapsedMs});
    if(!best || result.elapsedMs<best.elapsedMs)best=result;
    if(result.phase==='ready'){autoAudio=backend;return {...result,attempts};}
   }catch(cause){error=cause;attempts.push({backend,phase:'error'});}
   if(epoch!==generation)throw new Error('模型准备已取消');
  }
  if(best){autoAudio=best.backend;return {...best,attempts};}
  throw error || new Error('此端侧方案需要 Chrome 扩展与对应本地组件');
 };
 const prepare=(kind,selection)=>{
  const selected=selection || config()[kind==='text' ? 'textModel' : 'audioBackend'] || 'auto',active=preparing.get(kind);
  if(active){if(active.selection===selected)return active.promise;return Promise.reject(new Error('此模型正在准备，请等待完成或先释放内存'));}
  const promise=runPrepare(kind,selected,generation).finally(()=>{if(preparing.get(kind)?.promise===promise)preparing.delete(kind);});
  preparing.set(kind,{selection:selected,promise});return promise;
 };
 const ready=async(kind,selection)=>{
   if(kind!=='text')return audio(selection==='auto' ? autoAudio : selection || audioBackend())?.ready(kind) || false;
   if(!await browser?.ready(kind))return false;
   const state=await browser.status?.();if(state?.text)textStatus=state.text;
   const selected=selection || config().textModel;return !selected || selected==='auto' || textStatus.model===TEXT_MODELS[selected]?.id;
  };
 const ensure=async(kind,selection)=>{
  if(!await ready(kind,selection))return prepare(kind,selection);
  if(kind==='text')return textStatus;
  const backend=selection==='auto' ? autoAudio : selection || audioBackend();
  return {...await audio(backend)?.status?.(),backend};
 };
 const status=async()=>{const state=await browser?.status() || {};textStatus=state.text || {};return {...state,audio:{...(audioBackend()==='native-sensevoice' ? await native?.status() : state.audio) || {phase:'unprepared'},backend:audioBackend()}};};
 return {detect,prepare,ensure,ready,audioBackend,tuning:()=>automaticLatency(textStatus),
  reply:(p,c)=>browser.reply(p,c),classify:(text,signal)=>{if(config().enabled===false)throw new Error('请先启用本地 AI');if(!browser?.classify)throw new Error('此浏览器未连接中文端侧模型');return browser.classify(text,signal);},transcribe:(sample,signal)=>audio().transcribe(sample,signal),
  status,subscribe:listener=>browser?.subscribe?.(listener) || (()=>{}),
  release:async()=>{generation++;preparing.clear();textStatus={};native?.close();await browser?.release();},close:()=>{generation++;preparing.clear();textStatus={};native?.close();browser?.close();}};
}
