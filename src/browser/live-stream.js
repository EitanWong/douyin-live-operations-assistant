import {roomFromURL} from './room-context.js';

const cdnSuffixes=['douyincdn.com','douyincdn.com.cn','douyin.com','bytecdn.cn','bytedance.com'];
export function validateStreamURL(value){
  let url;try{url=new URL(value);}catch{throw new Error('直播流地址无效');}
  if(url.protocol!=='https:' || url.username || url.password || url.port || url.hash || value.length>12000
    || !cdnSuffixes.some(suffix=>url.hostname.endsWith(`.${suffix}`)) || !/\.(?:flv|m3u8)$/iu.test(url.pathname))throw new Error('直播流地址无效');
  return url.href;
}
const parse=value=>{if(typeof value!=='string')return value;try{return JSON.parse(value);}catch{return null;}};
const qualityRank=value=>/^(sd|sd1|ld|ld1)$/iu.test(value) ? 0 : /^(hd|hd1|origin|full_hd1)$/iu.test(value) ? 1 : 2;
function roomCandidates(info,room,requestedRoom){
  const rid=String(info?.web_rid || info?.webRid || '');
  if((rid ? rid!==room : requestedRoom!==room) || Number(info.status)!==2)return [];
  const stream=info.stream_url || info.streamUrl;if(!stream || typeof stream!=='object')return [];
  const rows=[];
  const add=(url,quality)=>{try{const value=validateStreamURL(url),format=new URL(value).pathname.endsWith('.m3u8') ? 'hls' : 'flv';rows.push({url:value,format,quality:String(quality),roomId:String(info.id_str || info.id || '')});}catch{}};
  for(const [quality,url] of Object.entries(stream.flv_pull_url || {}))add(url,quality);
  for(const [quality,url] of Object.entries(stream.hls_pull_url_map || {}))add(url,quality);
  if(typeof stream.hls_pull_url==='string')add(stream.hls_pull_url,'origin');
  const sdk=parse(stream.live_core_sdk_data?.pull_data?.stream_data || stream.stream_data);
  for(const [quality,value] of Object.entries(sdk?.data || {})){
    const main=value?.main;if(!main || /(?:hevc|h265|hvc1|av1)/iu.test(main.vcodec || main.codec || ''))continue;
    add(main.flv,quality);add(main.hls,quality);
  }
  return [...new Map(rows.sort((a,b)=>(a.format==='flv'?0:1)-(b.format==='flv'?0:1) || qualityRank(a.quality)-qualityRank(b.quality)).map(row=>[row.url,row])).values()].slice(0,8);
}
export function streamCandidates(data,room,{requestedRoom}={}){
  if(data?.status_code!==undefined && data.status_code!==0)return [];
  const slots=[data?.roomStore?.roomInfo?.room,data?.roomStore?.roomInfo,data?.roomInfo?.room,data?.roomInfo,data?.room,...(Array.isArray(data?.data?.data)?data.data.data:[]),data?.data?.room];
  return slots.filter(Boolean).flatMap(info=>roomCandidates(info,room,requestedRoom)).slice(0,8);
}
function initialStreams(page,room){
  for(const name of ['SSR_RENDER_DATA','SSR_RENDER_DATA_DOC']){
    const rows=streamCandidates(page[name],room);if(rows.length)return rows;
    const text=page.document?.getElementById(name)?.textContent;
    if(text && text.length<8*1024*1024){const data=parse(text);const rows=streamCandidates(data,room);if(rows.length)return rows;}
  }
  const text=page.document?.getElementById('RENDER_DATA')?.textContent;
  if(text && text.length<8*1024*1024){try{const rows=streamCandidates(parse(decodeURIComponent(text)),room);if(rows.length)return rows;}catch{}}
  return [];
}
export async function resolveLiveStream({page=globalThis,room=roomFromURL(page.location),signal}){
  if(!room || page.location.origin!=='https://live.douyin.com' || roomFromURL(page.location)!==room)throw new Error('请在当前抖音直播间启动直接拉流');
  if(signal?.aborted)throw new Error('直接拉流已停止');
  const initial=initialStreams(page,room);if(initial.length)return initial;
  const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,10000);
  try{
    const response=await page.fetch(`/webcast/room/web/enter/?aid=6383&app_name=douyin_web&device_platform=web&web_rid=${encodeURIComponent(room)}`,{credentials:'same-origin',redirect:'error',signal:controller.signal});
    if(!response.ok)throw new Error('request');const text=await response.text();if(text.length>8*1024*1024)throw new Error('size');
    const rows=streamCandidates(parse(text),room,{requestedRoom:room});if(!rows.length)throw new Error('no streams');
    if(roomFromURL(page.location)!==room)throw new Error('changed');return rows;
  }catch{throw new Error(signal?.aborted ? '直接拉流已停止' : '未获取到当前直播间原始流，请确认正在开播并刷新直播页后重试');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

// The decoder is independent of the site's player and never uses display/tab capture.
export function createDirectStreamSource({page=globalThis,env=globalThis,resolve=resolveLiveStream,loadCodecs=()=>import('../services/live-stream-codecs.js'),setupTimeoutMs=30000}={}){
  return async({config,signal,isCurrent=()=>true,onEnded=()=>{},onError=()=>{}})=>{
    let video,decoder,stream,decodedStream,audioContext,audioNode,audioDestination,closed=false,interval,timer,rejectWait,failure;
    const listeners=[];
    const stop=()=>{
      if(closed)return;closed=true;clearInterval(interval);clearTimeout(timer);signal?.removeEventListener('abort',stop);
      for(const [name,fn] of listeners)video?.removeEventListener(name,fn);
      for(const track of new Set([...(stream?.getTracks() || []),...(decodedStream?.getTracks() || []),...(audioDestination?.stream.getTracks() || [])]))track.stop();
      audioNode?.disconnect();if(audioContext)void audioContext.close().catch(()=>{});
      decoder?.destroy();if(video){video.pause();video.removeAttribute('src');video.srcObject=null;video.load();video.remove();}
      rejectWait?.(new Error('直接拉流已停止'));
    };
    const cancelled=new Promise((_,reject)=>rejectWait=reject);void cancelled.catch(()=>{});
    const active=()=>!closed && !signal?.aborted && isCurrent();
    const fail=()=>{if(!active())return;failure=new Error('原始直播流连接中断，请重新开始拉流');stop();onError(failure);onEnded();};
    signal?.addEventListener('abort',stop,{once:true});
    timer=setTimeout(()=>{failure=new Error('timeout');stop();},setupTimeoutMs);
    try{
      if(!active()){stop();throw new Error('直接拉流已停止');}
      if(config.audioEnabled){
        if(!env.AudioContext || !env.MediaStream)throw new Error('audio unavailable');
        audioContext=new env.AudioContext();
        // Resume in the original click activation, before any network work.
        await Promise.race([audioContext.resume(),cancelled]);
      }
      const candidates=await Promise.race([resolve({page,signal}),cancelled]);if(!active())throw new Error('cancelled');
      const codecs=await Promise.race([loadCodecs(),cancelled]);if(!active())throw new Error('cancelled');
      const candidate=candidates[0];if(!candidate)throw new Error('no stream');validateStreamURL(candidate.url);
      video=env.document.createElement('video');video.crossOrigin='anonymous';video.muted=true;video.playsInline=true;video.autoplay=true;video.setAttribute('aria-hidden','true');
      video.style.cssText='position:fixed;width:2px;height:2px;left:-10px;top:-10px;opacity:0;pointer-events:none';env.document.body.append(video);
      if(audioContext){audioDestination=audioContext.createMediaStreamDestination();audioNode=audioContext.createMediaElementSource(video);audioNode.connect(audioDestination);video.muted=false;}
      const attaching=Promise.resolve(codecs.attach(video,candidate,{onError:fail}));void attaching.then(value=>{if(closed)value.destroy();},()=>{});
      decoder=await Promise.race([attaching,cancelled]);if(!active())throw new Error('cancelled');
      for(const name of ['error','ended']){video.addEventListener(name,fail);listeners.push([name,fail]);}
      await Promise.race([video.play(),cancelled]);
      await Promise.race([new Promise((resolveReady,reject)=>{
        const check=()=>{
          if(!active()){reject(new Error('cancelled'));return;}
          if(video.readyState<2 || !video.videoWidth)return;
          try{
            if(!decodedStream){if(typeof video.captureStream!=='function')throw new Error('capture');decodedStream=video.captureStream();}
            if(config.audioEnabled && !decodedStream.getAudioTracks().length)return;
            if(!stream)stream=audioDestination ? new env.MediaStream([...audioDestination.stream.getAudioTracks(),...decodedStream.getVideoTracks()]) : decodedStream;
            if(audioContext && audioContext.state!=='running')return;
            if(config.videoEnabled && !stream.getVideoTracks().length)return;
            // Reading must remain origin-clean before any frame is sent to a model.
            const canvas=env.document.createElement('canvas');canvas.width=1;canvas.height=1;const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,1,1);ctx.getImageData(0,0,1,1);
            clearInterval(interval);clearTimeout(timer);resolveReady();
          }catch{reject(new Error('decode'));}
        };
        interval=setInterval(check,100);check();
      }),cancelled]);
      if(!active())throw new Error('cancelled');
      for(const track of stream.getTracks())track.addEventListener('ended',fail,{once:true});
      return {stream,source:'direct',stop};
    }catch{const cancelled=!failure && (closed || signal?.aborted || !isCurrent());stop();throw new Error(cancelled ? '直接拉流已停止' : '原始直播流拉流失败：请确认直播已开播、流支持 H264/AAC 且允许跨域读取，再重试；不会自动启动屏幕共享');}
  };
}
