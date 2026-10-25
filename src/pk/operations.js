import { summarizeAnchorBattles } from '../core/anchor-stats.js';

const DAY_MS = 86400000;
const SHANGHAI_OFFSET_MS = 8 * 3600000;

export function nextChinaMidnight(now = Date.now()) {
  if (!Number.isFinite(now)) return null;
  return Math.floor((now + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS - SHANGHAI_OFFSET_MS + DAY_MS;
}

export function calculateMidnightPKStart(now, durationMs, graceMs = 1000) {
  const midnight = nextChinaMidnight(now);
  if (!midnight || !Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(graceMs) || graceMs < 0) return null;
  return { midnight, startAt: midnight - durationMs + graceMs, endAt: midnight + graceMs };
}

export function summarizeDailyPK(report, date) {
  const rows = (report?.battles || []).filter(row => row.date === date);
  const ended = rows.filter(row => row.phase === 'ended');
  const wins = ended.filter(row => row.outcome === 'win').sort((a,b) => a.endedAt - b.endedAt);
  return {
    date,
    observedBattles: rows.length,
    endedBattles: ended.length,
    wins: wins.length,
    firstWin: wins.length > 0 ? wins[0] : null,
    firstWinTask: null,
    validBattleTask: null
  };
}

const strategyCompetitors = pk => pk?.competitors?.length ? pk.competitors : [
  {anchorId:pk?.anchorId,name:pk?.anchorName,isSelf:true,score:pk?.selfScore,scoreObserved:pk?.selfScoreObserved,scoreAgeMs:pk?.dataQuality?.selfScoreAgeMs},
  {anchorId:pk?.opponentId,name:pk?.opponentName,isSelf:false,score:pk?.opponentScore,scoreObserved:pk?.opponentScoreObserved,scoreAgeMs:pk?.dataQuality?.opponentScoreAgeMs}
];

export function buildPKStrategyContext(pk, liveContext, rank) {
  if (!pk || pk.phase !== 'active') return null;
  const competitors = strategyCompetitors(pk), self = competitors.find(item => item.isSelf);
  const top = Math.max(...competitors.filter(item => item.scoreObserved).map(item => item.score), -Infinity);
  const visibleRank = row => row && typeof row === 'object' ? {
    detail:typeof row.detail === 'string' ? row.detail.slice(0,40) : null,
    score:typeof row.scoreDisplay === 'string' ? row.scoreDisplay.slice(0,24) : null,
    level:Number.isSafeInteger(row.level) ? row.level : null
  } : null;
  return {
    at: pk.lastEventAt || null,
    remainingMs: Number.isFinite(pk.remainingMs) ? pk.remainingMs : null,
    scoreFresh: !pk.dataQuality?.stale,
    competitors: competitors.slice(0, 8).map(item => ({
      name: item.name || '', self: Boolean(item.isSelf),
      score: item.scoreObserved ? item.score : null,
      scoreAgeMs: item.scoreAgeMs ?? null,
      grade: item.grade ? {name:item.grade.name || '',level:item.grade.level ?? null,starCount:item.grade.starCount ?? null,targetStarCount:item.grade.targetStarCount ?? null} : null,
      contributors: (item.isSelf ? (pk.selfUsers || []) : item.anchorId === pk.opponentId ? (pk.opponentUsers || []) : []).slice(0, 8).map(user => ({
        name: user.name || '', score: user.score ?? null,
        wealthLevel: user.wealthLevel ?? null, fanLevel: user.fanLevel ?? null
      }))
    })),
    scoreGapToLeader:self?.scoreObserved && Number.isFinite(top) ? top - self.score : null,
    requiredScoreRate:self?.scoreObserved && Number.isFinite(top) && Number.isFinite(pk.remainingMs) && pk.remainingMs > 0
      ? Math.max(0,top - self.score) / (pk.remainingMs / 1000) : null,
    selfVelocity: Number.isFinite(pk.selfSpeed) ? pk.selfSpeed : null,
    opponentVelocity: Number.isFinite(pk.opponentSpeed) ? pk.opponentSpeed : null,
    effects: (pk.effects || []).filter(item => item.active).map(item => ({ name: item.name || '', side:item.side || null, multiplier: item.multiplier ?? null, endAt: item.endAt ?? null })),
    chatSignals: pk.chatSignals ? { self: pk.chatSignals.self, opponent: pk.chatSignals.opponent } : null,
    observedChat: (pk.chatHistory || []).slice(-12).map(item => ({ side: item.side, text: String(item.text || '').slice(0,160), at: item.at })),
    roomActivity: liveContext?.activityLastMinute || null,
    audience: liveContext?.audience || null,
    rank: rank ? { at: rank.observedAt, before:visibleRank(rank.beforeRank), after:visibleRank(rank.afterRank),
      exhibitionRetention:rank.exhibitionRetention && !rank.exhibitionRetention.stale ? {name:rank.exhibitionRetention.name,remaining:rank.exhibitionRetention.remaining,at:rank.exhibitionRetention.observedAt} : null } : null,
    dataLimits: '只提供本页采集到的样本；未观测数据为未知。礼物钻石不等于 PK 分数，观众等级不能证明可用预算。'
  };
}

export const PK_OPERATIONS_DEFAULTS = {
  enabled: false, announceLifecycle: true, reportEnabled: true, reportSec: 300,
  midnightEnabled: true, durationSec: 300, crossMidnightSec: 5, preparationSec: 60,
  aiEnabled: false, aiIntervalSec: 30
};

// A change of leader or active bonus invalidates an earlier tactical message.
export function strategyRegime(pk) {
  const competitors = strategyCompetitors(pk), top = Math.max(...competitors.filter(row => row.scoreObserved).map(row => row.score));
  return JSON.stringify({leaders:competitors.filter(row => row.scoreObserved && row.score === top).map(row => row.anchorId).sort(),
    effects:(pk?.effects || []).filter(row => row.active).map(row => [row.side,row.name,row.multiplier,row.endAt])});
}

const short = value => [...String(value || '')].slice(0, 8).join('');
const clock = at => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hourCycle: 'h23', hour:'2-digit', minute:'2-digit', second:'2-digit' }).format(at);
const dateOf = at => new Date(at + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
const pkRivals = state => (state.competitors || []).filter(item => !item.isSelf && state.anchorId && item.anchorId !== state.anchorId);
const pkName = item => short(item.name) || `主播${String(item.anchorId).slice(-6)}`;
function pkStartText(state, ordinal) {
  const rivals = pkRivals(state);
  const names = rivals.slice(0,3).map(pkName).join('、');
  const opponent = rivals.length > 1 ? `${rivals.length}位对手：${names}${rivals.length > 3 ? '等' : ''}`
    : `对手${names || short(state.opponentName) || '名单同步中'}`;
  return `PK开始，${ordinal ? `本场第${ordinal}场，` : ''}${opponent}${Number.isFinite(state.remainingMs) ? `，剩余${Math.ceil(state.remainingMs / 1000)}秒` : ''}。`;
}

export class PKOperations {
  constructor(engine) {
    this.engine = engine; this.notices = new Set(); this.task = null; this.nextReport = 0; this.nextAI = 0; this.strategy = null;
  }
  snapshot() { return { notices: [...this.notices].slice(-200), task: this.task, broadcast: this.broadcast, nextReport: this.nextReport, nextAI: this.nextAI }; }
  restore(value) {
    this.notices = new Set(Array.isArray(value?.notices) ? value.notices.slice(-200).filter(item => typeof item === 'string') : []);
    this.task = value?.task && typeof value.task === 'object' ? value.task : null;
    this.broadcast = value?.broadcast?.roomId && value.broadcast.anchorId ? {...value.broadcast} : null;
    this.nextReport = Number.isFinite(value?.nextReport) ? value.nextReport : 0;
    this.nextAI = Number.isFinite(value?.nextAI) ? value.nextAI : 0;
  }
  observeBroadcast(event) {
    const now = this.engine.now(), at = event.receivedAt || event.at || now;
    if (!event.roomId || !['start','pk-start','room-state'].includes(event.type) || at > now || now-at > 30000) return;
    if (Number.isFinite(event.at) && Math.abs(now-event.at) > 30000 && event.type !== 'start') return;
    // An identity start carries the platform's original start time; receipt is
    // the live observation time. Never group by the stable web room URL or date.
    const anchorId = this.engine.config.anchorId;
    if (!anchorId || this.broadcast?.at > at) return;
    this.broadcast = {anchorId,roomId:String(event.roomId),at};
  }
  sessionRows() {
    const engine = this.engine, current = engine.pk.current();
    const roomId = this.broadcast?.anchorId === engine.config.anchorId ? this.broadcast.roomId
      : current?.anchorId === engine.config.anchorId ? current.roomId : '';
    const rows = roomId ? [...engine.anchorStats.records.values()].filter(row => row.anchorId === engine.config.anchorId && row.roomId === roomId) : [];
    rows.sort((a,b) => (a.startedAt || a.updatedAt || 0) - (b.startedAt || b.updatedAt || 0) || a.battleKey.localeCompare(b.battleKey));
    return {roomId,rows};
  }
  ordinal(state) {
    const {rows} = this.sessionRows(), index = rows.findIndex(row => row.battleKey === state.key);
    return index < 0 ? null : index + 1;
  }
  sessionText() {
    const s = this.view().session;
    return s.known ? `本场PK次数${s.battles}场，胜利${s.wins}场，失败${s.losses}场，平局${s.draws}场。` : '本场PK次数待采集，等待直播场次信息。';
  }
  ingestTasks(event) {
    const engine = this.engine;
    if (event.source !== 'native-task-panel' || typeof event.id !== 'string' || !event.id.startsWith('pk-tasks:')) return;
    if (event.anchorId !== engine.config.anchorId || !Number.isFinite(event.receivedAt) || event.receivedAt > engine.now() || engine.now() - event.receivedAt > 600000) return;
    if (this.task && event.receivedAt < this.task.at) return;
    const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 10000 ? value : null;
    this.task = {anchorId:event.anchorId, date:dateOf(event.receivedAt), at:event.receivedAt, source:'dom',
      valid:count(event.valid), target:count(event.target), validWins:count(event.validWins), winTarget:count(event.winTarget), firstWin:typeof event.firstWin === 'boolean' ? event.firstWin : null};
  }
  view() {
    const engine = this.engine, now = engine.now(), c = engine.config.pkOperations;
    const cacheKey = JSON.stringify([engine.config.anchorId,this.broadcast?.roomId,dateOf(now),engine.anchorStats.revision,this.task?.at,this.strategy?.at,c.durationSec,c.crossMidnightSec]);
    if (this.cachedView?.key === cacheKey && now - this.cachedView.at < 1000) return this.cachedView.value;
    const report = {battles:[...engine.anchorStats.records.values()].filter(row => row.anchorId === engine.config.anchorId),exhibition:engine.anchorStats.exhibitionFor(engine.config.anchorId)};
    const daily = summarizeDailyPK(report, dateOf(now));
    const {roomId,rows} = this.sessionRows();
    const session = {roomId,known:Boolean(roomId),...summarizeAnchorBattles(rows)};
    session.pendingResults = session.ended - session.decided;
    const task = this.task?.anchorId === engine.config.anchorId && this.task.date === daily.date ? {...this.task, stale:now - this.task.at > 120000} : null;
    const value = {daily, session, task, exhibition:report.exhibition, exhibitionRetention:engine.anchorStats.retentionFor(engine.config.anchorId), plan:calculateMidnightPKStart(now, c.durationSec * 1000, c.crossMidnightSec * 1000), strategy:this.strategy};
    this.cachedView = {at:now,key:cacheKey,value};
    return value;
  }
  notice(key, text, extra = {}, generation = {}) {
    if (this.notices.has(key)) return false;
    this.notices.add(key);
    while (this.notices.size > 200) this.notices.delete(this.notices.values().next().value);
    this.engine.log('system', text);
    const clipped = [...text].slice(0, this.engine.config.sending.maxLength).join('');
    const engine=this.engine;
    if (!engine.enqueue('pk',clipped,{channel:'admin',pkNotice:true,...extra})) return false;
    const job=engine.queue.at(-1);
    // Keep the factual template in its queue position. AI may replace it once,
    // before the deadline; failure, quota, SKIP or late output keeps the template.
    if (engine.config.ai.enabled && !engine.aiBusy) {
      job.revision=(job.revision || 0)+1;job.aiPending=true;
      const deadline=Math.min(job.expires,engine.now()+5000);job.readyAt=deadline;
      void engine.requestAI(null,{
        kind:generation.kind || 'pk-announcement',data:generation.data || {fixedText:clipped},
        instruction:'基于固定播报事实和共享直播上下文生成简短播报，不编造进度、比分或时间。',
        targetJob:job,revision:job.revision,deadline,timeoutMs:Math.max(1,deadline-engine.now()),fallback:clipped,
        transform:raw=>{
          if(!this.validJob(job) || generation.current && !generation.current()){
            engine.queue=engine.queue.filter(item=>item!==job);return '[SKIP]';
          }
          const value=String(raw || '').trim();
          if(!generation.kind && value!=='[SKIP]') {
            const numbers=line=>(line.match(/\d+(?:\.\d+)?/gu) || []).sort().join(',');
            const states=clipped.match(/已完成|未完成|待确认|待采集|未知|获胜|落败|平局/gu) || [];
            if(numbers(value)!==numbers(clipped) || states.some(state=>!value.includes(state)))return '[SKIP]';
          }
          if(value && value!=='[SKIP]')generation.accept?.(value);
          return value;
        }
      });
    }
    return true;
  }
  validJob(job) {
    if (!job.pkNotice) return true;
    const c = this.engine.config.pkOperations, pk = this.engine.pk.current();
    return c.enabled && job.expires > this.engine.now()
      && (!job.pkFeature || c[job.pkFeature])
      && (!job.pkBattle || pk?.key === job.pkBattle && pk?.phase === 'active' && pk.remainingMs !== 0)
      && (job.pkFeature !== 'midnightEnabled' || pk?.phase !== 'active')
      && (!job.pkStrategy || !pk?.dataQuality?.stale && job.pkRegime === strategyRegime(pk));
  }
  lifecycle(event, state) {
    const engine = this.engine, c = engine.config.pkOperations, now = engine.now();
    if (!engine.running || !c.enabled || !c.announceLifecycle || !state?.key) return;
    // 名单可能晚于开局到达。只更新尚未发送的开局提醒，保留原有效期且不重复播报。
    if (['pk-start','pk-score','room-state'].includes(event.type) && state.phase === 'active') {
      const job = engine.queue.find(item => item.pkLifecycle === 'start' && item.expires > now &&
        (item.pkBattle === state.key || state.startedAt && item.pkStartedAt === state.startedAt && item.pkRoom === state.roomId));
      if (job) {
        const text = [...pkStartText(state,this.ordinal(state))].slice(0,engine.config.sending.maxLength).join('');
        if (text !== job.text || job.pkBattle !== state.key) {
          engine.queue = engine.queue.filter(item => item !== job);
          engine.enqueue('pk',text,{...job,text,pkBattle:state.key,revision:(job.revision || 0)+1,aiPending:false,readyAt:now});
        }
      }
    }
    if (!['pk-start','pk-end'].includes(event.type)) return;
    // 补推或恢复的历史事件不触发公屏播报。
    if (now - (event.receivedAt || now) > 15000 || Number.isFinite(event.at) && now - event.at > 15000) return;
    const key = `${state.key}:${event.type}`;
    if (event.type === 'pk-start') {
      if (state.phase !== 'active') return;
      const startKey = state.roomId && state.startedAt ? `start:${state.roomId}:${state.anchorId}:${state.startedAt}` : key;
      if (this.notices.has(key)) return;
      this.notice(startKey, pkStartText(state,this.ordinal(state)), {pkFeature:'announceLifecycle',pkLifecycle:'start',pkBattle:state.key,pkStartedAt:state.startedAt,pkRoom:state.roomId, expires:now + 15000});
    } else {
      if (state.phase !== 'ended') return;
      const row = [...engine.anchorStats.records.values()].find(item => item.battleKey === state.key && item.anchorId === engine.config.anchorId);
      const result = {win:'获胜',loss:'落败',draw:'平局'}[row?.outcome] || '终局待确认';
      const rivals = pkRivals(state);
      const opponent = rivals.length > 1 ? `对手${rivals.slice(0,3).map(item => `${pkName(item)}${item.scoreObserved ? item.score : '未知'}分`).join('、')}${rivals.length > 3 ? '等' : ''}`
        : `对手${state.opponentScoreObserved ? state.opponentScore : '未知'}分`;
      if (!this.notices.has(key)) {
        this.notice(key, `PK结束，${result}，己方${state.selfScoreObserved ? state.selfScore : '未知'}分，${opponent}。`, {pkFeature:'announceLifecycle',expires:now + 30000});
        this.notice(`${key}:summary`,this.sessionText(),{pkFeature:'announceLifecycle',expires:now + 30000});
      }
    }
  }
  tick(canSend) {
    const engine = this.engine, c = engine.config.pkOperations, now = engine.now();
    engine.queue = engine.queue.filter(job => this.validJob(job));
    if (!engine.running || !c.enabled || !canSend) return;
    const view = this.view(), pk = engine.pk.current();
    if (c.reportEnabled && now >= this.nextReport) {
      this.nextReport = now + c.reportSec * 1000;
      const task = view.task && !view.task.stale ? view.task : null;
      const valid = task?.valid != null ? `${task.valid}${task.target != null ? `/${task.target}` : ''}` : '待采集';
      const first = task?.firstWin === true ? '已完成' : task?.firstWin === false ? '未完成' : '待确认';
      const period = Math.floor(now / (c.reportSec * 1000));
      this.notice(`report:${period}`, `平台任务：有效PK ${valid}，首胜${first}。`,{pkFeature:'reportEnabled'});
      if (task?.validWins != null) this.notice(`report-wins:${period}`, `平台任务：有效PK胜利${task.validWins}${task.winTarget != null ? `/${task.winTarget}` : ''}场。`,{pkFeature:'reportEnabled'});
      const s = view.session;
      this.notice(`report-session:${period}`,this.sessionText(),{pkFeature:'reportEnabled'});
      if (s.active || s.pendingResults) this.notice(`report-pending:${period}`, `本场PK：进行中${s.active}场，已结束待确认${s.pendingResults}场。`,{pkFeature:'reportEnabled'});
      if (view.exhibition && now - view.exhibition.updatedAt < 120000) this.notice(`exhibition:${Math.floor(now / (c.reportSec * 1000))}`, `展馆已观测点亮${view.exhibition.lightedCount}/${view.exhibition.totalCount}项${view.exhibition.partial || view.exhibition.truncated ? '，列表不完整' : ''}。`,{pkFeature:'reportEnabled'});
      if (view.exhibitionRetention && !view.exhibitionRetention.stale) this.notice(`retention:${Math.floor(now / (c.reportSec * 1000))}`, `${view.exhibitionRetention.name}，${view.exhibitionRetention.remaining ? `还差${view.exhibitionRetention.remaining}款保级` : '已保级'}。`,{pkFeature:'reportEnabled'});
    }
    if (c.midnightEnabled && view.plan && pk?.phase !== 'active') {
      const plan = view.plan, until = plan.startAt - now;
      if (until <= c.preparationSec * 1000 && until > 0) this.notice(`midnight:prepare:${plan.midnight}`, `首胜以平台为准：建议${clock(plan.startAt)}开PK，预计${clock(plan.endAt)}结束。`, {pkFeature:'midnightEnabled',expires:plan.startAt});
      if (until <= 0 && until >= -5000) this.notice(`midnight:start:${plan.midnight}`, `到零点PK建议时间，按${c.durationSec}秒开局预计跨零点；首胜以平台为准。`, {pkFeature:'midnightEnabled',expires:now + 5000});
    }
    if (c.aiEnabled && pk?.phase === 'active' && now >= this.nextAI) {
      this.nextAI = now + c.aiIntervalSec * 1000;
      engine.requestPKStrategy(pk);
    }
  }
}
