import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGiveaway,enterGiveaway,drawGiveaway,parseGiveawayState} from '../../src/core/giveaway.js';
import {prepareGiveawayFeedback} from '../../src/core/giveaway-feedback.js';
import {Engine,copy,DEFAULTS} from '../../src/core/engine.js';

const config={prizes:[{name:'签名礼盒',count:1},{name:'纪念杯',count:2}],durationSec:360,chatEnabled:true,keyword:'参与抽奖',giftEnabled:true,gifts:'小心心',giftMin:1,feedbackEnabled:true};
const make=()=>createGiveaway(config,{id:'r',room:'123',now:1000});
const enter=(r,id)=>enterGiveaway(r,{type:'chat',text:'参与抽奖',at:2000,user:{id,name:`观众${id}`}},2000);

test('开始、合并报名与多奖品结果生成有界公屏消息，重复参与和重放不重复确认',()=>{
  let round=prepareGiveawayFeedback(make(),1000,50,{start:true});
  assert.match(round.feedback.map(row=>row.text).join(''),/抽奖开始.*参与抽奖/);
  assert.ok(round.feedback.some(row=>row.text.includes('发送弹幕：参与抽奖 即可参抽奖')));
  for(const id of ['1','2','3'])round=enter(round,id);
  round=prepareGiveawayFeedback(round,2000,50);
  const entries=round.feedback.filter(row=>row.kind==='entry');assert.equal(entries.length,1);
  assert.deepEqual(entries.flatMap(row=>row.userIds),['1','2','3']);assert.match(entries[0].text,/报名成功.*@观众1.*@观众2.*@观众3/);
  const repeated=prepareGiveawayFeedback(enter(round,'1'),2100,50);assert.deepEqual(repeated.feedback,round.feedback);
  round=prepareGiveawayFeedback(drawGiveaway(round,361000,()=>0),361000,50);
  const results=round.feedback.filter(row=>row.kind==='result').map(row=>row.text).join('');
  assert.match(results,/签名礼盒.*观众1/);assert.match(results,/纪念杯.*观众2.*观众3/);
  assert.ok(round.feedback.every(row=>[...row.text].length<=50));
  assert.deepEqual(prepareGiveawayFeedback(round,362000,50).feedback,round.feedback);
  assert.deepEqual(parseGiveawayState({version:2,rounds:[round]},'123').rounds[0].feedback,round.feedback);
});
test('开场可隐藏奖品，但开奖结果始终恭喜并点名播报奖品',()=>{
  let round=createGiveaway({...config,announcePrizeNames:false},{id:'hidden',room:'123',now:1000});
  round=prepareGiveawayFeedback(round,1000,50,{start:true});
  round=enter(round,'1');round=prepareGiveawayFeedback(drawGiveaway(round,361000,()=>0),361000,50);
  const start=round.feedback.filter(row=>row.kind==='start').map(row=>row.text).join('');
  assert.match(start,/抽奖开始/);assert.doesNotMatch(start,/签名礼盒|纪念杯/);
  const result=round.feedback.filter(row=>row.kind==='result').map(row=>row.text).join('');
  assert.match(result,/签名礼盒.*恭喜.*@观众1/);
  assert.equal(parseGiveawayState({version:2,rounds:[round]},'123').rounds[0].config.announcePrizeNames,false);
});
test('抽奖反馈优先请求管理员弹幕',async()=>{
  const f=sender();let channel;
  f.engine.send=async(text,current,hooks)=>{channel=hooks.channel;await hooks.beforeClick();return {submitted:true};};
  await f.engine.enqueueGiveaway(f.message('start','抽奖开始',{kind:'start'}));await f.engine.tick();
  assert.equal(channel,'admin');
});
test('短轮次合并开场信息，为报名确认与倒计时留出发送时段',async()=>{
  const f=sender();
  let round=createGiveaway({...config,prizes:[{name:'礼盒',count:2}],durationSec:12,giftEnabled:false},{id:'r',room:'123',now:1000});
  round=prepareGiveawayFeedback(round,1000,50,{start:true});
  const starts=round.feedback.filter(row=>row.kind==='start');
  assert.ok(starts.length<=2);assert.match(starts.map(row=>row.text).join(''),/12秒后开奖.*礼盒.*参与抽奖/);
  const handedOff=new Set();
  for(let now=1000;now<round.endsAt;now+=500){
    f.time(now);if(now===1500)round=enter(enter(round,'1'),'2');
    round=prepareGiveawayFeedback(round,now,50);
    for(const message of round.feedback){
      if(handedOff.has(message.id))continue;
      await f.engine.enqueueGiveaway({...message,key:`r:${message.id}`,roundId:'r',endsAt:round.endsAt});handedOff.add(message.id);
    }
    await f.engine.tick();
  }
  assert.match(f.sent.join(''),/报名成功.*@观众1.*@观众2/);
  assert.equal(f.sent.filter(text=>text.startsWith('抽奖剩余')).length,2);
});
test('关键节点只提醒一次，短轮次和后台恢复不补发过时节点',()=>{
  let round=make();
  for(const remaining of [300,60,30,10]){
    const now=round.endsAt-remaining*1000;round=prepareGiveawayFeedback(round,now,50);
    round=prepareGiveawayFeedback(round,now+250,50);
  }
  assert.deepEqual(round.feedback.filter(row=>row.kind==='countdown').map(row=>row.seconds),[300,60,30,10]);
  const restored=prepareGiveawayFeedback(make(),make().endsAt-22000,50);
  assert.equal(restored.feedback.filter(row=>row.kind==='countdown').length,0);
  const short=createGiveaway({...config,durationSec:30},{id:'short',room:'123',now:1000});
  assert.equal(prepareGiveawayFeedback(short,1000,50).feedback.length,0);
});
test('300秒抽奖全程分阶段提示剩余时间，越接近开奖反馈越密集且刷新不重复',()=>{
  let round=createGiveaway({...config,durationSec:300},{id:'five-minutes',room:'123',now:1000});
  round=prepareGiveawayFeedback(round,1000,50,{start:true});
  assert.match(round.feedback.find(row=>row.kind==='start').text,/300秒后开奖/);
  for(let now=1500;now<round.endsAt;now+=500){
    round=prepareGiveawayFeedback(round,now,50);
    round=parseGiveawayState({version:2,rounds:[round]},'123').rounds[0];
    assert.deepEqual(prepareGiveawayFeedback(round,now,50).feedback,round.feedback);
  }
  const countdowns=round.feedback.filter(row=>row.kind==='countdown');
  assert.deepEqual(countdowns.map(row=>row.seconds),[240,180,120,90,60,30,10,5]);
  assert.deepEqual(countdowns.map(row=>row.text),[240,180,120,90,60,30,10,5].map(seconds=>`抽奖剩余${seconds}秒`));
});
test('长于五分钟的轮次同样每分钟提示，短轮次只播报适用节点',()=>{
  for(const [durationSec,expected] of [[900,[840,780,720,660,600,540,480,420,360,300,240,180,120,90,60,30,10,5]],[100,[90,60,30,10,5]],[8,[5]],[5,[]]]){
    let round=createGiveaway({...config,durationSec},{id:`duration-${durationSec}`,room:'123',now:1000});
    for(let now=1000;now<round.endsAt;now+=1000)round=prepareGiveawayFeedback(round,now,50);
    assert.deepEqual(round.feedback.filter(row=>row.kind==='countdown').map(row=>row.seconds),expected);
    assert.deepEqual(parseGiveawayState({version:2,rounds:[round]},'123').rounds[0].feedback,round.feedback);
  }
});
test('定时回调延迟数秒仍及时播报当前余时，过期节点不追发且不能保存非法节点',()=>{
  let round=make(),now=round.endsAt-240000+3100;
  round=prepareGiveawayFeedback(round,now,50);
  const countdown=round.feedback.find(row=>row.kind==='countdown');
  assert.equal(countdown?.text,'抽奖剩余237秒');assert.equal(countdown.seconds,240);
  assert.equal(countdown.expiresAt,round.endsAt-235000);
  assert.deepEqual(prepareGiveawayFeedback(round,now+500,50).feedback,round.feedback);
  assert.equal(prepareGiveawayFeedback(make(),make().endsAt-235000,50).feedback.filter(row=>row.kind==='countdown').length,0);
  for(const seconds of [0,7,91,121,240.5,86460]){
    const corrupt=structuredClone(round);corrupt.feedback.find(row=>row.kind==='countdown').seconds=seconds;
    assert.throws(()=>parseGiveawayState({version:2,rounds:[corrupt]},'123'),/反馈/);
  }
  for(const status of ['drawn','cancelled']){
    assert.equal(prepareGiveawayFeedback({...round,status},round.endsAt-5000,50).feedback.filter(row=>row.kind==='countdown').length,1);
  }
});
test('全部消息支持最小长度、长昵称和长奖品，关闭反馈及旧记录不自动发弹幕',()=>{
  let round=createGiveaway({...config,prizes:[{name:'奖'.repeat(100),count:1}]},{id:'long',room:'123',now:1000});
  round=enterGiveaway(round,{type:'chat',text:'参与抽奖',user:{id:'1',name:'🦊'.repeat(100)}},2000);
  round=prepareGiveawayFeedback(round,2000,10,{start:true});round=prepareGiveawayFeedback(drawGiveaway(round,361000,()=>0),361000,10);
  assert.ok(round.feedback.every(row=>[...row.text].length<=10 && row.text.trim()));
  const old={...make(),config:{...make().config,feedbackEnabled:undefined},feedback:undefined};
  const parsed=parseGiveawayState({version:2,rounds:[old]},'123').rounds[0];
  assert.equal(parsed.config.feedbackEnabled,false);assert.equal(prepareGiveawayFeedback(parsed,1000,50,{start:true}).feedback.length,0);
  const corrupt=structuredClone(round);corrupt.feedback[0].queued='yes';assert.throws(()=>parseGiveawayState({version:2,rounds:[corrupt]},'123'),/反馈/);
});

function sender(mode='auto') {
  let time=1000,fail=false;const sent=[],logs=[];const c=copy(DEFAULTS);c.mode=mode;
  const engine=new Engine({config:c,now:()=>time,checkpoint:async()=>{if(fail)throw Error('写盘失败');},
    log:(kind,text)=>logs.push([kind,text]),send:async(text,current,hooks)=>{if(!current())return {submitted:false};await hooks.beforeClick();sent.push(text);return {submitted:true,clicked:true};}});
  const message=(id,text,extra={})=>({key:`r:${id}`,roundId:'r',kind:'entry',text,createdAt:time,expiresAt:20000,...extra});
  return {engine,sent,logs,message,time:value=>{time=value;},fail:value=>{fail=value;}};
}
test('场控未开始时只有抽奖消息可发送，独立限频且报名确认不被普通队列淘汰',async()=>{
  const f=sender();f.engine.config.sending.queueLimit=1;
  f.engine.enqueue('keyword','不应发送的关键词回复');
  await f.engine.enqueueGiveaway(f.message('1','报名成功：小雨'));await f.engine.enqueueGiveaway(f.message('2','报名成功：小林'));
  await f.engine.tick();assert.deepEqual(f.sent,['报名成功：小雨']);assert.equal(f.engine.running,false);
  await f.engine.tick();assert.equal(f.sent.length,1);f.time(3000);await f.engine.tick();assert.equal(f.sent.length,2);
  assert.ok(f.engine.queue.some(row=>row.kind==='keyword'));
});
test('消息收据持久化去重，刷新和重复交付不重复发送；存储失败不点击',async()=>{
  const f=sender(),message=f.message('1','报名成功：小雨');f.fail(true);
  await assert.rejects(f.engine.enqueueGiveaway(message),/写盘失败/);await f.engine.tick();assert.equal(f.sent.length,0);
  f.fail(false);await f.engine.enqueueGiveaway(message);f.time(3000);await f.engine.tick();assert.equal(f.sent.length,1);
  const restored=sender();restored.time(5000);restored.engine.restore(f.engine.snapshot());await restored.engine.enqueueGiveaway(message);await restored.engine.tick();assert.equal(restored.sent.length,0);
});
test('倒计时在出队时使用实际剩余秒数，过期不发送；预览仅显示消息',async()=>{
  const f=sender();await f.engine.enqueueGiveaway(f.message('c','抽奖剩余30秒',{kind:'countdown',endsAt:31000,expiresAt:3000}));
  f.time(2000);await f.engine.tick();assert.deepEqual(f.sent,['抽奖剩余29秒']);
  await f.engine.enqueueGiveaway(f.message('late','抽奖剩余10秒',{kind:'countdown',endsAt:12000,expiresAt:2500}));
  f.time(4000);await f.engine.tick();assert.equal(f.sent.length,1);
  const preview=sender('preview');await preview.engine.enqueueGiveaway(preview.message('p','抽奖报名成功'));await preview.engine.tick();assert.equal(preview.sent.length,0);assert.ok(preview.logs.some(([kind,text])=>kind==='preview' && text==='抽奖报名成功'));
});
test('其他页面已持久认领的消息不再点击，未认领的恢复任务即使队列丢失也能重新交付',async()=>{
  const f=sender();f.engine.claimGiveaway=async()=>false;
  await f.engine.enqueueGiveaway(f.message('claimed','报名成功：小雨'));await f.engine.tick();assert.equal(f.sent.length,0);assert.equal(f.engine.queue.length,0);
  const fresh=sender(),message=fresh.message('pending','报名成功：小林');await fresh.engine.enqueueGiveaway(message);
  const snapshot=fresh.engine.snapshot();snapshot.queue=[];
  const restored=sender();restored.engine.restore(snapshot);await restored.engine.enqueueGiveaway({...message,queued:true});await restored.engine.tick();assert.deepEqual(restored.sent,['报名成功：小林']);
});
test('已取消轮次的排队报名确认不再发送，取消通知仍可发送',async()=>{
  const f=sender();f.engine.giveawayCurrent=message=>message.kind==='cancelled';
  await f.engine.enqueueGiveaway(f.message('entry','报名成功：小雨'));await f.engine.enqueueGiveaway(f.message('cancel','本轮抽奖已取消',{kind:'cancelled'}));
  await f.engine.tick();assert.deepEqual(f.sent,['本轮抽奖已取消']);assert.equal(f.engine.queue.length,0);
});

test('主播必中与权重规则不进入公屏结果，奖品名称完整保留',()=>{
  const prize='限量签名纪念礼盒'.repeat(8);
  let round=createGiveaway({...config,prizes:[{name:prize,count:1}],anchorGuaranteed:true,weights:[{userId:'1',weight:2}]},{id:'private',room:'123',anchorId:'1',now:1000});
  round=prepareGiveawayFeedback(drawGiveaway(enter(round,'1'),361000,()=>0),361000,50);
  const result=round.feedback.filter(row=>row.kind==='result');
  assert.doesNotMatch(result.map(row=>row.text).join(''),/必中|权重|抽取规则/);
  assert.match(result.map(row=>row.text).join(''),/@观众1/);
  assert.ok(result.map(row=>row.text.replace(/^奖品：/, '')).join('').includes(prize));
  assert.ok(result.every(row=>[...row.text].length<=50));
});
test('每分钟主动提示全部参与方式，重复tick及刷新不重复，恢复只发当前提示',()=>{
  let round=make();
  assert.equal(prepareGiveawayFeedback(round,60000,50).feedback.length,0);
  round=prepareGiveawayFeedback(round,61000,50);
  const reminders=round.feedback.filter(row=>row.kind==='reminder');
  assert.match(reminders.map(row=>row.text).join(''),/抽奖进行中.*参与抽奖.*小心心.*1.*任一/);
  const restored=parseGiveawayState({version:2,rounds:[round]},'123').rounds[0];
  assert.deepEqual(prepareGiveawayFeedback(restored,62000,50).feedback,round.feedback);
  round=prepareGiveawayFeedback(restored,241000,50);
  assert.equal(new Set(round.feedback.filter(row=>row.kind==='reminder').map(row=>row.createdAt)).size,2);
  assert.ok(round.feedback.filter(row=>row.kind==='reminder').every(row=>row.expiresAt<=round.endsAt && [...row.text].length<=50));
  const ending=prepareGiveawayFeedback(round,352000,50);
  assert.equal(ending.feedback.filter(row=>row.kind==='reminder').length,round.feedback.filter(row=>row.kind==='reminder').length);
});
test('仅弹幕或仅礼物的提示准确且取消或开奖后不再招募',()=>{
  for(const chatEnabled of [true,false]) {
    let round=createGiveaway({...config,chatEnabled,giftEnabled:!chatEnabled},{id:'single',room:'123',now:1000});
    round=prepareGiveawayFeedback(round,61000,50);
    const messages=round.feedback.filter(row=>row.kind==='reminder').map(row=>row.text).join('');
    assert.match(messages,chatEnabled ? /参与抽奖/ : /小心心/);
    assert.doesNotMatch(messages,chatEnabled ? /小心心|任一/ : /发送弹幕|任一/);
    for(const status of ['drawn','cancelled'])assert.equal(prepareGiveawayFeedback({...round,status},121000,50).feedback.filter(row=>row.kind==='reminder').length,round.feedback.filter(row=>row.kind==='reminder').length);
  }
});
