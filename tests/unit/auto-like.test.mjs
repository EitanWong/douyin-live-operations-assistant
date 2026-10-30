import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {AutoLike,validateAutoLike,AUTO_LIKE_DEFAULTS} from '../../src/core/auto-like.js';
import {PageRequestSender} from '../../src/browser/request-sender.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function controller(overrides={}) {
  const requests=[],timers=[];let guard='';
  const lock={held:false,acquire:async()=>{lock.held=true;return true;},release:()=>{lock.held=false;}};
  const transport={prepareLike:async()=>({available:true,token:'session'}),stopLike:async()=>({stopped:true}),commitLike:async(token,count,sequence)=>{requests.push({token,count,sequence});return {submitted:true,count};},...overrides};
  const runner=new AutoLike({transport,lock,guard:()=>guard,schedule:fn=>{timers.push(fn);return fn;},cancel:fn=>{const i=timers.indexOf(fn);if(i>=0)timers.splice(i,1);}});
  return {runner,transport,requests,timers,lock,setGuard:value=>{guard=value;},flush:async()=>{await timers.shift()?.();await new Promise(setImmediate);}};
}
function pageFixture() {
  const dom=new JSDOM('',{url:'https://live.douyin.com/123'}),page=dom.window,requests=[];
  page.__STORE__={roomStore:{roomInfo:{roomId:'7700231539170609947',room:{web_rid:'123',status:2,room_auth:{Digg:true}}}},userStore:{userInfo:{id_str:'987654321'}}};
  const sender=new PageRequestSender(page),client={request:async request=>{requests.push(request);return {data:{status_code:0}};}};
  sender.client=()=>client;
  return {dom,page,sender,client,requests,room:page.__STORE__.roomStore.roomInfo.room};
}

test('参数边界：数量为有限整数，间隔支持整毫秒，目标不允许无限运行',()=>{
  assert.deepEqual(validateAutoLike(AUTO_LIKE_DEFAULTS),AUTO_LIKE_DEFAULTS);
  for(const [key,values] of Object.entries({batch:[0,101,1.5,NaN,Infinity,'20'],intervalSec:[0,-1,0.0009,0.0015,1.0001,60.001,NaN,Infinity,'1',null,undefined],target:[0,1000001,-1,NaN]}))for(const value of values)assert.throws(()=>validateAutoLike({...AUTO_LIKE_DEFAULTS,[key]:value}));
  for(const intervalSec of [0.001,0.01,0.1,0.5,1,1.001,2.5,59.999])
    assert.deepEqual(validateAutoLike({batch:1,intervalSec,target:1}),{batch:1,intervalSec,target:1});
  assert.deepEqual(validateAutoLike({batch:100,intervalSec:60,target:1}),{batch:100,intervalSec:60,target:1});
});
test('串行分批、精确最后一批、到达目标停止并释放跨页锁',async()=>{
  const f=controller();await f.runner.start({batch:20,intervalSec:2,target:45});
  assert.equal(f.runner.state.accepted,20);assert.equal(f.lock.held,true);
  await f.flush();await f.flush();
  assert.deepEqual(f.requests.map(r=>r.count),[20,20,5]);assert.deepEqual(f.requests.map(r=>r.sequence),[1,2,3]);
  assert.equal(f.runner.state.phase,'completed');assert.equal(f.runner.state.accepted,45);assert.equal(f.lock.held,false);assert.equal(f.timers.length,0);
  assert.equal(f.runner.state.reason,'已达到本次目标');
});
test('1 毫秒间隔仅在上一批返回后计时，等待期间停止不会再提交',async()=>{
  const pending=deferred(),timers=[],f=controller({commitLike:()=>pending.promise});
  f.runner.schedule=(fn,ms)=>{timers.push({fn,ms});return fn;};
  f.runner.cancel=fn=>{const i=timers.findIndex(timer=>timer.fn===fn);if(i>=0)timers.splice(i,1);};
  const start=f.runner.start({batch:3,intervalSec:0.001,target:7});await new Promise(setImmediate);
  assert.equal(timers.length,0);await f.runner.tick();assert.equal(timers.length,0);
  pending.resolve({submitted:true,count:3});await start;
  assert.equal(timers.length,1);assert.equal(timers[0].ms,1);
  f.runner.stop();assert.equal(timers.length,0);assert.equal(f.runner.state.phase,'stopped');
});
test('毫秒设置转换为整数定时器延迟，串行完成精确余数',async()=>{
  for(const intervalSec of [0.001,0.01,0.1,1.001]){
    const f=controller(),delays=[];
    f.runner.schedule=(fn,ms)=>{delays.push(ms);f.timers.push(fn);return fn;};
    await f.runner.start({batch:3,intervalSec,target:7});await f.flush();await f.flush();
    assert.deepEqual(delays,[Math.round(intervalSec*1000),Math.round(intervalSec*1000)]);
    assert.deepEqual(f.requests.map(r=>r.count),[3,3,1]);assert.equal(f.runner.state.phase,'completed');
    assert.equal(f.runner.state.accepted,7);assert.equal(f.timers.length,0);
  }
});
test('1 毫秒模式第二批被平台拒绝时立即停止，不继续或重试',async()=>{
  let calls=0;
  const f=controller({commitLike:async(token,count)=>++calls===1?{submitted:true,count}:{submitted:false,reason:'平台拒绝点赞'}});
  await f.runner.start({batch:3,intervalSec:0.001,target:7});await f.flush();await f.runner.tick();
  assert.equal(calls,2);assert.equal(f.runner.state.accepted,3);assert.equal(f.runner.state.phase,'stopped');
  assert.equal(f.runner.state.reason,'平台拒绝点赞');assert.equal(f.timers.length,0);assert.equal(f.lock.held,false);
});
test('拒绝、超时、畸形响应和异常均停止，不重试且不增加接受次数',async()=>{
  for(const response of [{submitted:false,reason:'拒绝'},{submitted:false,unknown:true},{submitted:true},{submitted:true,count:99},null,'throw']){
    let calls=0;const f=controller({commitLike:async()=>{calls++;if(response==='throw')throw Error();return response;}});
    await f.runner.start(AUTO_LIKE_DEFAULTS);await f.runner.tick();
    assert.equal(calls,1);assert.equal(f.timers.length,0);assert.equal(f.runner.state.accepted,0);assert.equal(f.runner.state.phase,'stopped');assert.equal(f.lock.held,false);
  }
});
test('手动停止时保留已提交批次的真实返回，禁止立刻重开与迟到续发',async()=>{
  const pending=deferred();const f=controller({commitLike:()=>pending.promise});
  const start=f.runner.start(AUTO_LIKE_DEFAULTS);await new Promise(setImmediate);
  f.runner.stop();assert.equal(f.runner.state.phase,'stopping');assert.equal(f.lock.held,true);
  await assert.rejects(f.runner.start(AUTO_LIKE_DEFAULTS),/正在处理/);
  pending.resolve({submitted:true,count:20});await start;
  assert.equal(f.runner.state.accepted,20);assert.equal(f.runner.state.phase,'stopped');assert.equal(f.lock.held,false);assert.equal(f.timers.length,0);
  assert.equal(f.runner.state.reason,'已手动停止');
});
test('开始检查期间停止：迟到能力票据撤销，不执行首批',async()=>{
  const pending=deferred(),stopped=[];const f=controller({prepareLike:()=>pending.promise,stopLike:async token=>stopped.push(token)});
  const start=f.runner.start(AUTO_LIKE_DEFAULTS);await new Promise(setImmediate);f.runner.stop();
  pending.resolve({available:true,token:'late'});await start;
  assert.deepEqual(stopped,['late']);assert.equal(f.requests.length,0);assert.equal(f.lock.held,false);
});
test('跨标签页锁等待期间取消，不继续准备；锁拒绝会报告',async()=>{
  const pending=deferred(),f=controller();f.lock.acquire=()=>pending.promise;
  const start=f.runner.start(AUTO_LIKE_DEFAULTS);f.runner.stop();pending.resolve(true);await start;
  assert.equal(f.requests.length,0);assert.equal(f.lock.held,false);
  const other=controller();other.lock.acquire=async()=>false;
  await assert.rejects(other.runner.start(AUTO_LIKE_DEFAULTS),/另一个标签页/);assert.equal(other.requests.length,0);
});
test('连接、房间、上下文失效会清除等待中的批次，恢复后需人工重开',async()=>{
  const f=controller();await f.runner.start(AUTO_LIKE_DEFAULTS);f.setGuard('直播已结束');f.runner.check();
  assert.equal(f.timers.length,0);assert.equal(f.requests.length,1);assert.equal(f.runner.state.reason,'直播已结束');
  f.setGuard('');await f.runner.tick();assert.equal(f.requests.length,1);
});
test('单次请求未返回时禁止并发 tick，重复 start 也不并发',async()=>{
  const pending=deferred();let calls=0;const f=controller({commitLike:()=>{calls++;return pending.promise;}});
  const start=f.runner.start(AUTO_LIKE_DEFAULTS);await new Promise(setImmediate);
  await f.runner.tick();await f.runner.tick();await assert.rejects(f.runner.start(AUTO_LIKE_DEFAULTS));assert.equal(calls,1);
  pending.resolve({submitted:true,count:20});await start;f.runner.stop();
});
test('网页点赞 POST 空 body、精确64位房间ID、原生 count，同批重复桥消息不重复提交',async()=>{
  const f=pageFixture();try{
    const {token}=f.sender.prepareLike(),a=f.sender.commitLike(token,20,1),b=f.sender.commitLike(token,20,1);
    assert.equal(a,b);assert.deepEqual(await a,{submitted:true,count:20});assert.equal(f.requests.length,1);
    assert.deepEqual(f.requests[0],{url:'/webcast/room/like/',method:'post',data:{},params:{room_id:'7700231539170609947',count:20},timeout:8000});
    assert.equal((await f.sender.commitLike(token,20,1)).submitted,true);assert.equal(f.requests.length,1);
  }finally{f.dom.window.close();}
});
test('网页节流、非法数量、跳号和停止后的票据不产生第二个请求',async t=>{
  t.mock.method(Date,'now',()=>1800000000000);
  for(const [count,sequence] of [[0,1],[101,1],[1.5,1],[1,0],[1,2],[1,'1']]){
    const f=pageFixture();try{const {token}=f.sender.prepareLike();assert.equal((await f.sender.commitLike(token,count,sequence)).submitted,false);assert.equal(f.requests.length,0);}finally{f.dom.window.close();}
  }
  const f=pageFixture();try{
    const {token}=f.sender.prepareLike();await f.sender.commitLike(token,20,1);
    assert.equal((await f.sender.commitLike(token,20,2)).submitted,false);assert.equal(f.requests.length,1);
    assert.equal((await f.sender.commitLike(token,20,3)).submitted,false);
  }finally{f.dom.window.close();}
});
test('网页允许恰好 1 毫秒的下一批，同毫秒提交则停止，重新准备不重置节流',async t=>{
  let now=1800000000000;t.mock.method(Date,'now',()=>now);
  for(const elapsed of [0,1]){
    const f=pageFixture();try{
      const {token}=f.sender.prepareLike();await f.sender.commitLike(token,3,1);
      now+=elapsed;
      const result=await f.sender.commitLike(token,3,2);
      assert.equal(result.submitted,elapsed===1);assert.equal(f.requests.length,elapsed===1?2:1);
    }finally{f.dom.window.close();}
  }
  const f=pageFixture();try{
    const first=f.sender.prepareLike();await f.sender.commitLike(first.token,3,1);f.sender.stopLike(first.token);
    const second=f.sender.prepareLike();assert.equal(second.available,true);
    assert.equal((await f.sender.commitLike(second.token,3,1)).submitted,false);assert.equal(f.requests.length,1);
  }finally{f.dom.window.close();}
});
test('准备和提交均核对登录、开播、点赞权限、账号与当前房间',async()=>{
  const changes=[f=>f.page.__STORE__.userStore.userInfo.id_str='',f=>f.room.status=4,f=>f.room.room_auth.Digg=false,f=>f.room.room_auth.SpecialStyle={Like:{UnableStyle:1}},f=>f.room.web_rid='999',f=>Object.defineProperty(f.page.navigator,'onLine',{value:false}),f=>f.page.__STORE__.feedStore={isActive:false}];
  for(const change of changes){const f=pageFixture();try{const {token}=f.sender.prepareLike();change(f);assert.equal(f.sender.prepareLike().available,false);assert.equal((await f.sender.commitLike(token,1,1)).submitted,false);assert.equal(f.requests.length,0);}finally{f.dom.window.close();}}
  for(const change of [f=>f.page.__STORE__.userStore.userInfo.id_str='999',f=>f.page.__STORE__.roomStore.roomInfo.roomId='7700000000000000000']){const f=pageFixture();try{const {token}=f.sender.prepareLike();change(f);assert.equal((await f.sender.commitLike(token,1,1)).submitted,false);assert.equal(f.requests.length,0);}finally{f.dom.window.close();}}
});
test('网页会话取消、pagehide、过期、服务端拒绝或未知后均失效',async()=>{
  for(const cancel of [f=>f.sender.stopLike(f.sender.likes.session.token),f=>f.page.dispatchEvent(new f.page.Event('pagehide')),f=>{f.sender.likes.session.at-=3600001;}]){const f=pageFixture();try{const {token}=f.sender.prepareLike();cancel(f);assert.equal((await f.sender.commitLike(token,1,1)).submitted,false);assert.equal(f.requests.length,0);}finally{f.dom.window.close();}}
  for(const response of [{data:{status_code:403}},{data:{}},'throw']){const f=pageFixture();try{let calls=0;f.client.request=async()=>{calls++;if(response==='throw')throw Error();return response;};const {token}=f.sender.prepareLike();const result=await f.sender.commitLike(token,1,1);assert.equal(result.submitted,false);assert.equal(result.unknown,response?.data?.status_code===403?undefined:true);await f.sender.commitLike(token,1,1);assert.equal(calls,1);}finally{f.dom.window.close();}}
});
test('网页提交期间停止并重新准备也不能绕过并发限制',async()=>{
  const f=pageFixture();try{const pending=deferred();f.client.request=()=>pending.promise;const {token}=f.sender.prepareLike();const request=f.sender.commitLike(token,20,1);f.sender.stopLike(token);assert.equal(f.sender.prepareLike().available,false);pending.resolve({data:{status_code:0}});assert.equal((await request).count,20);}finally{f.dom.window.close();}
});
test('默认浏览器定时器保持正确 receiver 并能继续第二批',async()=>{
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,timers=[];
  // Web timer methods can require a global Window receiver. Never store one
  // directly on the controller and invoke it with the controller as `this`.
  globalThis.setTimeout=function(fn,ms){assert.equal(this,undefined);timers.push({fn,ms});return fn;};
  globalThis.clearTimeout=function(){assert.equal(this,undefined);};
  const f=controller();
  const runner=new AutoLike({transport:f.transport,lock:f.lock});
  try{await runner.start({batch:3,intervalSec:2,target:7});assert.equal(timers[0].ms,2000);await timers.shift().fn();await new Promise(setImmediate);assert.equal(runner.state.accepted,6);runner.stop();}
  finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});

test('停止接口同步抛错仍撤销后续批次、发布停止状态并释放运行锁',async()=>{
  const f=controller({stopLike:()=>{throw Error('extension invalidated');}});
  await f.runner.start(AUTO_LIKE_DEFAULTS);
  assert.doesNotThrow(()=>f.runner.stop());
  assert.equal(f.runner.state.phase,'stopped');assert.equal(f.lock.held,false);assert.equal(f.timers.length,0);
  await f.runner.tick();assert.equal(f.requests.length,1);
});
