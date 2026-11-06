import {withDeadline} from './ai-resilience.js';

export function createSpeechRecognizer({cloud,edge,config,now=Date.now}){
 return async(sample,media,{signal}={})=>{
  if(signal?.aborted)throw new Error('语音识别已取消');
  const local=config();
  const localEnabled=sample.kind==='audio' && local.enabled && local.audioEnabled;
  const transcribe=async()=>{
   const text=await withDeadline(s=>edge.transcribe(sample,s),{signal,timeout:4000});
   return text ? {kind:'audio',at:sample.at,endedAt:sample.endedAt,isFinal:true,text,model:edge.audioBackend?.() || local.audioBackend,transport:'local',inputSource:sample.inputSource,receivedAt:now()} : null;
  };
  if(media.localAudio){
   if(!localEnabled || !await edge.ready('audio'))throw new Error('请先启用本地 AI 并准备中文语音模型通过测速');
   return transcribe();
  }
  try{return await withDeadline(s=>cloud(sample,media,{signal:s}),{signal,timeout:6000});}
  catch(error){
   if(signal?.aborted || !localEnabled || !await edge.ready('audio'))throw error;
   return transcribe();
  }
 };
}
