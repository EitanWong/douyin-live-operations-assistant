import {validateMediaConfig} from '../services/media.js';

export function encodeWav(samples,sampleRate=16000) {
  const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
  const write=(offset,text)=>[...text].forEach((char,index)=>view.setUint8(offset+index,char.charCodeAt(0)));
  write(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,samples.length*2,true);
  samples.forEach((value,index)=>{const clipped=Math.max(-1,Math.min(1,value));view.setInt16(44+index*2,Math.round(clipped*(clipped<0 ? 32768 : 32767)),true);});
  return buffer;
}
const base64=buffer=>{
  const bytes=new Uint8Array(buffer);let text='';
  for(let index=0;index<bytes.length;index+=8192)text+=String.fromCharCode(...bytes.subarray(index,index+8192));
  return btoa(text);
};

async function audioWav(blob,env,maxSeconds,includeSilence=false) {
  const context=new env.AudioContext();
  try {
    const decoded=await context.decodeAudioData(await blob.arrayBuffer());
    const length=Math.min(Math.ceil(decoded.duration*16000),maxSeconds*16000);
    const offline=new env.OfflineAudioContext(1,length,16000),source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
    const samples=(await offline.startRendering()).getChannelData(0);
    const rms=Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);
    return rms<0.003 && !includeSilence ? null : base64(encodeWav(samples));
  } finally {await context.close();}
}

function frame(video,canvas) {
  if(video.readyState<2 || !video.videoWidth || !video.videoHeight)return null;
  const scale=Math.min(1,640/video.videoWidth,480/video.videoHeight);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
  canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
  const data=canvas.toDataURL('image/jpeg',0.65);
  if(data.length>400000)throw new Error('共享画面过大，请缩小共享范围');
  return data;
}

// getDisplayMedia 必须在点击调用栈内调用；不用麦克风替代直播音频。
export async function createDisplayCapture({config,onSample,onEnded,onError,onSkip=()=>{},isCurrent=()=>true,signal},env=globalThis) {
  if(!env.navigator?.mediaDevices?.getDisplayMedia)throw new Error('当前浏览器不支持屏幕共享，请使用支持共享标签页音频的Chrome桌面版');
  const stream=await env.navigator.mediaDevices.getDisplayMedia({video:true,audio:config.audioEnabled,preferCurrentTab:true,systemAudio:'exclude'});
  let closed=false,video,canvas,recorder,recordTimer,frameTimer,decoding=false,releasePreparation;
  const cancelled=new Promise(resolve=>{releasePreparation=resolve;});
  const stop=()=>{
    if(closed)return;closed=true;clearTimeout(recordTimer);clearInterval(frameTimer);
    signal?.removeEventListener('abort',stop);releasePreparation();
    if(recorder?.state==='recording')recorder.stop();
    for(const track of stream.getTracks())track.stop();
    if(video){video.pause();video.srcObject=null;}
  };
  signal?.addEventListener('abort',stop,{once:true});
  try {
    if(signal?.aborted || !isCurrent()){stop();return {stop};}
    if(config.audioEnabled && !stream.getAudioTracks().length)throw new Error('没有共享到直播音频，请重新选择直播标签页并勾选“同时分享标签页音频”，或关闭音频识别');
    for(const track of stream.getTracks())track.addEventListener('ended',()=>{if(!closed){stop();onEnded();}},{once:true});
    if(config.videoEnabled){
      video=env.document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;await Promise.race([video.play(),cancelled]);
      if(closed || !isCurrent()){stop();return {stop};}
      canvas=env.document.createElement('canvas');
      const sample=()=>{try {const data=frame(video,canvas);if(data && !closed)void onSample({kind:'video',data,at:Date.now()});}catch(error){onError(error);}};
      if(!config.omniEnabled){frameTimer=setInterval(sample,config.videoIntervalSec*1000);sample();}
    }
    if(config.audioEnabled){
      if(!env.MediaRecorder || !env.AudioContext || !env.OfflineAudioContext)throw new Error('当前浏览器缺少音频分段识别支持');
      const audioStream=new env.MediaStream(stream.getAudioTracks());
      const record=()=>{
        if(closed)return;
        const parts=[],at=Date.now();recorder=new env.MediaRecorder(audioStream);
        recorder.ondataavailable=event=>{if(event.data.size)parts.push(event.data);};
        recorder.onerror=()=>{stop();onError(new Error('共享音频录制失败，请停止后重试'));onEnded();};
        recorder.onstop=()=>{
          if(closed)return;
          const endedAt=Date.now(),blob=new Blob(parts,{type:recorder.mimeType});let image;
          try {if(config.omniEnabled)image=frame(video,canvas);}catch(error){onError(error);}
          record();
          if(config.omniEnabled && !image){onSkip();return;}
          if(decoding){onSkip();return;}decoding=true;
          void (async()=>{try {const data=await audioWav(blob,env,config.audioIntervalSec,config.omniEnabled);if(data && !closed)await onSample(config.omniEnabled ? {kind:'omni',image,data,at,endedAt} : {kind:'audio',data,at,endedAt});}catch(error){if(!closed)onError(error);}finally{decoding=false;}})();
        };
        recorder.start();recordTimer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},config.audioIntervalSec*1000);
      };
      record();
    }
    return {stop};
  } catch(error){stop();throw error;}
}

export class LiveMediaAnalyzer {
  constructor({capture=createDisplayCapture,realtimeCapture,recognize,onObservation=()=>{},onState=()=>{},onError=()=>{}}){
    Object.assign(this,{capture,realtimeCapture,recognize,onObservation,onState,onError});this.state='idle';this.epoch=0;this.skipped=0;this.errors=0;this.busy=new Map();this.failures=new Map();
  }
  notify(){this.onState({state:this.state,skipped:this.skipped,errors:this.errors});}
  async start(config){
    if(this.state!=='idle')return;
    validateMediaConfig(config,true);const epoch=++this.epoch;this.controller=new AbortController();this.state='starting';this.errors=0;this.skipped=0;this.failures.clear();this.notify();
    try {
      const factory=config.transport==='webrtc' ? this.realtimeCapture : this.capture;
      if(!factory)throw new Error('实时识别服务未初始化');
      const capture=await factory({config,onObservation:row=>{if(epoch===this.epoch)this.onObservation(row);},onProgress:value=>{if(epoch===this.epoch)this.onState({state:this.state,skipped:this.skipped,errors:this.errors,...value});},signal:this.controller.signal,isCurrent:()=>epoch===this.epoch,onSample:sample=>this.sample(sample,config,epoch),onEnded:()=>{if(epoch===this.epoch)this.stop();},onError:error=>this.error(error,'capture',epoch),onSkip:()=>{if(epoch===this.epoch){this.skipped++;this.notify();}}});
      if(epoch!==this.epoch){capture.stop();return;}
      this.source=capture;this.state='running';this.notify();
    }catch(error){if(epoch===this.epoch){this.stop();this.onError(error);throw error;}}
  }
  error(error,kind,epoch){
    if(epoch!==this.epoch)return;
    this.errors++;const failures=(this.failures.get(kind) || 0)+1;this.failures.set(kind,failures);this.onError(error);
    if(failures>=3 || /额度/u.test(error.message))this.stop();
    this.notify();
  }
  async sample(sample,config,epoch){
    if(epoch!==this.epoch || this.state==='idle')return;
    if(this.busy.has(sample.kind)){this.skipped++;this.notify();return;}
    const token={};this.busy.set(sample.kind,token);
    try {
      const row=await this.recognize(sample,config);
      if(epoch===this.epoch){this.failures.set(sample.kind,0);if(row)this.onObservation(row);}
    }catch(error){this.error(error,sample.kind,epoch);}
    finally {if(this.busy.get(sample.kind)===token)this.busy.delete(sample.kind);}
  }
  stop(){this.epoch++;this.controller?.abort();this.controller=null;this.source?.stop();this.source=null;this.busy.clear();this.state='idle';this.notify();}
}
