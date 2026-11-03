// The capture owner supplies its live track. This adapter never opens a microphone.
export async function createSpeechSegments({stream,signal,onSpeech,assets,onError=()=>{},now=Date.now},{VAD}){
 let closed=false,vad,timer,disposing;
 const stop=()=>{if(disposing)return disposing;closed=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);disposing=Promise.resolve(vad?.destroy()).catch(()=>{});return disposing;};
 if(signal?.aborted)throw new Error('语音分句已取消');
 const flush=async()=>{try{if(closed)return;await vad.pause();if(!closed)await vad.start();}catch(error){if(!closed)onError(error);}};
 vad=await VAD.new({model:'v5',baseAssetPath:assets,onnxWASMBasePath:assets+'ort/',
  ortConfig:ort=>{ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;},
  getStream:async()=>stream,pauseStream:async()=>{},resumeStream:async()=>stream,startOnLoad:false,
  redemptionMs:450,preSpeechPadMs:240,minSpeechMs:250,positiveSpeechThreshold:.5,negativeSpeechThreshold:.35,submitUserSpeechOnPause:true,
  onSpeechStart:()=>{clearTimeout(timer);timer=setTimeout(flush,8000);},
  onSpeechEnd:samples=>{clearTimeout(timer);if(closed || samples.length>160000)return;const endedAt=now();onSpeech({samples,at:endedAt-samples.length/16,endedAt});}
 });
 if(signal?.aborted){await stop();throw new Error('语音分句已取消');}
 signal?.addEventListener('abort',stop,{once:true});
 try{await vad.start();return {stop};}catch(error){await stop();throw error;}
}
