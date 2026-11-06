import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textCandidates,TEXT_MODELS} from '../../src/ai/device-policy.js';
import {createSpeechRecognizer} from '../../src/services/speech-routing.js';
import {createModelPreparation} from '../../extension/model-preparation.js';
import {LiveMemoryArchive} from '../../src/ai/live-memory.js';
import {installEdgeBridge} from '../../extension/edge-background.js';
import {createEdgeClient} from '../../src/browser/edge-client.js';

test('浏览器自动选择最大兼容多模态模型，保留内存、存储和未知资源边界',()=>{
 const high={webgpu:true,shaderF16:true,memoryGB:8,cores:8,maxBufferMB:2048,maxStorageMB:1024,storageFreeMB:12000};
 assert.equal(textCandidates('auto',high)[0],'qwen3.5-4b');assert.equal(TEXT_MODELS['qwen3.5-4b'].multimodal,true);
 assert.equal(textCandidates('auto',{...high,memoryGB:null})[0],'qwen-0.5b');
 assert.equal(textCandidates('auto',{...high,memoryGB:4})[0],'qwen3.5-0.8b');
 assert.equal(textCandidates('auto',{...high,storageFreeMB:2000}).includes('qwen3.5-4b'),false);
});
test('画面优先云端，只有失败后用浏览器视觉；仅记最新帧的时间与识别文本',async()=>{
 const calls=[];let fails=false;
 const recognize=createSpeechRecognizer({cloud:async()=>{calls.push('cloud');if(fails)throw Error('quota');return {text:'云端观察'};},edge:{ready:async()=>true,observe:async sample=>{calls.push('webgpu');assert.equal(sample.data,'data:image/jpeg;base64,Yg==');return {text:'左侧蓝色，右侧红色。',model:'browser-vlm'};}},config:()=>({enabled:true,visionEnabled:true}),now:()=>300});
 const sample={kind:'video',at:100,endedAt:200,frames:[{at:100,data:'data:image/jpeg;base64,YQ=='},{at:200,data:'data:image/jpeg;base64,Yg=='}],inputSource:'direct'};
 assert.equal((await recognize(sample,{})).text,'云端观察');assert.deepEqual(calls,['cloud']);
 fails=true;const row=await recognize(sample,{});
 assert.deepEqual(calls,['cloud','cloud','webgpu']);assert.equal(row.at,200);assert.equal(row.endedAt,200);assert.equal(row.frameCount,1);assert.equal(row.transport,'local');assert.equal(row.model,'browser-vlm');assert.equal(row.data,undefined);
});
test('仅本地语音组合不改变画面的云端优先路由',async()=>{
 const calls=[];
 const recognize=createSpeechRecognizer({cloud:async()=>{calls.push('cloud');return {text:'云端画面'};},edge:{ready:async()=>{calls.push('local');return true;}},config:()=>({enabled:true,audioEnabled:true,visionEnabled:true})});
 assert.equal((await recognize({kind:'video',data:'jpeg'},{localAudio:true})).text,'云端画面');assert.deepEqual(calls,['cloud']);
});
test('文字和视觉共用一个Worker与推理槽，忙时拒绝排队并能释放',async()=>{
 let worker;const manager=createModelPreparation({read:async()=>({}),write:async()=>{},detect:async()=>({webgpu:true}),createWorker:()=>worker={sent:[],postMessage(m){this.sent.push(m);},terminate(){}}});await manager.ready;
 const task=await manager.prepare('text','qwen-0.5b');worker.onmessage({data:{id:task.id,value:{phase:'ready',vision:{phase:'ready'}}}});await new Promise(setImmediate);
 const picture=manager.infer({id:'v',kind:'vision',data:'jpeg'});await new Promise(setImmediate);assert.equal(worker.sent.at(-1).kind,'vision');
 await assert.rejects(manager.infer({id:'t',kind:'text'}),/繁忙/);worker.onmessage({data:{id:'v',value:{text:'蓝色'}}});assert.equal((await picture).text,'蓝色');manager.close();
});
test('取消视觉会恢复已选择模型的后台准备，显式释放仍阻止恢复',async()=>{
 const workers=[];const manager=createModelPreparation({read:async()=>({}),write:async()=>{},detect:async()=>({webgpu:true}),createWorker:()=>{const w={postMessage(){},terminate(){this.terminated=true;}};workers.push(w);return w;}});await manager.ready;
 const task=await manager.prepare('text','qwen-0.5b');workers[0].onmessage({data:{id:task.id,value:{phase:'ready',vision:{phase:'ready'}}}});await new Promise(setImmediate);
 const running=manager.infer({id:'v',kind:'vision'}),cancelled=assert.rejects(running,/取消/);await new Promise(setImmediate);manager.cancel('v');await cancelled;await new Promise(setImmediate);
 assert.equal(workers[0].terminated,true);assert.equal(workers.length,2);assert.equal(manager.status().text.phase,'loading');await manager.release();assert.equal(manager.status().text.phase,'released');manager.close();
});
test('浏览器视觉兜底写入现有记忆，重建后仍按主播隔离并明确历史时间',async()=>{
 let now=1800000000000;const values=new Map();
 const recognize=createSpeechRecognizer({cloud:async()=>{throw Error('cloud unavailable');},edge:{ready:async()=>true,observe:async()=>({text:'左侧是蓝色杯子。',model:'browser-vlm'})},config:()=>({enabled:true,visionEnabled:true}),now:()=>now});
 const row=await recognize({kind:'video',at:now,endedAt:now,data:'data:image/jpeg;base64,YQ=='},{});
 const options={room:'1',now:()=>now,get:(key,fallback)=>values.get(key) ?? fallback,set:async(key,value)=>values.set(key,structuredClone(value))};
 const archive=new LiveMemoryArchive(options);assert.equal(archive.current('a').perception.observe(row),true);await archive.persist(archive.capture());now+=86400000;
 const restored=new LiveMemoryArchive(options),history=restored.current('a').perception.context('蓝色杯子');
 assert.match(history.coverage,/historical/);assert.equal(history.records[0].text,row.text);assert.equal(history.records[0].at,row.at);assert.equal(restored.current('b').perception.context('杯子').records.length,0);
});
test('浏览器视觉端口校验图像边界，通过后台后报告真正就绪的视觉模型',async()=>{
 const event=()=>{const listeners=[];return {addListener:fn=>listeners.push(fn),emit:(...args)=>listeners.forEach(fn=>fn(...args))};};
 const sent=[],answers=[];
 const chrome={storage:{local:{get:async()=>({})}},runtime:{id:'ext',getURL:p=>`chrome-extension://ext/${p}`,getContexts:async()=>[{}],onConnect:event(),onMessage:event(),sendMessage:async message=>{sent.push(message);return {value:{text:'左蓝右红',model:'vlm'}};}}};
 installEdgeBridge(chrome);
 const port={name:'edge-ai',sender:{frameId:0,url:'https://live.douyin.com/1',tab:{id:7,url:'https://live.douyin.com/1'}},onMessage:event(),onDisconnect:event(),postMessage:m=>answers.push(m),disconnect(){}};
 chrome.runtime.onConnect.emit(port);
 for(const data of ['data:image/jpeg;base64,YQ==','https://example.com/private.jpg','data:image/jpeg;base64,'+'A'.repeat(400001)]){
  port.onMessage.emit({id:crypto.randomUUID(),action:'infer',kind:'vision',data});await new Promise(setImmediate);
 }
 assert.equal(sent.filter(row=>row.action==='infer').length,1);assert.equal(answers.filter(row=>row.error).length,2);
 const messages=event();let state={text:{phase:'ready',vision:{phase:'slow'}}};
 const client=createEdgeClient({connect:()=>({onMessage:messages,onDisconnect:event(),disconnect(){},postMessage:m=>queueMicrotask(()=>messages.emit({id:m.id,value:m.action==='status' ? state : {text:'蓝色',model:'vlm'}}))})});
 assert.equal(await client.ready('vision'),false);state.text.vision.phase='ready';assert.equal(await client.ready('vision'),true);assert.equal((await client.observe({data:'data:image/jpeg;base64,YQ=='})).model,'vlm');client.close();
});
test('自检失败或速度不合格的最终候选立即释放GPU执行器',async()=>{
 for(const result of [{error:'incorrect'},{value:{phase:'slow'}}]){
  let worker;const manager=createModelPreparation({read:async()=>({}),write:async()=>{},detect:async()=>({webgpu:true}),createWorker:()=>worker={postMessage(){},terminate(){this.terminated=true;}}});await manager.ready;
  const task=await manager.prepare('text','qwen-0.5b');worker.onmessage({data:{id:task.id,...result}});await new Promise(setImmediate);assert.equal(worker.terminated,true);await assert.rejects(manager.infer({id:'x',kind:'text'}),/尚未就绪/);manager.close();
 }
});
