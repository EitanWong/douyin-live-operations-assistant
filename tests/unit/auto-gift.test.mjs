import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AutoGift} from '../../src/core/auto-gift.js';

const config={giftId:'463',priceUnits:10,batch:2,target:5,intervalSec:5,budget:3};
function fixture() {
  const timers=[],calls=[],lock={held:false,acquire:async()=>{lock.held=true;return true;},release:()=>{lock.held=false;}};
  const transport={giftSnapshot:async()=>({available:true,balanceUnits:100,gifts:[{id:'463',name:'小心心',available:true,priceUnits:10}]}),
    prepareGift:async()=>({available:true,token:'gift',balanceUnits:100}),stopGift:async()=>{},
    commitGift:async(token,count,sequence)=>{calls.push({count,sequence});return {submitted:true,count,costUnits:count*10,balanceUnits:100-count*10};}};
  const runner=new AutoGift({transport,lock,schedule:callback=>{timers.push(callback);return callback;},cancel:id=>{const index=timers.indexOf(id);if(index>=0)timers.splice(index,1);}});
  return {runner,transport,lock,timers,calls};
}
test('自动送礼按预算缩小最后批次，达到消费上限停止；刷新余额不启动送礼',async()=>{
  const f=fixture();await f.runner.refresh();assert.equal(f.calls.length,0);assert.equal(f.runner.state.balanceUnits,100);
  await f.runner.start(config);assert.deepEqual(f.calls,[{count:2,sequence:1}]);
  await f.timers.shift()();assert.deepEqual(f.calls,[{count:2,sequence:1},{count:1,sequence:2}]);
  assert.equal(f.runner.state.spentUnits,30);assert.equal(f.runner.state.accepted,3);assert.equal(f.runner.state.phase,'completed');assert.equal(f.lock.held,false);
});
test('停止期间的已提交结果仍计费，结算前不可重启且结算后没有后续批次',async()=>{
  const f=fixture();let complete;
  f.transport.commitGift=(token,count)=>new Promise(resolve=>{complete=()=>resolve({submitted:true,count,costUnits:count*10,balanceUnits:80});});
  const starting=f.runner.start(config);await new Promise(setImmediate);f.runner.stop();
  assert.equal(f.lock.held,true);await assert.rejects(f.runner.start(config),/正在/);
  complete();await starting;assert.equal(f.runner.state.spentUnits,20);assert.equal(f.lock.held,false);assert.equal(f.timers.length,0);
});
test('未知响应与价格异常立即停止，不重试、不从旧状态恢复',async()=>{
  for(const result of [{submitted:false,unknown:true,pending:{id:'unknown'},reason:'结果未知'}, {submitted:true,count:2,costUnits:30,priceChanged:true}]) {
    const f=fixture();f.transport.commitGift=async()=>result;await f.runner.start(config);
    assert.equal(f.runner.state.phase,'stopped');assert.equal(f.timers.length,0);assert.equal(f.lock.held,false);
    if(result.unknown)assert.equal(f.runner.state.pending.id,'unknown');
  }
});
