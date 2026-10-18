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
