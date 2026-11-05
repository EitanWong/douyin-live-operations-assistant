import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupProgress} from '../../src/ui/setup-progress.js';
import {requestNativeDeployment} from '../../extension/native-deployment.js';
test('准备阶段与当前文件真实字节独立显示，未知总大小不伪造百分比',()=>{
 const known=setupProgress('text',{phase:'loading',progress:{stage:'download',file:'model.onnx',loaded:50*1024*1024,total:100*1024*1024}});
 assert.equal(known.percent,50);assert.match(known.text,/50.0.*100.0.*MB/);assert.match(known.text,/当前文件/);
 assert.equal(setupProgress('native',{phase:'running',progress:{stage:'python'}}).percent,null);
 assert.match(setupProgress('audio',{phase:'loading',progress:{stage:'restoring'}}).text,/恢复/);
 assert.match(setupProgress('text',{phase:'error',error:'请检查网络'}).text,/请检查网络/);
});
test('原生安装控制只接受固定操作，状态不暴露安装路径和错误细节',async()=>{
 const sent=[],chrome={runtime:{sendNativeMessage:async(host,request)=>{sent.push({host,request});return {value:{phase:'running',pid:999,config:{path:'/private'},progress:{stage:'model-download',loaded:5,total:10}}};}}};
 const result=await requestNativeDeployment(chrome,'status');assert.equal(result.progress.loaded,5);assert.equal(result.pid,undefined);assert.equal(result.config,undefined);
 await assert.rejects(requestNativeDeployment(chrome,'shell'),/无效/);assert.equal(sent.length,1);
 const missing={runtime:{sendNativeMessage:async()=>{throw Error('not found');}}};
 assert.equal((await requestNativeDeployment(missing,'status')).phase,'unavailable');await assert.rejects(requestNativeDeployment(missing,'start'),/先运行一次/);
});
