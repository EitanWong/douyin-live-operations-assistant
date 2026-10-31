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

test('并发收到的弹幕全部持久保存，到期只开奖一次，重建后结果相同',async()=>{
  const f=fixture(),runner=f.create();await runner.ready();await runner.start(config);f.time(2000);
  await Promise.all(['1','2','3'].map(id=>runner.event(event(id))));assert.equal(f.saved().rounds[0].entrants.length,3);
  f.time(3000);await runner.tick();const winner=f.saved().rounds[0].winnerIds[0];await runner.dispose();
  const restored=f.create();await restored.ready();await restored.tick();
  assert.equal(restored.state().rounds[0].status,'drawn');assert.deepEqual(restored.state().rounds[0].winnerIds,[winner]);await restored.dispose();
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
  const result=f.saved().rounds[0];assert.equal(result.status,'drawn');assert.deepEqual(result.winnerIds,['1']);await second.dispose();
});
