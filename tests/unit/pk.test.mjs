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
  tracker.ingest({type:'gift',battleId:'legacy',side:'self',user:{id:'u',name:'观众'},unitValue:10});
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

test('两侧比分独立计时，弹幕和礼物不刷新比分或提高预测可信度', () => {
  let now = 11_000_000;
  const tracker = new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',battleId:'fresh',roomId:'self-room',selfScore:100,opponentScore:80,remainingMs:120000});
  const initial = tracker.current().prediction.confidence;
  now += 20000;
  tracker.ingest({type:'pk-score',battleId:'fresh',selfScore:200});
  for (let index=0; index<30; index++) tracker.ingest({type:'chat',battleId:'fresh',text:'加油上分'});
  const snapshot = tracker.current();
  assert.equal(snapshot.dataQuality.selfScoreAgeMs,0);
  assert.equal(snapshot.dataQuality.opponentScoreAgeMs,20000);
  assert.equal(snapshot.dataQuality.scoreAgeMs,20000);
  assert.equal(snapshot.dataQuality.stale,true);
  assert.equal(snapshot.dataQuality.scoreSamples,2);
  assert.ok(snapshot.prediction.confidence < initial);
  now += 41000;
  tracker.ingest({type:'chat',battleId:'fresh',text:'继续加油'});
  assert.equal(tracker.current().prediction.status,'unknown');
});

test('速度随 snapshot 时钟衰减，冻结比分不能永久贡献速度', () => {
  let now = 12_000_000;
  const tracker = new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',battleId:'speed',selfScore:0,opponentScore:0,remainingMs:120000});
  now += 5000;
  tracker.ingest({type:'pk-score',battleId:'speed',selfScore:120,opponentScore:60});
  assert.equal(tracker.current().selfSpeed,8);
  assert.equal(tracker.current().opponentVelocity60,1);
  now += 15000;
  assert.equal(tracker.current().selfSpeed,0);
  assert.equal(tracker.current().selfVelocity60,2);
  now += 45000;
  assert.equal(tracker.current().selfVelocity60,0);
});

test('重复消息、乱序消息与较新降分不回滚官方比分或重复累计速度', () => {
  let now = 13_000_000;
  const tracker = new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-score',battleId:'ordered',selfScore:100,opponentScore:50,at:now});
  now += 1000;
  tracker.ingest({type:'pk-score',id:'delta',battleId:'ordered',selfScore:160,opponentScore:80,at:now});
  now += 1000;
  tracker.ingest({type:'pk-score',id:'delta',battleId:'ordered',selfScore:220,opponentScore:100,at:now});
  tracker.ingest({type:'pk-score',battleId:'ordered',selfScore:140,opponentScore:70,at:now-1500});
  tracker.ingest({type:'pk-score',battleId:'ordered',selfScore:0,opponentScore:0,at:now});
  const snapshot = tracker.current();
  assert.equal(snapshot.selfScore,160); assert.equal(snapshot.opponentScore,80);
  assert.equal(snapshot.selfVelocity60,1); assert.equal(snapshot.opponentVelocity60,.5);
  assert.equal(snapshot.dataQuality.scoreSamples,2);
  assert.equal(snapshot.dataQuality.selfScoreAgeMs,1000);
  assert.equal(snapshot.dataQuality.rejectedScoreEvents,4);
});

test('新时间的同值比分可证明比分仍然新鲜且不制造增量', () => {
  let now=14_000_000;
  const tracker=new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-score',battleId:'same',selfScore:10,opponentScore:0});
  now+=20000;
  tracker.ingest({type:'pk-score',battleId:'same',selfScore:10,opponentScore:0});
  assert.equal(tracker.current().dataQuality.scoreAgeMs,0);
  assert.equal(tracker.current().selfVelocity60,0);
});

test('连击按累计数量计算增量，按目标主播归属且不更改官方 PK 分数', () => {
  let now=15_000_000;
  const tracker=new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',battleId:'gifts',roomId:'r1',anchorId:'a1',opponentId:'a2',opponentRoomIds:['r2'],selfScore:10,opponentScore:20});
  const gift={type:'gift',battleId:'gifts',roomId:'r1',anchorId:'a2',user:{id:'u1',name:'观众'},giftId:'rose',groupId:'combo',unitValue:10,scoreContribution:100};
  tracker.ingest({...gift,count:1}); tracker.ingest({...gift,count:3}); tracker.ingest({...gift,count:3,final:true}); tracker.ingest({...gift,count:2});
  tracker.ingest({...gift,groupId:'unknown',anchorId:'another',count:1});
  const snapshot=tracker.current();
  assert.equal(snapshot.anchorId,'a1'); assert.equal(snapshot.roomId,'r1');
  assert.equal(snapshot.opponentGifts,3); assert.equal(snapshot.opponentGiftValue,30);
  assert.equal(snapshot.opponentUsers[0].gifts,3);
  assert.equal(snapshot.selfGiftValue,0); assert.equal(snapshot.selfScore,10); assert.equal(snapshot.opponentScore,20);
  assert.equal(snapshot.dataQuality.unassignedGifts,1);
  const restored=new PKTracker({now:()=>now}); restored.restore(tracker.export());
  restored.ingest({...gift,count:3,final:true});
  assert.equal(restored.current().opponentGifts,3);
});

test('贡献榜保留真实贡献、排名和观测时间，礼物金额独立', () => {
  let now=16_000_000;
  const tracker=new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',battleId:'ranks',roomId:'r1',anchorId:'a1',opponentId:'a2',remainingMs:60000});
  tracker.ingest({type:'gift',battleId:'ranks',side:'self',user:{id:'u1',name:'观众'},count:2,unitValue:50});
  tracker.ingest({type:'pk-contribution',battleId:'ranks',anchorId:'a1',contributors:[{user:{id:'u1',name:'贡献者'},score:800,rank:1}],scores:[{anchorId:'a1',score:1000},{anchorId:'a2',score:1500}]});
  tracker.ingest({type:'pk-contribution',battleId:'ranks',anchorId:'a2',contributors:[{user:{id:'u2',name:'对面贡献者'},score:1200,rank:1}]});
  const snapshot=tracker.current();
  assert.equal(snapshot.selfUsers[0].value,100); assert.equal(snapshot.selfUsers[0].score,800); assert.equal(snapshot.selfUsers[0].rank,1);
  assert.equal(snapshot.selfUsers[0].name,'贡献者'); assert.equal(snapshot.opponentUsers[0].score,1200);
  assert.equal(snapshot.selfScore,1000); assert.equal(snapshot.opponentScore,1500);
  assert.equal(snapshot.anchorId,'a1');
  assert.equal(snapshot.analysis.requiredRate,501/60);
});

test('明确倍率窗口作为事实呈现且不自动变为触发概率', () => {
  let now=17_000_000;
  const tracker=new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',battleId:'effects',anchorId:'a1',opponentId:'a2'});
  const effect={type:'pk-effect',id:'window',battleId:'effects',effectType:'multiplier',anchorId:'a2',multiplier:2,startAt:now,endAt:now+10000};
  tracker.ingest(effect); tracker.ingest(effect);
  assert.equal(tracker.current().effects.length,1);
  assert.equal(tracker.current().effects[0].side,'opponent'); assert.equal(tracker.current().effects[0].active,true);
  assert.equal(tracker.current().multiplierStats.rate,null);
  now+=10001; assert.equal(tracker.current().effects[0].active,false);
});

test('概率对称无己方偏置且归一化，终局胜负与平局确定', () => {
  let now=18_000_000;
  const tracker=new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',battleId:'tie',selfScore:100,opponentScore:100,remainingMs:60000});
  const tied=tracker.current().prediction;
  assert.equal(tied.selfWin,tied.opponentWin);
  assert.ok(Math.abs(tied.selfWin+tied.opponentWin+tied.draw-1)<1e-12);
  tracker.ingest({type:'pk-end',battleId:'tie'});
  assert.deepEqual([tracker.current().prediction.selfWin,tracker.current().prediction.opponentWin,tracker.current().prediction.draw],[0,0,1]);
  tracker.ingest({type:'pk-start',battleId:'win',selfScore:200,opponentScore:100,remainingMs:60000});
  const win=tracker.current().prediction;
  tracker.ingest({type:'pk-start',battleId:'lose',selfScore:100,opponentScore:200,remainingMs:60000});
  assert.ok(Math.abs(win.selfWin-tracker.current().prediction.opponentWin)<1e-12);
  tracker.ingest({type:'pk-end',battleId:'lose'});
  assert.deepEqual([tracker.current().prediction.selfWin,tracker.current().prediction.opponentWin,tracker.current().prediction.draw],[0,1,0]);
});

test('未知剩余时间降低可信度，趋势分析解释可能反转及反超分速', () => {
  let now=19_000_000;
  const tracker=new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',battleId:'trend',selfScore:100,opponentScore:1000,remainingMs:60000});
  now+=1000;
  tracker.ingest({type:'pk-score',battleId:'trend',selfScore:1000,opponentScore:1100});
  const snapshot=tracker.current();
  assert.equal(snapshot.analysis.lead,'opponent'); assert.ok(snapshot.analysis.projectedGap>0);
  assert.ok(snapshot.analysis.catchUpSeconds>0); assert.equal(snapshot.analysis.volatileLead,true);
  assert.ok(snapshot.analysis.risks.some(risk=>risk.includes('反转')));
  tracker.ingest({type:'pk-start',battleId:'no-clock',selfScore:1000,opponentScore:1100});
  assert.equal(tracker.current().analysis.projectedGap,null);
  assert.ok(tracker.current().prediction.confidence<snapshot.prediction.confidence);
});

test('恢复倒计时以导出时刻为基准，不重复扣除已过去时间', () => {
  let now=20_000_000;
  const tracker=new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',battleId:'restore-clock',selfScore:1,opponentScore:2,remainingMs:60000});
  now+=10000;
  const saved=tracker.export();
  now+=5000;
  const restored=new PKTracker({now:()=>now}); restored.restore(saved);
  assert.equal(restored.current().remainingMs,45000);
  assert.equal(restored.current().dataQuality.scoreAgeMs,15000);
  const again=new PKTracker({now:()=>now}); again.restore(restored.export());
  assert.equal(again.current().remainingMs,45000);
});

test('无战局 ID 的对面礼物按房间归属，多场时不接收无归属比分', () => {
  const tracker=new PKTracker({now:()=>21_000_000});
  tracker.ingest({type:'pk-start',battleId:'first',roomId:'r1',opponentRoomIds:['r2']});
  tracker.ingest({type:'pk-start',battleId:'second',roomId:'r3',opponentRoomIds:['r4']});
  tracker.ingest({type:'gift',roomId:'r2',user:{id:'u'},count:1,unitValue:100});
  tracker.ingest({type:'pk-score',selfScore:99999,opponentScore:0});
  assert.equal(tracker.all().length,2);
  assert.equal(tracker.snapshot('first').opponentGiftValue,100);
  assert.equal(tracker.snapshot('first').roomId,'r1');
  assert.equal(tracker.snapshot('second').selfScoreObserved,false);
});

test('无比分的协议时钟仍同步倒计时，未核实的倍率比例保留原值', () => {
  let now=22_000_000;
  const tracker=new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',battleId:'clock-only',anchorId:'a1',opponentId:'a2'});
  tracker.ingest({type:'pk-score',battleId:'clock-only',scores:[],endsAt:now+30000,at:0});
  assert.equal(tracker.current().remainingMs,30000);
  assert.equal(tracker.current().selfScoreObserved,false);
  tracker.ingest({type:'pk-score',battleId:'clock-only',at:0,scores:[{anchorId:'a1',score:100,contributorCount:12,buffScoreRatio:150,scoreVersion:'8'}]});
  assert.equal(tracker.current().dataQuality.selfScoreAgeMs,0);
  assert.deepEqual(tracker.current().selfScoreMeta,{scoreVersion:'8',contributorCount:12,buffScoreRatio:150});
  tracker.ingest({type:'pk-end',battleId:'clock-only'});
  tracker.ingest({type:'pk-score',battleId:'clock-only',endsAt:now+60000});
  assert.equal(tracker.current().remainingMs,0);
});

test('先收到未知主播的贡献榜可暂存，身份确认后再归属且静态榜单不伪造活跃', () => {
  let now=23_000_000;
  const tracker=new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',battleId:'pending-rank',roomId:'r1'});
  const board={type:'pk-contribution',battleId:'pending-rank',anchorId:'a2',contributorCount:9,contributors:[{user:{id:'u'},score:50,rank:1}]};
  tracker.ingest(board);
  assert.equal(tracker.current().opponentUsers.length,0);
  tracker.ingest({type:'pk-start',battleId:'pending-rank',participants:[{anchorId:'a1',roomId:'r1'},{anchorId:'a2',roomId:'r2'}]});
  assert.equal(tracker.current().opponentUsers[0].score,50);
  assert.equal(tracker.current().opponentScoreMeta.contributorCount,9);
  now+=100000; tracker.ingest(board);
  assert.equal(tracker.current().opponentIntent.probability,0);
});

test('普通房间聊天礼物不会创建 PK，明确活跃战局也不把未知房间当对方', () => {
  let now=24_000_000;
  const tracker=new PKTracker({now:()=>now});
  tracker.ingest({type:'chat',roomId:'ordinary',text:'加油'});
  tracker.ingest({type:'gift',roomId:'ordinary',user:{id:'u'},unitValue:100});
  tracker.ingest({type:'chat',battleId:'missing',roomId:'ordinary',side:'self',text:'加油'});
  assert.equal(tracker.all().length,0);
  tracker.ingest({type:'pk-start',battleId:'chat-context',roomId:'r1',opponentRoomIds:['r2']});
  tracker.ingest({type:'chat',battleId:'chat-context',roomId:'unrelated',text:'上票反超'});
  tracker.ingest({type:'chat',roomId:'unrelated',text:'上票反超'});
  tracker.ingest({type:'chat',battleId:'chat-context',text:'上票反超'});
  tracker.ingest({type:'chat',text:'上票反超'});
  assert.equal(tracker.current().chatSignals.total,0);
  assert.equal(tracker.all().length,1);
  tracker.ingest({type:'chat',roomId:'r2',text:'上票反超'});
  tracker.ingest({type:'chat',battleId:'chat-context',side:'self',text:'加油'});
  assert.equal(tracker.current().chatSignals.opponent.total,1);
  assert.equal(tracker.current().chatSignals.self.total,1);
  tracker.ingest({type:'pk-end',battleId:'chat-context'});
  tracker.ingest({type:'chat',battleId:'chat-context',roomId:'r1',text:'加油'});
  assert.equal(tracker.current().chatSignals.total,2);
});

test('长采样间隔的比分增量按整个已观测区间分配，不在重连瞬间虚构爆发', () => {
  let now=25_000_000;
  const tracker=new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',battleId:'reconnect',selfScore:0,opponentScore:0,remainingMs:300000});
  now+=60000;
  tracker.ingest({type:'pk-score',battleId:'reconnect',selfScore:6000,opponentScore:3000});
  assert.equal(tracker.current().selfSpeed,100);
  assert.equal(tracker.current().opponentSpeed,50);
  assert.equal(tracker.current().selfVelocity60,100);
  now+=1000;
  tracker.ingest({type:'pk-score',battleId:'reconnect',selfScore:6030,opponentScore:3015});
  assert.ok(tracker.current().selfSpeed<102);
  assert.ok(tracker.current().selfVelocity60<100);
});

test('比分过期或倒计时归零时撤下外推，等待终局期间不声称已胜', () => {
  let now=26_000_000;
  const tracker=new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',battleId:'stop-project',selfScore:10,opponentScore:1000,remainingMs:60000});
  now+=1000; tracker.ingest({type:'pk-score',battleId:'stop-project',selfScore:1000,opponentScore:1100});
  assert.ok(tracker.current().analysis.catchUpSeconds>0);
  now+=16000;
  const stale=tracker.current();
  assert.equal(stale.dataQuality.stale,true);
  assert.equal(stale.analysis.projectedGap,null); assert.equal(stale.analysis.requiredRate,null); assert.equal(stale.analysis.catchUpSeconds,null);
  now+=43000;
  const zero=tracker.current();
  assert.equal(zero.remainingMs,0); assert.equal(zero.phase,'active');
  assert.equal(zero.prediction.status,'awaiting-final'); assert.equal(zero.prediction.selfWin,null);
  assert.equal(zero.analysis.awaitingFinal,true); assert.ok(zero.analysis.summary.includes('等待'));
  assert.equal(zero.analysis.projectedGap,null); assert.equal(tracker.results.length,0);
  tracker.ingest({type:'pk-end',battleId:'stop-project',selfScore:1500,opponentScore:1200});
  assert.equal(tracker.current().prediction.status,'final'); assert.equal(tracker.current().prediction.selfWin,1);
});

test('旧局结束后无 ID 迟到比分不复活，有新开局时间的中途比分建立独立战局', () => {
  let now=27_000_000;
  const tracker=new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',battleId:'previous',roomId:'r',startedAt:now,selfScore:1000,opponentScore:900});
  now+=60000; tracker.ingest({type:'pk-end',battleId:'previous',roomId:'r',selfScore:2000,opponentScore:1900});
  now+=1000;
  tracker.ingest({type:'pk-score',roomId:'r',selfScore:2000,opponentScore:1900});
  tracker.ingest({type:'pk-score',roomId:'r',startedAt:now-61000,selfScore:2000,opponentScore:1900});
  tracker.ingest({type:'pk-end',roomId:'r'});
  assert.equal(tracker.all().length,1); assert.equal(tracker.current().phase,'ended');
  now+=60000;
  tracker.ingest({type:'pk-score',roomId:'r',startedAt:now-30000,selfScore:100,opponentScore:90});
  assert.equal(tracker.all().length,2); assert.equal(tracker.current().phase,'active');
  assert.equal(tracker.current().selfScore,100); assert.equal(tracker.current().provisional,true);
  tracker.ingest({type:'pk-score',battleId:'previous',roomId:'r',selfScore:5000});
  assert.equal(tracker.current().selfScore,100); assert.equal(tracker.snapshot('previous').selfScore,2000);
});

test('无 ID 新局开始可避开旧临时战局的 key，后续真实 ID 能承接数据', () => {
  let now=28_000_000;
  const tracker=new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',roomId:'r',selfScore:100,opponentScore:90});
  tracker.ingest({type:'pk-end',roomId:'r'});
  now+=60000;
  tracker.ingest({type:'pk-start',roomId:'r',startedAt:now,selfScore:0,opponentScore:0});
  assert.equal(tracker.current().phase,'active'); assert.equal(tracker.current().selfScore,0);
  tracker.ingest({type:'pk-score',battleId:'new-real-id',roomId:'r',selfScore:20,opponentScore:10});
  assert.equal(tracker.current().key,'new-real-id'); assert.equal(tracker.all().length,2);
});

test('导出保存完整贡献人群和聊天历史，面板 top20 不截断持久化', () => {
  const tracker=new PKTracker({now:()=>29_000_000});
  tracker.ingest({type:'pk-start',battleId:'full-export',roomId:'r'});
  for(let index=0; index<35; index++) {
    tracker.ingest({type:'gift',battleId:'full-export',roomId:'r',id:`gift-${index}`,user:{id:`user-${index}`},unitValue:index+1});
    tracker.ingest({type:'chat',battleId:'full-export',roomId:'r',text:`加油 ${index}`});
  }
  assert.equal(tracker.current().selfUsers.length,20); assert.equal(tracker.current().chatHistory.length,30);
  const saved=tracker.export();
  assert.equal(saved.states[0].selfUsers.length,35); assert.equal(saved.states[0].chatHistory.length,35);
  const restored=new PKTracker({now:()=>29_000_000}); restored.restore(saved);
  assert.equal(restored.current().selfIntent.sampleSize,35);
  assert.equal(restored.states.get('full-export').chatHistory.length,35);
  restored.ingest({type:'gift',battleId:'full-export',roomId:'r',id:'gift-0',user:{id:'user-0'},unitValue:1});
  assert.equal(restored.current().selfGiftValue,630);
});
