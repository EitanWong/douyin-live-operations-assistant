import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RoomMonitor} from '../../src/browser/room-monitor.js';

function fixture(storage = new Map()) {
  let now = 1000000, reads = 0, reloads = 0, failRead = false, failSave = false;
  const order = [], statuses = [], errors = [];
  const context = {current:true, enabled:true, live:'ended', healthy:false, lastActivity:0, dirty:false};
  const page = {location:{href:'https://live.douyin.com/123',reload:()=>{reloads++;order.push('reload');}}, navigator:{onLine:true},
    sessionStorage:{getItem:key=>storage.get(key) ?? null,setItem:(key,value)=>storage.set(key,value)}};
  const monitor = new RoomMonitor({page,now:()=>now,context:()=>context,
    read:async()=>{reads++;if(failRead)throw Error('network');},
    checkpoint:async()=>{order.push('save');if(failSave)throw Error('storage');},
    onStatus:status=>statuses.push(status),onError:error=>errors.push(error.message)});
  return {monitor,page,context,order,statuses,errors,storage,advance:ms=>now+=ms,
    get reads(){return reads;},get reloads(){return reloads;},failRead:value=>failRead=value,failSave:value=>failSave=value};
}

test('未开播页持续检测，保存状态后才刷新，刷新冷却跨页面重建保留',async()=>{
  const f=fixture();await f.monitor.tick();assert.equal(f.reads,0);
  f.advance(15000);await f.monitor.tick();assert.equal(f.reads,1);
  assert.equal(f.statuses.at(-1).state,'waiting');assert.equal(f.statuses.at(-1).active,true);
  f.advance(105000);await f.monitor.tick();assert.deepEqual(f.order,['save','reload']);
  await f.monitor.tick();assert.equal(f.reloads,1,'导航中不重复刷新');
  const next=fixture(f.storage);next.context.live='live';await next.monitor.tick();
  next.advance(5000);await next.monitor.tick();assert.equal(next.reloads,0,'跨刷新不形成刷新风暴');
});

test('全天候24小时等待没有重试次数上限，失败退避且后续成功恢复正常检测频率',async()=>{
  const f=fixture();f.failRead(true);f.advance(15000);await f.monitor.tick();
  f.advance(15000);await f.monitor.tick();assert.equal(f.reads,1);
  f.advance(15000);await f.monitor.tick();assert.equal(f.reads,2);
  f.failRead(false);f.advance(60000);await f.monitor.tick();assert.equal(f.reads,3);
  // 未保存草稿阻止导航，但不会停止检测；用虚拟时间覆盖完整一天。
  f.context.dirty=true;
  for(let i=0;i<5760;i++){f.advance(15000);await f.monitor.tick();}
  assert.equal(f.reads,5763);assert.equal(f.reloads,0);assert.equal(f.statuses.at(-1).active,true);
});

test('连续24小时周期刷新后重建页面，5760次检测和720次持久化刷新不中断',async()=>{
  let now=1000000,reads=0,reloads=0,saves=0,reboot=false;
  const saved=new Map(),context=()=>({current:true,enabled:true,live:'ended',healthy:false});
  const page={navigator:{onLine:true},location:{href:'https://live.douyin.com/123',reload:()=>{reloads++;reboot=true;}},
    sessionStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)}};
  const create=()=>new RoomMonitor({page,context,now:()=>now,read:async()=>reads++,checkpoint:async()=>saves++});
  let monitor=create();
  for(let i=0;i<5760;i++) {
    now+=15000;await monitor.tick();
    if(reboot){monitor.close();monitor=create();reboot=false;}
  }
  await monitor.tick();
  assert.equal(reads,5760);assert.equal(reloads,720);assert.equal(saves,reloads);assert.equal(monitor.status.active,true);
});

test('开播但原页没有连接时快速刷新；正常连接不刷新，断线先等重连，假在线超时也恢复',async()=>{
  const f=fixture();f.context.live='live';await f.monitor.tick();
  f.advance(5000);await f.monitor.tick();assert.equal(f.reloads,1);
  const live=fixture();live.context.live='live';live.context.healthy=true;
  await live.monitor.tick();live.advance(180000);await live.monitor.tick();assert.equal(live.reloads,0);
  live.context.healthy=false;await live.monitor.tick();live.advance(29000);await live.monitor.tick();assert.equal(live.reloads,0);
  live.advance(1000);await live.monitor.tick();assert.equal(live.reloads,1);
  const stale=fixture();stale.context.live='live';stale.context.healthy=true;stale.context.lastActivity=1000000;
  await stale.monitor.tick();stale.advance(120001);await stale.monitor.tick();
  stale.advance(30000);await stale.monitor.tick();assert.equal(stale.reloads,1);
  const silent=fixture();silent.context.live='live';silent.context.healthy=true;
  await silent.monitor.tick();silent.advance(120001);await silent.monitor.tick();
  silent.advance(30000);await silent.monitor.tick();assert.equal(silent.reloads,1,'连接打开后始终没有第一帧也应恢复');
});

test('网络离线、手动暂停、切房、挂起及保存失败不刷新，恢复后可重试',async()=>{
  const f=fixture();f.advance(120000);f.page.navigator.onLine=false;await f.monitor.tick();
  assert.equal(f.reads,0);assert.equal(f.reloads,0);assert.equal(f.statuses.at(-1).state,'offline');
  f.page.navigator.onLine=true;f.context.enabled=false;await f.monitor.tick();assert.equal(f.reloads,0);
  assert.equal(f.statuses.at(-1).active,false);
  f.context.enabled=true;f.context.current=false;await f.monitor.tick();assert.equal(f.reloads,0);
  f.context.current=true;f.context.suspended=true;await f.monitor.tick();assert.equal(f.reloads,0);
  f.context.suspended=false;f.failSave(true);await f.monitor.tick();assert.equal(f.reloads,0);assert.deepEqual(f.errors,['storage']);
  f.failSave(false);f.advance(15000);await f.monitor.tick();assert.equal(f.reloads,1);
});

test('并发后台唤醒合并检测；保存期间暂停或离开房间不导航；关闭拒绝晚到结果',async()=>{
  const f=fixture();let finishRead;f.monitor.read=()=>new Promise(resolve=>finishRead=resolve);
  const first=f.monitor.wake(),second=f.monitor.wake();assert.equal(first,second);
  f.context.enabled=false;finishRead();await first;assert.equal(f.statuses.at(-1).active,false);
  f.monitor.read=async()=>{};f.context.enabled=true;f.advance(120000);
  let finishSave,started;const savingStarted=new Promise(resolve=>started=resolve);
  f.monitor.checkpoint=()=>{started();return new Promise(resolve=>finishSave=resolve);};
  const saving=f.monitor.tick();await savingStarted;f.context.current=false;finishSave();await saving;assert.equal(f.reloads,0);
  f.monitor.close();f.context.current=true;f.advance(120000);await f.monitor.wake();assert.equal(f.reloads,0);
});
