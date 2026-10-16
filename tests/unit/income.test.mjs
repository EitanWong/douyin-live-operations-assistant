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
