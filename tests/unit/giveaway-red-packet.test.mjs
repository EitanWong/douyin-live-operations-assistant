import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GiveawayRunner} from '../../src/tools/giveaway/runner.js';

const packet={metaId:'1009',diamondCount:20,packNum:15,delayTime:300,accountId:'9',roomId:'123',anchorId:'8',voucher:false};
const config={prizes:[{type:'red-packet',count:1,redPacket:packet}],durationSec:1,chatEnabled:true,keyword:'参与',giftEnabled:false};
function fixture(){
 let saved,time=1000,fail=false;const sends=[];
 const make=overrides=>new GiveawayRunner({room:'123',broadcastId:()=> '123',now:()=>time,randomInt:()=>0,storage:{get:async()=>structuredClone(saved),set:async(k,v)=>{if(fail)throw Error('磁盘失败');saved=structuredClone(v);}},lock:{acquire:async()=>true,release(){}},
  packetCatalog:async()=>({available:true,accountId:'9',roomId:'123',anchorId:'8',balanceUnits:1000,packages:[{metaId:'1009',diamondCount:20,packNum:15,delays:[0,300],available:true}]}),
  packetSend:async value=>{assert.equal(saved.rounds[0].redPacketDeliveries[0].status,'dispatching');sends.push(value);return {submitted:true,boxId:'7705119625705048859'};},...overrides});
 return {make,sends,saved:()=>saved,time:v=>time=v,fail:v=>fail=v,put:v=>saved=v};
}
test('红包不依赖中奖者且只发一个套餐，先保存发放意图，刷新和重复tick不再发送',async()=>{
 const f=fixture();let r=f.make();await r.ready();await r.start(config);f.time(1500);
 for(const id of ['1','2'])await r.event({type:'chat',id,text:'参与',at:1500,user:{id,name:id}});
 f.time(2000);await r.tick();assert.equal(f.sends.length,1);assert.equal(f.saved().rounds[0].awards.length,0);
 assert.equal(f.saved().rounds[0].redPacketDeliveries[0].status,'sent');assert.equal(f.saved().rounds[0].redPacketDeliveries[0].boxId,'7705119625705048859');
 await r.dispose();r=f.make();await r.ready();await r.tick();assert.equal(f.sends.length,1);await r.dispose();
});
test('取消不花费，无人参与仍发放，结果未知或发出后存储失败绝不重发',async()=>{
 for(const mode of ['empty','cancel','preview','unknown','disk']){
  const f=fixture();let r=f.make({feedbackMode:()=>mode==='preview'?'preview':'auto',packetSend:async()=>{f.sends.push(1);if(mode==='disk')f.fail(true);return {submitted:false,unknown:true,reason:'超时'};}});
  await r.ready();await r.start(config);f.time(1500);
  if(mode!=='empty')await r.event({type:'chat',id:'e',text:'参与',at:1500,user:{id:'1',name:'甲'}});
  if(mode==='cancel')await r.cancel();
  f.time(2000);if(mode==='disk')await assert.rejects(r.tick(),/磁盘/);else await r.tick();
  f.fail(false);await r.dispose();r=f.make();await r.ready();await r.tick();
  assert.equal(f.sends.length,mode==='cancel'?0:1,mode);
  if(mode==='disk')assert.equal(f.saved().rounds[0].redPacketDeliveries[0].status,'unknown');
  await r.dispose();
 }
});
test('指定时间任务刷新后继续等待，过期超过一分钟不补发，余额不足不能创建任务',async()=>{
 for(const late of [false,true]){
  const f=fixture();let r=f.make();await r.ready();await r.start({...config,scheduledAt:6000});assert.equal(f.saved().rounds[0].endsAt,6000);await r.dispose();
  f.time(5000);r=f.make();await r.ready();assert.equal(f.sends.length,0);
  f.time(late?66001:6000);await r.tick();assert.equal(f.sends.length,late?0:1);
  if(late)assert.match(f.saved().rounds[0].redPacketDeliveries[0].reason,/错过/);await r.dispose();
 }
 const f=fixture(),r=f.make({packetCatalog:async()=>({available:true,accountId:'9',roomId:'123',anchorId:'8',balanceUnits:199,packages:[{metaId:'1009',diamondCount:20,packNum:15,delays:[0,300],available:true}]})});
 await r.ready();await assert.rejects(r.start(config),/余额不足/);assert.equal(f.saved(),undefined);await r.dispose();
});
