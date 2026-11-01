import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GiveawayRunner} from '../../src/tools/giveaway/runner.js';

const config={prize:'礼盒',winners:1,durationSec:2,chatEnabled:true,keyword:'参与抽奖',giftEnabled:false};
function fixture() {
  let saved=null,held=false,time=1000,fail=false;
  const storage={get:async()=>structuredClone(saved),set:async(key,value)=>{if(fail)throw Error('磁盘已满');saved=structuredClone(value);}};
  const create=(overrides={})=>new GiveawayRunner({room:'123',storage,now:()=>time,randomInt:()=>0,broadcastId:()=> 'room',guard:()=>'',changed(){},
    lock:{acquire:async()=>{if(held)return false;held=true;return true;},release:()=>{held=false;}},...overrides});
  return {create,storage,time:value=>{time=value;},failure:value=>{fail=value;},saved:()=>saved};
}
const event=id=>({type:'chat',id:`c-${id}`,source:'socket',roomId:'room',at:1500,text:'参与抽奖',user:{id,name:`观众${id}`}});

test('采集到平台时间为零和安全 UID 的口令时立即保存报名和 @ 确认',async()=>{
  const f=fixture(),messages=[],runner=f.create({feedback:async message=>messages.push(message)});
  try {
    await runner.ready();await runner.start(config);f.time(2000);
    await runner.event({...event('0'),at:0,receivedAt:2000,user:{id:'0',secUid:'viewer',name:'小雨'}});
    assert.equal(f.saved().rounds[0].entrants[0]?.userId,'sec:viewer');
    assert.ok(messages.some(row=>row.kind==='entry' && row.text.includes('@小雨')));
  } finally {await runner.dispose();}
});

test('匹配口令缺少稳定身份时提示原因，后续有效报名清除提醒',async()=>{
  const f=fixture(),runner=f.create();
  try {
    await runner.ready();await runner.start(config);f.time(2000);
    await runner.event({...event(''),user:{name:'小雨'}});
    assert.equal(f.saved().rounds[0].entrants.length,0);assert.match(runner.state().entryError,/小雨.*用户.*ID/);
    await runner.tick();assert.match(runner.state().entryError,/用户.*ID/);
    await runner.event(event('1'));assert.equal(runner.state().entryError,'');
  } finally {await runner.dispose();}
});

test('新轮次即使传入关闭反馈也会生成并交付开轮公告',async()=>{
  const f=fixture(),messages=[],runner=f.create({feedback:async message=>messages.push(message)});
  await runner.ready();await runner.start({...config,feedbackEnabled:false});
  assert.equal(f.saved().rounds[0].config.feedbackEnabled,true);
  assert.ok(messages.some(message=>message.kind==='start'));await runner.dispose();
});

test('并发收到的弹幕全部持久保存，到期只开奖一次，重建后结果相同',async()=>{
  const f=fixture(),runner=f.create();await runner.ready();await runner.start(config);f.time(2000);
  await Promise.all(['1','2','3'].map(id=>runner.event(event(id))));assert.equal(f.saved().rounds[0].entrants.length,3);
  f.time(3000);await runner.tick();const winner=f.saved().rounds[0].awards[0];await runner.dispose();
  const restored=f.create();await restored.ready();await restored.tick();
  assert.equal(restored.state().rounds[0].status,'drawn');assert.deepEqual(restored.state().rounds[0].awards,[winner]);await restored.dispose();
});
test('刷新后接续进行中轮次，多标签页只允许一个写入者，旧页退出后接管',async()=>{
  const f=fixture(),first=f.create(),second=f.create();await first.ready();await first.start(config);await second.ready();
  await assert.rejects(second.start(config),/其他页面/);f.time(2000);await second.event(event('2'));assert.equal(f.saved().rounds[0].entrants.length,0);
  await first.dispose();await second.tick();await second.event(event('2'));assert.equal(f.saved().rounds[0].entrants.length,1);
  await second.cancel('人工取消');assert.equal(f.saved().rounds[0].status,'cancelled');await second.dispose();
});
test('保存失败不显示未保存参与者，保留原轮次；恢复存储可重放事件',async()=>{
  const f=fixture(),runner=f.create();await runner.ready();await runner.start(config);f.time(2000);f.failure(true);
  await assert.rejects(runner.event(event('1')),/磁盘已满/);assert.equal(runner.state().rounds[0].entrants.length,0);
  f.failure(false);await runner.event(event('1'));assert.equal(f.saved().rounds[0].entrants.length,1);await runner.dispose();
});
test('旧页面在存储读取途中关闭不能再创建轮次或继续写入',async()=>{
  const f=fixture(),runner=f.create();await runner.ready();let release;
  f.storage.get=()=>new Promise(resolve=>{release=resolve;});
  const starting=runner.start(config);await new Promise(setImmediate);const closed=runner.dispose();release(null);
  await assert.rejects(starting,/停用/);await closed;assert.equal(f.saved(),null);
});
test('无人报名的到期轮次与取消轮次保留，导出包含所有轮次',async()=>{
  const f=fixture(),runner=f.create();await runner.ready();await runner.start(config);f.time(3001);await runner.tick();
  await runner.start(config);await runner.cancel('用户取消');
  const data=await runner.export();assert.equal(data.rounds.length,2);assert.deepEqual(data.rounds.map(r=>r.status),['drawn','cancelled']);await runner.dispose();
});

test('恢复时先补入截止前已写入日志的事件，再对过期轮次开奖',async()=>{
  const f=fixture(),first=f.create();await first.ready();await first.start(config);await first.dispose();f.time(5000);
  const records=[{key:'pending',savedAt:1500,event:event('1')},{key:'late',savedAt:4000,event:event('2')}];
  const second=f.create({pendingEvents:async()=>records});await second.ready();
  const result=f.saved().rounds[0];assert.equal(result.status,'drawn');assert.deepEqual(result.awards,[{userId:'1',prizeIndex:0}]);await second.dispose();
});
test('多奖品与权重、主播身份固定；开奖保存失败不公布，恢复后导出映射保持',async()=>{
  const f=fixture();let anchor='9';const runner=f.create({anchorId:()=>anchor});await runner.ready();
  await runner.start({...config,prizes:[{name:'礼盒',count:1},{name:'纪念杯',count:1}],weights:[{userId:'1',weight:3}],anchorGuaranteed:true});
  anchor='8';f.time(2000);await runner.event(event('1'));await runner.event(event('9'));f.time(3000);f.failure(true);
  await assert.rejects(runner.tick(),/磁盘已满/);assert.equal(runner.state().rounds[0].status,'running');assert.deepEqual(runner.state().rounds[0].awards,[]);
  f.failure(false);await runner.tick();const saved=await runner.export();assert.equal(saved.version,2);
  assert.equal(saved.rounds[0].anchorId,'9');assert.deepEqual(saved.rounds[0].awards,[{userId:'9',prizeIndex:0},{userId:'1',prizeIndex:1}]);await runner.dispose();
  const restored=f.create({randomInt:()=>assert.fail('保存后不能重抽')});await restored.ready();assert.deepEqual((await restored.export()).rounds[0],saved.rounds[0]);await restored.dispose();
});
test('旧版已开奖记录升级后可直接导出，追加新轮次时以新版保存且旧结果不变',async()=>{
  const f=fixture();await f.storage.set('',{version:1,rounds:[{id:'old',room:'123',broadcastId:'room',status:'drawn',startedAt:0,endsAt:500,closedAt:500,
    config,entrants:[{userId:'2',userName:'旧观众',sources:['chat'],enteredAt:100,giftCount:0}],giftProgress:[],winnerIds:['2'],reason:'旧结果'}]});
  const runner=f.create();await runner.ready();assert.deepEqual((await runner.export()).rounds[0].awards,[{userId:'2',prizeIndex:0}]);
  await runner.start(config);assert.equal(f.saved().version,2);assert.equal(f.saved().rounds.length,2);assert.equal(f.saved().rounds[0].config.prizes[0].name,'礼盒');await runner.dispose();
});

test('报名先保存再立即确认；关键倒计时和开奖结果只入队一次，重建不重发',async()=>{
  const f=fixture(),messages=[];
  const feedback=async message=>{assert.ok(f.saved().rounds[0].feedback.some(row=>row.id===message.id));messages.push(message);};
  const runner=f.create({feedback});await runner.ready();await runner.start({...config,durationSec:61});
  assert.ok(messages.some(row=>row.kind==='start'));f.time(2000);
  await runner.event(event('1'));await runner.event(event('2'));await runner.event(event('1'));await runner.tick();
  assert.equal(messages.filter(row=>row.kind==='entry').length,2);assert.match(messages.filter(row=>row.kind==='entry').map(row=>row.text).join(''),/@观众1.*@观众2/);
  await runner.tick();assert.equal(messages.filter(row=>row.kind==='countdown').length,1);
  f.time(62000);await runner.tick();assert.equal(messages.filter(row=>row.kind==='result').length,1);
  for(const message of messages.filter(row=>row.kind==='result'))await runner.claimFeedback({key:message.key,owner:'sender'});
  await runner.dispose();const restored=f.create({feedback});await restored.ready();await restored.tick();
  assert.equal(messages.filter(row=>row.kind==='result').length,1);await restored.dispose();
});
test('报名或开奖保存失败不会发成功公告，发送失败保留待重试且不撤销报名或结果',async()=>{
  const f=fixture(),messages=[];let unavailable=false;
  const runner=f.create({feedback:async message=>{if(unavailable)throw Error('发送暂不可用');messages.push(message);}});
  await runner.ready();await runner.start(config);f.time(2000);f.failure(true);
  await assert.rejects(runner.event(event('1')),/磁盘/);assert.equal(messages.filter(row=>row.kind==='entry').length,0);
  f.failure(false);unavailable=true;await runner.event(event('1'));await runner.tick();assert.equal(runner.state().rounds[0].entrants.length,1);
  assert.match(runner.state().feedbackError,/发送暂不可用/);f.time(3000);f.failure(true);
  await assert.rejects(runner.tick(),/磁盘/);assert.equal(messages.filter(row=>row.kind==='result').length,0);
  f.failure(false);await runner.tick();assert.equal(runner.state().rounds[0].status,'drawn');
  unavailable=false;await runner.tick();assert.equal(messages.filter(row=>row.kind==='result').length,1);await runner.dispose();
});

test('跨页面发送同一公告先持久认领，其他页面不能重复点击；未认领的排队消息可接管',async()=>{
  const f=fixture(),firstMessages=[],secondMessages=[];
  const first=f.create({feedback:async row=>firstMessages.push(row)});await first.ready();await first.start(config);
  const message=firstMessages[0];assert.equal(await first.claimFeedback({key:message.key,owner:'page-one'}),true);
  await first.dispose();const second=f.create({feedback:async row=>secondMessages.push(row)});await second.ready();
  assert.equal(await second.claimFeedback({key:message.key,owner:'page-two'}),false);
  assert.ok(secondMessages.length>0);assert.ok(!secondMessages.some(row=>row.key===message.key));await second.dispose();
});
