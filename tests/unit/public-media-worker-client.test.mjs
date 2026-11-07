import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPublicMediaWorkerClient} from '../../extension/public-media-worker-client.js';

function fixture(version=3,analyzeVisual){
 let messages=[],disconnects=0,changed=0;
 const listeners=new Set(),disconnected=new Set();
 const port={onMessage:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},onDisconnect:{addListener:f=>disconnected.add(f),removeListener:f=>disconnected.delete(f)},disconnect(){disconnects++;for(const fn of disconnected)fn();},postMessage(message){messages.push(message);queueMicrotask(()=>{for(const fn of listeners)fn({id:message.id,value:message.action==='capabilities'?{publicMedia:version,modelLease:1,keyframes:1}:{accepted:true}});});}};
 const client=createPublicMediaWorkerClient({connect:()=>port,onResult:()=>changed++,analyzeVisual});
 return {client,port,messages,listeners,get disconnects(){return disconnects;},get changed(){return changed;}};
}
test('后台只启动支持共享模型租约的宿主，重复运行请求不会开第二个工作者',async()=>{
 const f=fixture();assert.equal(await f.client.ready(),true);await Promise.all([f.client.run(),f.client.run()]);
 assert.equal(f.messages.filter(m=>m.action==='run').length,1);
 for(const fn of f.listeners)fn({type:'public-media-result',value:{id:'job',status:'succeeded'}});
 assert.equal(f.changed,1);f.client.close();assert.equal(f.disconnects,1);
});
test('关键帧请求只运行一项，原生取消和连接关闭终止视觉调用，迟到文本不回传',async()=>{
 let calls=0,signal,finish;
 const f=fixture(3,async(_input,options)=>{calls++;signal=options.signal;return new Promise(resolve=>finish=resolve);});
 assert.equal(await f.client.ready(),true);
 for(const fn of f.listeners)fn({type:'public-media-visual',id:'frame-one',job:{id:'job'},frame:{atMs:0,data:'jpeg'}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 for(const fn of f.listeners)fn({type:'public-media-visual-cancel',id:'frame-one'});
 assert.equal(signal.aborted,true);finish('late');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.messages.some(m=>m.action==='visual-result'),false);f.client.close();
});
test('旧宿主不能通过能力探测，不提交运行请求并释放连接',async()=>{
 const f=fixture(0);assert.equal(await f.client.ready(),false);assert.equal(f.messages.some(m=>m.action==='run'),false);assert.equal(f.disconnects,1);
});
test('仅有旧音轨协议的宿主不能接受新增页面媒体任务',async()=>{
 const f=fixture(1);assert.equal(await f.client.ready(),false);assert.equal(f.messages.some(m=>m.action==='run'),false);
});
test('没有关键帧协议的旧页面下载宿主也不能启动视觉任务',async()=>{
 const f=fixture(2);assert.equal(await f.client.ready(),false);assert.equal(f.messages.some(m=>m.action==='run'),false);
});

test('旧连接迟到消息和断开不能关闭新工作者或触发旧结果导入',async()=>{
 const ports=[];let imported=0;
 const connect=()=>{const messages=new Set(),disconnects=new Set();const port={closed:0,onMessage:{addListener:f=>messages.add(f)},onDisconnect:{addListener:f=>disconnects.add(f)},disconnect(){this.closed++;},emit:value=>messages.forEach(f=>f(value)),lost:()=>disconnects.forEach(f=>f()),postMessage:m=>queueMicrotask(()=>port.emit({id:m.id,value:{publicMedia:3,modelLease:1,keyframes:1}}))};ports.push(port);return port;};
 const client=createPublicMediaWorkerClient({connect,onResult:()=>imported++});
 await client.ready();client.close();await client.ready();
 ports[0].emit({type:'public-media-result',value:{id:'late'}});ports[0].lost();
 assert.equal(imported,0);assert.equal(ports[1].closed,0);client.close();
});
