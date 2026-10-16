// Local CPU/heap diagnostics, not browser rendering or live delivery measurements.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Engine, copy, DEFAULTS } from '../src/core/engine.js';
import { RuntimeWriter } from '../src/runtime/journal.js';
const config = copy(DEFAULTS); config.mode = 'preview'; config.gift.minValue = 1; config.gift.cooldownSec = 0;
let now = 1800000000000;
const engine = new Engine({config, now:() => now}); engine.start();
const queue = Array.from({length:5000}, (_, id) => ({id,kind:id % 3 ? 'gift' : 'bot',priority:id % 3 ? 100 : 90,created:now - id,expires:now + 45000,retryAt:id % 5 ? 0 : now + 60000}));
const referenceSelect = () => {
  const ready = queue.filter(job => engine.giftReady(job, now)).sort((a, b) => b.priority - a.priority || a.created - b.created || a.id - b.id);
  const oldest = jobs => jobs.sort((a,b) => a.created - b.created || a.id - b.id)[0];
  const gift = oldest(ready.filter(job => job.kind === 'gift'));
  const bot = oldest(ready.filter(job => job.kind === 'bot' && now - job.created >= 3000));
  if (!gift) return bot || ready[0] || null;
  if (bot && now - engine.lastGiftSend >= 1500 && now - gift.created < 5000) return bot;
  return gift;
};
assert.equal(engine.selectNextJob(queue, now), referenceSelect());
function measure(fn, iterations = 1000) {
  for (let i = 0; i < 100; i++) fn();
  const samples = [];
  for (let i = 0; i < iterations; i++) { const start = performance.now(); fn(); samples.push(performance.now() - start); }
  samples.sort((a,b) => a-b);
  return {medianMs:samples[Math.floor(samples.length / 2)],p95Ms:samples[Math.floor(samples.length * .95)]};
}
const selection = [];
for (let run = 0; run < 5; run++) {
  // Alternate measurement order to reduce warmup/order bias.
  const result = {};
  for (const name of run % 2 ? ['scan','reference'] : ['reference','scan']) result[name] = measure(name === 'scan' ? () => engine.selectNextJob(queue, now) : referenceSelect);
  selection.push(result);
}
let changes = 0; engine.changed = () => { changes++; };
for (let i = 0; i < 1000; i++) await engine.tick();
assert.equal(changes, 0);
const idleChangeCallbacks = changes;
globalThis.gc?.(); const heapBefore = process.memoryUsage().heapUsed;
const ingestStart = performance.now();
for (let i = 0; i < 1200; i++) engine.ingest({type:'gift',id:String(i),groupId:String(i),giftId:'rose',giftName:'玫瑰',count:1,unitValue:1,final:true,user:{id:String(i),name:`观众${i}`}});
const ingestMs = performance.now() - ingestStart;
await engine.tick(false);
const credited = [...engine.gifts.values()].reduce((sum, gift) => sum + gift.credited, 0);
assert.equal(credited, 1200);
globalThis.gc?.(); const pendingHeapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
const pendingSnapshotBytes = Buffer.byteLength(JSON.stringify(engine.snapshot()));
const drainStart = performance.now(); let ticks = 0;
while (engine.queue.length && ticks < 2000) { now += 250; await engine.tick(); ticks++; }
const drainCpuMs = performance.now() - drainStart;
assert.equal(engine.queue.length, 0);
now += 600001; await engine.tick(false);
const finalSnapshotBytes = Buffer.byteLength(JSON.stringify(engine.snapshot()));
let release; const gate = new Promise(resolve => { release = resolve; }); const writes = [];
const writer = new RuntimeWriter(async snapshot => { writes.push(snapshot); if (snapshot === 0) await gate; });
const first = writer.save(0), pending = [];
for (let i = 1; i <= 1000; i++) pending.push(writer.save(i));
release(); await Promise.all([first,...pending]); assert.deepEqual(writes,[0,1000]);
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,selection5000Jobs:selection,idleTicks:1000,idleChangeCallbacks,gifts:{events:1200,credited,ingestMs,drainCpuMs,simulatedSendTicks:ticks,pendingHeapDeltaBytes:globalThis.gc ? pendingHeapDeltaBytes : null,pendingSnapshotBytes,finalSnapshotBytes},slowStorage:{snapshotRequests:1001,actualWrites:writes.length}},null,2));
