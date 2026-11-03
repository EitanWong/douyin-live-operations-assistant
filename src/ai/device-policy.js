// Hardware signals narrow the candidates. Only a real warm benchmark grants readiness.
export const TEXT_MODELS=Object.freeze({
 'qwen-0.5b':{id:'onnx-community/Qwen2.5-0.5B-Instruct',revision:'22942cb7d7ba4cc81bb4673549ca4d4614469b5e',label:'Qwen2.5 0.5B · 低延迟',task:'text-generation',dtype:'q4',storageMB:650},
 'qwen-1.5b':{id:'onnx-community/Qwen2.5-1.5B-Instruct',revision:'d54957e3af1be04546436e874a60fe386041b244',label:'Qwen2.5 1.5B · 较强理解',task:'text-generation',dtype:'q4f16',storageMB:1250}
});
export function recommendDevice(device={},native={}){
 const reasons=[];let textModel='qwen-0.5b';
 if(!device.webgpu){textModel=null;reasons.push('没有可用 WebGPU，保留云端回复与规则话术');}
 else if(Number.isFinite(device.storageFreeMB) && device.storageFreeMB<TEXT_MODELS[textModel].storageMB){textModel=null;reasons.push('浏览器可用存储不足，请先清理空间');}
 else if(device.shaderF16 && device.memoryGB>=8 && device.cores>=8 && device.maxBufferMB>=1024 && device.maxStorageMB>=512 && (device.storageFreeMB==null || device.storageFreeMB>=TEXT_MODELS['qwen-1.5b'].storageMB)){
  textModel='qwen-1.5b';reasons.push('已知内存、CPU、FP16 与 GPU 缓冲区允许先测较大模型，加载、自检或速度不达标自动降为 0.5B');
 }else reasons.push('资源有限或信息不完整，优先 0.5B；不把未知内存猜作高性能设备');
 const audioBackend=native.available ? 'native-sensevoice' : 'browser-whisper';
 reasons.push(native.available ? '已检测到 SenseVoice 组件与模型文件，准备后实测' : '未检测到已安装的 SenseVoice；可使用浏览器 Whisper 或安装中文组件');
 return {textModel,audioBackend,reasons,requiresBenchmark:true};
}
export function textCandidates(selection='auto',device={}){
 if(selection!=='auto'){if(!TEXT_MODELS[selection])throw new Error('不支持的端侧文字模型');return [selection];}
 const first=recommendDevice(device).textModel;return first==='qwen-1.5b' ? [first,'qwen-0.5b'] : first ? [first] : [];
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
