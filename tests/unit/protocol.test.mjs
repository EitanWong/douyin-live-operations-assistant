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
test('礼物结构保留大额礼物单价与数量，不因 64 位礼物 ID 丢精度', () => {
  const gift = cat(i(5, 77), i(11, 2), i(12, 11999), b(16, '暮光恋人'));
  const e = decodeMessage('WebcastGiftMessage', cat(b(1, common), i(2, '9007199254740993123'), i(5, 1), b(7, user), i(11, 0), b(15, gift)), '1004');
  assert.equal(e.giftName, '暮光恋人'); assert.equal(e.unitValue, 11999); assert.equal(e.count, 1); assert.equal(e.final, true);
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
test('protobuf tag 在转换为 Number 前校验合法字段编号范围', () => {
  const maxFieldTag = (0x1fffffffn << 3n) | 0n;
  assert.equal(wire(Buffer.concat([varint(maxFieldTag), varint(1)])).get(0x1fffffff)[0], 1n);
  const tooLarge = (0x20000000n << 3n) | 0n;
  assert.throws(() => wire(varint(tooLarge)), /字段编号超出范围/);
});
test('非进场 Member action 被忽略，非下播 Control 不触发暂停', () => {
  assert.equal(decodeMessage('WebcastMemberMessage', cat(b(2, user), i(10, 5))), null);
  assert.equal(decodeMessage('WebcastControlMessage', i(2, 1)), null);
});

test('PK 单次热度更新不把 from_user_id 或 hot_score 当成累计比分', () => {
  const body = cat(
    b(1, common), i(2, 1), i(3, 1128), i(4, '7777777777777777777'),
    i(5, '9007199254740993999'), i(6, 3210), i(7, '9007199254740993888'),
    i(8, 3), i(9, 2), b(10, 'linker_3210_123'), i(11, 1791990000123)
  );
  assert.equal(decodeMessage('WebcastLinkmicPlayModeUpdateScoreMessage', body, '987'), null);
});

const score = (anchor, value, extra = Buffer.alloc(0)) => cat(i(2, anchor), ...(value === null ? [] : [i(1, value)]), extra);
const participant = (anchor, name, room) => cat(i(1, anchor), b(2, cat(b(1, cat(i(1, anchor), b(2, name))), b(13, room))));
test('LinkMicMethod 第 17 字段读取双方总分，保留 UID 精度且不以消息 ID 代替 battle_id', () => {
  const body = cat(b(1, common), b(17, score(12345, 65249, b(7, '65249'))), b(17, score(uid, 0)), i(104, '9007199254740993999'));
  const event = decodeMessage('WebcastLinkMicMethod', body, '987');
  assert.equal(event.type, 'pk-score');
  assert.equal(event.battleId, '9007199254740993999');
  assert.equal(event.roomId, '7777777777777777777');
  assert.deepEqual(event.scores, [{anchorId:'12345',score:65249}, {anchorId:uid,score:0}]);
  const noId = decodeMessage('WebcastLinkMicMethod', b(17, score(uid, 3210)), '999');
  assert.equal(noId.battleId, '');
  assert.equal(decodeMessage('WebcastLinkMicMethod', cat(body, b(114, 'battle-string'))).battleId, 'battle-string');
});
test('比分字段兼容纯数字显示文本、默认零和模糊展示，不猜测模糊文本或越界数值', () => {
  const event = decodeMessage('WebcastLinkMicMethod', cat(
    b(17, score(1, 1273262, b(7, '100万+'))),
    b(17, score(2, null, b(7, '65249'))),
    b(17, score(3, null)),
    b(17, score(4, null, b(7, '100万+'))),
    b(17, score(5, null, b(4, '领先46161'))),
    b(17, score(6, uid)),
    b(17, score(7, null, b(7, uid))),
    b(17, i(1, 30))
  ));
  assert.deepEqual(event.scores, [{anchorId:'1',score:1273262},{anchorId:'2',score:65249},{anchorId:'3',score:0}]);
});
test('PK 开始和结束按 settings、主播映射和 BattleScore 字段解码', () => {
  const settings = cat(i(2, '9007199254740993333'), i(3, 1800000000000), i(4, 300));
  const start = decodeMessage('WebcastLinkMicBattleMethod', cat(b(1, common), b(2, settings), b(6, participant(uid, '己方', 'room-1')), b(6, participant(12345, '对方', 'room-2'))));
  assert.equal(start.type, 'pk-start');
  assert.equal(start.battleId, '9007199254740993333');
  assert.equal(start.durationMs, 300000);
  assert.equal(start.endsAt, 1800000300000);
  assert.deepEqual(start.participants, [{anchorId:uid,name:'己方',roomId:'room-1'},{anchorId:'12345',name:'对方',roomId:'room-2'}]);
  const end = decodeMessage('WebcastLinkMicBattleFinishMethod', cat(b(2, settings),
    b(4, score(uid, 1273262, cat(i(11, 1), b(12, '100万+'), b(15, '100万+'), i(17, 1)))),
    b(4, score(12345, 65249, cat(i(11, 1), b(12, '65249'), b(15, '65249')))),
    b(12, participant(uid, '己方', 'room-1'))));
  assert.equal(end.type, 'pk-end');
  assert.deepEqual(end.scores, [{anchorId:uid,score:1273262},{anchorId:'12345',score:65249}]);
  assert.equal(end.participants[0].anchorId, uid);
});
test('普通连麦、贡献榜和未知 Battle 更新不能建立虚假 PK', () => {
  const body = cat(b(1, common), i(2, 1), i(3, 300), i(4, 10000));
  for (const method of ['WebcastLinkMicMethod','WebcastLinkMicArmies','WebcastBattleUpdateMessage','WebcastLinkMicBattleMethod']) assert.equal(decodeMessage(method, body), null);
});
test('同一 gzip 帧中的弹幕与累计 PK 比分都能解码', async () => {
  const response = cat(
    b(1, cat(b(1, 'WebcastChatMessage'), b(2, cat(b(1, common), b(2, user), b(3, '加油'))), i(3, 101))),
    b(1, cat(b(1, 'WebcastLinkMicMethod'), b(2, cat(b(1, common), b(17, score(uid, 3210)))), i(3, 102)))
  );
  const events = await decodeFrame(cat(b(6, 'gzip'), b(7, 'msg'), b(8, gzipSync(response))));
  assert.deepEqual(events.map(event => event.type), ['chat','pk-score']);
  assert.equal(events[1].scores[0].score, 3210);
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
