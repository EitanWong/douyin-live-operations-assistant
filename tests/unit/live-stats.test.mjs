import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine, DEFAULTS, copy, mergeConfig, validateConfig} from '../../src/core/engine.js';
import {currentGiftBroadcastMessages} from '../../src/core/gift-analytics.js';

function setup() {
  let now=1800000000000;
  const config=copy(DEFAULTS);config.anchorId='123';config.mode='auto';
  let income={id:'current',anchorId:'123',startAt:now-1000,endAt:0,totalDiamonds:600,giftCount:6,
    audience:[300,200,100].map((totalDiamonds,i)=>({userId:`uid:${i+1}`,name:`观众${i+1}`,totalDiamonds}))};
  const sent=[];
  const engine=new Engine({config,now:()=>now,send:async text=>{sent.push(text);return {submitted:true};},liveData:()=>({income})});
  engine.start();
  return {engine,sent,messages:currentGiftBroadcastMessages(income),advance:ms=>now+=ms,setIncome:value=>income=value,getIncome:()=>income};
}

test('本场统计按整轮预留发送位置，小队列也完整入队，满队列、屏蔽词或重复消息不留下部分榜单',async()=>{
  const h=setup(), {engine,messages}=h;
  engine.config.sending.queueLimit=1;
  engine.enqueue('bot','占位互动');
  assert.equal(engine.queueLiveStats(messages,'current'),false);assert.equal(engine.queue.length,1);
  engine.queue=[];
  engine.config.blockedWords=['观众2'];
  assert.equal(engine.queueLiveStats(messages,'current'),false);assert.equal(engine.queue.length,0);
  engine.config.blockedWords=[];
  engine.duplicates.set(messages[2],engine.now());
  assert.equal(engine.queueLiveStats(messages,'current'),false);assert.equal(engine.queue.length,0);
  engine.duplicates.clear();
  assert.equal(engine.queueLiveStats(messages,'current'),true);
  assert.equal(engine.queueLiveStats(messages,'current'),false);
  assert.equal(engine.queue.length,messages.length);
  for (let i=0;i<messages.length;i++) await engine.tick();
  assert.deepEqual(h.sent,messages);
  assert.equal(engine.queueLiveStats(messages,'current'),false);
  engine.stop();assert.equal(engine.queueLiveStats(messages,'current'),false);
});

test('开始场控主动播报且仅播报贡献榜及千票人数，之后每五分钟一轮、不补发错过的轮次',async()=>{
  const h=setup(), {engine,messages}=h;
  engine.config.sending.duplicateSec=3600;
  assert.deepEqual(engine.config.audienceBroadcast,{enabled:true,intervalSec:300});
  for(let i=0;i<messages.length;i++) await engine.tick();
  assert.deepEqual(h.sent,messages);
  assert.doesNotMatch(h.sent.join(''),/本场已统计|收到礼物|礼物件数|总收入/);
  h.advance(299999);await engine.tick();assert.equal(h.sent.length,4);
  h.advance(1);for(let i=0;i<messages.length;i++) await engine.tick();
  assert.deepEqual(h.sent,[...messages,...messages],'主动播报使用设定的周期，不被通用重复冷却挡住');
  h.advance(1800000);for(let i=0;i<messages.length;i++) await engine.tick();
  assert.equal(h.sent.length,12,'离线半小时只播报当前一轮');
  await engine.tick();assert.equal(h.sent.length,12);
});

test('主动播报等待连接、场次和榜单数据，容量不足时重试，关闭、暂停和下播后停止',async()=>{
  const h=setup(), {engine}=h;
  await engine.tick(false);assert.equal(h.sent.length,0);assert.equal(engine.queue.length,0);
  engine.config.sending.queueLimit=1;engine.enqueue('bot','占位互动',{retryAt:engine.now()+60000});
  await engine.tick();assert.equal(engine.queue.filter(job=>job.kind==='live-stats').length,0);
  engine.queue=[];engine.config.sending.queueLimit=200;h.advance(5000);await engine.tick();
  assert.equal(h.sent.length,1);assert.equal(engine.queue.length,3);
  engine.update({...engine.config,audienceBroadcast:{enabled:false,intervalSec:300}});
  assert.equal(engine.queue.length,0);h.advance(300000);await engine.tick();assert.equal(h.sent.length,1);
  engine.stop();h.advance(300000);await engine.tick();assert.equal(h.sent.length,1);
  engine.config.audienceBroadcast.enabled=true;engine.start();
  h.setIncome({...h.getIncome(),endAt:engine.now()});await engine.tick();assert.equal(h.sent.length,1);
  h.setIncome({...h.getIncome(),id:'empty',endAt:0,audience:[]});await engine.tick();assert.equal(engine.queue.length,0);
  h.setIncome({...h.getIncome(),audience:[{userId:'uid:1',name:'新观众',totalDiamonds:1000}]});h.advance(5000);
  await engine.tick();assert.match(h.sent.at(-1),/第1名：新观众。/);
  await engine.tick();assert.equal(h.sent.at(-1),'本场千票贡献榜人数：1 人。');
});

test('刷新恢复主动播报的五分钟间隔，切场撤销旧消息并立即播报新场榜单',async()=>{
  const h=setup(), {engine,messages}=h;
  for(let i=0;i<messages.length;i++) await engine.tick();
  const snapshot=engine.snapshot(), restored=new Engine({config:engine.config,now:engine.now,liveData:engine.liveData,send:engine.send});
  restored.restore(snapshot);restored.start();h.advance(299999);await restored.tick();assert.equal(h.sent.length,4);
  h.advance(1);await restored.tick();assert.equal(h.sent.length,5);
  h.setIncome({...h.getIncome(),id:'new',audience:[{userId:'uid:9',name:'新场榜首',totalDiamonds:2000}]});
  await restored.tick();assert.match(h.sent.at(-1),/新场榜首/);
  assert.ok(restored.queue.every(job=>job.liveGiftSession==='new'));
});

test('贡献榜播报配置对旧配置默认开启五分钟，拒绝无效间隔',()=>{
  assert.deepEqual(validateConfig(mergeConfig({})).audienceBroadcast,{enabled:true,intervalSec:300});
  for(const intervalSec of [0,29,3601,300.5,NaN]) assert.throws(()=>validateConfig(mergeConfig({audienceBroadcast:{intervalSec}})),/贡献榜播报间隔/);
  assert.equal(validateConfig(mergeConfig({audienceBroadcast:{enabled:false,intervalSec:60}})).audienceBroadcast.enabled,false);
});

test('分条榜单重试和运行快照恢复后仍按顺序发送，下播或切场后整组撤销',async()=>{
  const h=setup(), {engine,messages}=h;
  let first=true;
  engine.send=async text=>{if(first){first=false;throw new Error('暂时断线');}h.sent.push(text);return {submitted:true};};
  assert.equal(engine.queueLiveStats(messages,'current'),true);
  await engine.tick();await engine.tick();
  assert.deepEqual(h.sent,[],'首条重试等待中不抢先发送后面的名次');
  const snapshot=engine.snapshot();
  const restored=new Engine({config:engine.config,now:engine.now,liveData:engine.liveData,send:engine.send});
  restored.restore(snapshot);restored.start();h.advance(20000);
  for (let i=0;i<messages.length;i++) await restored.tick();
  assert.deepEqual(h.sent,messages);
  for (const income of [{id:'current',anchorId:'123',endAt:engine.now()},{id:'next',anchorId:'123',endAt:0},{id:'current',anchorId:'other',endAt:0}]) {
    const next=setup();assert.equal(next.engine.queueLiveStats(next.messages,'current'),true);next.setIncome(income);
    await next.engine.tick();assert.equal(next.engine.queue.length,0);assert.deepEqual(next.sent,[]);
    assert.equal(next.engine.queueLiveStats(next.messages,'current'),false);
  }
});

test('整轮榜单在慢速发送与断线超过十五秒后仍完整，尚未结束时不叠加新一轮',async()=>{
  const h=setup(), {engine,messages}=h;
  engine.config.sending.queueLimit=1;
  assert.equal(engine.queueLiveStats(messages,'current'),true);
  await engine.tick();assert.deepEqual(h.sent,[messages[0]]);
  h.advance(20000);await engine.tick(false);
  assert.equal(engine.queue.length,messages.length-1);
  const changed=messages.map(text=>text.replace('：','：更新'));
  assert.equal(engine.queueLiveStats(changed,'current'),false,'未完成整轮前不插入另一轮');
  for(let i=1;i<messages.length;i++) {h.advance(20000);await engine.tick();}
  assert.deepEqual(h.sent,messages);assert.equal(engine.queue.length,0);
});

test('队列压力不挤掉已接受榜单的任何分条，礼物与机器人持续涌入时仍完成整轮',async()=>{
  const h=setup(), {engine,messages}=h;
  engine.config.sending.queueLimit=messages.length;
  assert.equal(engine.queueLiveStats(messages,'current'),true);
  const ids=engine.queue.map(job=>job.id);
  engine.enqueue('welcome','欢迎新观众');engine.enqueue('bot','机器人菜单');engine.enqueue('moderation','请文明互动');
  assert.deepEqual(engine.queue.filter(job=>job.kind==='live-stats').map(job=>job.id),ids);
  engine.config.sending.queueLimit=200;
  for(let i=0;i<25;i++) {
    engine.enqueue('gift',`感谢观众${i}送礼`);engine.enqueue('bot',`互动回复${i}`);
    h.advance(1000);await engine.tick();
  }
  assert.deepEqual(h.sent.filter(text=>messages.includes(text)),messages);
  assert.ok(h.sent.some(text=>/感谢观众/.test(text)),'榜单分条之间继续发送礼物感谢');
  assert.equal(engine.queue.filter(job=>job.kind==='live-stats').length,0);
});

test('首条正在发送时不接收另一轮，长昵称的全部续条按序发送',async()=>{
  const h=setup(), {engine}=h;
  engine.config.sending.maxLength=10;engine.config.sending.queueLimit=1;
  const name='😄'.repeat(10)+'abcde fghij'.repeat(6);
  const income={...h.getIncome(),audience:[{userId:'uid:1',name,totalDiamonds:1000}]};
  h.setIncome(income);
  const messages=currentGiftBroadcastMessages(income,10);
  assert.equal(engine.queueLiveStats(messages,'current'),true);
  let complete;
  engine.send=async text=>{h.sent.push(text);if(!complete) await new Promise(resolve=>complete=resolve);return {submitted:true};};
  const sending=engine.tick();
  assert.equal(engine.queueLiveStats(['本场贡献榜：更新'],'current'),false);
  complete();await sending;
  for(let i=1;i<messages.length;i++) {h.advance(10000);await engine.tick();}
  assert.deepEqual(h.sent,messages);assert.equal(engine.queue.length,0);
  assert.equal(h.sent.slice(0,-1).map(text=>text.slice(text.indexOf('：')+1,-1)).join(''),name,'昵称中的表情和空格均完整保留');
});

test('升级后撤销含钻石的旧版待播报整轮，改用当前不含钻石的新榜单',async()=>{
  const h=setup(), {engine,messages}=h;
  assert.equal(engine.queueLiveStats(messages,'current'),true);
  const snapshot=engine.snapshot();
  for(const job of snapshot.queue) {delete job.liveStatsVersion;job.text+='100钻';}
  const restored=new Engine({config:engine.config,now:engine.now,liveData:engine.liveData,send:engine.send});
  restored.restore(snapshot);restored.start();
  for(let i=0;i<messages.length;i++) await restored.tick();
  assert.deepEqual(h.sent,messages);assert.doesNotMatch(h.sent.join(''),/钻/);
});
