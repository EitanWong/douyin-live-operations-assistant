import { summarizeAnchorBattles } from './anchor-stats.js';

export const sharedLiveContext = (() => {
const text = value => typeof value === 'string' ? [...value].slice(0,160).join('') : '';
const num = value => Number.isFinite(value) ? value : null;
const fields = (value, keys) => Object.fromEntries(keys.map(key=>[key,num(value?.[key])]));
const activityKeys = ['chat','enter','like','gift','diamonds','unknownGifts'];
const countActivity = rows => rows.reduce((sum,row)=>{for(const key of activityKeys)sum[key]+=num(row[key]) ?? 0;return sum;},Object.fromEntries(activityKeys.map(key=>[key,0])));
const sample = (rows,limit) => ({total:rows.length,included:Math.min(rows.length,limit),truncated:rows.length>limit});
const publicUser = (user,anchorId) => {
  const club = user?.fanClubs?.find(row=>row.anchorId===anchorId);
  return {name:text(user?.name),wealthLevel:num(user?.wealthLevel),fanLevel:num(club?.level ?? user?.fanLevel),fanClubLit:club ? club.status===1 : null};
};
const rankValue = row => row ? {detail:text(row.detail),score:text(row.scoreDisplay),level:num(row.level)} : null;
const observedContributor = (row,anchorId) => ({...publicUser(row,anchorId),...fields(row,['score','gifts','value','lastAt','events'])});
const observedActivity = row => row ? {...fields(row,['sampleSize','confidence']),activeRatio:num(row.probability),observedDiamonds:num(row.expected)}:null;
const rateSummary = row => row ? fields(row,['successes','trials','rate','posteriorMean','low','high','confidence']):null;
const publicBattle = row => ({phase:row.phase,startedAt:num(row.startedAt),endedAt:num(row.endedAt),score:num(row.score),scoreFinal:Boolean(row.scoreFinal),outcome:row.outcome || null,opponents:(row.opponents || []).slice(0,8).map(item=>({name:text(item.name)}))});

// One bounded, explicit projection for every AI task. Never serialize stores,
// raw protocol objects, user IDs, credentials or arbitrary nested event fields.
function buildSharedLiveContext(engine, now, config=engine.config) {
  const anchorId=config.anchorId, age=config.ai.contextAgeSec*1000;
  const fresh = (at,window=age) => Number.isFinite(at) && at<=now && now-at<=window;
  const stamp = row => num(row?.receivedAt) ?? num(row?.at);
  const room=engine.roomData, stats=room.stats, audience=room.audience, current=engine.pk.current();
  const pk=anchorId && current?.anchorId && current.anchorId!==anchorId ? null : current;
  const chat=(engine.contextChat.length ? engine.contextChat : engine.history).filter(row=>fresh(row.at));
  const buckets=[...engine.liveMetrics.buckets.values()].filter(row=>fresh(row.at,600000)).sort((a,b)=>a.at-b.at);
  const users=[...engine.audience.users.values()].filter(row=>fresh(row.observedAt,engine.audience.retention));
  const records=[...engine.anchorStats.records.values()].filter(row=>row.anchorId===anchorId).sort((a,b)=>(a.endedAt || a.startedAt || 0)-(b.endedAt || b.startedAt || 0));
  const broadcast=engine.pkOperations.broadcast;
  const currentRoom=broadcast?.anchorId===anchorId ? broadcast.roomId : pk?.anchorId===anchorId ? pk.roomId : '';
  const sessionRows=records.filter(row=>currentRoom && row.roomId===currentRoom);
  const view=engine.pkOperations.view(), exhibition=view.exhibition, rank=engine.anchorStats.rank.get(anchorId);
  const events=engine.replyEvents.filter(row=>fresh(row.at));
  const roomEvents=room.activities.filter(row=>fresh(stamp(row))).slice(-30);
  let income=null;
  try {
    const observed=engine.liveData()?.income;
    if(observed && observed.anchorId===anchorId && (!currentRoom || observed.roomId===currentRoom)) income={
      at:num(observed.at),stale:!fresh(observed.at,120000),source:text(observed.source),
      startAt:num(observed.startAt),endAt:num(observed.endAt),pending:num(observed.pending),
      ...fields(observed,['totalDiamonds','giftCount','unknownCount','estimatedIncome','calibrationIncome','calibrationDiamonds']),
      month:text(observed.month),monthTotals:observed.summary ? fields(observed.summary,['totalDiamonds','giftCount','unknownCount','estimatedIncome']):null,
      dailyHistory:(observed.days || []).slice(-31).map(row=>({date:text(row.date),...fields(row,['totalDiamonds','giftCount','unknownCount','estimatedIncome'])})),
      estimateOnly:true,basis:'本机采集与账本校准；钻石面值与人民币估算分列，不代表平台结算收入。'
    };
  } catch { /* A failed income provider must not prevent replies. Unknown stays null. */ }
  const competitors=pk?.competitors || [];
  const scoreHistory=(pk?.trend || []).filter(row=>row.at<=now);
  return {
    schemaVersion:2,observedAt:now,timeZone:'Asia/Shanghai',
    roomStats:stats ? {at:stamp(stats),stale:!fresh(stamp(stats)),hidden:Boolean(stats.hidden),metricType:text(stats.metricType),value:stats.hidden ? null:num(stats.displayValue),display:stats.hidden ? '':text(stats.displayLong || stats.displayMiddle || stats.displayShort)} : null,
    audience:audience ? {at:stamp(audience),stale:!fresh(stamp(audience)),online:num(audience.onlineCount),cumulativeUsers:num(audience.cumulativeUsers),popularity:num(audience.popularity),
      ranking:(audience.ranks || []).slice(0,20).map(row=>({...publicUser(row.user,anchorId),rank:num(row.rank),score:num(row.score)})),
      seats:(audience.seats || []).slice(0,12).map(row=>publicUser(row.user,anchorId))} : null,
    audienceProfiles:{...sample(users,30),sampleBasis:'最近观测的观众资料，不代表当前在线名单或消费预算',users:users.slice(-30).map(row=>({...publicUser(row,anchorId),at:row.observedAt}))},
    recentChat:chat.slice(-config.ai.contextSize).map(row=>({at:row.at,name:text(row.name),text:text(row.text)})),
    activityLastMinute:countActivity(buckets.filter(row=>fresh(row.at,60000))),
    activity:{windowSec:600,bucketSec:10,totals:countActivity(buckets),history:buckets.map(row=>({at:row.at,...fields(row,activityKeys)}))},
    income,
    recentEvents:events.slice(-20).map(row=>({type:text(row.type),at:row.at,name:text(row.name),text:text(row.text),...(row.type==='gift' ? {gift:text(row.gift),count:num(row.count),unitDiamonds:num(row.unitDiamonds),cumulative:true}:row.type==='like' ? {count:num(row.count)}:{})})),
    roomEvents:roomEvents.map(row=>({type:text(row.type),at:stamp(row),name:text(row.user?.name),text:text(row.text || row.description || row.title || row.display || row.status),
      ...fields(row,['followCount','shareCount','count','total','memberCount','diamondCount'])})),
    game:config.bot.enabled && engine.bot.session ? {type:engine.bot.session.type,phase:engine.bot.session.phase || 'playing',summary:text(engine.bot.sessionSummary())} : null,
    pk:pk?.phase ? {
      phase:pk.phase,at:num(pk.lastEventAt),remainingMs:num(pk.remainingMs),selfName:text(pk.anchorName),opponentName:text(pk.opponentName),
      selfScore:pk.selfScoreObserved ? num(pk.selfScore):null,opponentScore:pk.opponentScoreObserved ? num(pk.opponentScore):null,stale:Boolean(pk.dataQuality?.stale),
      ...fields(pk,['selfSpeed','opponentSpeed','selfVelocity60','opponentVelocity60']),
      dataQuality:fields(pk.dataQuality,['scoreSamples','rejectedScoreEvents','selfScoreAgeMs','opponentScoreAgeMs']),
      competitors:competitors.slice(0,8).map(row=>({name:text(row.name),isSelf:Boolean(row.isSelf),score:row.scoreObserved ? num(row.score):null,scoreAgeMs:num(row.scoreAgeMs),grade:row.grade ? {name:text(row.grade.name),...fields(row.grade,['level','starCount','targetStarCount'])}:null})),
      contributors:{self:(pk.selfUsers || []).slice(0,20).map(row=>observedContributor(row,anchorId)),opponent:(pk.opponentUsers || []).slice(0,20).map(row=>observedContributor(row,anchorId))},
      contributorActivity:{self:observedActivity(pk.selfIntent),opponent:observedActivity(pk.opponentIntent),basis:'已观测贡献者近90秒活跃比例与已观测钻石，不代表未来付费概率或预算'},
      chatSignals:pk.chatSignals ? {...fields(pk.chatSignals,['total','recent','latestAt','sampleSize']),self:fields(pk.chatSignals.self,['total','positive','negative','request','comeback']),opponent:fields(pk.chatSignals.opponent,['total','positive','negative','request','comeback']),basis:'关键词统计，不代表真实情绪或意图'}:null,
      estimates:{basis:'本机基于页面观测的模型推演，未经真实胜负样本校准，不是平台官方胜率或确定结果',
        prediction:pk.prediction ? {status:text(pk.prediction.status),...fields(pk.prediction,['selfWin','opponentWin','draw','confidence','sampleSize']),factors:(pk.prediction.factors || []).slice(0,10).map(text)}:null,
        analysis:pk.analysis ? {summary:text(pk.analysis.summary),...fields(pk.analysis,['gap','projectedGap','requiredRate','catchUpSeconds','selfRate','opponentRate','speedGap']),risks:(pk.analysis.risks || []).slice(0,10).map(text)}:null},
      effectHistory:{multiplier:rateSummary(pk.multiplierStats),cards:rateSummary(pk.cardStats),basis:'本机记录样本的经验频率与区间，不能保证本次触发'},
      effects:(pk.effects || []).slice(-20).map(row=>({name:text(row.name),side:text(row.side),active:Boolean(row.active),multiplier:num(row.multiplier),startAt:num(row.startAt),endAt:num(row.endAt)})),
      scoreHistory:scoreHistory.slice(-60).map(row=>({at:row.at,selfScore:num(row.selfScore),opponentScore:num(row.opponentScore),scores:competitors.slice(0,8).map(item=>({name:text(item.name),isSelf:Boolean(item.isSelf),score:num(row.competitorScores?.[item.anchorId])}))})),
      historyCoverage:sample(scoreHistory,60),
      chat:(pk.chatHistory || []).filter(row=>fresh(row.at)).slice(-30).map(row=>({at:row.at,side:text(row.side),text:text(row.text)}))
    } : null,
    pkHistory:{basis:'本机观测，仅明确终局比分计入胜负与总分',summary:summarizeAnchorBattles(records),session:summarizeAnchorBattles(sessionRows),...sample(records,20),battles:records.slice(-20).map(publicBattle)},
    tasks:view.task ? {at:view.task.at,stale:view.task.stale,...fields(view.task,['valid','target','validWins','winTarget']),firstWin:view.task.firstWin} : null,
    exhibition:exhibition ? {at:exhibition.updatedAt,stale:!fresh(exhibition.updatedAt,120000),title:text(exhibition.title),
      ...fields(exhibition,['level','floor','keepTarget','gapToNextLevel','exhibitionType','lightedCount','totalCount']),
      stars:exhibition.stars ? fields(exhibition.stars,['current','target','completedStage']):null,
      partial:Boolean(exhibition.partial || exhibition.truncated),itemCoverage:sample(exhibition.items || [],30),
      items:(exhibition.items || []).slice(0,30).map(row=>({name:text(row.name),lighted:row.lighted ?? null,...fields(row,['diamonds','received','threshold','totalReceived']),
        task:row.task ? {...fields(row.task,['current','target','rewardStars']),finished:row.task.finished ?? null}:null})),
      taskCoverage:sample(exhibition.tasks || [],30),tasks:(exhibition.tasks || []).slice(0,30).map(row=>({name:text(row.name),...fields(row,['current','target','rewardStars']),finished:row.finished ?? null}))} : null,
    rank:rank ? {at:rank.observedAt,stale:!fresh(rank.observedAt,120000),before:rankValue(rank.beforeRank),after:rankValue(rank.afterRank),
      deltaScore:text(rank.deltaScore),tips:text(rank.tips),changes:(rank.deltaDetails || []).slice(0,20).map(row=>({name:text(row.name),score:text(row.score)}))} : null,
    exhibitionRetention:view.exhibitionRetention ? {at:view.exhibitionRetention.observedAt,stale:view.exhibitionRetention.stale,name:text(view.exhibitionRetention.name),remaining:num(view.exhibitionRetention.remaining)} : null,
    coverage:{chat:sample(chat,config.ai.contextSize),events:sample(events,20),roomEvents:sample(room.activities.filter(row=>fresh(stamp(row))),30),
      limits:'仅页面已采集的数据；历史有界采样并保留汇总，不含直播音视频理解。null 为未知，stale 为过期；礼物连击 count 为累计，不可直接相加。'}
  };
}

return buildSharedLiveContext;
})();
