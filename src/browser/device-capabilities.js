export async function detectDevice(nav=globalThis.navigator){
 const result={webgpu:false,memoryGB:nav?.deviceMemory || null,cores:nav?.hardwareConcurrency || null,maxBufferMB:null,maxStorageMB:null,shaderF16:false,storageFreeMB:null};
 try{
  const adapter=await nav?.gpu?.requestAdapter();
  if(adapter){const device=await adapter.requestDevice();result.webgpu=true;result.maxBufferMB=adapter.limits.maxBufferSize/2**20;result.maxStorageMB=adapter.limits.maxStorageBufferBindingSize/2**20;result.shaderF16=adapter.features.has('shader-f16');device.destroy();}
 }catch{ /* Device creation can fail even when navigator.gpu exists. */ }
 try{const {quota,usage}=await nav.storage.estimate();if(Number.isFinite(quota) && Number.isFinite(usage))result.storageFreeMB=Math.max(0,Math.floor((quota-usage)/2**20));}catch{}
 return result;
}
