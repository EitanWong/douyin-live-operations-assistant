import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { decodeFrame } from '../../src/browser/protocol.js';
import { Engine, DEFAULTS, copy } from '../../src/core/engine.js';

const cat = (...parts) => Buffer.concat(parts.map(part => Buffer.from(part)));
const varint = value => { let remaining = BigInt(value); const bytes = []; while (remaining > 127n) { bytes.push(Number(remaining & 127n) | 128); remaining >>= 7n; } bytes.push(Number(remaining)); return Buffer.from(bytes); };
const i = (field, value) => cat(varint(field * 8), varint(value));
const b = (field, value) => { const bytes = Buffer.from(value); return cat(varint(field * 8 + 2), varint(bytes.length), bytes); };
const self = '9007199254740993123', rival = '9007199254740993124', room = '7777777777777777777';
const score = (id, value) => b(17, cat(i(1, value), b(21, id), b(7, String(value))));

test('gzip PK 推送到暂停的引擎仍更新正确比分和倒计时，重复推送只记一次', async () => {
  const now = 1800000000000, config = copy(DEFAULTS); config.anchorId = self;
  const engine = new Engine({config,now:()=>now,send:()=>assert.fail('PK 统计不得发送弹幕')});
  const common = cat(i(3, room), i(4, now / 1000));
  const message = (method, body, id) => b(1, cat(b(1, method), b(2, cat(b(1, common), body)), i(3, id)));
  const start = message('WebcastLinkMicBattleMethod', b(2, cat(i(2, 42), i(3, now-60000), i(4, 300))), 101);
  const update = message('WebcastLinkMicMethod', cat(i(104, 42), score(rival, 600), score(self, 1200)), 102);
  const events = await decodeFrame(cat(b(6, 'gzip'), b(7, 'msg'), b(8, gzipSync(cat(start, update, update)))));
  for (const event of events) engine.ingest(event);
  const current = engine.pk.current();
  assert.equal(engine.running, false);
  assert.equal(current.phase, 'active'); assert.equal(current.key, '42');
  assert.equal(current.selfScore, 1200); assert.equal(current.opponentScore, 600);
  assert.equal(current.remainingMs, 240000);
  assert.equal(current.history.length, 1); assert.equal(current.dataQuality.events, 2);
  assert.notEqual(current.prediction.selfWin, null);
  assert.equal(engine.queue.length, 0);
});
