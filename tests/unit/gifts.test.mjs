import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GiftLedger } from '../../src/data/gifts.js';

const gift = (overrides = {}) => ({
  type: 'gift', roomId: 'room-1', giftId: 'gift-1', giftName: '星星', groupId: 'combo-1',
  user: { id: 'user-1' }, count: 1, unitValue: 50, final: false, ...overrides
});

test('连击按累计数量增量计值，重复帧不重复累计', () => {
  const ledger = new GiftLedger();
  ledger.observe(gift({ count: 1 }), 'room-1', 'uid:user-1');
  ledger.observe(gift({ count: 2 }), 'room-1', 'uid:user-1');
  ledger.observe(gift({ count: 2 }), 'room-1', 'uid:user-1');
  ledger.observe(gift({ count: 3, final: true }), 'room-1', 'uid:user-1');
  ledger.observe(gift({ count: 3, final: true }), 'room-1', 'uid:user-1');
  assert.deepEqual(ledger.snapshot(), { totalDiamonds: 150, unknownCount: 0, giftCount: 3 });
});

test('未知单价独立累计，后续拿到单价时从未知转为已知', () => {
  const ledger = new GiftLedger();
  ledger.observe(gift({ count: 2, unitValue: null }), 'room-1', 'uid:user-1');
  assert.deepEqual(ledger.snapshot(), { totalDiamonds: 0, unknownCount: 2, giftCount: 2 });
  ledger.observe(gift({ count: 3, unitValue: 10 }), 'room-1', 'uid:user-1');
  assert.deepEqual(ledger.snapshot(), { totalDiamonds: 30, unknownCount: 0, giftCount: 3 });
});

test('不同主播、房间或礼物连击组不会互相合并', () => {
  const ledger = new GiftLedger();
  ledger.observe(gift({ count: 2 }), 'room-1', 'uid:user-1');
  ledger.observe(gift({ count: 2 }), 'room-1', 'uid:user-2');
  ledger.observe(gift({ roomId: 'room-2', count: 2 }), 'room-2', 'uid:user-1');
  assert.deepEqual(ledger.snapshot(), { totalDiamonds: 300, unknownCount: 0, giftCount: 6 });
});

test('缺少用户资料时仍可按房间与礼物组统计金额', () => {
  const ledger = new GiftLedger();
  ledger.observe(gift({ user: undefined, count: 2 }), 'room-1', 'anonymous');
  assert.deepEqual(ledger.snapshot(), { totalDiamonds: 100, unknownCount: 0, giftCount: 2 });
});

test('恢复账本后保留每日统计、连击进度和已结束连击去重', () => {
  let now = Date.parse('2026-10-15T10:00:00Z');
  let ledger = new GiftLedger({now:()=>now});
  ledger.observe(gift({count:2}), '1', 'uid:1', 0.05);
  ledger = new GiftLedger({state:JSON.parse(JSON.stringify(ledger.serialize())),now:()=>now});
  ledger.observe(gift({count:3,final:true}), '1', 'uid:1', 0.05);
  ledger = new GiftLedger({state:JSON.parse(JSON.stringify(ledger.serialize())),now:()=>now});
  ledger.observe(gift({count:3,final:true}), '1', 'uid:1', 0.05);
  assert.deepEqual(ledger.summary('2026-10'),{totalDiamonds:150,unknownCount:0,giftCount:3,estimatedIncome:7.5});
  assert.equal(ledger.days.get('2026-10-15').giftCount,3);
});

test('跨北京时间零点与跨月连击按收到增量的日期记账，未知单价回填原日期', () => {
  let now = Date.parse('2026-10-31T15:59:59Z');
  const ledger = new GiftLedger({now:()=>now});
  ledger.observe(gift({count:2,unitValue:null}), '1', 'uid:1',0.05);
  now += 2000;
  ledger.observe(gift({count:3,unitValue:100}), '1', 'uid:1',0.04);
  ledger.observe(gift({count:4,unitValue:null,final:true}), '1', 'uid:1',0.04);
  assert.deepEqual(ledger.summary('2026-10'),{totalDiamonds:200,unknownCount:0,giftCount:2,estimatedIncome:10});
  assert.deepEqual(ledger.summary('2026-11'),{totalDiamonds:200,unknownCount:0,giftCount:2,estimatedIncome:8});
});

test('修改估算比例只影响之后的礼物，历史收入不随设置重算', () => {
  const ledger = new GiftLedger({now:()=>Date.parse('2026-10-15T10:00:00Z')});
  ledger.observe(gift({count:1,final:true,groupId:'a'}), '1','uid:1',0.05);
  ledger.observe(gift({count:1,final:true,groupId:'b'}), '1','uid:1',0.1);
  assert.equal(ledger.summary('2026-10').estimatedIncome,7.5);
});

test('协议缺失创建时间返回 0 时按采集日期记账，不写入 1970 年', () => {
  const ledger=new GiftLedger({now:()=>Date.parse('2026-10-15T10:00:00Z')});
  ledger.observe(gift({at:0,final:true}),'1','uid:1',0.05);
  assert.equal(ledger.days.has('1970-01-01'),false);
  assert.equal(ledger.days.get('2026-10-15').totalDiamonds,50);
});

test('实时礼物平台时间偏差超过十分钟时按捕获日期记收入', () => {
  const capturedAt = Date.parse('2026-10-18T04:00:00Z');
  const ledger = new GiftLedger({now:()=>capturedAt});
  ledger.observe(gift({giftName:'暮光恋人',count:1,unitValue:1999,final:true,at:capturedAt-30*60000,capturedAt,receivedAt:capturedAt}), '1', 'uid:1');
  assert.deepEqual(ledger.summary('2026-10-18'),{totalDiamonds:1999,unknownCount:0,giftCount:1,estimatedIncome:99.95});
  assert.equal(ledger.days.has('2026-10-17'),false);
});

test('结束通知先到时，后到的更大累计数只补增量，单价可在结束后补齐', () => {
  const ledger = new GiftLedger();
  ledger.observe(gift({count:2,unitValue:null,final:true}), '1', 'uid:1');
  const restarted = new GiftLedger({state:ledger.serialize()});
  restarted.observe(gift({count:5,unitValue:100}), '1', 'uid:1');
  restarted.observe(gift({count:3,unitValue:null,final:true}), '1', 'uid:1');
  restarted.observe(gift({count:5,unitValue:100,final:true}), '1', 'uid:1');
  assert.deepEqual(restarted.snapshot(), {totalDiamonds:500,unknownCount:0,giftCount:5});
});

test('高峰挤出活跃缓存的连击保留累计进度，不漏掉后续礼物也不重计', () => {
  const ledger = new GiftLedger({maxActive:1});
  ledger.observe(gift({groupId:'a',count:2}), '1', 'uid:1');
  ledger.observe(gift({groupId:'b',count:1}), '1', 'uid:1');
  ledger.observe(gift({groupId:'a',count:5,final:true}), '1', 'uid:1');
  ledger.observe(gift({groupId:'a',count:5,final:true}), '1', 'uid:1');
  assert.deepEqual(ledger.snapshot(), {totalDiamonds:300,unknownCount:0,giftCount:6});
});

test('旧版已结束去重数据升级后保留，新礼物仍记账', () => {
  const ledger = new GiftLedger(); ledger.observe(gift({final:true}), '1', 'uid:1');
  const state = ledger.serialize(); state.finalized[0][1] = true;
  const upgraded = new GiftLedger({state});
  assert.equal(upgraded.observe(gift({final:true}), '1', 'uid:1'), false);
  upgraded.observe(gift({groupId:'new',final:true}), '1', 'uid:1');
  assert.equal(upgraded.snapshot().giftCount, 2);
});
