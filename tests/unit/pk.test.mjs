import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PKTracker, emptyPKState, observeRate, predictPK } from '../../src/pk/model.js';

test('PK tracker aggregates score, remaining time and transparent prediction', () => {
  let now = 1_000_000;
  const tracker = new PKTracker({ now: () => now });
  tracker.ingest({ type:'pk-start', battleId:'b1', roomId:'r1', anchorId:'a1', opponentId:'a2', anchorName:'己方', opponentName:'对方', remainingMs:120000, receivedAt:now });
  now += 15_000;
  tracker.ingest({ type:'pk-score', battleId:'b1', selfScore:1200, opponentScore:700, remainingMs:105000, receivedAt:now });
  now += 15_000;
  tracker.ingest({ type:'pk-score', battleId:'b1', selfScore:2000, opponentScore:1300, remainingMs:90000, receivedAt:now });
  const state = tracker.current();
  assert.equal(state.selfScore, 2000);
  assert.equal(state.opponentScore, 1300);
  assert.equal(state.phase, 'active');
  assert.ok(state.prediction.selfWin > state.prediction.opponentWin);
  assert.ok(state.selfVelocity60 > 0);
  assert.equal(state.opponentName, '对方');
});

test('active PK countdown advances between score events without mutating stored state', () => {
  let now = 100000;
  const tracker = new PKTracker({ now: () => now });
  tracker.ingest({ type:'pk-start', battleId:'clock', roomId:'r', remainingMs:60000, receivedAt:now });
  now += 5000;
  tracker.ingest({ type:'chat', battleId:'clock', roomId:'r', text:'加油', receivedAt:now });
  now += 7500;
  assert.equal(tracker.current().remainingMs, 47500);
  assert.equal(tracker.states.get('clock').remainingMs, 60000);
});

test('无 battleId 的精确比分更新并入当前房间战局且区分未观测的对方分数', () => {
  let now = 1800000000000;
  const tracker = new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',battleId:'live-battle',roomId:'room-1',receivedAt:now});
  now += 1000;
  const state = tracker.ingest({type:'pk-score',roomId:'room-1',selfScore:3210,receivedAt:now});
  assert.equal(state.key,'live-battle');
  assert.equal(state.selfScore,3210);
  assert.equal(state.selfScoreObserved,true);
  assert.equal(state.opponentScoreObserved,false);
  assert.equal(tracker.all().length,1);
});

test('PK tracker records contributor intent without equating level with payment', () => {
  let now = 1_000_000;
  const tracker = new PKTracker({ now: () => now });
  tracker.ingest({ type:'pk-start', battleId:'b2', roomId:'r2', remainingMs:60000, receivedAt:now });
  tracker.ingest({ type:'gift', battleId:'b2', side:'self', user:{id:'u1',name:'大哥',wealthLevel:50}, count:2, unitValue:100, receivedAt:now });
  now += 1000;
  const state = tracker.current();
  assert.equal(state.selfGiftValue, 200);
  assert.equal(state.selfUsers[0].wealthLevel, 50);
  assert.equal(state.selfIntent.sampleSize, 1);
  assert.equal(state.selfIntent.probability, 1);
});

test('prediction is unknown without observable score or gift evidence', () => {
  const state = emptyPKState('empty');
  assert.equal(predictPK(state).selfWin, null);
});

test('empirical multiplier/card rate uses bounded interval and remains unknown at zero samples', () => {
  assert.equal(observeRate(0, 0).rate, null);
  const result = observeRate(3, 10);
  assert.equal(result.rate, 0.3);
  assert.ok(result.low >= 0 && result.high <= 1 && result.low <= result.rate && result.rate <= result.high);
});

test('同一 tracker 隔离多个 battle，并恢复贡献者、弹幕和经验统计', () => {
  let now = 2_000_000;
  const tracker = new PKTracker({ now: () => now });
  tracker.ingest({ type:'pk-start', battleId:'battle-a', roomId:'room-a', opponentRoomIds:['room-b'], remainingMs:60000, receivedAt:now });
  tracker.ingest({ type:'pk-start', battleId:'battle-b', roomId:'room-c', opponentRoomIds:['room-d'], remainingMs:60000, receivedAt:now });
  tracker.ingest({ type:'pk-score', battleId:'battle-a', selfScore:100, opponentScore:80, receivedAt:now });
  tracker.ingest({ type:'pk-score', battleId:'battle-b', selfScore:10, opponentScore:20, receivedAt:now });
  tracker.ingest({ type:'chat', roomId:'room-b', text:'大哥上票，马上反超', receivedAt:now });
  tracker.ingest({ type:'gift', battleId:'battle-a', side:'opponent', user:{id:'u-a',name:'对面大哥',wealthLevel:50}, unitValue:200, count:2, receivedAt:now });
  tracker.ingest({ type:'pk-multiplier', success:true, receivedAt:now });
  tracker.ingest({ type:'pk-multiplier', success:false, receivedAt:now });
  tracker.ingest({ type:'pk-card', won:true, receivedAt:now });
  const battleA = tracker.all().find(item => item.key === 'battle-a');
  const battleB = tracker.all().find(item => item.key === 'battle-b');
  assert.equal(battleA.selfScore, 100);
  assert.equal(battleB.selfScore, 10);
  assert.equal(battleA.opponentUsers[0].value, 400);
  assert.equal(battleA.chatSignals.opponent.request, 1);
  assert.equal(battleA.chatSignals.opponent.comeback, 1);
  assert.equal(battleA.multiplierStats.rate, 0.5);
  assert.equal(battleA.cardStats.rate, 1);
  const restored = new PKTracker({ now: () => now });
  assert.equal(restored.restore(tracker.export()), true);
  assert.equal(restored.all().length, 2);
  assert.equal(restored.all().find(item => item.key === 'battle-a').chatSignals.opponent.total, 1);
  assert.equal(restored.all().find(item => item.key === 'battle-b').opponentUsers.length, 0);
});

test('多房间状态达到上限后清理最旧的非当前战局', () => {
  let now = 3_000_000;
  const tracker = new PKTracker({ now: () => now, maxBattles: 2 });
  tracker.ingest({ type: 'pk-start', battleId: 'old', roomId: 'old-room', remainingMs: 60000, receivedAt: now });
  now += 1000;
  tracker.ingest({ type: 'pk-end', battleId: 'old', selfScore: 1, opponentScore: 0, receivedAt: now });
  now += 1000;
  tracker.ingest({ type: 'pk-start', battleId: 'current', roomId: 'current-room', remainingMs: 60000, receivedAt: now });
  now += 1000;
  tracker.ingest({ type: 'pk-start', battleId: 'new', roomId: 'new-room', remainingMs: 60000, receivedAt: now });
  assert.equal(tracker.all().length, 2);
  assert.equal(tracker.all().some(item => item.key === 'current'), true);
  assert.equal(tracker.all().some(item => item.key === 'new'), true);
  assert.equal(tracker.all().some(item => item.key === 'old'), false);
});

test('结束战局不会永久占用当前状态配额', () => {
  let now = 4_000_000;
  const tracker = new PKTracker({ now: () => now, maxBattles: 1 });
  tracker.ingest({ type: 'pk-start', battleId: 'ended', roomId: 'ended-room', remainingMs: 60000, receivedAt: now });
  now += 1000;
  tracker.ingest({ type: 'pk-end', battleId: 'ended', selfScore: 1, opponentScore: 0, receivedAt: now });
  now += 1000;
  tracker.ingest({ type: 'pk-start', battleId: 'active', roomId: 'active-room', remainingMs: 60000, receivedAt: now });
  assert.deepEqual(tracker.all().map(item => item.key), ['active']);
});

test('中途收到比分即可显示当前 PK，按主播 UID 归属且首帧不虚增速度', () => {
  let now = 5_000_000;
  const tracker = new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-score',roomId:'r',anchorId:'self',scores:[{anchorId:'rival',score:600},{anchorId:'self',score:1200}],receivedAt:now});
  const first = tracker.current();
  assert.equal(first.phase, 'active');
  assert.equal(first.selfScore, 1200); assert.equal(first.opponentScore, 600);
  assert.equal(first.selfScoreObserved, true); assert.equal(first.opponentScoreObserved, true);
  assert.equal(first.opponentId, 'rival'); assert.equal(first.selfVelocity60, 0);
  now += 1000;
  tracker.ingest({type:'pk-score',roomId:'r',anchorId:'self',scores:[{anchorId:'self',score:1260},{anchorId:'rival',score:630}],receivedAt:now});
  assert.equal(tracker.current().selfVelocity60, 1);
  assert.equal(tracker.current().opponentVelocity60, .5);
});

test('比分临时战局补到真实 ID 后保留数据，重复开始不清空比分', () => {
  let now = 6_000_000;
  const tracker = new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-score',roomId:'r',anchorId:'self',scores:[{anchorId:'self',score:100},{anchorId:'rival',score:50}],receivedAt:now});
  now += 1000;
  const start = {type:'pk-start',battleId:'real-id',roomId:'r',startedAt:now-61000,endsAt:now+239000,participants:[{anchorId:'self',name:'主播',roomId:'r'},{anchorId:'rival',name:'对手',roomId:'opponent-room'}],receivedAt:now};
  tracker.ingest(start); tracker.ingest(start);
  assert.equal(tracker.all().length, 1);
  assert.equal(tracker.current().key, 'real-id');
  assert.equal(tracker.current().provisional, false);
  assert.equal(tracker.current().selfScore, 100); assert.equal(tracker.current().opponentScore, 50);
  assert.equal(tracker.current().selfScoreObserved, true); assert.equal(tracker.current().history.length, 1);
  assert.equal(tracker.current().opponentName, '对手');
  assert.deepEqual(tracker.current().opponentRoomIds, ['opponent-room']);
  assert.equal(tracker.current().remainingMs, 239000);
});

test('主播未知或多人比分无法确认对手时不按顺序猜测双方', () => {
  const tracker = new PKTracker({now:()=>7_000_000});
  tracker.ingest({type:'pk-start',battleId:'b',roomId:'r'});
  const scores = [{anchorId:'third',score:300},{anchorId:'self',score:100},{anchorId:'rival',score:200}];
  tracker.ingest({type:'pk-score',battleId:'b',scores});
  assert.equal(tracker.current().selfScoreObserved, false);
  tracker.ingest({type:'pk-score',battleId:'b',anchorId:'self',scores});
  assert.equal(tracker.current().selfScore, 100);
  assert.equal(tracker.current().opponentScoreObserved, false);
  assert.equal(tracker.current().prediction.status, 'unknown');
  tracker.ingest({type:'pk-end',battleId:'b'});
  assert.equal(tracker.results.length, 0);
});

test('主播可从参与者房间匹配，终局不重复结算且不被迟到比分复活', () => {
  const tracker = new PKTracker({now:()=>8_000_000});
  tracker.ingest({type:'pk-start',battleId:'b',roomId:'r',participants:[{anchorId:'self',roomId:'r'},{anchorId:'rival',roomId:'r2'}]});
  const end = {type:'pk-end',battleId:'b',roomId:'r',scores:[{anchorId:'rival',score:10},{anchorId:'self',score:20}]};
  tracker.ingest(end); tracker.ingest(end);
  tracker.ingest({type:'pk-score',battleId:'b',selfScore:1000});
  assert.equal(tracker.current().selfScore, 20);
  assert.equal(tracker.current().phase, 'ended'); assert.equal(tracker.current().remainingMs, 0);
  assert.equal(tracker.results.length, 1); assert.equal(tracker.results[0].winner, 'self');
  assert.ok(Number.isFinite(tracker.current().selfVelocity60));
});

test('无 ID 比分按房间并入已知战局，不串到最近打开的另一房间', () => {
  const tracker = new PKTracker({now:()=>9_000_000});
  tracker.ingest({type:'pk-start',battleId:'a',roomId:'r1'});
  tracker.ingest({type:'pk-start',battleId:'b',roomId:'r2'});
  tracker.ingest({type:'pk-score',roomId:'r1',selfScore:30,opponentScore:20});
  const battles = tracker.all();
  assert.equal(battles.length, 2);
  assert.equal(battles.find(state=>state.key==='a').selfScore, 30);
  assert.equal(battles.find(state=>state.key==='b').selfScoreObserved, false);
});

test('旧启发式比分快照升级后不污染预测样本，保留贡献者和人工概率记录', () => {
  const tracker = new PKTracker({now:()=>10_000_000});
  tracker.ingest({type:'pk-start',battleId:'legacy',roomId:'r',selfScore:12345,opponentScore:0});
  tracker.ingest({type:'gift',battleId:'legacy',user:{id:'u',name:'观众'},unitValue:10});
  tracker.ingest({type:'pk-end',battleId:'legacy'});
  tracker.ingest({type:'pk-card',won:true});
  const saved = {...tracker.export(),version:1};
  const restored = new PKTracker();
  assert.equal(restored.restore(saved), true);
  assert.equal(restored.current().phase, 'idle');
  assert.equal(restored.current().selfScoreObserved, false);
  assert.equal(restored.current().prediction.status, 'unknown');
  assert.equal(restored.results.length, 0);
  assert.equal(restored.current().selfUsers[0].value, 10);
  assert.equal(restored.current().cardStats.rate, 1);
  assert.equal(restored.export().version, 2);
});
