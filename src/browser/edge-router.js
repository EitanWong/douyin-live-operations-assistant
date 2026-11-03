import {recommendDevice,automaticLatency,TEXT_MODELS} from '../ai/device-policy.js';

export function createEdgeRouter({browser,native,config}){
 let autoAudio='browser-whisper',textStatus={};
 const audioBackend=()=>config().audioBackend==='auto' ? autoAudio : config().audioBackend;
 const audio=(backend=audioBackend())=>backend==='native-sensevoice' ? native : browser;
 const detect=async()=>{
  const [gpu,asr]=await Promise.allSettled([browser?.detect?.(),native?.inspect?.()]);
  const device=gpu.status==='fulfilled' ? gpu.value || {} : {},local=asr.status==='fulfilled' ? asr.value || {} : {};
  return {device,native:local,recommendation:recommendDevice(device,local)};
 };
 const prepare=async(kind,selection)=>{
  if(kind==='text'){
   if(!browser)throw new Error('浏览器端侧推理需要 Chrome 扩展');
   textStatus=await browser.prepare(kind,selection || config().textModel || 'auto');return textStatus;
  }
  const requested=selection || config().audioBackend;
  const selected=requested==='auto' ? (await detect()).recommendation.audioBackend : requested;
  if(!audio(selected))throw new Error('此端侧方案需要 Chrome 扩展与对应本地组件');
  let result;
  try{result=await audio(selected).prepare(kind);}
  catch(error){if(requested!=='auto' || selected!=='native-sensevoice' || !browser)throw error;}
  if(requested==='auto' && selected==='native-sensevoice' && result?.phase!=='ready'){
   result=await browser.prepare(kind);autoAudio='browser-whisper';
  }else autoAudio=selected;
  return {...result,backend:autoAudio};
 };
 return {detect,prepare,audioBackend,tuning:()=>automaticLatency(textStatus),
  ready:async kind=>{
   if(kind!=='text')return audio()?.ready(kind) || false;
   if(!await browser?.ready(kind))return false;
   const state=await browser.status?.();if(state?.text)textStatus=state.text;
   const selected=config().textModel;return !selected || selected==='auto' || textStatus.model===TEXT_MODELS[selected]?.id;
  },
  reply:(p,c)=>browser.reply(p,c),transcribe:(sample,signal)=>audio().transcribe(sample,signal),
  status:async()=>{const state=await browser?.status() || {};textStatus=state.text || {};return {...state,audio:{...(audioBackend()==='native-sensevoice' ? await native?.status() : state.audio) || {phase:'unprepared'},backend:audioBackend()}};},
  release:async()=>{textStatus={};native?.close();await browser?.release();},close:()=>{textStatus={};native?.close();browser?.close();}};
}
