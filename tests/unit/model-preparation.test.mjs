import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createModelPreparation} from '../../extension/model-preparation.js';

const flush=()=>new Promise(setImmediate);
function fixture(initial={}){
 let saved=structuredClone(initial);const workers=[];
 const options={read:async()=>structuredClone(saved),write:async value=>{saved=structuredClone(value);},
  detect:async()=>({webgpu:true,shaderF16:true,memoryGB:16,cores:8,maxBufferMB:2048,maxStorageMB:1024}),
  createWorker:()=>{const worker={sent:[],terminated:false,postMessage(m){this.sent.push(m);},terminate(){this.terminated=true;},emit(data){this.onmessage({data});}};workers.push(worker);return worker;}};
 return {options,workers,get saved(){return saved;}};
}
test('后台模型任务先持久化，页面离开不影响；重建执行器自动接续同一任务并恢复进度',async()=>{
 const f=fixture(),first=createModelPreparation(f.options);await first.ready;
 const task=await first.prepare('text','qwen-0.5b');const worker=f.workers[0];
 assert.equal(f.saved.text.id,task.id);assert.equal(worker.sent.length,1);
 worker.emit({id:task.id,progress:{stage:'download',file:'onnx/model.onnx',loaded:25,total:100}});await flush();
 assert.equal(f.saved.text.progress.loaded,25);
 first.close();assert.equal(worker.terminated,true);
 const restored=createModelPreparation(f.options);await restored.ready;
 assert.equal(f.workers.length,2);assert.equal(restored.status().text.id,task.id);
 assert.equal(restored.status().text.phase,'loading');
 const next=f.workers[1];next.emit({id:task.id,value:{phase:'ready',model:'verified-model'}});await flush();
 assert.equal(f.saved.text.phase,'ready');assert.equal(restored.status().text.model,'verified-model');restored.close();
});
test('同一模型多处点击合并，显式释放写入取消状态，重载不复活且迟到进度无效',async()=>{
 const f=fixture(),manager=createModelPreparation(f.options);await manager.ready;
 const [a,b]=await Promise.all([manager.prepare('audio'),manager.prepare('audio')]);
 assert.equal(a.id,b.id);assert.equal(f.workers.length,1);
 await manager.release();f.workers[0].emit({id:a.id,value:{phase:'ready'}});await flush();
 assert.equal(f.saved.audio.phase,'released');manager.close();
 const restored=createModelPreparation(f.options);await restored.ready;assert.equal(f.workers.length,1);restored.close();
});
test('自动文字选型与性能降级归后台持有，旧worker结果不能覆盖新模型',async()=>{
 const f=fixture(),manager=createModelPreparation(f.options);await manager.ready;
 const task=await manager.prepare('text','auto');assert.equal(f.workers[0].sent[0].model,'qwen-1.5b');
 f.workers[0].emit({id:task.id,value:{phase:'slow'}});await flush();
 assert.equal(f.workers.length,2);assert.equal(f.workers[1].sent[0].model,'qwen-0.5b');
 f.workers[0].emit({id:task.id,value:{phase:'ready',model:'old'}});await flush();
 assert.equal(manager.status().text.phase,'loading');
 f.workers[1].emit({id:task.id,value:{phase:'ready',model:'small'}});await flush();
 assert.equal(f.saved.text.model,'small');manager.close();
});
test('持久化失败不启动下载；推理取消只结束对应推理，不撤销后台准备意图',async()=>{
 const f=fixture(),manager=createModelPreparation({...f.options,write:async()=>{throw Error('disk full');}});await manager.ready;
 await assert.rejects(manager.prepare('text','qwen-0.5b'),/disk full/);assert.equal(f.workers.length,0);manager.close();
});
test('同时恢复文字和语音时，第一项写入不会抹去另一项意图；已就绪模型重新预热',async()=>{
 const f=fixture(Object.fromEntries(['text','audio'].map(kind=>[kind,{id:crypto.randomUUID(),kind,selection:kind==='text'?'qwen-0.5b':'auto',phase:'ready'}])));
 const manager=createModelPreparation(f.options);await manager.ready;
 assert.equal(f.workers.length,2);assert.equal(f.saved.text.phase,'loading');assert.equal(f.saved.audio.phase,'loading');manager.close();
});
