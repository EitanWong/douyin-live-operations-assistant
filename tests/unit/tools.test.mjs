import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ToolRegistry} from '../../src/tools/registry.js';
import {ToolRuntime} from '../../src/tools/runtime.js';
import {ToolScope} from '../../src/tools/scope.js';
import {ToolGateway,toolOperations} from '../../src/tools/gateway.js';
import {autoLikeTool} from '../../src/tools/auto-like/index.js';

const flush = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise=new Promise(done=>{resolve=done;}); return {promise,resolve}; };
const definition = (id,mount,capabilities=[]) => ({id,mount,capabilities,label:id,icon:'heart',version:'1.0.0',apiVersion:1,view:{template:()=>'',update(){}}});
function locks() {
  const instances=[];
  const createLock=key=>{const lock={key,held:false,acquire:async()=>{lock.held=true;return true;},release:()=>{lock.held=false;}};instances.push(lock);return lock;};
  return {instances,createLock};
}
function runtime(definitions,options={}) {
  const lock=locks(),errors=[];
  const host=new ToolRuntime({registry:new ToolRegistry(definitions),room:'123',createLock:lock.createLock,onError:(id,error)=>errors.push([id,error]),...options});
  return {host,errors,...lock};
}

test('工具注册拒绝重复 ID、无效版本和不兼容 API，声明能力不可被后续数组修改',()=>{
  const item=definition('sample',()=>({actions:{}})), registry=new ToolRegistry([item]);
  item.capabilities.push('unexpected');assert.deepEqual(registry.get('sample').capabilities,[]);
  assert.throws(()=>registry.register(item),/重复/);
  assert.throws(()=>new ToolRegistry([{...item,apiVersion:2}]),/版本/);
  assert.throws(()=>new ToolRegistry([{...item,id:'bad"id'}]),/定义/);
  assert.throws(()=>new ToolRegistry([{...item,version:'latest'}]),/定义/);
});

test('100 次启停后计时器、DOM 监听、登记资源全部释放，旧上下文不能继续调用操作',async()=>{
  const target=new EventTarget(),timers=new Map();let serial=0,hits=0,resources=0,context;
  const f=runtime([definition('sample',ctx=>{
    context=ctx;resources++;ctx.scope.defer(()=>{resources--;});
    ctx.scope.listen(target,'probe',()=>{hits++;});
    ctx.scope.timeout(()=>assert.fail('卸载后不应触发'),1000);
    return {actions:{}};
  },['act'])],{scopeOptions:{schedule:fn=>{timers.set(++serial,fn);return serial;},cancel:id=>timers.delete(id)},operations:{act:{lock:false,run:()=>assert.fail('旧上下文不能提交')}}});
  for(let i=0;i<100;i++) {
    await f.host.enable('sample');target.dispatchEvent(new Event('probe'));assert.equal(hits,i+1);
    assert.deepEqual(f.host.diagnostics(),{backend:'cordis',plugins:1,scopes:1});
    await f.host.disable('sample');target.dispatchEvent(new Event('probe'));
    assert.deepEqual(f.host.diagnostics(),{backend:'cordis',plugins:0,scopes:0});
    assert.equal(hits,i+1);assert.equal(timers.size,0);assert.equal(resources,0);
    await assert.rejects(context.operations.call('act'),/停用/);
  }
  await f.host.close();assert.equal(f.errors.length,0);
});

test('Cordis 服务注入保持工具上下文契约，工具不获得原始 Context 或 Fiber',async()=>{
  const page={},log=()=>{};let context;
  const f=runtime([definition('sample',ctx=>{context=ctx;return {actions:{}};})],{services:{page,log}});
  await f.host.start();
  assert.equal(context.services.page,page);assert.equal(context.services.log,log);
  assert.ok(Object.isFrozen(context.services));assert.ok(Object.isFrozen(context));
  for(const key of ['fiber','plugin','provide','root'])assert.equal(context[key],undefined);
  await f.host.close();assert.deepEqual(f.host.diagnostics(),{backend:'cordis',plugins:0,scopes:0});
  assert.equal(f.host.backend.root.fiber.getEffects().length,0,'根服务与工具 effects 一起回收');
});

test('Cordis 挂载同步失败后清理部分资源与 Fiber，健康工具继续运行',async()=>{
  let resources=0,ticks=0;
  const f=runtime([
    definition('broken',ctx=>{resources++;ctx.scope.defer(()=>{resources--;});throw Error('mount failure');}),
    definition('healthy',()=>({tick:()=>{ticks++;}}))
  ]);
  const results=await f.host.start();assert.equal(results[0].status,'rejected');assert.match(results[0].reason.message,/mount failure/);
  await flush();assert.equal(resources,0);assert.equal(f.host.status()[0].phase,'failed');
  assert.deepEqual(f.host.diagnostics(),{backend:'cordis',plugins:1,scopes:1});
  f.host.notify('tick');assert.equal(ticks,1);await f.host.close();
  assert.deepEqual(f.host.diagnostics(),{backend:'cordis',plugins:0,scopes:0});
});

test('关闭 Cordis 宿主期间迟到挂载仍销毁，关闭后不会重新提供服务或挂载工具',async()=>{
  const late=deferred();let context,disposed=0,mounts=0;
  const f=runtime([definition('sample',ctx=>{context=ctx;mounts++;return late.promise;})],{timeout:20});
  const starting=f.host.enable('sample');await flush();const closing=f.host.close();
  assert.equal(context.signal.aborted,true);
  late.resolve({dispose:()=>{disposed++;}});await starting;await closing;
  assert.equal(disposed,1);assert.deepEqual(f.host.diagnostics(),{backend:'cordis',plugins:0,scopes:0});
  await f.host.enable('sample');assert.equal(mounts,1);assert.equal(f.host.backend.root.fiber.getEffects().length,0);
});

test('重复启用不使当前实例失效，开始后立即停用不会迟到挂载',async()=>{
  let mounts=0,ctx;
  const f=runtime([definition('sample',context=>{ctx=context;mounts++;return {actions:{publish:()=>ctx.publish({phase:'test'})}};})]);
  await f.host.enable('sample');await f.host.enable('sample');
  await f.host.invoke('sample','publish');assert.equal(f.host.state('sample').phase,'test');assert.equal(mounts,1);
  await f.host.disable('sample');
  const enable=f.host.enable('sample'),disable=f.host.disable('sample');await Promise.all([enable,disable]);
  assert.equal(mounts,1);assert.equal(f.host.status()[0].phase,'disabled');await f.host.close();
});

test('单个工具同步抛错或异步挂起时其他工具继续，超时旧回调被撤权',async()=>{
  const late=deferred();let healthy=0,oldContext,calls=0;
  const f=runtime([
    definition('throws',()=>({tick:()=>{throw Error('injected failure');}})),
    definition('hangs',ctx=>{oldContext=ctx;return {tick:()=>late.promise};},['act']),
    definition('healthy',()=>({tick:()=>{healthy++;}}))
  ],{timeout:20,operations:{act:{lock:false,run:()=>{calls++;}}}});
  await f.host.start();f.host.notify('tick');assert.equal(healthy,1);
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(f.host.status().find(x=>x.id==='throws').phase,'failed');
  assert.equal(f.host.status().find(x=>x.id==='hangs').phase,'failed');
  await assert.rejects(oldContext.operations.call('act'),/停用/);late.resolve();
  f.host.notify('tick');assert.equal(healthy,2);assert.equal(calls,0);await f.host.close();
});

test('挂载失败回收部分资源，迟到完成的挂载也回收后才允许替代实例',async()=>{
  let resources=0,disposed=0,mounts=0;const late=deferred();
  const f=runtime([definition('sample',ctx=>{mounts++;ctx.scope.defer(()=>{resources--;});resources++;return late.promise;})],{timeout:20});
  await assert.rejects(f.host.enable('sample'),/超时/);
  assert.equal(resources,0);
  await assert.rejects(f.host.enable('sample'),/超时/);assert.equal(mounts,1);
  late.resolve({dispose:()=>{disposed++;}});await flush();
  await f.host.enable('sample');assert.equal(mounts,2);await f.host.close();assert.equal(disposed,2);assert.equal(resources,0);
});

test('资源清理异常仍清理其他资源，并阻止不安全的替代实例',async()=>{
  let cleaned=0,mounts=0;
  const f=runtime([definition('sample',ctx=>{mounts++;ctx.scope.defer(()=>{cleaned++;});ctx.scope.defer(()=>{throw Error('cleanup failure');});return {actions:{}};})]);
  await f.host.enable('sample');await assert.rejects(f.host.disable('sample'),/回收失败/);
  assert.equal(cleaned,1);await assert.rejects(f.host.enable('sample'),/回收失败/);assert.equal(mounts,1);
  await f.host.close();
});

test('操作网关检查能力、房间、锁；停用期间迟到的锁授权立即归还',async()=>{
  const scope=new ToolScope(),pending=deferred(),lock={held:false,acquire:()=>pending.promise,release(){this.held=false;}};
  let guard='',calls=0;
  const gateway=new ToolGateway({definition:definition('sample',()=>{},['act']),scope,room:'123',guard:()=>guard,createLock:()=>lock,operations:{act:{run:()=>{calls++;}}}});
  await assert.rejects(gateway.call('other'),/未声明/);await assert.rejects(gateway.call('act'),/运行锁/);
  lock.held=true;guard='直播间已切换';await assert.rejects(gateway.call('act'),/切换/);guard='';lock.held=false;
  const acquiring=gateway.lock.acquire();await scope.close();lock.held=true;pending.resolve(true);
  assert.equal(await acquiring,false);assert.equal(lock.held,false);assert.equal(calls,0);
  await assert.rejects(gateway.call('act'),/停用/);await gateway.close();
});

test('点赞额度、序号、账号与 token 受网关校验，已提交的未知批次不能重复消耗额度',async()=>{
  const scope=new ToolScope(),lock={held:true,acquire:async()=>true,release(){}},commits=[];let account='self';
  const gateway=new ToolGateway({definition:autoLikeTool,scope,room:'123',guard:()=>'',createLock:()=>lock,
    operations:toolOperations({selfId:()=>account,transport:{prepareLike:async()=>({token:'t',available:true}),commitLike:async(...args)=>{commits.push(args);return {submitted:false};},stopLike:async()=>{}}})});
  await gateway.call('like.prepare',30);
  await assert.rejects(gateway.call('like.commit',{token:'wrong',count:20,sequence:1}),/会话/);
  await gateway.call('like.commit',{token:'t',count:20,sequence:1});
  await assert.rejects(gateway.call('like.commit',{token:'t',count:20,sequence:2}),/额度/);
  await assert.rejects(gateway.call('like.commit',{token:'t',count:10,sequence:1}),/批次/);
  account='other';await assert.rejects(gateway.call('like.commit',{token:'t',count:10,sequence:2}),/账号/);
  assert.equal(commits.length,1);await scope.close();await gateway.call('like.stop','t');await gateway.close();
});

test('自动点赞停用等待已提交批次结算，新实例不重复提交；旧回调不会更新新实例',async()=>{
  const commit=deferred();let commits=0,stops=0;
  const f=runtime([autoLikeTool],{operations:toolOperations({transport:{prepareLike:async()=>({available:true,token:'t'}),commitLike:()=>{commits++;return commit.promise;},stopLike:async()=>{stops++;}}})});
  await f.host.start();const start=f.host.invoke('auto-like','start',{batch:20,intervalSec:2,target:100});await flush();
  assert.equal(commits,1);const restart=f.host.restart('auto-like');await flush();
  await assert.rejects(f.host.invoke('auto-like','start',{batch:20,intervalSec:2,target:100}),/就绪|停用/);
  assert.equal(f.instances.length,1);commit.resolve({submitted:true,count:20});await start;await restart;
  assert.equal(f.instances.length,2);assert.equal(commits,1);assert.equal(stops,1);assert.equal(f.host.state('auto-like').accepted,0);
  await f.host.close();
});

test('准备点赞期间停用，迟到 token 会注销，永远不提交批次',async()=>{
  const prepared=deferred();let stopped=0;
  const f=runtime([autoLikeTool],{operations:toolOperations({transport:{prepareLike:()=>prepared.promise,commitLike:()=>assert.fail('不能提交'),stopLike:async()=>{stopped++;}}})});
  await f.host.start();const start=f.host.invoke('auto-like','start',{batch:20,intervalSec:2,target:100});await flush();
  const disable=f.host.disable('auto-like');prepared.resolve({available:true,token:'late'});await start;await disable;
  assert.equal(stopped,1);assert.equal(f.instances[0].held,false);await f.host.close();
});

test('计时器触发的后续点赞批次挂起也会超时停用，实际请求结算前不能替换',async()=>{
  const pending=deferred(),timers=[];let commits=0;
  const f=runtime([autoLikeTool],{timeout:25,scopeOptions:{schedule:fn=>{timers.push(fn);return fn;},cancel(){}},
    operations:toolOperations({transport:{prepareLike:async()=>({available:true,token:'t'}),commitLike:async()=>{commits++;return commits===1?{submitted:true,count:20}:pending.promise;},stopLike:async()=>{}}})});
  await f.host.start();await f.host.invoke('auto-like','start',{batch:20,intervalSec:2,target:100});
  timers.shift()();await new Promise(resolve=>setTimeout(resolve,45));
  assert.equal(commits,2);assert.equal(f.host.status()[0].phase,'failed');
  await assert.rejects(f.host.restart('auto-like'),/超时/);assert.equal(f.instances.length,1);
  pending.resolve({submitted:true,count:20});await flush();await f.host.restart('auto-like');
  assert.equal(f.instances.length,2);assert.equal(commits,2);await f.host.close();
});


test('Scope 关闭等待已运行的计时器和事件异步回调，替代实例不能抢先启动',async()=>{
  for(const kind of ['timer','listener','notify','invoke']) {
    const pending=deferred(),target=new EventTarget(),timers=[];let mounts=0;
    const f=runtime([definition('sample',ctx=>{
      mounts++;
      if(kind==='timer')ctx.scope.timeout(()=>pending.promise,1);
      if(kind==='listener')ctx.scope.listen(target,'work',()=>pending.promise);
      return {tick:()=>pending.promise,actions:{work:()=>pending.promise}};
    })],{scopeOptions:{schedule:fn=>{timers.push(fn);return fn;},cancel(){}},timeout:1000});
    await f.host.enable('sample');
    let invoking;
    if(kind==='timer')timers.shift()();
    if(kind==='listener')target.dispatchEvent(new Event('work'));
    if(kind==='notify')f.host.notify('tick');
    if(kind==='invoke')invoking=f.host.invoke('sample','work');
    const restarting=f.host.restart('sample');await flush();
    assert.equal(mounts,1,kind+' 必须等真实回调结束');
    pending.resolve();await invoking;await restarting;assert.equal(mounts,2);
    await f.host.close();
  }
});

test('停用将 AbortSignal 传到底层 transport，合作取消结算后可以安全重建',async()=>{
  let signal,commits=0;
  const f=runtime([autoLikeTool],{operations:toolOperations({transport:{prepareLike:async()=>({available:true,token:'t'}),
    commitLike:(token,count,sequence,options)=>{commits++;signal=options?.signal;return new Promise(resolve=>signal?.addEventListener('abort',()=>resolve({submitted:false,unknown:true}),{once:true}));},stopLike:async()=>{}}})});
  try {
    await f.host.start();const start=f.host.invoke('auto-like','start',{batch:20,intervalSec:2,target:100});await flush();
    assert.ok(signal instanceof AbortSignal,'取消信号必须到达 transport');
    await f.host.disable('auto-like');await start;assert.equal(signal.aborted,true);
    await f.host.enable('auto-like');assert.equal(f.instances.length,2);assert.equal(commits,1);
  } finally {if(signal)await f.host.close();}
});


test('重启等待旧实例排空期间再次停用，不会迟到挂载或执行新副作用',async()=>{
  const pending=deferred();let mounts=0;
  const f=runtime([definition('sample',ctx=>{mounts++;if(mounts===1)ctx.scope.defer(()=>pending.promise);return {actions:{}};})]);
  try {
    await f.host.enable('sample');
    f.host.fail(f.host.entries.get('sample'),Error('trigger cleanup'));
    const enabling=f.host.enable('sample');await flush();
    const disabling=f.host.disable('sample');pending.resolve();
    await Promise.allSettled([enabling,disabling]);
    assert.equal(mounts,1);assert.equal(f.host.status()[0].phase,'disabled');
  }finally{pending.resolve();await f.host.close();}
});

test('操作同步触发卸载时，真实操作先登记，运行锁等待操作结算',async()=>{
  const pending=deferred(),scope=new ToolScope();let closing;
  const lock={held:true,release(){this.held=false;}};
  const gateway=new ToolGateway({definition:definition('sample',()=>{},['act']),scope,room:'123',guard:()=>'',createLock:()=>lock,
    operations:{act:{run:()=>{closing=scope.close();return pending.promise;}}}});
  scope.defer(()=>gateway.close());
  const call=gateway.call('act');
  try {await flush();assert.equal(lock.held,true,'同步撤权不能漏记已经进入的操作');}
  finally{pending.resolve('done');await call;await closing;}
  assert.equal(lock.held,false);
});

test('Scope 的一个计时器撤销抛错仍回收其余计时器和监听资源',async()=>{
  const canceled=[],scope=new ToolScope({schedule:fn=>fn,cancel:id=>{canceled.push(id);if(canceled.length===1)throw Error('cancel failed');}});
  let cleaned=0;scope.timeout(()=>{},1);scope.timeout(()=>{},1);scope.defer(()=>{cleaned++;});
  await assert.rejects(Promise.resolve().then(()=>scope.close()),/回收失败/);
  assert.equal(canceled.length,2);assert.equal(cleaned,1);assert.equal(scope.active,false);
});

test('工具命令拒绝非 Error 值时保留原始拒绝且健康实例继续服务',async()=>{
  const f=runtime([definition('sample',()=>({actions:{reject:()=>Promise.reject(null),healthy:()=>42}}))]);
  try {
    await f.host.start();await assert.rejects(f.host.invoke('sample','reject'),error=>error===null);
    assert.equal(await f.host.invoke('sample','healthy'),42);assert.equal(f.host.status()[0].phase,'active');
  }finally{await f.host.close();}
});
