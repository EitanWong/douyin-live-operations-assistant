import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AnchorStats} from '../../src/core/anchor-stats.js';
import {PKTracker} from '../../src/pk/model.js';

const at = value => Date.parse(`${value}+08:00`);
const today = at('2026-10-23T12:00:00');
const battle = (extra = {}) => ({key:'battle-1',roomId:'room-1',anchorId:'9007199254740993123',anchorName:'主播甲',opponentId:'20',opponentName:'主播乙',
  provisional:false,startedAt:today-60000,endedAt:today,phase:'ended',lastEventAt:today,
  selfScore:100,opponentScore:50,selfScoreObserved:true,opponentScoreObserved:true,
  selfScoreAt:today,opponentScoreAt:today,selfScoreMeta:{final:true},opponentScoreMeta:{final:true},...extra});
const self = '9007199254740993123';

test('逐场按 UID 去重，双方统计相反且零比分有效，平局纳入胜率分母',()=>{
  const stats = new AnchorStats({now:()=>today});
  assert.equal(stats.ingestBattle(battle()),true);
  assert.equal(stats.ingestBattle(battle()),false);
  stats.ingestBattle(battle({key:'draw',selfScore:0,opponentScore:0}));
  stats.ingestBattle(battle({key:'lose',selfScore:20,opponentScore:40}));
  const report = stats.report(self);
  assert.equal(report.today.battles,3); assert.equal(report.today.wins,1); assert.equal(report.today.losses,1); assert.equal(report.today.draws,1);
  assert.equal(report.today.winRate,1/3); assert.equal(report.today.totalScore,120); assert.equal(report.today.pending,0);
  assert.equal(report.timeZone,'Asia/Shanghai'); assert.equal(report.trend.length,7); assert.equal(report.trend.at(-1).date,'2026-10-23');
  assert.equal(report.trend.at(-1).battles,3); assert.equal(report.trend[0].winRate,null); assert.equal(report.trend[0].totalScore,null);
  assert.deepEqual(stats.report('20').total,{battles:3,active:0,ended:3,pending:0,wins:1,losses:1,draws:1,decided:3,winRate:1/3,totalScore:90,scoreBattles:3,unknownScoreBattles:0});
  assert.equal(stats.anchors()[0].battles,3); assert.equal(report.name,'主播甲');
});

test('赛中比分、倒计时归零、预测 final 以及无终局比分的 pk-end 不变成胜负',()=>{
  let now=today;
  const tracker = new PKTracker({now:()=>now});
  tracker.ingest({type:'pk-start',battleId:'observed',anchorId:self,opponentId:'20',selfScore:100,opponentScore:50,remainingMs:1000});
  const stats=new AnchorStats({now:()=>now});
  stats.ingestBattle(tracker.current());
  now+=1000; stats.ingestBattle(tracker.current());
  assert.equal(stats.report(self).today.active,1); assert.equal(stats.report(self).today.winRate,null);
  tracker.ingest({type:'pk-end',battleId:'observed'}); stats.ingestBattle(tracker.current());
  const report=stats.report(self);
  assert.equal(report.total.battles,1);assert.equal(report.total.pending,1);assert.equal(report.total.decided,0);
  assert.equal(report.total.totalScore,null);assert.equal(report.battles[0].score,100);assert.equal(report.battles[0].outcome,null);
  assert.equal(report.battles[0].status,'pending');assert.equal(report.total.unknownScoreBattles,1);
});

test('一侧终局分数可累计，另一侧未知时不计算胜负，后补终局证据只更新原场',()=>{
  const stats=new AnchorStats({now:()=>today});
  stats.ingestBattle(battle({opponentScoreObserved:false,opponentScoreMeta:{}}));
  let report=stats.report(self);
  assert.equal(report.total.totalScore,100);assert.equal(report.total.decided,0);assert.equal(stats.report('20').total.totalScore,null);
  assert.equal(stats.report('20').battles[0].score,null);
  stats.ingestBattle(battle({lastEventAt:today+1000}));
  report=stats.report(self);
  assert.equal(report.total.battles,1);assert.equal(report.total.wins,1);assert.equal(report.total.totalScore,100);
});

test('北京时间跨日跨月的结束比赛迁移日期，未结束按开始日且趋势补零',()=>{
  const begin=at('2026-09-30T23:59:00'),end=at('2026-10-01T00:01:00');
  const stats=new AnchorStats({now:()=>end});
  const active=battle({startedAt:begin,endedAt:0,phase:'active',lastEventAt:begin,selfScoreMeta:{},opponentScoreMeta:{}});
  stats.ingestBattle(active);
  assert.equal(stats.report(self,{now:begin}).today.battles,1);
  stats.ingestBattle({...active,phase:'ended',endedAt:end,lastEventAt:end,selfScoreMeta:{final:true},opponentScoreMeta:{final:true}});
  assert.equal(stats.report(self,{now:begin}).today.battles,0);
  const report=stats.report(self,{now:end,days:30});
  assert.equal(report.today.battles,1);assert.equal(report.month.month,'2026-10');assert.equal(report.month.battles,1);
  assert.equal(report.trend.length,30);assert.equal(report.trend.at(-2).date,'2026-09-30');assert.equal(report.trend.at(-2).battles,0);
  assert.equal(report.battles[0].date,'2026-10-01');
});

test('增量更新与乱序活跃快照不能覆盖已确认终局数据或结束日',()=>{
  const stats=new AnchorStats({now:()=>today});
  stats.ingestBattle(battle());
  stats.ingestBattle(battle({phase:'active',startedAt:today+DAY,endedAt:0,lastEventAt:today+DAY,selfScoreAt:today+DAY,
    selfScore:99999,opponentScore:999999,selfScoreMeta:{},opponentScoreMeta:{}}));
  stats.ingestBattle(battle({selfScore:1,opponentScore:1000,lastEventAt:today+2*DAY,endedAt:today+2*DAY}));
  const report=stats.report(self);
  assert.equal(report.total.wins,1);assert.equal(report.total.totalScore,100);assert.equal(report.battles[0].endedAt,today);
  assert.equal(report.battles[0].date,'2026-10-23');assert.equal(report.battles[0].score,100);
});
const DAY=86400000;

test('按明确 UID 处理多方比赛，所有终局比分齐全才定胜负，最高同分才记平',()=>{
  const stats=new AnchorStats({now:()=>today});
  const competitors=[{anchorId:self,name:'甲',score:100,scoreObserved:true,scoreAt:today,scoreMeta:{final:true}},
    {anchorId:'20',name:'乙',score:100,scoreObserved:true,scoreAt:today,scoreMeta:{final:true}},
    {anchorId:'30',name:'丙',score:20,scoreObserved:true,scoreAt:today,scoreMeta:{}}];
  const multi=battle({competitors,opponentId:'',opponentScoreMeta:{},opponentScoreObserved:false});
  stats.ingestBattle(multi);
  assert.equal(stats.report(self).total.decided,0);assert.equal(stats.report('30').total.decided,0);
  stats.ingestBattle({...multi,competitors:competitors.map(row=>({...row,scoreMeta:{final:true}}))});
  assert.equal(stats.report(self).total.draws,1);assert.equal(stats.report('20').total.draws,1);assert.equal(stats.report('30').total.losses,1);
  assert.equal(stats.report('30').battles[0].opponents.length,2);
  assert.deepEqual(stats.anchors().map(row=>row.anchorId).sort(),['20','30',self].sort());
});

test('没有 UID 不按房间或名字猜主播，未观测零分及不安全数值保留未知',()=>{
  const stats=new AnchorStats({now:()=>today});
  assert.equal(stats.ingestBattle(battle({anchorId:'',opponentId:'',competitors:[]})),false);
  stats.ingestBattle(battle({anchorId:9007199254740992,opponentId:'20',selfScore:0,selfScoreObserved:false,selfScoreMeta:{},opponentScore:NaN}));
  assert.deepEqual(stats.anchors().map(row=>row.anchorId),['20']);
  assert.equal(stats.report('20').battles[0].score,null);assert.equal(stats.report('20').total.totalScore,null);
  assert.equal(stats.report('missing').total.winRate,null);assert.equal(stats.report('missing').total.battles,0);
  assert.equal(stats.ingestBattle(battle({key:'idle',phase:'idle'})),false);
});

test('超出运行时保留上限后快照仍保留所有场次，恢复重放幂等且返回值无引用泄漏',()=>{
  const stats=new AnchorStats({now:()=>today});
  for(let i=0;i<260;i++)stats.ingestBattle(battle({key:`game-${i}`}));
  const saved=stats.snapshot(),restored=new AnchorStats({now:()=>today});
  assert.equal(restored.restore(saved),true);assert.equal(restored.ingestBattle(battle({key:'game-259'})),false);
  const report=restored.report(self);
  assert.equal(report.total.battles,260);assert.equal(report.total.wins,260);assert.equal(report.total.totalScore,26000);
  assert.equal(report.battles.length,260);assert.equal(restored.snapshot().records.length,520);
  saved.records[0].score=99999;report.battles[0].score=99999;
  assert.equal(restored.report(self).total.totalScore,26000);
  assert.equal(restored.restore({version:0,records:[]}),false);assert.equal(restored.report(self).total.battles,260);
  const again=new AnchorStats();again.restore(JSON.parse(JSON.stringify(restored.snapshot())));
  assert.equal(again.report(self,{now:today}).total.battles,260);
});

test('同房间同开局的临时战局升级服务端 key 后迁移记录而不重复计场',()=>{
  const stats=new AnchorStats({now:()=>today});
  stats.ingestBattle(battle({key:'room-1:opponent',phase:'active',endedAt:0,provisional:true,selfScoreMeta:{},opponentScoreMeta:{}}));
  stats.ingestBattle(battle({key:'official-key'}));
  assert.equal(stats.report(self).total.battles,1);assert.equal(stats.report(self).total.wins,1);
  assert.equal(stats.snapshot().records.length,2);assert.equal(stats.report(self).battles[0].battleKey,'official-key');
  stats.ingestBattle(battle({key:'new-round',startedAt:today+100000,endedAt:today+200000,lastEventAt:today+200000}));
  assert.equal(stats.report(self).total.battles,2);
});

test('无有效日期的场次保留总表但不挤入今日，积分求和溢出不伪造精度',()=>{
  const stats=new AnchorStats({now:()=>today});
  stats.ingestBattle(battle({startedAt:0,endedAt:0,lastEventAt:0,selfScoreAt:0,opponentScoreAt:0,selfScore:Number.MAX_SAFE_INTEGER}));
  stats.ingestBattle(battle({key:'overflow',selfScore:1}));
  const report=stats.report(self);
  assert.equal(report.total.battles,2);assert.equal(report.today.battles,1);assert.equal(report.total.totalScore,null);
  assert.equal(report.total.scoreBattles,2);assert.equal(stats.report(self,{days:0}).trend.length,1);
});

test('展馆分块按 snapshotId 去重并合并摘要、礼物和任务，容量受限且可恢复',()=>{
  const stats = new AnchorStats({now:()=>today});
  const base = {type:'anchor-exhibition',anchorId:self,roomId:'room-1',snapshotId:'snap-1',receivedAt:today,
    summary:{name:'主播甲',title:'本周展馆',level:7,gradeLevel:3,stars:{current:12,target:20,completedStage:2}}};
  const item = (giftId, lighted, task=null) => ({giftId,name:`礼物${giftId}`,diamonds:10,lighted,received:1,threshold:2,task});
  assert.equal(stats.ingest({...base,section:'lighted_items',chunk:0,chunks:2,totalItems:2,items:[item('g1',true)]}),true);
  assert.equal(stats.ingest({...base,section:'lighted_items',chunk:0,chunks:2,totalItems:2,items:[item('g1',true)]}),false);
  assert.equal(stats.ingest({...base,section:'unlighted_items',chunk:0,chunks:1,totalItems:1,items:[item('g2',false,{groupId:'1',taskId:'2',current:1,target:3,rewardStars:4,finished:false})]}),true);
  assert.equal(stats.ingest({...base,section:'all_normal_items',chunk:0,chunks:1,totalItems:2,items:[item('g1',false),item('g2',false)]}),true);
  let report=stats.report(self);
  assert.equal(report.exhibition.level,7);assert.equal(report.exhibition.floor,3);assert.deepEqual(report.exhibition.stars,{current:12,target:20,completedStage:2});
  assert.equal(report.exhibition.lightedCount,1);assert.equal(report.exhibition.totalCount,2);assert.equal(report.exhibition.items.length,2);assert.equal(report.exhibition.tasks[0].taskId,'2');
  const saved=stats.snapshot(),restored=new AnchorStats({now:()=>today});assert.equal(restored.restore(saved),true);
  assert.equal(restored.report(self).exhibition.items.length,2);assert.equal(restored.report(self).exhibition.totalCount,2);
  assert.equal(restored.ingest({...base,section:'lighted_items',chunk:1,chunks:2,totalItems:2,items:[item('g3',true)]}),true);
  assert.equal(restored.report(self).exhibition.items.length,3);assert.equal(restored.report(self).exhibition.lightedCount,2);
  assert.equal(restored.ingest({...base,snapshotId:'snap-0',section:'lighted_items',chunk:0,totalItems:1,items:[item('old',true)]}),false);
  report=restored.report(self);assert.equal(report.exhibition.snapshotId,'snap-1');assert.equal(report.exhibition.items.length,3);
});

test('段位事件按 context UID 保存最新观察，无 owner 时单独保留未知赛季记录',()=>{
  const stats=new AnchorStats({now:()=>today});
  const event={type:'pk-rank-season',id:'rank-1',roomId:'room-1',receivedAt:today,beforeRank:{detail:'钻石',level:6},afterRank:{detail:'王者',level:7},changeType:1,deltaScore:'20',tips:'升级'};
  assert.equal(stats.ingest(event,{anchorId:self}),true);assert.equal(stats.ingest(event,{anchorId:self}),false);
  let report=stats.report(self);assert.equal(report.rank.afterRank.detail,'王者');assert.equal(report.rank.deltaScore,'20');assert.deepEqual(report.rankUnknown,[]);
  assert.equal(stats.ingest({...event,id:'rank-2',receivedAt:today+1},{}),true);
  report=stats.report(self);assert.equal(report.rankUnknown.length,1);assert.equal(report.rankUnknown[0].anchorId,null);
  const saved=stats.snapshot(),restored=new AnchorStats({now:()=>today});restored.restore(saved);assert.equal(restored.report(self).rank.afterRank.detail,'王者');assert.equal(restored.report(self).rankUnknown.length,1);
});

test('PK 参战段位只归属显式主播 UID，不串入其他主播',()=>{
  const stats=new AnchorStats({now:()=>today});
  const state={key:'grade-battle',roomId:'room-1',anchorId:self,anchorName:'主播甲',opponentId:'20',opponentName:'主播乙',
    provisional:false,phase:'ended',startedAt:today-60000,endedAt:today,lastEventAt:today,
    competitors:{
      [self]:{anchorId:self,name:'主播甲',score:100,scoreObserved:true,scoreAt:today,scoreMeta:{final:true},
        grade:{name:'璀璨钻石',level:'4',starCount:'2',targetStarCount:'5'},pkStageDescription:'钻石 IV'},
      '20':{anchorId:'20',name:'主播乙',score:50,scoreObserved:true,scoreAt:today,scoreMeta:{final:true}}
    },
    selfScore:100,selfScoreObserved:true,selfScoreAt:today,selfScoreMeta:{final:true},
    opponentScore:50,opponentScoreObserved:true,opponentScoreAt:today,opponentScoreMeta:{final:true}
  };
  assert.equal(stats.ingestBattle(state),true);
  const owner=stats.report(self),other=stats.report('20');
  assert.equal(owner.rank.afterRank.detail,'璀璨钻石');
  assert.equal(owner.rank.afterRank.level,'4');
  assert.equal(owner.rank.afterRank.starCount,'2');
  assert.equal(owner.rank.afterRank.targetStarCount,'5');
  assert.equal(other.rank,null);
});

test('无 PK 的展馆及段位主播也可选择，乱序段位不得覆盖最新观测',()=>{
  const stats=new AnchorStats({now:()=>today});
  stats.ingest({type:'pk-rank-season',id:'new-rank',anchorId:'101',receivedAt:today,afterRank:{detail:'钻石'}});
  const revision=stats.revision;
  assert.equal(stats.ingest({type:'pk-rank-season',id:'old-rank',anchorId:'101',receivedAt:today-1000,afterRank:{detail:'青铜'}}),false);
  assert.equal(stats.revision,revision);assert.equal(stats.report('101').rank.afterRank.detail,'钻石');
  stats.ingest({type:'anchor-exhibition',anchorId:'202',snapshotId:'snapshot',receivedAt:today,section:'items',items:[],summary:{name:'展馆主播'}});
  assert.deepEqual(stats.anchors().map(row=>row.anchorId).sort(),['101','202']);
  assert.equal(stats.report('202').name,'展馆主播');assert.equal(stats.report('202').total.battles,0);
});

test('重复 PK 不使版本改变，恢复及终局更新使版本递增，快照保留上限不影响有效展馆',()=>{
  const stats=new AnchorStats({now:()=>today});
  stats.ingestBattle(battle());const revision=stats.revision;
  stats.ingestBattle(battle());assert.equal(stats.revision,revision);
  stats.ingestBattle(battle({key:'next'}));assert.ok(stats.revision>revision);
  for(let i=0;i<50;i++) stats.ingest({type:'anchor-exhibition',anchorId:self,snapshotId:`${today+i}-0`,receivedAt:today+i,section:'items',items:[],summary:{gradeLevel:i}});
  assert.ok(stats.exhibition.size<=13);assert.equal(stats.report(self).exhibition.floor,49);
  const restored=new AnchorStats();restored.restore(stats.snapshot());assert.ok(restored.revision>0);
  assert.equal(restored.report(self).exhibition.floor,49);
});
