import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine, mergeConfig} from '../../src/core/engine.js';
import {DeliveryTracker} from '../../src/runtime/delivery.js';

function setup(send) {
  let now = 1800000000000;
  const engine = new Engine({config:mergeConfig({selfId:'10'}),now:()=>now,send});
  engine.start(); return {engine,advance:ms=>now+=ms,echo:(text,extra={})=>({type:'chat',source:'socket',id:'echo-id',user:{id:'10'},text,at:now,receivedAt:now,...extra})};
}

test('点击意图先落盘；输入框清空后仍待回显，仅匹配本人、文本和时间',async()=>{
  let saved, clicks = 0; const s = setup(async(text,current,hooks)=>{
    await hooks.beforeClick(); assert.equal(saved.deliveries[0].state,'clicked'); clicks++;
    return {submitted:true,clicked:true};
  });
  s.engine.checkpoint = async()=>{saved=s.engine.snapshot();};
  s.engine.enqueue('gift','感谢支持'); await s.engine.tick();
  assert.equal(clicks,1); assert.equal(s.engine.deliveries.records[0].state,'clicked');
  assert.equal(s.engine.observeEcho(s.echo('感谢支持',{user:{id:'other'}})),false);
  assert.equal(s.engine.observeEcho(s.echo('感谢支持',{source:'dom'})),false);
  assert.equal(s.engine.observeEcho(s.echo('另一条消息')),false);
  assert.equal(s.engine.observeEcho(s.echo('感谢支持',{at:1800000000000-60000})),false);
  s.advance(350); assert.equal(s.engine.observeEcho(s.echo('感谢支持')),true);
  assert.equal(s.engine.deliveries.records[0].latencyMs,350);
  assert.equal(s.engine.deliveries.records[0].messageId,'echo-id');
  assert.equal(s.engine.stats.echoed,1); assert.equal(s.engine.observeEcho(s.echo('感谢支持')),false);
});

test('回显可早于发送函数返回，已回显结果不会被点击返回覆盖',async()=>{
  const s=setup(async(text,current,hooks)=>{await hooks.beforeClick();s.engine.observeEcho(s.echo(text));return {submitted:true};});
  s.engine.enqueue('gift','感谢');await s.engine.tick();
  assert.equal(s.engine.deliveries.records[0].state,'echoed');
  const snapshot=s.engine.snapshot();snapshot.inFlight={deliveryId:snapshot.deliveries[0].id,text:'感谢',jobs:[{id:1,text:'感谢',kind:'gift',created:s.engine.now()}]};
  const restored=new Engine({config:s.engine.config,now:s.engine.now});restored.restore(snapshot);
  assert.equal(restored.queue.length,0);assert.equal(restored.deliveries.pending().length,0,'已确认回显的在途快照不能重新隔离或重发');
});

test('回显超时自动重发；刷新恢复任务，旧发送的迟到回显可撤销重试',async()=>{
  let sends=0;const s=setup(async(text,current,hooks)=>{await hooks.beforeClick();sends++;return {submitted:true};});
  s.engine.enqueue('gift','感谢');await s.engine.tick();s.advance(8001);await s.engine.tick();
  assert.equal(s.engine.deliveries.records[0].state,'retrying');assert.equal(s.engine.queue.length,1);
  const restored = new Engine({config:s.engine.config,now:s.engine.now,send:async()=>{sends++;return {submitted:true};}});
  restored.restore(s.engine.snapshot());restored.start();assert.equal(restored.queue.length,1);
  assert.equal(restored.observeEcho(s.echo('感谢')),true);assert.equal(restored.queue.length,0);
  assert.equal(restored.queue.length,0);
});

test('平台拒绝与点击后异常均自动重试并持久化',async()=>{
  const s=setup(async(text,current,hooks)=>{await hooks.beforeClick();return {clicked:true,failed:true,reason:'你已被禁言'};});
  s.engine.enqueue('gift','感谢');await s.engine.tick();
  const record=s.engine.deliveries.records[0];assert.equal(record.state,'retrying');assert.equal(s.engine.running,true);assert.equal(s.engine.queue.length,1);
  const restored=new Engine({config:s.engine.config,now:s.engine.now});restored.restore(s.engine.snapshot());assert.equal(restored.queue.length,1);
  const u=setup(async(text,current,hooks)=>{await hooks.beforeClick();throw Object.assign(new Error('点击后网络异常'),{clicked:true});});
  u.engine.enqueue('gift','感谢');await u.engine.tick();assert.equal(u.engine.queue.length,1);
  assert.equal(u.engine.deliveries.records[0].state,'retrying');
});

test('点击后的持久化失败不阻塞发送；旧版在途快照会自动重发',async()=>{
  const s=setup(async(text,current,hooks)=>{await hooks.beforeClick();return {submitted:true};});let writes=0;
  s.engine.checkpoint=async()=>{if(++writes===3)throw new Error('QUOTA_BYTES');};
  s.engine.enqueue('gift','感谢');await s.engine.tick();assert.equal(s.engine.queue.length,0);assert.equal(s.engine.deliveries.records[0].state,'clicked');
  const old={version:1,savedAt:s.engine.now(),running:true,queue:[],inFlight:{text:'旧版感谢',jobs:[{id:1,text:'旧版感谢',kind:'gift',created:s.engine.now()}]}};
  const restored=new Engine({config:s.engine.config,now:s.engine.now});restored.restore(old);assert.equal(restored.queue.length,1);assert.equal(restored.queue[0].text,'旧版感谢');
});

test('上一条未回显且追踪记录积压时，后续相同文本仍会直接发送',async()=>{
  let sends=0;const s=setup(async(text,current,hooks)=>{await hooks.beforeClick();sends++;return {submitted:true};});
  s.engine.enqueue('gift','感谢');s.engine.enqueue('gift','感谢');s.engine.enqueue('gift','欢迎');s.engine.enqueue('gift','第三条');
  await s.engine.tick();await s.engine.tick();await s.engine.tick();await s.engine.tick();
  assert.equal(sends,4);assert.equal(s.engine.queue.length,0);
  assert.equal(s.engine.deliveries.pending().length,4,'回显追踪记录不再作为发送许可');
});

test('无法识别本人 UID 时不通过昵称猜测；重复发送时回显可结束自动重试',()=>{
  const t=new DeliveryTracker({now:()=>10000});const a=t.create('感谢',[],{});t.clicked(a);
  assert.equal(t.observe({type:'chat',source:'socket',user:{name:'场控'},text:'感谢',receivedAt:10000}),null);
  a.account.id='10';const b=t.create('感谢',[],{id:'10'});t.clicked(b);
  assert.equal(t.observe({type:'chat',source:'socket',user:{id:'10'},text:'感谢',receivedAt:10000})?.state,'echoed');
});

test('礼物积压触发背压前不消费事件去重标记，释放容量后可恢复',()=>{
  const s=setup();s.engine.backlogLimit=1;
  const gift=id=>({type:'gift',id,groupId:id,giftId:'g',giftName:'礼物',count:1,unitValue:100,final:true,user:{id,name:id}});
  s.engine.ingest(gift('one'));assert.throws(()=>s.engine.ingest(gift('two')),error=>error.code==='BACKPRESSURE');
  assert.equal(s.engine.gifts.size,1);s.engine.gifts.clear();s.engine.ingest(gift('two'));assert.equal(s.engine.gifts.size,1);
});
