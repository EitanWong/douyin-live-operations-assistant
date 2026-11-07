import {resolveMediaConfig} from '../src/services/ai-pipeline.js';
import {createMediaClient} from '../src/services/media.js';
import {withDeadline} from '../src/services/ai-resilience.js';
import {createNativeASRClient} from '../src/browser/native-asr-client.js';
import {NATIVE_HOST} from './native-perception.js';
import {collectAccount} from './account-collector.js';
const check=signal=>{if(signal?.aborted)throw Error('作品音画采样已取消');};
const enabled=ai=>ai?.assistant?.memoryEnabled!==false && ['local-audio','local-multimodal'].includes(ai?.pipeline?.mode);
const signature=ai=>JSON.stringify([ai?.pipeline,ai?.edge,ai?.assistant?.memoryEnabled]);

export function createAccountMediaAnalyzer({readAI,capture,transcribe,recognize,onMedia=()=>{},now=Date.now}){
 return async({source,records,tabId,signal})=>{
  check(signal);const ai=await readAI(),work=records.find(r=>r.kind==='work' && r.id===source.id);
  if(!enabled(ai) || !work)return [];
  const version=signature(ai),current=async()=>{check(signal);return signature(await readAI())===version;},rows=[],status=[];
  const media=resolveMediaConfig(ai),audio=ai.edge?.enabled && ai.edge?.audioEnabled;
  const sample=await capture({tabId,source,audio,video:media.localVision,signal});
  if(!await current())return [];
  if(sample.mediaSource)onMedia(sample.mediaSource);
  const at=now(),add=(kind,value)=>{
   const position=kind==='transcript' ? sample.audioPositionMs ?? sample.positionMs : sample.positionMs;
   const text=typeof value==='string' ? value.trim().slice(0,1200) : '';if(!text || ['[UNKNOWN]','[SILENCE]'].includes(text))return;
   rows.push({kind,id:`${source.id}-${kind}-${at}`,subject:work.subject,workId:source.id,title:kind==='transcript' ? '作品语音片段' : '作品画面采样',text,source:source.url,url:source.url,observedAt:at,expiresAt:at+86400000,counts:{},
    ...(Number.isSafeInteger(position) && position>=0 ? {positionMs:position} : {}),
    coverage:kind==='transcript' ? '本机识别约4秒公开视频音轨采样；说话人未认证，不能代表完整视频' : '本机识别单帧；不认证人物身份或关系，不能代表完整视频'});
  };
  if(audio && sample.audio){
   try{add('transcript',await transcribe({kind:'audio',data:sample.audio,at,endedAt:at+4000},signal,ai));}catch(error){check(signal);status.push(`语音未完成：${error.message}`);}
  }else status.push('未取得可识别音轨或本地语音未启用');
  if(!await current())return [];
  if(media.localVision && sample.frame){
   try{const result=await recognize({kind:'video',data:sample.frame,at,endedAt:at,inputSource:'public-work'},media,{signal});add('visual',result?.text);}catch(error){check(signal);status.push(`画面未完成：${error.message}`);}
  }else if(media.localVision)status.push('未取得可读画面');
  if(!await current())return [];
  work.coverage=`公开视频有限采样，已取得${rows.length}项音画记录；${status.join('；') || '单帧/约4秒音轨，非全片分析'}`.slice(0,500);
  return rows;
 };
}

// Runs only in a temporary tab owned by the collector. No microphone/display
// capture, platform request signing, or cross-origin canvas bypass.
export async function capturePublicWorkSample({audio,video,workId}){
 const observed=workId && window.__liveAssistantPublicAccountV1?.mediaSource?.(),mediaSource=observed?.workId===workId ? observed : null;
 const element=[...document.querySelectorAll('video')].filter(v=>v.readyState>=2 && v.getBoundingClientRect().width>0 && (!workId || window.__liveAssistantPublicAccountV1?.mediaMatches(v.currentSrc))).sort((a,b)=>b.videoWidth*b.videoHeight-a.videoWidth*a.videoHeight)[0];
 if(!element)return mediaSource ? {mediaSource} : {};
 const within=async(work,ms)=>{let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('采样等待超时')),ms);})]);}finally{clearTimeout(timer);}};
 const result={positionMs:Math.max(0,Math.round(element.currentTime*1000)),mediaSource:mediaSource ?? window.__liveAssistantPublicAccountV1?.mediaSource(element.currentSrc) ?? null};let stream,context,processor,source,gain;
 try{
  element.muted=true;
  if(audio)try{await within(element.play(),1200);}catch{}
  if(video)try{const canvas=document.createElement('canvas');canvas.width=Math.min(640,element.videoWidth);canvas.height=Math.max(1,Math.round(element.videoHeight*canvas.width/element.videoWidth));canvas.getContext('2d').drawImage(element,0,0,canvas.width,canvas.height);const frame=canvas.toDataURL('image/jpeg',0.65);if(frame.length<=400000)result.frame=frame;canvas.width=0;}catch{}
  if(!audio || !element.captureStream)return result;
  stream=element.captureStream();if(!stream.getAudioTracks().length)return result;
  context=new AudioContext();await within(context.resume(),800);if(context.state!=='running')return result;
  result.audioPositionMs=Math.max(0,Math.round(element.currentTime*1000));source=context.createMediaStreamSource(stream);processor=context.createScriptProcessor(2048,1,1);gain=context.createGain();gain.gain.value=0;
  const rate=context.sampleRate,chunks=[];let length=0;
  processor.onaudioprocess=e=>{if(length>=rate*4)return;const data=e.inputBuffer.getChannelData(0).slice(0,Math.min(e.inputBuffer.length,rate*4-length));chunks.push(data);length+=data.length;};
  source.connect(processor);processor.connect(gain);gain.connect(context.destination);
  await new Promise(resolve=>setTimeout(resolve,4100));
  if(length<rate)return result;
  const samples=new Float32Array(length);let offset=0;for(const chunk of chunks){samples.set(chunk,offset);offset+=chunk.length;}
  const count=Math.min(64000,Math.floor(length*16000/rate)),bytes=new Uint8Array(44+count*2),view=new DataView(bytes.buffer);
  const ascii=(at,text)=>{for(let i=0;i<text.length;i++)bytes[at+i]=text.charCodeAt(i);};
  ascii(0,'RIFF');view.setUint32(4,bytes.length-8,true);ascii(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,count*2,true);
  for(let i=0;i<count;i++){const begin=Math.floor(i*rate/16000),end=Math.min(length,Math.floor((i+1)*rate/16000));let sum=0;for(let j=begin;j<end;j++)sum+=samples[j];const value=Math.max(-1,Math.min(1,sum/Math.max(1,end-begin)));view.setInt16(44+i*2,Math.round(value*(value<0 ? 32768 : 32767)),true);}
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));result.audio=btoa(binary);
 }catch{}finally{processor && (processor.onaudioprocess=null);source?.disconnect();processor?.disconnect();gain?.disconnect();stream?.getTracks().forEach(track=>track.stop());if(context)try{await within(context.close(),250);}catch{}element.pause();}
 return result;
}

export async function authorizeLocalMediaEndpoint(chrome,endpoint){
 const url=new URL(endpoint);
 if(!['http:','https:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password || !await chrome.permissions.contains({origins:[`${url.protocol}//${url.hostname}/*`]}))throw Error('请授权本机视觉接口');
 return url;
}

export function createLocalMediaRequest(chrome){
 return details=>{
  const controller=new AbortController();let timer=setTimeout(()=>{controller.abort();details.ontimeout();},10000);
  void (async()=>{
   try{
    const url=await authorizeLocalMediaEndpoint(chrome,details.url);
    const response=await fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json'},body:details.data,credentials:'omit',redirect:'error',signal:controller.signal});
    const responseText=await response.text();if(responseText.length>1000000)throw Error('本机视觉响应过大');
    details.onload({status:response.status,responseText,finalUrl:response.url});
   }catch{details.onerror();}finally{clearTimeout(timer);}
  })();
  return {abort:()=>{clearTimeout(timer);controller.abort();}};
 };
}

export async function collectAccountWithMedia(chrome,url,{readAI,onMedia,...options}){
 const native=createNativeASRClient({connect:()=>{const port=chrome.runtime.connectNative(NATIVE_HOST);return {onMessage:port.onMessage,onDisconnect:port.onDisconnect,disconnect:()=>port.disconnect(),postMessage:m=>port.postMessage({...m,type:'local-asr'})};}});
 const recognize=createMediaClient({request:createLocalMediaRequest(chrome),getKey:()=>''});
 const transcribe=(sample,signal,ai)=>withDeadline(async active=>{
  if(ai.edge.audioBackend==='browser-whisper')throw Error('作品后台语音需要选择 SenseVoice 或自动后端');
  const abort=()=>native.close();active.addEventListener('abort',abort,{once:true});
  try{if(!await native.ready()){const status=await native.prepare();if(status.phase!=='ready' || !status.selfTestPassed)throw Error('SenseVoice 未通过本机测速');}return await native.transcribe(sample,active);}
  finally{active.removeEventListener('abort',abort);}
 },{signal,timeout:8000});
 const analyze=createAccountMediaAnalyzer({readAI,recognize,transcribe,onMedia,capture:async({tabId,source,audio,video,signal})=>{
  check(signal);const [sample]=await withDeadline(()=>chrome.scripting.executeScript({target:{tabId},world:'MAIN',func:capturePublicWorkSample,args:[{audio,video,workId:source.id}]}),{signal,timeout:7500});check(signal);return sample?.result || {};
 }});
 try{return await collectAccount(chrome,url,{...options,analyze});}finally{native.close();}
}
