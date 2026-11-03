import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TEXT_MODELS,recommendDevice,textCandidates,automaticLatency,prepareRecommendedText} from '../../src/ai/device-policy.js';
import {detectDevice} from '../../src/browser/device-capabilities.js';

test('automatic recommendations prefer a larger Chinese model only with sufficient known resources',()=>{
 const high={webgpu:true,memoryGB:8,cores:8,maxBufferMB:2048,maxStorageMB:1024,storageFreeMB:6000,shaderF16:true};
 assert.equal(recommendDevice(high).textModel,'qwen-1.5b');
 assert.deepEqual(textCandidates('auto',high),['qwen-1.5b','qwen-0.5b']);
 assert.equal(recommendDevice({...high,memoryGB:null}).textModel,'qwen-0.5b');
 assert.equal(recommendDevice({...high,shaderF16:false}).textModel,'qwen-0.5b');
 assert.equal(TEXT_MODELS['qwen-1.5b'].dtype,'q4f16');
 assert.deepEqual(textCandidates('qwen-0.5b',high),['qwen-0.5b']);
 assert.equal(recommendDevice({...high,storageFreeMB:100}).textModel,null);
 assert.equal(recommendDevice({...high,webgpu:false}).textModel,null);
 assert.equal(recommendDevice(high,{available:true}).audioBackend,'native-sensevoice');
 assert.equal(recommendDevice(high,{available:false}).audioBackend,'browser-whisper');
 assert.equal(automaticLatency({phase:'ready',totalMs:600}).edgeDelayMs,900);
 assert.equal(automaticLatency({phase:'unprepared'}).edgeDelayMs,1500);
});
test('automatic preparation demotes a slow model, manual selection does not silently change it',async()=>{
 const tried=[],device={webgpu:true,memoryGB:8,cores:8,maxBufferMB:2048,maxStorageMB:1024,shaderF16:true};
 const run=async key=>{tried.push(key);return {phase:key==='qwen-1.5b' ? 'slow' : 'ready'};};
 assert.equal((await prepareRecommendedText('auto',device,run)).selection,'qwen-0.5b');assert.equal(tried.length,2);
 tried.length=0;assert.equal((await prepareRecommendedText('qwen-1.5b',device,run)).phase,'slow');assert.deepEqual(tried,['qwen-1.5b']);
});
test('capability detection releases its GPU and reports unknowns honestly without downloading a model',async()=>{
 let destroyed=0;const report=await detectDevice({hardwareConcurrency:8,deviceMemory:8,storage:{estimate:async()=>({quota:1e10,usage:1e9})},gpu:{requestAdapter:async()=>({limits:{maxBufferSize:2**30,maxStorageBufferBindingSize:2**29},features:new Set(['shader-f16']),requestDevice:async()=>({destroy:()=>destroyed++})})}});
 assert.equal(report.webgpu,true);assert.equal(report.cores,8);assert.equal(report.maxStorageMB,512);assert.equal(destroyed,1);
 const unknown=await detectDevice({gpu:{requestAdapter:async()=>{throw Error('denied');}}});
 assert.equal(unknown.webgpu,false);assert.equal(unknown.memoryGB,null);
});
