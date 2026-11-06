// Hardware signals narrow the candidates. Only a real warm benchmark grants readiness.
export const TEXT_MODELS=Object.freeze({
 'qwen3.5-4b':{id:'onnx-community/Qwen3.5-4B-ONNX-OPT',revision:'bb072268d0912bdc5cf4f41c8c6f53a03fd68624',label:'Qwen3.5 4B · 浏览器文字与视觉',task:'text-generation',dtype:'q4f16',storageMB:4200,memoryGB:8,multimodal:true,inputTokens:4096},
 'qwen3.5-2b':{id:'onnx-community/Qwen3.5-2B-ONNX-OPT',revision:'ed446636739bf426e73c5a00714fd8e010d36c21',label:'Qwen3.5 2B · 浏览器文字与视觉',task:'text-generation',dtype:'q4f16',storageMB:2400,memoryGB:6,multimodal:true,inputTokens:4096},
 'qwen3.5-0.8b':{id:'onnx-community/Qwen3.5-0.8B-ONNX-OPT',revision:'9a4c21d8f724176b0a7edaaed36303044451886e',label:'Qwen3.5 0.8B · 浏览器轻量多模态',task:'text-generation',dtype:'q4f16',storageMB:1300,memoryGB:4,multimodal:true,inputTokens:4096},
 'qwen-0.5b':{id:'onnx-community/Qwen2.5-0.5B-Instruct',revision:'22942cb7d7ba4cc81bb4673549ca4d4614469b5e',label:'Qwen2.5 0.5B · 低延迟',task:'text-generation',dtype:'q4',storageMB:650},
 'qwen-1.5b':{id:'onnx-community/Qwen2.5-1.5B-Instruct',revision:'d54957e3af1be04546436e874a60fe386041b244',label:'Qwen2.5 1.5B · 较强理解',task:'text-generation',dtype:'q4f16',storageMB:1250}
});
const preferred=['qwen3.5-4b','qwen3.5-2b','qwen3.5-0.8b','qwen-1.5b','qwen-0.5b'];
function eligibleText(device){
 if(!device.webgpu)return [];
 return preferred.filter(key=>{
  const spec=TEXT_MODELS[key];
  return (!Number.isFinite(device.storageFreeMB) || device.storageFreeMB>=spec.storageMB)
   && (key==='qwen-0.5b' || device.shaderF16 && device.memoryGB>=(spec.memoryGB || 8) && device.cores>=8 && device.maxBufferMB>=1024 && device.maxStorageMB>=512);
 });
}
export function recommendDevice(device={},native={}){
 const textModel=eligibleText(device)[0] || null,reasons=[!device.webgpu ? '没有可用 WebGPU，保留云端回复与规则话术' : !textModel ? '浏览器可用存储不足，请先清理空间' : textModel==='qwen-0.5b' ? '资源有限或信息不完整，优先轻量文字模型；不把未知内存猜作高性能设备' : '按已知资源先测较大的浏览器多模态模型，加载、自检或速度不足自动逐级降档'];
 const audioBackend=native.available ? 'native-sensevoice' : 'browser-whisper';
 reasons.push(native.available ? '已检测到 SenseVoice 组件与模型文件，准备后实测' : '未检测到已安装的 SenseVoice；可使用浏览器 Whisper 或安装中文组件');
 return {textModel,audioBackend,reasons,requiresBenchmark:true};
}
export function textCandidates(selection='auto',device={}){
 if(selection!=='auto'){if(!TEXT_MODELS[selection])throw new Error('不支持的端侧文字模型');return [selection];}
 return eligibleText(device);
}
export function automaticLatency(status={}){
 return {edgeDelayMs:status.phase==='ready' && Number.isFinite(status.totalMs) ? Math.max(500,Math.min(1500,Math.round(status.totalMs*1.5))) : 1500,cloudMs:8000,totalMs:16000};
}
export async function prepareRecommendedText(selection,device,run){
 const candidates=textCandidates(selection,device);if(!candidates.length)throw new Error('当前设备不适合浏览器文字推理，请检查 WebGPU 和可用存储');
 let result,error;
 for(const key of candidates){
  try{result={...await run(key),selection:key};if(result.phase==='ready')return result;}catch(cause){error=cause;}
 }
 if(result)return result;throw error;
}
