export const audioInferenceOptions=pcm=>({language:'chinese',task:'transcribe',return_timestamps:false,max_new_tokens:Math.min(160,Math.max(16,Math.ceil(pcm.length/16000*12)))});
const accept=text=>/桌上.*蓝色.*杯子/u.test(String(text || '').replace(/[\s，,。.!！]/gu,''));
export async function benchmarkChineseASR(infer,samples,now=()=>performance.now()){
 const options=audioInferenceOptions(samples),timings=[];
 if(!accept((await infer(samples,options))?.text))return {phase:'error',selfTestPassed:false,error:'中文语音自检未通过，请使用 SenseVoice 或重新准备'};
 for(let i=0;i<3;i++){
  const started=now(),result=await infer(samples,options);timings.push(now()-started);
  if(!accept(result?.text))return {phase:'error',selfTestPassed:false,error:'中文语音自检未通过'};
 }
 const elapsedMs=timings.toSorted((a,b)=>a-b)[1],audioMs=samples.length/16;
 return {phase:elapsedMs>0 && elapsedMs<=Math.min(2000,audioMs*.6) ? 'ready' : 'slow',elapsedMs,realTimeFactor:elapsedMs/audioMs,sampleMs:audioMs,selfTestPassed:true,benchmarkRuns:3};
}
