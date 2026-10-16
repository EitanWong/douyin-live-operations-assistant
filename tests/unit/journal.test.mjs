import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JournalCommitter, RuntimeWriter } from '../../src/runtime/journal.js';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('慢存储只保留一个正在写入及一个最新快照，检查点等待实际写入', async () => {
  const gate = deferred(), writes = [];
  const writer = new RuntimeWriter(async value => { writes.push(value); if (value === 0) await gate.promise; });
  const first = writer.save(0), waiters = [];
  for (let i = 1; i <= 1000; i++) waiters.push(writer.save(i));
  assert.deepEqual(writes, [0]);
  assert.equal(new Set(waiters).size, 1);
  assert.equal(writer.pending.value, 1000);
  let committed = false; void waiters[0].then(() => { committed = true; });
  await Promise.resolve(); assert.equal(committed, false);
  gate.resolve(); await Promise.all([first, ...waiters]);
  assert.deepEqual(writes, [0, 1000]); assert.equal(writer.pending, null);
});

test('快照写入失败会拒绝检查点，后续快照仍可继续保存', async () => {
  const writer = new RuntimeWriter(async value => { if (value === 1) throw new Error('disk'); });
  await assert.rejects(writer.save(1), /disk/);
  await writer.save(2); assert.equal(writer.running, false);
});

test('持续积压串行确认，每批最多50条；慢存储期间不堆积检查点', async () => {
  const gate = deferred(), batches = []; let checkpoints = 0;
  const committer = new JournalCommitter({ delay:60000, checkpoint:async () => { checkpoints++; if (checkpoints === 1) await gate.promise; }, ack:async keys => { batches.push(keys); } });
  try {
    for (let i = 0; i < 120; i++) committer.add(String(i));
    const flushing = committer.flush(); await Promise.resolve();
    for (let i = 120; i < 1200; i++) committer.add(String(i));
    assert.equal(committer.flush(), flushing); assert.equal(checkpoints, 1);
    assert.equal(committer.timer, null);
    gate.resolve(); await flushing;
    assert.equal(batches.length, 24);
    assert.ok(batches.every(keys => keys.length <= 50));
    assert.deepEqual(batches.flat(), Array.from({length:1200}, (_, i) => String(i)));
    assert.equal(committer.pending.size, 0);
  } finally { gate.resolve(); committer.pause(); }
});

test('快照失败及确认失败保留整批，积压超过100条仍可恢复', async () => {
  const batches = [], errors = []; let snapshotFail = true, ackFail = true;
  const committer = new JournalCommitter({ retryDelay:60000, checkpoint:async () => { if (snapshotFail) throw new Error('snapshot'); }, ack:async keys => { if (ackFail) throw new Error('ack'); batches.push(keys); }, onError:error => errors.push(error.message) });
  try {
    for (let i = 0; i < 230; i++) committer.add(String(i));
    await committer.flush(); assert.equal(committer.pending.size, 230); assert.equal(batches.length, 0);
    const retryTimer = committer.timer; committer.add('late');
    assert.equal(committer.timer, retryTimer, '新事件不能绕过失败退避');
    snapshotFail = false; await committer.flush(); assert.equal(committer.pending.size, 231);
    ackFail = false; await committer.flush();
    assert.deepEqual(errors, ['snapshot', 'ack']);
    assert.equal(committer.pending.size, 0); assert.equal(new Set(batches.flat()).size, 231);
    assert.ok(batches.every(keys => keys.length <= 50));
  } finally { committer.pause(); }
});

test('页面离开时不确认在途快照，返回后继续；重复待确认键只占一个位置', async () => {
  let active = true, acks = 0; const gate = deferred();
  const committer = new JournalCommitter({ active:() => active, checkpoint:() => gate.promise, ack:async () => { acks++; } });
  try {
    committer.add('one'); committer.add('one');
    assert.equal(committer.pending.size, 1);
    const flushing = committer.flush(); await Promise.resolve();
    active = false; committer.pause(); gate.resolve(); await flushing;
    assert.equal(acks, 0); assert.equal(committer.pending.size, 1); assert.equal(committer.timer, null);
    active = true; await committer.flush(); assert.equal(acks, 1); assert.equal(committer.pending.size, 0);
  } finally { gate.resolve(); committer.pause(); }
});
