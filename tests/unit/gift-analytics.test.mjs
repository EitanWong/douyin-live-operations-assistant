import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GiftLedger, GiftStore} from '../../src/data/gifts.js';
import {giftPeriodRange, summarizeGiftSessions, giftAnalyticsTrend} from '../../src/core/gift-analytics.js';
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

test('日周月季年按开播归属整场；同日两场分开，跨日不拆场',()=>{
  const sessions=['2025-12-31T23:00:00','2026-01-01T00:00:00','2026-09-30T23:00:00','2026-10-01T00:00:00','2026-10-19T00:00:00','2026-10-25T08:00:00','2026-10-25T11:00:00'].map((value,i)=>({id:String(i),startAt:at(value),endAt:i===6 ? 0 : at(value)+7200000,totalDiamonds:100,giftCount:1})).reverse();
  const income={allSessions:sessions,currentSession:sessions[0]}, report={battles:[]};
  for (const [period,count] of [['day',2],['week',3],['month',4],['quarter',4],['year',6],['all',7]]) {
    const selected=selectAnchorPeriod(report,period,income,'','2026-10-25',now);
    assert.equal(selected.gifts.sessions,count,period);assert.equal(selected.gifts.totalDiamonds,count*100);
  }
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
