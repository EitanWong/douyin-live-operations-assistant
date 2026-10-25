import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GiftStore} from '../../src/data/gifts.js';
const clone = value => JSON.parse(JSON.stringify(value));
function setup() {
  const values = {};
  const options = {get:async(key,fallback)=>values[key] === undefined ? fallback : clone(values[key]),set:async(key,value)=>{values[key]=clone(value);},all:async()=>clone(values),now:()=>Date.parse('2026-10-15T10:00:00Z')};
  return {values,options,store:new GiftStore(options)};
}
const record = (groupId='a', room='1') => ({room,userKey:'uid:9',rate:0.05,event:{type:'gift',roomId:'session-1',giftId:'gift-1',groupId,count:1,unitValue:100,final:true}});
test('待入账事实携带采集检查点，长时间存储故障后仍按原日期入账并去重',async()=>{
  const {store,options}=setup(),capturedAt=options.now();
  const gift=record();gift.event.at=capturedAt;gift.event.receivedAt=capturedAt;gift.capturedAt=capturedAt;
  const later=new GiftStore({...options,now:()=>capturedAt+2*86400000});
  await later.record(gift);await later.record(gift);
  assert.equal((await later.report('1','2026-10')).summary.totalDiamonds,100);
  assert.equal((await later.report('1','2026-10')).days[0].date,'2026-10-15');
});
test('多个标签页并发上报同一礼物只记一次，不同主播独立；重启后保留',async()=>{
  const {store,options}=setup();
  await Promise.all([store.record(record()),store.record(record()),store.record(record('b')),store.record(record('a','2'))]);
  const restarted = new GiftStore(options);
  await restarted.record(record());
  assert.equal((await restarted.report('1','2026-10')).summary.estimatedIncome,10);
  assert.equal((await restarted.report('2','2026-10')).summary.estimatedIncome,5);
  assert.equal((await restarted.report('1','2026-09')).summary.giftCount,0);
});
test('收入按开播与下播边界分场次；边界重复幂等，重启后继续新场次', async () => {
  const {store,options}=setup(), start=options.now(), end=start+3600000;
  let now=start; store.now=()=>now;
  await store.recordSession({room:'1',type:'start',at:start,source:'dom-observed'});
  await store.record(record('session-gift-1'));
  await store.recordSession({room:'1',type:'end',at:end,source:'platform'});
  await store.recordSession({room:'1',type:'end',at:end+1,source:'platform'});
  now=end+1000;
  const second=record('session-gift-2');second.event.roomId='session-2';
  await store.record(second);
  const report=await store.report('1','2026-10');
  assert.equal(report.sessions.length,2);
  assert.equal(report.sessions.find(session=>session.endAt).startSource,'dom-observed');
  assert.equal(report.sessions.find(session=>session.endAt).endAt,end);
  assert.equal(report.sessions.find(session=>!session.endAt).startSource,'first-observed');
  assert.equal(report.sessions.reduce((sum,session)=>sum+session.giftCount,0),2);
  const restarted=new GiftStore(options);
  await restarted.recordSession({room:'1',type:'end',at:end+3600000,source:'platform'});
  await restarted.recordSession({room:'1',type:'start',at:end+7200000,source:'dom-observed'});
  assert.equal((await restarted.report('1','2026-10')).sessions.length,3);
});
test('服务工作线程重启后从持久进度接续连击，不重复累计',async()=>{
  const {store,options}=setup(), first=record();first.event.final=false;first.event.count=2;
  await store.record(first);
  const restarted=new GiftStore(options),last=record();last.event.count=3;
  await restarted.record(last);
  assert.equal((await restarted.report('1','2026-10')).summary.totalDiamonds,300);
});
test('主播列表迁移旧配置，名称更新与多个主播隔离',async()=>{
  const {store,values}=setup();values['live-assistant:config:1']={anchorId:'101',gift:{minValue:50}};
  await store.profile({room:'1',name:'主播甲',anchorId:'101'});
  await store.profile({room:'2',name:'主播乙',anchorId:'202'});
  await store.profile({room:'1'});
  const profiles=await store.profiles();
  assert.equal(profiles.length,2);assert.equal(profiles.find(p=>p.room==='1').name,'主播甲');
  assert.equal(values['live-assistant:config:1'].gift.minValue,50);
});
test('写入失败必须报错；恢复后可重试且统计不重复',async()=>{
  const {store,options}=setup();let fail=true;
  store.set=async(...args)=>{if(fail)throw new Error('存储空间不足');return options.set(...args);};
  await assert.rejects(store.record(record()),/存储空间不足/);fail=false;
  await store.record(record());await store.record(record());
  assert.equal((await store.report('1','2026-10')).summary.giftCount,1);
});
test('月报按日期倒序，拒绝无效日期/比例并跳过历史补推',async()=>{
  const {store}=setup();
  const old=record();old.event.at=Date.parse('2026-10-01T00:00:00Z');
  assert.equal(await store.record(old),false);
  await assert.rejects(store.report('1','2026-13'),/日期/);
  await assert.rejects(store.record({...record(),rate:-1}),/数值/);
  assert.deepEqual((await store.report('1','2026-10')).days,[]);
});

test('在线贡献榜按日按UID去重，月报累加每日分数并展示月度唯一用户估值', async () => {
  const {store,options}=setup(),date='2026-10-15';
  await store.recordContribution({room:'1',date,userId:'uid:9',name:'同一用户',score:800});
  await store.recordContribution({room:'1',date,userId:'uid:9',name:'同一用户',score:1200});
  assert.equal(await store.recordContribution({room:'1',date,userId:'uid:9',name:'同一用户',score:1000}),false);
  await store.recordContribution({room:'1',date,userId:'uid:10',name:'另一用户',score:1000});
  await store.recordContribution({room:'1',date:'2026-10-16',userId:'uid:9',name:'同一用户',score:500});
  const report=await store.report('1','2026-10');
  assert.equal(report.calibration.users,2);
  assert.equal(report.calibration.score,2700);
  assert.equal(report.calibration.incomeEstimate,270);
  assert.equal(report.calibration.users,2);
  assert.equal(report.calibration.observations,3);
  assert.equal(report.days.find(day=>day.date===date).calibrationUsers,2);
  assert.equal(report.days.find(day=>day.date===date).calibratedIncomeEstimate,220);
  assert.equal(report.summary.estimatedIncome,0,'榜单参考不叠加到已采集礼物收入');
  const restarted=new GiftStore(options);
  assert.equal((await restarted.report('1','2026-10')).calibration.score,2700);
});

test('千票榜只提供下限时按1000分估值，后续精确观测可替换下限且不重复用户', async () => {
  const {store}=setup(),base={room:'1',date:'2026-10-15',userId:'uid:9',name:'榜单用户'};
  assert.equal(await store.recordContribution({...base,score:1000,scoreIsFloor:true}),true);
  assert.equal(await store.recordContribution({...base,score:1000,scoreIsFloor:true}),false);
  assert.equal(await store.recordContribution({...base,score:1800,scoreIsFloor:false}),true);
  const report=await store.report('1','2026-10');
  assert.equal(report.calibration.users,1);
  assert.equal(report.calibration.score,1800);
  assert.equal(report.calibration.hasFloor,false);
});

test('跨90天重启和新增榜单采样不删除历史收入与估值', async () => {
  const {store,options}=setup();
  await store.record(record());
  await store.recordContribution({room:'1',date:'2026-10-15',userId:'uid:9',name:'历史观众',score:1200});
  const before=await store.report('1','2026-10');
  const restarted=new GiftStore({...options,now:()=>Date.parse('2027-02-18T10:00:00Z')});
  await restarted.recordContribution({room:'1',date:'2027-02-18',userId:'uid:10',name:'新观众',score:1000});
  assert.deepEqual(await restarted.report('1','2026-10'),before);
  assert.equal((await restarted.report('1','2027-02')).calibration.incomeEstimate,100);
});

test('榜单观测拒绝昵称键和不可能的分数，房间隔离', async () => {
  const {store}=setup();
  await assert.rejects(store.recordContribution({room:'1',userId:'name:同名',score:1000}),/榜单校准数据无效/);
  await assert.rejects(store.recordContribution({room:'1',userId:'uid:9',score:1e10}),/榜单校准数据无效/);
  await store.recordContribution({room:'1',date:'2026-10-15',userId:'uid:9',score:1000});
  assert.equal((await store.report('2','2026-10')).calibration.users,0);
});

test('近一分钟服务端延迟的真实礼物仍入账；存储排队延迟不改变接收时间', async () => {
  const {store,options} = setup(); let now = options.now(); store.now = () => now;
  const delayed = record('delayed'); delayed.event.at = now - 45000;
  await store.record(delayed);
  let release, entered;
  const started = new Promise(resolve => {entered=resolve;});
  const block = store.transaction(() => new Promise(resolve => {release = resolve; entered();}));
  await started;
  const queued = record('queued'); queued.event.at = now;
  const result = store.record(queued);
  now += 11 * 60 * 1000; release(); await block;
  assert.equal(await result, true);
  assert.equal((await store.report('1','2026-10')).summary.giftCount, 2);
});

test('实时大礼物平台时间偏差超过十分钟时仍入账到捕获日', async () => {
  const {store,options}=setup(),capturedAt=options.now();
  const twilight=record('twilight-lover');
  twilight.event.giftName='暮光恋人'; twilight.event.count=1; twilight.event.unitValue=1999;
  twilight.event.at=capturedAt-30*60000; twilight.event.receivedAt=capturedAt;
  await store.record({...twilight,capturedAt});
  const report=await store.report('1','2026-10');
  assert.deepEqual(report.summary,{totalDiamonds:1999,unknownCount:0,giftCount:1,estimatedIncome:99.95});
  assert.equal(report.days[0].date,'2026-10-15');
});

test('无平台时间的恢复礼物跨月补记时沿用顶层采集检查点', async () => {
  const {options}=setup(),capturedAt=options.now();
  const later=new GiftStore({...options,now:()=>Date.parse('2026-11-18T00:00:00Z')});
  const item={...record('recovery-no-timestamp'),capturedAt};
  await later.record(item);await later.record(item);
  assert.equal((await later.report('1','2026-10')).summary.totalDiamonds,100);
  assert.equal((await later.report('1','2026-11')).summary.totalDiamonds,0);
});

test('跨午夜和跨月直播保持整场总额，月报按开播月份归属', async () => {
  const {store}=setup();let now=Date.parse('2026-10-31T15:59:00Z');store.now=()=>now;
  await store.recordSession({room:'1',type:'start',roomId:'broadcast-A',at:now});
  const gift=(id)=>({...record(id),event:{...record(id).event,roomId:'broadcast-A',receivedAt:now}});
  await store.record(gift('before-midnight'));
  now+=120000;
  await store.record(gift('after-midnight'));
  const october=await store.report('1','2026-10'),november=await store.report('1','2026-11');
  assert.equal(october.sessions.length,1);assert.equal(october.sessions[0].totalDiamonds,200);
  assert.equal(october.summary.totalDiamonds,200);assert.equal(november.summary.totalDiamonds,0);
  assert.equal(november.currentSession.totalDiamonds,200);
});

test('直播ID变化可识别漏掉的下播和重开，旧通知不关闭或重开新场次', async () => {
  const {store,options}=setup();let now=options.now();store.now=()=>now;
  await store.recordSession({room:'1',type:'start',roomId:'A',at:now});
  await store.record({...record('a'),event:{...record('a').event,roomId:'A'}});
  now+=3600000;
  await store.recordSession({room:'1',type:'start',roomId:'B',at:now-10000,observedAt:now});
  await store.record({...record('b'),event:{...record('b').event,roomId:'B'}});
  await store.recordSession({room:'1',type:'end',roomId:'A',at:now+1});
  await store.recordSession({room:'1',type:'start',roomId:'A',at:now-3600000,observedAt:now+2});
  const report=await store.report('1','2026-10');
  assert.equal(report.sessions.length,2);assert.equal(report.currentSession.roomId,'B');
  assert.equal(report.currentSession.endAt,0);assert.equal(report.currentSession.giftCount,1);
  assert.equal(report.sessions.find(item=>item.roomId==='A').giftCount,1);
});

test('故障后恢复的旧场次礼物和迟到连击仍回填原场次', async () => {
  const {store,options}=setup();let now=options.now();store.now=()=>now;const capturedAt=now;
  await store.recordSession({room:'1',type:'start',roomId:'A',at:now});
  await store.record({...record('combo'),event:{...record('combo').event,roomId:'A',count:1,unitValue:null}});
  now+=10000;await store.recordSession({room:'1',type:'end',roomId:'A',at:now});
  now+=10000;await store.recordSession({room:'1',type:'start',roomId:'B',at:now});
  await store.record({...record('retry'),capturedAt,event:{...record('retry').event,roomId:'A'}});
  await store.record({...record('combo'),event:{...record('combo').event,roomId:'A',count:3,unitValue:100}});
  const report=await store.report('1','2026-10');
  assert.equal(report.sessions.length,2);assert.equal(report.currentSession.giftCount,0);
  assert.equal(report.sessions.find(item=>item.roomId==='A').totalDiamonds,400);
});

test('场次汇总不依赖有界连击去重缓存；旧日账和新场次可以同时显示', async () => {
  const {GiftLedger}=await import('../../src/data/gifts.js');
  const {store,values,options}=setup(),at=options.now();
  const ledger=new GiftLedger({now:()=>at,maxFinalized:1,state:{version:1,days:[['2026-10-14',{totalDiamonds:50,giftCount:1,unknownCount:0,estimatedIncome:2.5}]],active:[],finalized:[]}});
  for(let i=0;i<5;i++)ledger.observe({...record(String(i)).event,roomId:'A'},'1','uid:9',0.05);
  values['live-assistant:income:1']=ledger.serialize();
  const report=await store.report('1','2026-10');
  assert.equal(report.sessions[0].giftCount,5);assert.equal(report.sessions[0].totalDiamonds,500);
  assert.equal(report.legacyDays[0].giftCount,1);assert.equal(report.summary.totalDiamonds,550);
});

test('刷新和后台重启沿用同一直播ID，并用平台时间补齐首次观测时间', async () => {
  const {store,options}=setup(),at=options.now();
  await store.record(record('first'));
  const restarted=new GiftStore(options);
  await restarted.recordSession({room:'1',type:'start',roomId:'session-1',at:at-3600000,observedAt:at,source:'platform'});
  await restarted.recordSession({room:'1',type:'start',roomId:'session-1',at:at-3600000,observedAt:at+1,source:'platform'});
  const report=await restarted.report('1','2026-10');
  assert.equal(report.sessions.length,1);assert.equal(report.currentSession.startAt,at-3600000);
  assert.equal(report.currentSession.giftCount,1);assert.equal(report.currentSession.startSource,'platform');
});


test('概览可读取跨月场次，月报默认只返回开播月份；场次数据不会借用日汇总', async()=>{
  const {store}=setup();let now=Date.parse('2026-09-30T15:00:00Z');store.now=()=>now;
  await store.recordSession({room:'1',type:'start',roomId:'September',at:now});
  await store.record({...record('sept'),event:{...record('sept').event,roomId:'September',receivedAt:now}});
  now+=7200000;await store.recordSession({room:'1',type:'end',roomId:'September',at:now});
  now+=3600000;await store.recordSession({room:'1',type:'start',roomId:'October',at:now});
  const monthly=await store.report('1','2026-10');
  assert.equal(monthly.sessions.length,1);assert.equal(monthly.sessions[0].giftCount,0);
  assert.equal(monthly.allSessions,undefined);
  const overview=await store.report('1','2026-10',{includeAllSessions:true});
  assert.equal(overview.allSessions.length,2);
  assert.equal(overview.allSessions[1].estimatedIncome,5);
  assert.equal(overview.currentSession.estimatedIncome,0);
});

test('平台补到真实时间可修正历史推定边界，不影响正在直播的新场次', async()=>{
  const {store,options}=setup();let now=options.now();store.now=()=>now;
  await store.recordSession({room:'1',type:'start',roomId:'A',at:now,source:'platform-observed'});
  now+=3600000;
  await store.recordSession({room:'1',type:'start',roomId:'B',at:now,source:'platform'});
  const actualStart=now-7200000,actualEnd=now-10000;
  await store.recordSession({room:'1',type:'end',roomId:'A',at:actualEnd,startAt:actualStart,observedAt:now,source:'platform'});
  const report=await store.report('1','2026-10');
  const old=report.sessions.find(row=>row.roomId==='A');
  assert.equal(old.startAt,actualStart);assert.equal(old.endAt,actualEnd);
  assert.equal(old.startSource,'platform');assert.equal(old.endSource,'platform');
  assert.equal(report.currentSession.roomId,'B');assert.equal(report.currentSession.endAt,0);
});

test('同场千票榜与用户榜按UID最高累计值补差，礼物前后到达与重启均不重复',async()=>{
  const {store,options}=setup(),capturedAt=options.now(),roomId='session-1';
  await store.recordSession({room:'1',type:'start',roomId,at:capturedAt});
  const sample={room:'1',capturedAt,roomId,rate:0.1,userId:'uid:9',name:'用户甲'};
  await store.record(record()); // ¥5 already captured
  await store.recordContribution({...sample,score:1000,scoreIsFloor:true});
  assert.equal(await store.recordContribution({...sample,score:1000,scoreIsFloor:true}),false);
  await store.recordContribution({...sample,score:1200});
  assert.equal(await store.recordContribution({...sample,score:1100}),false);
  let report=await store.report('1','2026-10');
  assert.equal(report.currentSession.estimatedIncome,120);
  assert.equal(report.currentSession.totalDiamonds,1200);
  assert.equal(report.currentSession.giftDiamonds,100);assert.equal(report.currentSession.calibrationDiamonds,1100);
  assert.equal(report.summary.giftIncome,5);assert.equal(report.summary.calibrationIncome,115);
  assert.equal(report.calibration.users,1);assert.equal(report.calibration.hasFloor,false);
  const restarted=new GiftStore(options);
  const recovered=record('recovered');recovered.event.count=23; // ¥115 fills the inferred gap
  await restarted.record(recovered);await restarted.record(recovered);
  report=await restarted.report('1','2026-10');
  assert.equal(report.currentSession.estimatedIncome,120);assert.equal(report.currentSession.calibrationIncome,0);
  assert.equal(report.currentSession.totalDiamonds,2400);assert.equal(report.currentSession.calibrationDiamonds,0);
  await restarted.record(record('new-gift'));
  assert.equal((await restarted.report('1','2026-10')).summary.estimatedIncome,125);
  await restarted.recordContribution({...sample,score:1250});
  assert.equal((await restarted.report('1','2026-10')).summary.estimatedIncome,125);
});

test('同名不同UID独立补差；未知礼物价格补齐后自动抵扣，匿名礼物保守避免重叠',async()=>{
  const {store,options}=setup(),capturedAt=options.now(),roomId='session-1';
  await store.recordSession({room:'1',type:'start',roomId,at:capturedAt});
  for(const userId of ['uid:9','uid:10']) await store.recordContribution({room:'1',roomId,capturedAt,userId,name:'同名',score:2000});
  const unknown=record('unknown');unknown.event.unitValue=null;unknown.event.count=20;
  await store.record(unknown);
  assert.equal((await store.report('1','2026-10')).summary.estimatedIncome,200);
  unknown.event.unitValue=100;
  await store.record(unknown);
  let report=await store.report('1','2026-10');
  assert.equal(report.summary.estimatedIncome,200);assert.equal(report.summary.calibrationIncome,100);
  assert.equal(report.summary.totalDiamonds,4000);assert.equal(report.summary.giftDiamonds,2000);assert.equal(report.summary.calibrationDiamonds,2000);
  await store.record({...record('anonymous'),userKey:'anonymous',event:{...record('anonymous').event,count:10}});
  report=await store.report('1','2026-10');
  assert.equal(report.summary.estimatedIncome,200);assert.equal(report.summary.calibrationIncome,50);
  assert.equal(report.summary.totalDiamonds,4000);assert.equal(report.summary.calibrationDiamonds,1000);
});

test('榜单跨日跨月仍属同场，同一UID重开后分开校准，离线与旧场残留不入新场',async()=>{
  const {store}=setup();let now=Date.parse('2026-10-31T15:59:00Z');store.now=()=>now;
  const sample=(roomId,score)=>({room:'1',roomId,capturedAt:now,rate:0.1,userId:'uid:9',score});
  assert.equal(await store.recordContribution(sample('A',1000)),false,'未识别场次不凭榜单造场');
  await store.recordSession({room:'1',type:'start',roomId:'A',at:now});
  await store.recordContribution(sample('A',1000));now+=120000;
  await store.recordContribution(sample('A',1200));
  assert.equal((await store.report('1','2026-10')).summary.estimatedIncome,120);
  assert.equal((await store.report('1','2026-11')).summary.estimatedIncome,0);
  await store.recordSession({room:'1',type:'end',roomId:'A',at:now});now+=1000;
  assert.equal(await store.recordContribution(sample('A',1500)),false);
  await store.recordSession({room:'1',type:'start',roomId:'B',at:now});
  await store.recordContribution(sample('B',1000));
  assert.equal(await store.recordContribution(sample('A',2000)),false);
  assert.equal((await store.report('1','2026-11')).summary.estimatedIncome,100);
});

test('新版用户累计脱离连击缓存，旧版历史未保留UID时不重复补足已记录金额',async()=>{
  const {store,options,values}=setup(),now=options.now();
  await store.record(record());
  const state=values['live-assistant:income:1'];state.active=[];state.finalized=[];
  await store.recordContribution({room:'1',roomId:'session-1',capturedAt:now,userId:'uid:9',score:200});
  assert.equal((await store.report('1','2026-10')).summary.estimatedIncome,10);
  const legacy=values['live-assistant:income:1'];
  delete legacy.sessions[0][1].giftUsers;legacy.version=3;
  await store.recordContribution({room:'1',roomId:'session-1',capturedAt:now,userId:'uid:10',score:100});
  assert.equal((await store.report('1','2026-10')).summary.estimatedIncome,15,'无法归属的旧礼物先抵扣榜单差额');
});

test('主播管理按UID合并多地址与旧配置，保留原账本；同名不同UID不合并',async()=>{
  const {store,values}=setup();
  values['live-assistant:config:1']={anchorId:'101'};
  values['live-assistant:profile:1']={room:1,name:'主播甲',anchorId:''};
  await store.profile({room:'2',anchorId:'101',name:'主播甲'});
  await store.profile({room:'3',anchorId:'202',name:'主播甲'});
  await store.profile({room:'02',anchorId:'101',name:'主播甲'});
  await store.record(record());
  const profiles=await store.profiles();
  assert.equal(profiles.length,2);
  assert.deepEqual(profiles.find(p=>p.anchorId==='101').rooms.sort(),['1','2']);
  assert.equal(profiles.find(p=>p.anchorId==='202').room,'3');
  assert.equal((await store.report('1','2026-10')).summary.estimatedIncome,5);
  assert.equal(values['live-assistant:config:1'].anchorId,'101');
});

test('榜单与礼物统一收入比例而非礼物面值；比例变化只作用新增分数',async()=>{
  const {store,options}=setup(),capturedAt=options.now();
  const gift=record('full');gift.event.count=10;
  await store.record(gift);
  const sample={room:'1',roomId:'session-1',capturedAt,userId:'uid:9',score:1000};
  await store.recordContribution(sample);
  assert.equal((await store.report('1','2026-10')).summary.estimatedIncome,50,'已收全1000钻时不再按100元面值补差');
  await store.recordContribution({...sample,score:1200,rate:0.03});
  await store.recordContribution({...sample,score:1200,rate:0.1});
  const report=await store.report('1','2026-10');
  assert.equal(report.summary.estimatedIncome,56);
  assert.equal(report.summary.totalDiamonds,1200,'钻石按礼物与榜单原始分值补差，不按当前人民币比例反推');
  assert.equal(report.summary.giftDiamonds,1000);assert.equal(report.summary.calibrationDiamonds,200);
});

test('无UID观众榜兜底抬高本场收入，重复行、多榜、榜单换人或消失不重复累计',async()=>{
  const {store,options}=setup(),capturedAt=options.now(),roomId='session-1';
  await store.record(record());
  const sample={room:'1',roomId,capturedAt,rate:0.05,rows:[
    {name:'LILAC',score:6297,source:'audience'},
    {name:'LILAC',score:6297,source:'audience'},
    {name:'用户甲',score:1001,source:'audience'},
    {name:'LILAC',score:1000,source:'thousand',scoreIsFloor:true}
  ]};
  assert.equal(await store.recordContributionSnapshot(sample),true);
  let report=await store.report('1','2026-10');
  assert.ok(Math.abs(report.summary.estimatedIncome-364.9)<1e-8);
  assert.equal(report.calibration.users,0);assert.equal(report.calibration.visibleUsers,2);
  assert.equal(report.summary.giftCount,1);assert.equal(report.summary.totalDiamonds,7298);
  assert.equal(report.summary.giftDiamonds,100);assert.equal(report.summary.calibrationDiamonds,7198);
  assert.equal(await store.recordContributionSnapshot(sample),false);
  await store.recordContributionSnapshot({...sample,rows:[{name:'改名后',score:6297}]});
  await store.recordContributionSnapshot({...sample,rows:[]});
  const restarted=new GiftStore(options);
  report=await restarted.report('1','2026-10');
  assert.ok(Math.abs(report.summary.estimatedIncome-364.9)<1e-8);
  assert.equal(report.currentSession.totalDiamonds,7298);assert.equal(report.sessions[0].totalDiamonds,7298);
  const late=record('late');late.event.count=7298;late.event.unitValue=1;
  await restarted.record(late);
  report=await restarted.report('1','2026-10');
  assert.ok(Math.abs(report.summary.estimatedIncome-369.9)<1e-8,'礼物补回后消耗整榜补差，不叠加整榜金额');
  assert.equal(report.summary.calibrationIncome,0);
  assert.equal(report.summary.totalDiamonds,7398);assert.equal(report.summary.calibrationDiamonds,0);
});

test('钻石按不同UID补差，逐用户累计在连击缓存清理和重启后仍保留',async()=>{
  const {store,options,values}=setup(),capturedAt=options.now();
  await store.record(record());
  const other=record('other');other.userKey='uid:10';other.event.count=10;
  await store.record(other);
  const saved=values['live-assistant:income:1'];saved.active=[];saved.finalized=[];
  const restarted=new GiftStore(options);
  const sample={room:'1',roomId:'session-1',capturedAt,userId:'uid:9',score:1000,rate:0.05};
  await restarted.recordContribution(sample);await restarted.recordContribution(sample);
  const report=await restarted.report('1','2026-10');
  assert.equal(report.summary.totalDiamonds,2000,'不能以其他用户的礼物抵扣已确认UID的榜单差额');
  assert.equal(report.summary.giftDiamonds,1100);assert.equal(report.summary.calibrationDiamonds,900);
  assert.equal(report.summary.estimatedIncome,100);assert.equal(report.summary.giftCount,11);
  assert.equal(values['live-assistant:income:1'].sessions[0][1].totalDiamonds,1100,'持久原始礼物总额不混入榜单估值');
});

test('v4旧账本恢复逐用户钻石，缺少历史连击时保守抵扣且不改变人民币',async()=>{
  for(const retained of [true,false]) {
    const {store,values,options}=setup(),capturedAt=options.now();
    await store.record(record());
    const state=values['live-assistant:income:1'];state.version=4;
    delete state.sessions[0][1].giftUserDiamonds;
    if(!retained){state.active=[];state.finalized=[];}
    const restarted=new GiftStore(options);
    await restarted.recordContribution({room:'1',roomId:'session-1',capturedAt,userId:'uid:9',score:1000,rate:0.05});
    let report=await restarted.report('1','2026-10');
    assert.equal(report.summary.totalDiamonds,1000);assert.equal(report.summary.calibrationDiamonds,900);
    assert.equal(report.summary.estimatedIncome,50);assert.equal(report.summary.giftCount,1);
    assert.equal(values['live-assistant:income:1'].version,5);
    report=await new GiftStore(options).report('1','2026-10');
    assert.equal(report.summary.totalDiamonds,1000);assert.equal(report.summary.estimatedIncome,50);
  }
});

test('收入比例为零时仍按榜单校准钻石，跨场不会合并面值',async()=>{
  const {store,options}=setup();let capturedAt=options.now();
  await store.record(record());
  await store.recordContribution({room:'1',roomId:'session-1',capturedAt,userId:'uid:9',score:1000,rate:0});
  let report=await store.report('1','2026-10');
  assert.equal(report.summary.totalDiamonds,1000);assert.equal(report.summary.estimatedIncome,5);
  capturedAt+=1000;store.now=()=>capturedAt;
  await store.recordSession({room:'1',type:'start',roomId:'session-2',at:capturedAt});
  await store.recordContribution({room:'1',roomId:'session-2',capturedAt,userId:'uid:9',score:2000,rate:0});
  report=await store.report('1','2026-10');
  assert.equal(report.summary.totalDiamonds,3000);assert.equal(report.currentSession.totalDiamonds,2000);
  assert.equal(report.summary.estimatedIncome,5);assert.equal(report.currentSession.estimatedIncome,0);
});

test('整榜与逐用户补差取较高下限；同UID跨榜更名、身份补齐不会重复算',async()=>{
  const {store,options}=setup(),capturedAt=options.now(),roomId='session-1';
  await store.record(record());
  const sample={room:'1',roomId,capturedAt,rows:[{name:'甲',score:2000},{name:'乙',score:1000}]};
  await store.recordContributionSnapshot(sample);
  assert.equal((await store.report('1','2026-10')).summary.estimatedIncome,150);
  await store.recordContributionSnapshot({...sample,rows:[
    {userId:'uid:9',name:'甲',score:2000},
    {userId:'uid:9',name:'甲的新昵称',score:2100,source:'thousand'},
    {name:'甲',score:2000}, {userId:'uid:10',name:'乙',score:1000}
  ]});
  const report=await store.report('1','2026-10');
  assert.equal(report.summary.estimatedIncome,155);
  assert.equal(report.calibration.users,2);
  assert.equal(report.calibration.unmatched,0);
});

test('整榜采样不能创建场次、跨场抬高或接受非法身份',async()=>{
  const {store,options}=setup(),capturedAt=options.now();
  const sample={room:'1',roomId:'session-1',capturedAt,rows:[{name:'甲',score:1000}]};
  assert.equal(await store.recordContributionSnapshot(sample),false);
  await store.record(record());
  await assert.rejects(store.recordContributionSnapshot({...sample,rows:[{name:'甲',userId:'name:甲',score:1000}]}),/榜单校准/);
  assert.equal(await store.recordContributionSnapshot({...sample,roomId:'different'}),false);
  await store.recordSession({room:'1',type:'end',roomId:'session-1',at:capturedAt});
  assert.equal(await store.recordContributionSnapshot({...sample,capturedAt:capturedAt+1}),false);
});
