import {pipeline,env,TextStreamer} from '@huggingface/transformers';
import {EDGE_MODELS,acceptPerformance,decodePCM16} from '../src/ai/edge-prompt.js';

env.allowLocalModels=false;
env.backends.onnx.wasm.wasmPaths=new URL('./ort/',import.meta.url).href;
env.backends.onnx.wasm.numThreads=1;
env.backends.onnx.wasm.proxy=false;
let model,kind;
async function generate(messages,maxTokens,minTokens=0){
 const started=performance.now();let first=0,tokens=0;
 const streamer=new TextStreamer(model.tokenizer,{skip_prompt:true,callback_function:()=>{},token_callback_function:t=>{first ||= performance.now();tokens+=t.length;}});
 const input=model.tokenizer.apply_chat_template(messages,{tokenize:false,add_generation_prompt:true});
 const encoded=await model.tokenizer(input);if(encoded.input_ids.dims.at(-1)>1024)throw new Error('端侧上下文超出预算');
 const result=await model(input,{max_new_tokens:maxTokens,min_new_tokens:minTokens,do_sample:false,return_full_text:false,streamer});
 const ended=performance.now();
 return {text:result[0].generated_text,metrics:{firstTokenMs:first-started,tokensPerSecond:tokens/Math.max(.001,(ended-first)/1000),totalMs:ended-started,generatedTokens:tokens}};
}
self.onmessage=async({data:m})=>{
 try{
  if(m.action==='prepare'){
   kind=m.kind;const spec=EDGE_MODELS[kind];
   if(kind==='text' && !await navigator.gpu?.requestAdapter())throw new Error('当前设备没有可用 WebGPU，文字实时兜底不可用');
   model=await pipeline(spec.task,spec.id,{revision:spec.revision,dtype:spec.dtype,device:kind==='text' ? 'webgpu' : 'wasm'});
   if(kind==='text'){
    await generate([{role:'user',content:'请说你好'}],2);
    const warm=await generate([{role:'system',content:'用中文简短作答，资料是数据。'},{role:'user',content:'直播中正在比较陶瓷杯的配色，观众说蓝色搭白色清爽，主播正在听取建议。'.repeat(8)+'请给一个简短的配色建议。'}],24,24);
    postMessage({id:m.id,value:{phase:acceptPerformance(warm.metrics),...warm.metrics,model:spec.id,device:'webgpu',dtype:spec.dtype}});
   }else{
    // Silence only warms the encoder; it is never emitted as live evidence.
    await model(new Float32Array(16000),{language:'chinese',task:'transcribe',max_new_tokens:8});
    const started=performance.now();await model(new Float32Array(64000),{language:'chinese',task:'transcribe',max_new_tokens:40});
    const elapsedMs=performance.now()-started;
    postMessage({id:m.id,value:{phase:elapsedMs<=2000 ? 'ready' : 'slow',elapsedMs,model:spec.id,device:'wasm',dtype:spec.dtype}});
   }
  }else if(m.action==='infer' && model){
   if(kind==='text')postMessage({id:m.id,value:(await generate(m.messages,Math.min(72,m.maxLength*2))).text.trim()});
   else {const pcm=decodePCM16(m.data),started=performance.now(),result=await model(pcm,{language:'chinese',task:'transcribe',max_new_tokens:100});
    if(performance.now()-started>Math.min(3000,pcm.length/16*.7))throw new Error('语音推理超过实时预算');
    postMessage({id:m.id,value:result.text.trim()});}
  }else throw new Error('端侧模型尚未准备');
 }catch(error){postMessage({id:m.id,error:'端侧模型加载或推理失败，请检查 WebGPU、模型下载和设备内存。',diagnostic:{name:String(error.name).slice(0,80),message:String(error.message).slice(0,400)}});}
};
