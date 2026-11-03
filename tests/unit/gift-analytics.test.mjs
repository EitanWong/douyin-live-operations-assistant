import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GiftLedger, GiftStore} from '../../src/data/gifts.js';
import {giftPeriodRange, summarizeGiftSessions, giftAnalyticsTrend, currentGiftBroadcast, currentGiftBroadcastMessages} from '../../src/core/gift-analytics.js';
import {selectAnchorPeriod} from '../../src/ui/anchor-view-model.js';

const at=value=>Date.parse(`${value}+08:00`);
const now=at('2026-10-25T12:00:00');

test('北京时间自然周跨年、闰月、季度和年界独立于宿主时区，非法日期不被修正',()=>{
  const range=(period,date)=>{const row=giftPeriodRange(period,date);return [row.start,row.end];};
  assert.deepEqual(range('week','2027-01-01'),[at('2026-12-28T00:00:00'),at('2027-01-04T00:00:00')]);
  assert.deepEqual(range('month','2028-02-29'),[at('2028-02-01T00:00:00'),at('2028-03-01T00:00:00')]);
  assert.deepEqual(range('quarter','2026-10-25'),[at('2026-10-01T00:00:00'),at('2027-01-01T00:00:00')]);
  assert.deepEqual(range('year','2026-10-25'),[at('2026-01-01T00:00:00'),at('2027-01-01T00:00:00')]);
  assert.equal(giftPeriodRange('month','2026-02-30'),null);
});

test('日周月季年按开播归属整场；同日两场分开，跨日不拆场，选择不改变正在直播的播报',()=>{
  const sessions=['2025-12-31T23:00:00','2026-01-01T00:00:00','2026-09-30T23:00:00','2026-10-01T00:00:00','2026-10-19T00:00:00','2026-10-25T08:00:00','2026-10-25T11:00:00'].map((value,i)=>({id:String(i),startAt:at(value),endAt:i===6 ? 0 : at(value)+7200000,totalDiamonds:100,giftCount:1})).reverse();
  const income={allSessions:sessions,currentSession:sessions[0]}, report={battles:[]};
  for (const [period,count] of [['day',2],['week',3],['month',4],['quarter',4],['year',6],['all',7]]) {
    const selected=selectAnchorPeriod(report,period,income,'','2026-10-25',now);
    assert.equal(selected.gifts.sessions,count,period);assert.equal(selected.gifts.totalDiamonds,count*100);
  }
  income.currentSession.audience=[{userId:'uid:1',name:'本场观众',totalDiamonds:100}];
  const text=currentGiftBroadcast(income.currentSession);
  assert.match(text,/第1名：本场观众。/);assert.doesNotMatch(text,/钻|700|本场已统计|收到礼物/);
  assert.equal(currentGiftBroadcast({...income.currentSession,endAt:now}), '');
});

test('逐用户统计不依赖已淘汰连击，重启与补价去重；同名账号独立，每场只计一次',()=>{
  let time=now-3600000;
  let ledger=new GiftLedger({now:()=>time,maxFinalized:1});
  const gift=(id,userId,count,price,name='同名')=>({type:'gift',id,groupId:id,giftId:id,giftName:id,count,unitValue:price,final:true,receivedAt:time,user:{id:userId,name}});
  ledger.startSession(time,'platform','A');
  ledger.observe(gift('cheap','1',100,1),'1','uid:1');
  ledger.observe(gift('expensive','1',1,6000),'1','uid:1');
  ledger.observe(gift('unknown','2',2,null),'1','uid:2');
  ledger.observe(gift('unknown','2',2,10),'1','uid:2');
  ledger.observe(gift('unknown','2',2,10),'1','uid:2');
  ledger.endSession(time+60000,'platform','A');time+=120000;
  ledger.startSession(time,'platform','B');ledger.observe(gift('second','1',3,10),'1','uid:1');
  ledger=new GiftLedger({now:()=>time,state:ledger.serialize(),maxFinalized:1});
  const sessions=[...ledger.sessions.values()].map(row=>ledger.calibratedSession(row));
  const summary=summarizeGiftSessions(sessions,sessions,now);
  assert.equal(summary.audience.length,2);
  assert.equal(summary.audience[0].sessions,2);assert.equal(summary.audience[0].todaySessions,2);
  assert.equal(summary.audience[0].totalDiamonds,6130);assert.equal(summary.audience[0].giftCount,104);
  assert.equal(summary.audience[1].totalDiamonds,20);assert.equal(summary.audience[1].unknownCount,0);
  assert.equal(sessions[0].highestGift.unitValue,6000);assert.equal(sessions[1].highestGift.unitValue,10);
});

test('本场最高礼物比较单价，低价连送不取代，补价后并列保存且新场不继承',()=>{
  const ledger=new GiftLedger({now:()=>now});
  const gift=(id,count,unitValue)=>({id,groupId:id,giftId:id,giftName:id,count,unitValue,final:true,user:{id:'1',name:'甲'}});
  ledger.observe(gift('玫瑰',99999,1),'1','uid:1');
  ledger.observe(gift('城堡',1,3000),'1','uid:1');
  ledger.observe(gift('飞船',1,null),'1','uid:1');
  ledger.observe(gift('飞船',1,3000),'1','uid:1');
  const highest=ledger.calibratedSession(ledger.currentSession()).highestGift;
  assert.equal(highest.unitValue,3000);assert.equal(highest.tiedCount,2);
  assert.deepEqual(new Set(highest.gifts.map(row=>row.name)),new Set(['城堡','飞船']));
  ledger.endSession(now);ledger.startSession(now+1);
  assert.equal(ledger.calibratedSession(ledger.currentSession()).highestGift,null);
});

test('逐用户礼物与榜单取最高值，后到礼物吸收补差；未知单价和旧件数不伪造',()=>{
  const ledger=new GiftLedger({now:()=>now});
  ledger.startSession(now-1000,'platform','A');
  ledger.observeContribution({userId:'uid:1',name:'甲',score:1000,capturedAt:now,roomId:'A',rate:0.05});
  const event={id:'a',giftId:'a',count:5,unitValue:100,final:true,user:{id:'1',name:'甲'}};
  ledger.observe(event,'1','uid:1');
  let user=ledger.calibratedSession(ledger.currentSession()).audience[0];
  assert.equal(user.totalDiamonds,1000);assert.equal(user.calibrationDiamonds,500);
  ledger.observe({...event,count:10},'1','uid:1');
  user=ledger.calibratedSession(ledger.currentSession()).audience[0];
  assert.equal(user.totalDiamonds,1000);assert.equal(user.calibrationDiamonds,0);
  const old=ledger.serialize();old.version=5;delete old.sessions[0][1].giftAudience;
  const restored=new GiftLedger({state:old,now:()=>now}).calibratedSession(old.sessions[0][1]);
  assert.equal(restored.totalDiamonds,1000);
  const migrated=new GiftLedger({state:old,now:()=>now});
  assert.equal(migrated.calibratedSession(migrated.currentSession()).audience[0].countsPartial,true);
});

test('零场次日补零、季度按七日、年度按月，未来不生成观测点',()=>{
  const daily=giftAnalyticsTrend([],'month','2026-10-25',now);
  assert.equal(daily.length,25);assert.equal(daily[0].totalDiamonds,0);
  assert.equal(giftAnalyticsTrend([],'quarter','2026-10-25',now).length,4);
  assert.equal(giftAnalyticsTrend([],'year','2026-10-25',now).length,10);
  assert.deepEqual(giftAnalyticsTrend([],'day','2026-10-26',now),[]);
});

test('持久报表保存礼物名称与逐用户数据，不暴露内部计价映射且房间隔离',async()=>{
  const values=new Map(), store=new GiftStore({now:()=>now,get:async(key,fallback)=>structuredClone(values.get(key) ?? fallback),set:async(key,value)=>values.set(key,structuredClone(value))});
  await store.record({room:'1',userKey:'uid:1',rate:0.05,event:{type:'gift',id:'one',giftId:'9',giftName:'城堡',count:1,unitValue:3000,final:true,user:{id:'1',name:'观众甲'}}});
  const report=await store.report('1','2026-10',{includeAllSessions:true});
  assert.equal(report.currentSession.audience[0].name,'观众甲');
  assert.equal(report.currentSession.highestGift.gifts[0].name,'城堡');
  assert.equal(report.currentSession.pricedGifts,undefined);
  assert.equal((await store.report('2','2026-10')).sessions.length,0);
});

test('本场播报按贡献钻石取前三名，榜单补差不重复计入且历史大额不混入',()=>{
  const ledger=new GiftLedger({now:()=>now});
  const gift=(id,name,count)=>({id,groupId:id,giftId:'g',giftName:'星星',count,unitValue:1,final:true,user:{id,name}});
  ledger.startSession(now-10000,'platform','old');
  ledger.observe(gift('9','历史榜首',99999),'1','uid:9');ledger.endSession(now-5000);
  ledger.startSession(now-1000,'platform','current');
  for (const [id,name,count] of [['1','同名',100],['2','同名',200],['3','第三位观众',50],['4','第四位观众',10]]) ledger.observe(gift(id,name,count),'1',`uid:${id}`);
  for (const [id,score] of [['1',300],['3',250]]) ledger.observeContribution({userId:`uid:${id}`,name:'榜单昵称',score,capturedAt:now,roomId:'current',rate:0.05});
  const session=ledger.calibratedSession(ledger.currentSession()), before=structuredClone(session);
  const messages=currentGiftBroadcastMessages(session);
  assert.deepEqual(messages,['本场观众贡献榜第1名：同名。','本场观众贡献榜第2名：第三位观众。','本场观众贡献榜第3名：同名。','本场千票贡献榜人数：0 人。']);
  assert.doesNotMatch(messages.join(''),/钻|历史榜首|99,999|第四位观众|uid:/);
  assert.deepEqual(session,before,'排序不修改账本观众顺序');
  ledger.observe(gift('1','同名',300),'1','uid:1');
  assert.deepEqual(currentGiftBroadcastMessages(ledger.calibratedSession(ledger.currentSession())),messages);
});

test('本场观众不足三人按实际人数，空榜和缺失昵称保持明确，已下播不生成消息',()=>{
  const session={startAt:now,endAt:0,totalDiamonds:20,giftCount:2,audience:[]};
  assert.deepEqual(currentGiftBroadcastMessages(session),[]);
  session.audience=[{userId:'sec:a',name:'甲',totalDiamonds:10},{userId:'uid:2',name:'',totalDiamonds:10}];
  const messages=currentGiftBroadcastMessages(session);
  assert.equal(messages.length,3);assert.match(messages[0],/第1名：甲。/);assert.match(messages[1],/第2名：昵称未采集。/);
  assert.equal(messages[2],'本场千票贡献榜人数：0 人。');
  assert.doesNotMatch(messages.join(''),/第3名|sec:a|uid:2/);
  assert.deepEqual(currentGiftBroadcastMessages({...session,endAt:now}),[]);
  assert.deepEqual(currentGiftBroadcastMessages(null),[]);
});

test('本场播报按配置字数续报完整昵称，表情不拆编码，不播报钻石数量',()=>{
  const session={startAt:now,endAt:0,totalDiamonds:9999,giftCount:999,unknownCount:12,calibrationDiamonds:100,audience:
    [9999,2222,123].map((totalDiamonds,i)=>({userId:`uid:${i+1}`,name:'😄'.repeat(60),totalDiamonds}))};
  for (const limit of [10,20,50]) {
    const messages=currentGiftBroadcastMessages(session,limit);
    assert.ok(messages.every(text=>[...text].length<=limit && !/[\uD800-\uDFFF]/u.test(text)));
    for (let rank=1;rank<=3;rank++) {
      const ranks=messages.filter(text=>new RegExp(`^(?:本场观众贡献榜第${rank}名|榜${rank}(?:续\\d+)?)：`).test(text));
      assert.ok(ranks.length>1);
      assert.equal(ranks.map(text=>text.slice(text.indexOf('：')+1,-1)).join(''),'😄'.repeat(60));
    }
    assert.equal(new Set(messages).size,messages.length,'续报标签区分同名与重复片段，不被重复过滤');
    assert.doesNotMatch(messages.join(''),/钻|9999|9,999|2222|2,222|123|…|补差|件|单价|本场已统计|收到礼物/);
    assert.match(messages.at(-1),/人数：2 ?人/);
  }
});

test('本场千票贡献榜人数统计全榜，1000计入、999不计，同名账号分别计数且重复UID不重复',()=>{
  const session={endAt:0,audience:[
    ...[4000,3000,2000,1001,1000,999].map((totalDiamonds,i)=>({userId:`uid:${i+1}`,name:'同名',totalDiamonds})),
    {userId:'uid:5',name:'重复记录',totalDiamonds:1200},
    {userId:'sec:known',name:'仅安全UID',totalDiamonds:1000},
    {userId:'name:unknown',name:'无账号',totalDiamonds:9000},
    {userId:'uid:8',name:'未知单价',totalDiamonds:0,unknownCount:3},
    {userId:'uid:9',name:'无效数据',totalDiamonds:NaN}
  ]};
  const messages=currentGiftBroadcastMessages(session);
  assert.equal(messages.length,4);
  assert.equal(messages[3],'本场千票贡献榜人数：6 人。');
  assert.doesNotMatch(messages.join(''),/重复记录|无账号|未知单价|无效数据|第4名|9,000/);
});
