import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine, mergeConfig} from '../../src/core/engine.js';
import {DeliveryTracker} from '../../src/runtime/delivery.js';
import {decodeMessage} from '../../src/browser/protocol.js';

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

test('管理员两种协议及文本布局的本人回显均确认发送，拒绝非协议和不匹配消息',async()=>{
  const bytes = (field, value) => {
    const data = Buffer.from(value);
    assert.ok(data.length < 128);
    return Buffer.concat([Buffer.from([field * 8 + 2, data.length]), data]);
  };
  for (const method of ['WebcastScreenChatMessage','WebcastPrivilegeScreenChatMessage']) {
    for (const field of [3,4]) {
      let sends=0;
      const s=setup(async(text,current,hooks)=>{await hooks.beforeClick();sends++;return {submitted:true,clicked:true,transport:'request',channelUsed:'admin'};});
      s.engine.enqueue('welcome','欢迎回来');await s.engine.tick();s.advance(1000);
      const event={...decodeMessage(method,Buffer.concat([bytes(2,[8,10]),bytes(field,'欢迎回来')]),'admin-echo'),receivedAt:s.engine.now()};
      assert.equal(s.engine.observeEcho({...event,source:'dom'}),false);
      assert.equal(s.engine.observeEcho({...event,user:{id:'other'}}),false);
      assert.equal(s.engine.observeEcho({...event,text:'另一条消息'}),false);
      assert.equal(s.engine.observeEcho({...event,at:s.engine.now()-60000}),false);
      assert.equal(s.engine.observeEcho(event),true,`${method} field ${field}`);
      assert.equal(s.engine.deliveries.records[0].state,'echoed');
      assert.equal(s.engine.deliveries.records[0].messageId,'admin-echo');
      assert.equal(s.engine.deliveries.records[0].latencyMs,1000);
      assert.equal(s.engine.observeEcho(event),false);
      s.advance(60000);await s.engine.tick();assert.equal(sends,1);
    }
  }
});

test('回显超时、暂停恢复和刷新均不重发，迟到回显仍可确认',async()=>{
  let sends=0;const s=setup(async(text,current,hooks)=>{await hooks.beforeClick();sends++;return {submitted:true};});
  s.engine.enqueue('gift','感谢');await s.engine.tick();s.advance(8001);await s.engine.tick();
  assert.equal(s.engine.deliveries.records[0].state,'unknown');assert.equal(s.engine.queue.length,0);
  s.advance(30000);await s.engine.tick();
  s.engine.stop('暂停',{preserveWork:true});s.engine.start();await s.engine.tick();
  const restored = new Engine({config:s.engine.config,now:s.engine.now,send:async()=>{sends++;return {submitted:true};}});
  restored.restore(s.engine.snapshot());restored.start();await restored.tick();assert.equal(restored.queue.length,0);
  assert.equal(restored.observeEcho(s.echo('感谢')),true);assert.equal(restored.queue.length,0);
  assert.equal(sends,1);
});

test('平台明确拒绝可重试，点击后异常不重试',async()=>{
  const s=setup(async(text,current,hooks)=>{await hooks.beforeClick();return {clicked:true,failed:true,reason:'你已被禁言'};});
  s.engine.enqueue('gift','感谢');await s.engine.tick();
  const record=s.engine.deliveries.records[0];assert.equal(record.state,'retrying');assert.equal(s.engine.running,true);assert.equal(s.engine.queue.length,1);
  const restored=new Engine({config:s.engine.config,now:s.engine.now});restored.restore(s.engine.snapshot());assert.equal(restored.queue.length,1);
  const u=setup(async(text,current,hooks)=>{await hooks.beforeClick();throw Object.assign(new Error('点击后网络异常'),{clicked:true});});
  u.engine.enqueue('gift','感谢');await u.engine.tick();assert.equal(u.engine.queue.length,0);
  assert.equal(u.engine.deliveries.records[0].state,'unknown');
});

test('点击后的持久化失败不重发；旧版在途快照不会重新点击',async()=>{
  const s=setup(async(text,current,hooks)=>{await hooks.beforeClick();return {submitted:true};});let writes=0;
  s.engine.checkpoint=async()=>{if(++writes===3)throw new Error('QUOTA_BYTES');};
  s.engine.enqueue('gift','感谢');await s.engine.tick();assert.equal(s.engine.queue.length,0);assert.equal(s.engine.deliveries.records[0].state,'clicked');
  const old={version:1,savedAt:s.engine.now(),running:true,queue:[],inFlight:{text:'旧版感谢',jobs:[{id:1,text:'旧版感谢',kind:'gift',created:s.engine.now()}]}};
  const restored=new Engine({config:s.engine.config,now:s.engine.now});restored.restore(old);assert.equal(restored.queue.length,0);assert.equal(restored.deliveries.records[0].state,'unknown');
});

test('升级恢复时撤销旧版因结果未知自动创建的重发队列',()=>{
  const s=setup();s.engine.enqueue('gift','感谢');
  const snapshot=s.engine.snapshot();
  snapshot.deliveries=[{id:'old',text:'感谢',jobs:[],state:'retrying',clickedAt:s.engine.now(),retryJobIds:[snapshot.queue[0].id]}];
  const restored=new Engine({config:s.engine.config,now:s.engine.now});restored.restore(snapshot);restored.start();
  assert.equal(restored.queue.length,0);assert.equal(restored.deliveries.records[0].state,'unknown');
});

test('旧版尚未可靠写入点击意图的 prepared 快照也不重发',()=>{
  const s=setup();s.engine.enqueue('gift','感谢');
  const snapshot=s.engine.snapshot();
  snapshot.deliveries=[{id:'old',text:'感谢',jobs:snapshot.queue,state:'prepared'}];
  snapshot.queue=[];snapshot.inFlight={deliveryId:'old',text:'感谢',jobs:snapshot.deliveries[0].jobs};
  const restored=new Engine({config:s.engine.config,now:s.engine.now});restored.restore(snapshot);restored.start();
  assert.equal(restored.queue.length,0);assert.equal(restored.deliveries.records[0].state,'unknown');
});

test('连续缺失回显时未知记录有界，不积压待重发任务',async()=>{
  const s=setup(async(text,current,hooks)=>{await hooks.beforeClick();return {submitted:true};});
  for(let i=0;i<100;i++) {s.engine.enqueue('gift','感谢');await s.engine.tick();s.advance(8001);await s.engine.tick();}
  assert.equal(s.engine.queue.length,0);assert.equal(s.engine.deliveries.pending().length,0);
  assert.ok(s.engine.deliveries.records.length<=51);
});

test('点击意图保存失败或挂起时不点击，恢复存储后仅发送一次',async()=>{
  let clicks=0;
  const s=setup(async(text,current,hooks)=>{await hooks.beforeClick();clicks++;return {submitted:true};});
  for (const checkpoint of [async()=>{throw new Error('存储失败');},()=>new Promise(()=>{})]) {
    s.engine.checkpoint=checkpoint;s.engine.enqueue('gift','感谢');await s.engine.tick();
    assert.equal(clicks,0);assert.equal(s.engine.queue.length,1);
    s.engine.checkpoint=async()=>{};s.advance(5000);await s.engine.tick();
    assert.equal(s.engine.queue.length,0);
    assert.equal(clicks,1);clicks=0;
  }
});

test('点击意图持久化完成前不能触发真实点击，刷新不重复发送',async()=>{
  let release, clickedSnapshot, clicks=0, writes=0;
  const s=setup(async(text,current,hooks)=>{await hooks.beforeClick();clicks++;return {submitted:true};});
  s.engine.checkpoint=async()=>{
    if (++writes===2) {clickedSnapshot=s.engine.snapshot();await new Promise(resolve=>{release=resolve;});}
  };
  s.engine.enqueue('gift','感谢');const sending=s.engine.tick();await new Promise(setImmediate);
  assert.equal(clicks,0);assert.equal(clickedSnapshot.deliveries[0].state,'clicked');
  release();await sending;assert.equal(clicks,1);
  const restored=new Engine({config:s.engine.config,now:s.engine.now,send:async()=>{clicks++;}});
  restored.restore(clickedSnapshot);restored.start();s.advance(30000);await restored.tick();
  assert.equal(clicks,1);assert.equal(restored.queue.length,0);
});

test('点击后结果未知不重试，也不阻塞后续消息',async()=>{
  const sent=[];const s=setup(async(text,current,hooks)=>{await hooks.beforeClick();sent.push(text);return {clicked:true,submitted:false};});
  s.engine.enqueue('gift','感谢');await s.engine.tick();
  s.engine.enqueue('gift','欢迎');await s.engine.tick();
  s.advance(60000);await s.engine.tick();
  assert.deepEqual(sent,['感谢','欢迎']);assert.equal(s.engine.queue.length,0);assert.equal(s.engine.running,true);
});

test('上一条未回显且追踪记录积压时，后续相同文本仍会直接发送',async()=>{
  let sends=0;const s=setup(async(text,current,hooks)=>{await hooks.beforeClick();sends++;return {submitted:true};});
  s.engine.enqueue('gift','感谢');s.engine.enqueue('gift','感谢');s.engine.enqueue('gift','欢迎');s.engine.enqueue('gift','第三条');
  await s.engine.tick();await s.engine.tick();await s.engine.tick();await s.engine.tick();
  assert.equal(sends,4);assert.equal(s.engine.queue.length,0);
  assert.equal(s.engine.deliveries.pending().length,4,'回显追踪记录不再作为发送许可');
});

test('无法识别本人 UID 时不通过昵称猜测；相同文本回显仍可确认',()=>{
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
