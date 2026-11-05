import {withDeadline} from './ai-resilience.js';

export function createSpeechRecognizer({cloud,edge,config,now=Date.now}){
 return async(sample,media,{signal}={})=>{
  if(signal?.aborted)throw new Error('语音识别已取消');
  const local=config();
  if(sample.kind==='audio' && (media.localAudio || local.audioEnabled) && await edge.ready('audio')){
   try{
    const text=await withDeadline(s=>edge.transcribe(sample,s),{signal,timeout:4000});
    return text ? {kind:'audio',at:sample.at,endedAt:sample.endedAt,isFinal:true,text,model:edge.audioBackend?.() || local.audioBackend,transport:'local',inputSource:sample.inputSource,receivedAt:now()} : null;
   }catch(error){if(signal?.aborted || media.localAudio)throw error;}
  }else if(media.localAudio)throw new Error('请先准备本地中文语音模型并通过测速');
  return withDeadline(s=>cloud(sample,media,{signal:s}),{signal,timeout:6000});
 };
}
