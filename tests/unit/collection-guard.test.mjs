import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {CollectionGuard} from '../../src/browser/collection-guard.js';
import {installCollectionKeeper} from '../../extension/collection-keeper.js';

function fixture() {
  const dom = new JSDOM('<body><textarea></textarea><button>继续播放</button></body>',{url:'https://live.douyin.com/123'});
  const page = dom.window; let now = 1000;
  page.__STORE__ = {roomStore:{roomInfo:{roomId:'999',room:{web_rid:'123',status:2}}}};
  Object.defineProperty(page.document,'visibilityState',{value:'hidden',configurable:true});
  const guard = new CollectionGuard({page,now:()=>now});
  return {dom,page,guard,advance:ms=>{now+=ms;},now:()=>now};
}

test('后台长期无操作仍重置原站挂机计时，不触发输入、聚焦和弹幕操作',()=>{
  const f=fixture(); let idleDeadline=f.now()+60000, pauses=0, input=0, clicks=0;
  f.page.document.addEventListener('mousemove',()=>{idleDeadline=f.now()+60000;});
  f.page.document.querySelector('textarea').addEventListener('input',()=>input++);
  f.page.document.querySelector('button').addEventListener('click',()=>clicks++);
  try {
    f.guard.start();
    for(let i=0;i<720;i++) {
      f.advance(20000); if(f.now()>=idleDeadline)pauses++;
      f.guard.tick();
    }
    assert.equal(pauses,0); assert.equal(f.guard.status.pulses,721);
    assert.equal(f.guard.status.active,true); assert.equal(f.guard.status.maxDelayMs,20000);
    assert.equal(input,0);assert.equal(clicks,0);assert.equal(f.page.document.activeElement,f.page.document.body);
  } finally {f.guard.stop();f.dom.window.close();}
});

test('定时器延迟后仅通过明确挂机弹窗恢复原站播放器和 IM，普通播放/验证按钮不点击',()=>{
  const f=fixture();let resumes=0;
  try {
    f.guard.start();
    f.page.document.body.insertAdjacentHTML('beforeend','<section><div><div>长时间无操作，已暂停播放</div></div><div><div id="resume">继续播放</div></div></section>');
    f.page.document.querySelector('#resume').addEventListener('click',()=>{resumes++;});
    f.advance(120000);f.guard.tick();
    assert.equal(resumes,1);assert.equal(f.guard.status.recoveries,1);assert.equal(f.guard.status.maxDelayMs,120000);
    f.advance(20000);f.guard.tick();assert.equal(resumes,1,'恢复重试至少间隔 30 秒');
    f.page.document.querySelector('#resume').parentElement.parentElement.remove();
    f.page.document.body.insertAdjacentHTML('beforeend','<div>请完成验证<button>继续播放</button></div>');
    f.advance(40000);f.guard.tick();assert.equal(resumes,1);
  } finally {f.guard.stop();f.dom.window.close();}
});

test('切房、下播、离线和 BFCache 挂起停止保活；恢复后重新启动且不会创建重复计时器',()=>{
  const f=fixture();
  try {
    f.guard.start();const first=f.guard.timer;f.guard.start();assert.equal(f.guard.timer,first);
    f.page.dispatchEvent(new f.page.PageTransitionEvent('pagehide',{persisted:true}));
    f.advance(60000);f.guard.tick();assert.equal(f.guard.status.pulses,1);assert.equal(f.guard.status.active,false);
    f.page.dispatchEvent(new f.page.PageTransitionEvent('pageshow',{persisted:true}));
    assert.equal(f.guard.status.pulses,2);assert.equal(f.guard.status.active,true);
    f.page.__STORE__.roomStore.roomInfo.room.status=4;f.advance(20000);f.guard.tick();
    assert.equal(f.guard.status.state,'ended');assert.equal(f.guard.status.active,false);
    f.page.__STORE__.roomStore.roomInfo.room.status=2;
    Object.defineProperty(f.page.navigator,'onLine',{value:false,configurable:true});f.guard.tick();assert.equal(f.guard.status.state,'offline');
    Object.defineProperty(f.page.navigator,'onLine',{value:true,configurable:true});
    f.page.history.pushState({},'', '/456');f.guard.tick();assert.equal(f.guard.status.state,'left');
    assert.equal(f.guard.status.pulses,2);
    f.page.dispatchEvent(new f.page.PageTransitionEvent('pagehide',{persisted:false}));assert.equal(f.guard.closed,true);
  } finally {f.guard.stop();f.dom.window.close();}
});

test('缺少当前直播间身份时不发保活事件，不能把其他房间或未开播页当作直播',()=>{
  const f=fixture();let events=0;f.page.document.addEventListener('mousemove',()=>events++);
  try {
    f.page.__STORE__.roomStore.roomInfo.room.web_rid='456';f.guard.tick();assert.equal(events,0);
    f.page.__STORE__.roomStore.roomInfo.room.web_rid='123';f.page.__STORE__.roomStore.roomInfo.room.status=0;
    f.guard.tick();assert.equal(events,0);assert.equal(f.guard.status.active,false);
  } finally {f.dom.window.close();}
});

function keeperFixture(shared={}) {
  let alarm,removed,updated;const power=[],sent=[],created=[];
  const tabs=[{id:1,url:'https://live.douyin.com/123'},{id:2,url:'https://live.douyin.com/456'},{id:3,url:'https://example.com/123'}];
  const active=new Set([1,2]);
  const chrome={storage:{session:{get:async key=>({[key]:structuredClone(shared[key])}),set:async value=>Object.assign(shared,structuredClone(value))}},
    alarms:{create:(...args)=>created.push(args),onAlarm:{addListener:f=>alarm=f}},
    power:{requestKeepAwake:level=>power.push(level),releaseKeepAwake:()=>power.push('release')},
    tabs:{query:async()=>tabs,sendMessage:async(id,message)=>{sent.push([id,message]);return {active:active.has(id)};},onRemoved:{addListener:f=>removed=f},onUpdated:{addListener:f=>updated=f}}};
  const keeper=installCollectionKeeper(chrome);
  return {keeper,shared,power,sent,created,active,tabs,alarm:()=>alarm({name:'live-assistant-collection'}),removed:id=>removed(id),updated:(id,change)=>updated(id,change)};
}

test('后台 30 秒唤醒仅作用于直播页；多房间共享系统待机保护，MV3 重启后重新核对',async()=>{
  const shared={},f=keeperFixture(shared);await f.keeper.refresh();
  assert.equal(f.created[0][1].periodInMinutes,0.5);assert.equal(f.power.at(-1),'system');
  assert.ok(f.sent.every(([id,message])=>id!==3&&message.type==='collection-wake'));
  f.active.delete(1);await f.keeper.refresh();assert.equal(f.power.at(-1),'system');
  f.active.delete(2);await f.keeper.refresh();assert.equal(f.power.at(-1),'release');
  const sender={frameId:0,tab:f.tabs[0]};
  assert.equal((await f.keeper.update(sender,true)).awake,true);
  const restarted=keeperFixture(shared);restarted.active.clear();await restarted.keeper.refresh();
  assert.equal(restarted.power.at(-1),'release','不保留已经失效的内存租约');
  assert.deepEqual(shared['live-assistant:collection-leases'],{});
  assert.equal((await restarted.keeper.update({frameId:1,tab:f.tabs[0]},true)).awake,false);
  assert.equal((await restarted.keeper.update({frameId:0,tab:f.tabs[2]},true)).awake,false);
});

test('一个后台标签冻结不响应时，唤醒超时不会阻塞其他房间和后续租约释放',async()=>{
  const saved={},power=[];
  const chrome={storage:{session:{get:async key=>({[key]:saved[key]}),set:async value=>Object.assign(saved,value)}},
    alarms:{create(){},onAlarm:{addListener(){}}},power:{requestKeepAwake:()=>power.push(true),releaseKeepAwake:()=>power.push(false)},
    tabs:{query:async()=>[{id:1,url:'https://live.douyin.com/123'},{id:2,url:'https://live.douyin.com/456'}],sendMessage:async id=>id===1?new Promise(()=>{}):{active:true}}};
  const keeper=installCollectionKeeper(chrome,{wakeTimeoutMs:10});
  await keeper.refresh();assert.equal(power.at(-1),true);
  assert.deepEqual(Object.keys(saved['live-assistant:collection-leases']),['2']);
  await keeper.update({frameId:0,tab:{id:2,url:'https://live.douyin.com/456'}},false);assert.equal(power.at(-1),false);
});
