import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {RewardAutomation,REWARDS_DEFAULTS} from '../../src/browser/rewards.js';
import {toolOperations} from '../../src/tools/gateway.js';
const roomId='7702463172476701483',lotteryId='7702521633959316287',userId='9007199254740993123',now=1793384520000;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const start=(id=lotteryId)=>({type:'activity-signal',activityKind:'lottery-start',roomId,lotteryId:id,startedAt:String(now/1000-10),drawAt:String(now/1000+60)});
function fixture({transport={},storage}={}) {
  const page=new JSDOM('<section class="gbRklVwV"><h3>福袋</h3><button>立即参与</button></section>',{url:'https://live.douyin.com/123'}).window;
  page.Element.prototype.getClientRects=()=>[{width:100,height:30}];
  const settings={...REWARDS_DEFAULTS,enabled:true,nativePassword:true},events=[start()],calls=[],records=[];let time=now,account=userId,clicks=0;
  page.document.body.onclick=()=>{clicks++;};
  const requests={prepare:async(id,options)=>{calls.push(['prepare',id,options]);return {available:true,token:'t'};},commit:async(token,options)=>{calls.push(['commit',token,options]);return {submitted:true,dispatched:true};},stop:async token=>{calls.push(['stop',token]);},...transport};
  const runner=new RewardAutomation({page,room:'123',getConfig:()=>settings,getEvents:()=>events,getRoomId:()=>roomId,getAccount:()=>account,
    lock:{acquire:async()=>true,release(){}},now:()=>time,lotteryRequests:requests,
    storage:storage || {get:async()=>structuredClone(records),set:async(_,values)=>{records.splice(0,records.length,...structuredClone(values));}}});
  return {page,settings,events,calls,runner,records,clicks:()=>clicks,account:value=>{account=value;},step:async(ms=1000)=>{time+=ms;await runner.tick();},close:()=>page.close()};
}
test('福袋协议轮次通过资格准备和请求提交，HTTP接受仍等待本人回执且不重复',async()=>{
  const f=fixture();try {
    await f.step();assert.deepEqual(f.calls.map(call=>call[0]),['prepare','commit','stop']);assert.equal(f.clicks(),0);
    assert.equal(f.calls[0][1],lotteryId);assert.equal(f.calls[0][2].allowPassword,true);
    assert.equal(f.runner.state.submitted,1);assert.equal(f.runner.state.serverConfirmed,0);
    assert.equal(f.records[0].status,'submitted');
    await f.step();assert.equal(f.calls.filter(call=>call[0]==='commit').length,1);
    f.events.push({type:'activity-signal',activityKind:'lottery-candidate',roomId,lotteryId,userId,participateSuccess:true,version:'20'});
    await f.step();assert.equal(f.runner.state.serverConfirmed,1);assert.equal(f.records[0].status,'confirmed');
  }finally{f.close();}
});
test('部分提交和未知请求结果保留未知记录，不回退点击或重新提交',async()=>{
  const f=fixture({transport:{commit:async()=>({submitted:false,dispatched:true,unknown:true,reason:'口令结果未知'})}});try {
    await f.step();await f.step(16000);assert.equal(f.clicks(),0);assert.equal(f.records[0].status,'unknown');
    assert.equal(f.calls.filter(call=>call[0]==='prepare').length,1);assert.equal(f.runner.state.submitted,1);
    assert.match(f.runner.state.reason,/未确认|未知/);
  }finally{f.close();}
});
test('准备等待期间停止、切换账号、关闭口令或切换轮次都撤销票据而不提交',async()=>{
  for(const mutate of [f=>f.runner.stop(),f=>f.account('77'),f=>{f.settings.nativePassword=false;},f=>f.events.push({...start('7702521633959316288'),startedAt:String(now/1000+1)})]) {
    const late=deferred(),f=fixture({transport:{prepare:()=>late.promise}});
    try {
      const pending=f.step();await new Promise(setImmediate);mutate(f);late.resolve({available:true,token:'late'});await pending;
      assert.equal(f.clicks(),0);assert.equal(f.calls.filter(call=>call[0]==='commit').length,0);assert.ok(f.calls.some(call=>call[0]==='stop'&&call[1]==='late'));
      assert.equal(f.records.length,0);
    }finally{f.close();}
  }
});
test('预留存储等待期间开奖，删除预留并不派发请求',async()=>{
  const saved=deferred();let writes=0;
  const f=fixture({storage:{get:async()=>[],set:async()=>{if(++writes===1)await saved.promise;}}});try {
    const pending=f.step();for(let i=0;i<20&&!writes;i++)await new Promise(setImmediate);assert.ok(writes,'应已开始持久化预留');
    f.events.push({type:'activity-signal',activityKind:'lottery-result',roomId,lotteryId,reportedUserIds:[]});saved.resolve();await pending;
    assert.equal(f.calls.filter(call=>call[0]==='commit').length,0);assert.equal(f.runner.records.length,0);assert.equal(writes,2);
  }finally{f.close();}
});
test('未满足资格的福袋查询有间隔，其他红包可继续；没有精确轮次不点击参与',async()=>{
  const f=fixture({transport:{prepare:async()=>{f.calls.push(['prepare']);return {available:false,reason:'粉丝团未满足'};}}});try {
    await f.step();await f.step();assert.equal(f.calls.length,1);assert.equal(f.clicks(),0);
    await f.step(10000);assert.equal(f.calls.length,2);
    f.events.splice(0);await f.step();assert.equal(f.clicks(),0);
  }finally{f.close();}
});
test('明确未派发时删除预留；请求进行期间停止会触发取消并保留在途所有权',async()=>{
  const late=deferred();let signal;
  const f=fixture({transport:{commit:async(_,options)=>{signal=options.signal;await late.promise;return {submitted:false,dispatched:true,unknown:true};}}});try {
    const pending=f.step();for(let i=0;i<20&&!signal;i++)await new Promise(setImmediate);assert.ok(signal,'应已开始请求提交');
    f.runner.stop();assert.equal(signal.aborted,true);assert.equal(f.runner.busy,true);late.resolve();await pending;
    assert.equal(f.runner.state.phase,'stopped');assert.equal(f.records[0].status,'unknown');
  }finally{f.close();}
  const unsent=fixture({transport:{commit:async()=>({submitted:false,dispatched:false,reason:'已取消'})}});try {
    await unsent.step();assert.equal(unsent.records.length,0);assert.equal(unsent.runner.state.submitted,0);assert.equal(unsent.clicks(),0);
  }finally{unsent.close();}
});
test('工具福袋请求绑定当前账号及设置，迟到准备撤销，提交后不能重复消费票据',async()=>{
  let account=userId;const config={enabled:true,luckyBag:true,nativePassword:true},calls=[];
  const operations=toolOperations({selfId:()=>account,getRewardsConfig:()=>config,transport:{
    prepareLottery:async()=>({available:true,token:'t'}),commitLottery:async()=>{calls.push('commit');return {submitted:true};},stopLottery:async token=>{calls.push(['stop',token]);}
  }});
  const controller=new AbortController(),ctx={session:{},signal:controller.signal,isCurrent:()=>true,assertCurrent(){}};
  assert.equal((await operations['rewards.prepare'].run({lotteryId,allowPassword:true},ctx)).available,true);
  account='77';await assert.rejects(operations['rewards.commit'].run({token:'t'},ctx),/账号|设置/);assert.equal(calls.length,0);
  await operations['rewards.stop'].run('t',ctx);
  account=userId;await operations['rewards.prepare'].run({lotteryId,allowPassword:true},ctx);
  assert.equal((await operations['rewards.commit'].run({token:'t'},ctx)).submitted,true);
  await assert.rejects(operations['rewards.commit'].run({token:'t'},ctx),/准备|票据/);assert.equal(calls.filter(v=>v==='commit').length,1);
});

test('工具独立取消信号使迟到准备立即撤销且释放准备槽位',async()=>{
  const late=deferred(),controller=new AbortController(),config={enabled:true,luckyBag:true,nativePassword:true};let prepares=0,stops=0;
  const operations=toolOperations({selfId:()=>userId,getRewardsConfig:()=>config,transport:{
    prepareLottery:async()=>{prepares++;return prepares===1?late.promise:{available:true,token:'new'};},stopLottery:async()=>{stops++;}
  }});
  const scope=new AbortController(),ctx={session:{},signal:scope.signal,isCurrent:()=>true};
  const pending=operations['rewards.prepare'].run({lotteryId,allowPassword:true,signal:controller.signal},ctx);
  controller.abort();late.resolve({available:true,token:'late'});assert.equal((await pending).available,false);assert.equal(stops,1);
  assert.equal((await operations['rewards.prepare'].run({lotteryId,allowPassword:true},ctx)).available,true);
});
test('保存设置后的恢复通知会撤销正在准备的旧福袋请求',async()=>{
  const late=deferred();let signal;
  const f=fixture({transport:{prepare:async(_,options)=>{signal=options.signal;return late.promise;}}});try {
    const pending=f.step();for(let i=0;i<20&&!signal;i++)await new Promise(setImmediate);assert.ok(signal);
    f.runner.resume();assert.equal(signal.aborted,true);late.resolve({available:true,token:'old'});await pending;
    assert.equal(f.calls.filter(call=>call[0]==='commit').length,0);assert.equal(f.records.length,0);
  }finally{f.close();}
});
