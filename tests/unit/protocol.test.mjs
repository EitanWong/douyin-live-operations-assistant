import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { decodeFrame, decodeMessage, decodeUser, wire } from '../../src/browser/protocol.js';
const cat = (...v) => Buffer.concat(v.map(x => Buffer.from(x)));
const varint = input => { let v = BigInt(input); const out = []; while (v > 127n) { out.push(Number(v & 127n) | 128); v >>= 7n; } out.push(Number(v)); return Buffer.from(out); };
const i = (field, value) => cat(varint(field * 8), varint(value));
const b = (field, value) => { const data = Buffer.from(value); return cat(varint(field * 8 + 2), varint(data.length), data); };
const uid = '9007199254740993123';
const club = anchor => cat(b(1, '本房粉丝团'), i(2, 8), i(3, 1), i(6, anchor));
const user = cat(i(1, uid), b(3, '青山'), b(23, i(6, 35)), b(24, cat(b(1, club('1234567890')), b(2, cat(i(1, 99), b(2, club('12345')))))));
const common = cat(i(2, '9876543210123456789'), i(3, '7777777777777777777'), i(4, 1791990000));
test('UID 和房间 ID 保留全部 64 位精度，解析粉丝团 preferData', () => {
  const decoded = decodeUser(user); assert.equal(decoded.id, uid); assert.equal(decoded.wealthLevel, 35); assert.equal(decoded.fanClubs.length, 2); assert.equal(decoded.fanClubs[0].status, 1);
  const e = decodeMessage('WebcastChatMessage', cat(b(1, common), b(2, user), b(3, '直播真好看')));
  assert.equal(e.roomId, '7777777777777777777'); assert.equal(e.id, '9876543210123456789'); assert.equal(e.text, '直播真好看');
});
test('ChatMessage 字段 12 atUser 解析被 @ 用户 UID', () => {
  const e = decodeMessage('WebcastChatMessage', cat(b(1, common), b(2, user), b(3, '请看一下'), b(12, cat(i(1, '12345678901234567890'), b(3, '小助手')))));
  assert.equal(e.atUser.name, '小助手'); assert.deepEqual(e.mentions, ['12345678901234567890']);
});
test('缺失等级和粉丝团不猜测默认达标', () => { const u = decodeUser(cat(i(1, uid), b(3, '未知用户'))); assert.equal(u.wealthLevel, null); assert.deepEqual(u.fanClubs, []); });
test('礼物读取 diamondCount、repeatCount、groupId 与 repeatEnd', () => {
  const gift = cat(i(5, 77), i(10, 1), i(12, 50), b(16, '星星'));
  const e = decodeMessage('WebcastGiftMessage', cat(b(1, common), i(2, 77), i(5, 3), i(6, 3), b(7, user), i(9, 1), i(11, '1234567890123456789'), b(15, gift)));
  assert.equal(e.unitValue, 50); assert.equal(e.count, 3); assert.equal(e.groupId, '1234567890123456789'); assert.equal(e.final, true);
});
test('LikeMessage 读取点赞用户、单条点赞数和累计数', () => {
  const e = decodeMessage('WebcastLikeMessage', cat(b(1, common), i(2, 30), i(3, 900), b(5, user)));
  assert.equal(e.type, 'like'); assert.equal(e.user.id, uid); assert.equal(e.user.name, '青山');
  assert.equal(e.count, 30); assert.equal(e.total, 900);
});
test('gzip PushFrame 按协议正确解包，忽略未知消息类型', async () => {
  const chat = cat(b(1, common), b(2, user), b(3, '你好'));
  const message = cat(b(1, 'WebcastChatMessage'), b(2, chat), i(3, '1234567890123456789'));
  const response = cat(b(1, message), b(1, cat(b(1, 'WebcastUnknownMessage'), b(2, Buffer.from([0])))));
  const frame = cat(b(6, 'gzip'), b(7, 'msg'), b(8, gzipSync(response)));
  const events = await decodeFrame(frame); assert.equal(events.length, 1); assert.equal(events[0].text, '你好'); assert.equal(events[0].id, '1234567890123456789');
});
test('gzip 魔数可用于缺失 encoding 字段的帧', async () => {
  const response = b(1, cat(b(1, 'WebcastControlMessage'), b(2, cat(b(1, common), i(2, 3)))));
  const events = await decodeFrame(cat(b(7, 'msg'), b(8, gzipSync(response)))); assert.equal(events[0].type, 'end');
});
test('损坏帧明确报错、非二进制消息不参与解析', async () => {
  assert.throws(() => wire(Buffer.from([0]))); assert.throws(() => wire(Buffer.from([10, 5, 1]))); assert.throws(() => wire(Buffer.alloc(8 * 1024 * 1024 + 1)));
  assert.deepEqual(await decodeFrame('{"other":"business"}'), []);
});
test('非进场 Member action 被忽略，非下播 Control 不触发暂停', () => {
  assert.equal(decodeMessage('WebcastMemberMessage', cat(b(2, user), i(10, 5))), null);
  assert.equal(decodeMessage('WebcastControlMessage', i(2, 1)), null);
});

test('显式零 groupId 的独立礼物不共用连击组，GiftStruct 字段 11 正确判断连击', () => {
  const single = cat(i(5, 77), i(11, 2), i(12, 50), b(16, '星星'));
  const body = cat(i(2, 77), i(5, 1), b(7, user), i(11, 0), b(15, single));
  const a = decodeMessage('WebcastGiftMessage', body, '1001'), c = decodeMessage('WebcastGiftMessage', body, '1002');
  assert.equal(a.groupId, 'single:1001'); assert.notEqual(a.groupId, c.groupId); assert.equal(a.final, true);
  const combo = decodeMessage('WebcastGiftMessage', cat(i(5, 2), i(9, 0), i(11, 88), b(15, cat(i(10, 0), i(11, 1)))));
  assert.equal(combo.final, false); assert.equal(combo.groupId, '88');
  assert.equal(decodeMessage('WebcastGiftMessage', cat(i(44, 7), b(15, single)), '1003').count, 7);
});

test('同一帧一条损坏消息不影响前后礼物，并保留解析错误诊断', async () => {
  const good = id => b(1, cat(b(1, 'WebcastGiftMessage'), b(2, cat(i(5, 3), b(7, user))), i(3, id)));
  const bad = b(1, cat(b(1, 'WebcastChatMessage'), b(2, Buffer.from([10, 5, 1]))));
  const errors = [], events = await decodeFrame(b(8, cat(good(101), bad, good(102))), error => errors.push(error));
  assert.deepEqual(events.map(e => e.id), ['101', '102']); assert.equal(errors.length, 1);
});
