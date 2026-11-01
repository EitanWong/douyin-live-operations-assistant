import mpegts from 'mpegts.js';
import Hls from 'hls.js';

// Signed media URLs must never appear in decoder diagnostics.
mpegts.LoggingControl.enableAll=false;

// Bundled locally; workers and external player services are not used.
export async function attach(video,candidate,{onError}){
  if(candidate.format==='flv'){
    if(!mpegts.isSupported())throw new Error('FLV 解码不可用');
    const player=mpegts.createPlayer({type:'flv',url:candidate.url,isLive:true,cors:true,withCredentials:false},{enableWorker:false,enableWorkerForMSE:false,enableStashBuffer:false,lazyLoad:false,liveBufferLatencyChasing:true,liveBufferLatencyMaxLatency:3,liveBufferLatencyMinRemain:1,autoCleanupSourceBuffer:true});
    let closed=false;
    const destroy=()=>{if(closed)return;closed=true;player.off(mpegts.Events.ERROR,onError);player.destroy();};
    try{player.on(mpegts.Events.ERROR,onError);player.attachMediaElement(video);player.load();return {destroy};}
    catch(error){destroy();throw error;}
  }
  if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=candidate.url;return {destroy(){}};}
  if(!Hls.isSupported())throw new Error('HLS 解码不可用');
  const player=new Hls({enableWorker:false,debug:false,lowLatencyMode:true,maxBufferLength:10,backBufferLength:5,liveSyncDurationCount:2,manifestLoadingMaxRetry:1,levelLoadingMaxRetry:1,fragLoadingMaxRetry:1});
  try{
    player.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal)onError();});player.loadSource(candidate.url);player.attachMedia(video);
    return {destroy(){player.destroy();}};
  }catch(error){player.destroy();throw error;}
}
