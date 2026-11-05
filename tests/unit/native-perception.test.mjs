import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNativeCapture,checkNativeComponent} from '../../src/browser/native-perception.js';
import {installNativePerceptionBridge} from '../../extension/native-perception.js';

function port(){const handlers={};return {sent:[],closed:0,onMessage:{addListener:f=>handlers.message=f},onDisconnect:{addListener:f=>handlers.disconnect=f},postMessage(v){this.sent.push(v);},disconnect(){this.closed++;},emit:v=>handlers.message?.(v),lost:()=>handlers.disconnect?.()};}
const config={inputSource:'native',transport:'webrtc',realtimeEndpoint:'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen3.8-omni-flash-realtime',realtimeModel:'qwen3.8-omni-flash-realtime',sessionMinutes:1,sessionTokens:1000,maxPerHour:10};
test('组件检查仅探测依赖、不传密钥和启动媒体，成功或断开均释放端口',async()=>{
  const p=port(),pending=checkNativeComponent(()=>p);
  assert.deepEqual(p.sent,[{type:'probe'}]);p.emit({type:'health',ready:true});
  assert.match(await pending,/已就绪/);assert.equal(p.closed,1);
  const q=port(),missing=checkNativeComponent(()=>q);q.lost();
  await assert.rejects(missing,/本地感知组件/);assert.equal(q.closed,1);
});
test('原生采集等待双轨就绪，观测进入统一出口；取消与迟到结果隔离，密钥不回传',async()=>{
  const p=port(),rows=[],states=[],controller=new AbortController();
  const capture=createNativeCapture({connect:()=>p,getKey:()=> 'test-secret',room:'123456',now:()=>10000});
  let ready=false;
  const pending=capture({config,signal:controller.signal,isCurrent:()=>true,onObservation:r=>rows.push(r),onProgress:s=>states.push(s),onError:assert.fail,onEnded(){}}).then(v=>{ready=true;return v;});
  assert.equal(p.sent[0].type,'start');assert.equal(p.sent[0].room,'123456');
  p.emit({type:'state',phase:'resolving'});await Promise.resolve();assert.equal(ready,false);
  p.emit({type:'ready'});const source=await pending;
  p.emit({type:'observation',row:{kind:'omni',id:'1',at:9500,endedAt:9800,receivedAt:10000,text:'主播展示杯子。',isFinal:true}});
  assert.equal(rows[0].inputSource,'native');assert.equal(rows[0].transport,'websocket');assert.equal(rows[0].text,'主播展示杯子。');assert.equal(states[0].phase,'resolving');
  controller.abort();source.stop();assert.equal(p.closed,1);assert.equal(p.sent.at(-1).type,'stop');
  p.emit({type:'observation',row:{kind:'omni',at:9500,endedAt:9800,text:'迟到'}});assert.equal(rows.length,1);
});
test('本地组件缺失或连接断开立即结束，错误不泄露原生返回文本',async()=>{
  const p=port();const capture=createNativeCapture({connect:()=>p,getKey:()=> 'secret',room:'123456'});
  const pending=capture({config,onError(){},onEnded(){}});p.lost();
  await assert.rejects(pending,/本地.*组件/);
  const q=port(),errors=[];let ended=0;
  const running=createNativeCapture({connect:()=>q,getKey:()=> 'secret',room:'123456'})({config,onError:e=>errors.push(e),onEnded:()=>ended++});
  q.emit({type:'ready'});await running;q.emit({type:'error',code:'DECODE_FAILED',message:'https://secret.example/?token=secret'});
  assert.equal(ended,1);assert.equal(errors.length,1);assert.doesNotMatch(errors[0].message,/secret|https:/);
});
test('原生桥仅接收本房顶层隔离脚本，独占房间，页面离开保留宿主直到手动停止',()=>{
  let listener;const hosts=[];const chrome={runtime:{onConnect:{addListener:f=>listener=f},connectNative:()=>{const p=port();hosts.push(p);return p;}}};
  installNativePerceptionBridge(chrome);
  const bad=port();Object.assign(bad,{name:'native-perception',sender:{frameId:1,tab:{id:1,url:'https://live.douyin.com/123456'}}});listener(bad);assert.equal(bad.closed,1);assert.equal(hosts.length,0);
  const client=port();Object.assign(client,{name:'native-perception',sender:{frameId:0,url:'https://live.douyin.com/123456',tab:{id:1,url:'https://live.douyin.com/123456'}}});listener(client);
  client.emit({type:'start',room:'999999',config,key:'secret'});assert.equal(hosts.length,0);
  const good=port();Object.assign(good,{name:'native-perception',sender:client.sender});listener(good);good.emit({type:'start',room:'123456',config,key:'secret'});
  assert.equal(hosts.length,1);assert.equal(hosts[0].sent[0].room,'123456');
  const duplicate=port();Object.assign(duplicate,{name:'native-perception',sender:client.sender});listener(duplicate);duplicate.emit({type:'start',room:'123456',config,key:'secret'});assert.equal(hosts.length,1);
  good.lost();assert.equal(hosts[0].closed,0);
  const at=Date.now();hosts[0].emit({type:'ready'});hosts[0].emit({type:'observation',row:{kind:'omni',id:'background',at,endedAt:at,text:'后台观察'}});assert.equal(good.sent.length,0);
  const resumed=port();Object.assign(resumed,{name:'native-perception',sender:client.sender});listener(resumed);
  resumed.emit({type:'resume',room:'123456'});assert.equal(hosts.length,1);
  assert.equal(resumed.sent[0].type,'ready');assert.equal(resumed.sent.at(-1).row.text,'后台观察');
  resumed.emit({type:'stop'});assert.equal(hosts[0].closed,1);
  const status=port();Object.assign(status,{name:'native-perception',sender:client.sender});listener(status);status.emit({type:'status'});
  assert.deepEqual(status.sent,[{type:'session',stopped:true}]);
});

test('原生页面生命周期只脱离订阅，显式停止仍发送stop',async()=>{
  const p=port(),controller=new AbortController();
  const pending=createNativeCapture({connect:()=>p,getKey:()=> 'secret',room:'123456'})({config,signal:controller.signal});
  p.emit({type:'ready'});await pending;controller.abort('detach');
  assert.equal(p.sent.at(-1).type,'detach');assert.equal(p.closed,1);
});

test('手动停止标记在MV3后台回收后仍阻止自动重启，不保存密钥或观察',async()=>{
  let listener;const saved={};const hosts=[];
  const chrome={storage:{session:{get:async key=>({[key]:saved[key]}),set:async values=>Object.assign(saved,values)}},runtime:{onConnect:{addListener:fn=>listener=fn},connectNative:()=>{const p=port();hosts.push(p);return p;}}};
  const client=()=>{const p=port();Object.assign(p,{name:'native-perception',sender:{frameId:0,url:'https://live.douyin.com/123456',tab:{id:1,url:'https://live.douyin.com/123456'}}});listener(p);return p;};
  installNativePerceptionBridge(chrome);const initial=client();initial.emit({type:'start',room:'123456',config,key:'memory-secret'});initial.emit({type:'stop'});
  assert.equal(hosts[0].closed,1);await new Promise(setImmediate);
  installNativePerceptionBridge(chrome);const restored=client();restored.emit({type:'status'});await new Promise(setImmediate);
  assert.deepEqual(restored.sent,[{type:'session',stopped:true}]);assert.doesNotMatch(JSON.stringify(saved),/memory-secret|realtimeEndpoint/);
});

test('离页后超过20条的感知仍全部存档，存储失败会保留重试，不重启模型',async()=>{
 let connected,fail=true;const hosts=[],saved=[];
 const chrome={runtime:{onConnect:{addListener:f=>connected=f},connectNative:()=>{const host=port();hosts.push(host);return host;}}};
 installNativePerceptionBridge(chrome,{memoryRetryMs:5,onObservation:async(room,row)=>{assert.equal(room,'123456');if(fail)throw Error('disk full');saved.push(row);}});
 const client=port();Object.assign(client,{name:'native-perception',sender:{frameId:0,url:'https://live.douyin.com/123456',tab:{id:1,url:'https://live.douyin.com/123456'}}});connected(client);
 client.emit({type:'start',room:'123456',config,key:'secret'});client.lost();const at=Date.now();
 for(let i=0;i<45;i++)hosts[0].emit({type:'observation',row:{id:'history'+i,kind:'omni',at,endedAt:at,text:'后台原文'+i}});
 await new Promise(setImmediate);fail=false;
 for(let i=0;i<100 && saved.length<45;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(saved.length,45);assert.equal(hosts.length,1);assert.equal(hosts[0].closed,0);
 const resumed=port();Object.assign(resumed,{name:'native-perception',sender:client.sender});connected(resumed);resumed.emit({type:'resume',room:'123456'});resumed.emit({type:'stop'});
});
