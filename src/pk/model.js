// PK 运行时统计模型。只使用页面已观测到的事件，不假设抖音服务端的内部规则。
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const keyOf = user => user?.id ? `uid:${user.id}` : user?.secUid ? `sec:${user.secUid}` : user?.name ? `name:${user.name}` : '';
const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
const CHAT_TERMS = {
  positive: ['加油', '稳住', '稳了', '必胜', '冲', '守住', '赢'],
  negative: ['逆风', '落后', '难了', '没了', '投降', '不打', '守不住'],
  request: ['上票', '上分', '支援', '救场', '助力', '大哥', '票呢'],
  comeback: ['反超', '追分', '翻盘', '冲刺', '追上']
};

export const PK_EVENT_TYPES = new Set(['pk-start', 'pk-score', 'pk-end', 'pk-contribution', 'pk-effect', 'pk-multiplier', 'pk-card']);

export function emptyPKState(key = '') {
  return {
    key, provisional: false, roomId: '', anchorId: '', anchorName: '', opponentId: '', opponentName: '',
    competitors: {},
    startedAt: 0, endedAt: 0, remainingMs: null, remainingUpdatedAt: 0, phase: 'idle',
    selfScore: 0, opponentScore: 0, selfSpeed: 0, opponentSpeed: 0,
    selfScoreObserved: false, opponentScoreObserved: false,
    selfVelocity60: 0, opponentVelocity60: 0, lastScoreAt: 0, lastEventAt: 0,
    selfScoreAt: null, opponentScoreAt: null, selfScoreMeta: {}, opponentScoreMeta: {}, clockAt: null, scoreEventIds: [], giftCombos: {},
    selfGifts: 0, opponentGifts: 0, selfGiftValue: 0, opponentGiftValue: 0,
    selfUsers: {}, opponentUsers: {}, contributionBoards: {}, opponentRoomIds: [], chatHistory: [],
    chatSignals: { total: 0, recent: 0, self: { total: 0, positive: 0, negative: 0, request: 0, comeback: 0 }, opponent: { total: 0, positive: 0, negative: 0, request: 0, comeback: 0 }, latestAt: 0, sampleSize: 0 },
    history: [],
    multiplierObservations: [], cardObservations: [], effects: [],
    prediction: { selfWin: null, opponentWin: null, draw: null, confidence: 0, sampleSize: 0, factors: [], status: 'unknown' },
    source: 'observed', dataQuality: { events: 0, lastAt: 0, lagMs: null, missingScoreEvents: 0, scoreSamples: 0, rejectedScoreEvents: 0, unassignedGifts: 0 }
  };
}

function ensureState(state, event) {
  if (!state) state = emptyPKState(event.battleId || event.roomId || 'default');
  // 对面房间的聊天事件用于归属判断，不能覆盖战局的主房间 ID。
  // 新建状态或同一主房间聊天仍然需要补齐 roomId。
  const metadata = ['pk-start', 'pk-score', 'pk-end', 'room-state'].includes(event.type);
  if (event.roomId && (!state.roomId || state.roomId === String(event.roomId))) state.roomId = String(event.roomId);
  if (event.anchorId && metadata) state.anchorId = String(event.anchorId);
  if (event.anchorName && metadata) state.anchorName = String(event.anchorName).slice(0, 80);
  if (event.opponentId) state.opponentId = String(event.opponentId);
  if (event.opponentName) state.opponentName = String(event.opponentName).slice(0, 80);
  const roomIds = Array.isArray(event.opponentRoomIds) ? event.opponentRoomIds : event.opponentRoomId ? [event.opponentRoomId] : [];
  for (const roomId of roomIds) if (roomId != null && String(roomId) !== state.roomId && !state.opponentRoomIds.includes(String(roomId))) state.opponentRoomIds.push(String(roomId));
  state.opponentRoomIds = state.opponentRoomIds.slice(-8);
  return state;
}

function orientScores(state, event) {
  const participants = Array.isArray(event.participants) ? event.participants : [];
  for (const item of participants) {
    if (!item?.anchorId) continue;
    const id = String(item.anchorId), old = state.competitors[id] || { anchorId:id, score:0, scoreObserved:false, scoreAt:null, scoreMeta:{} };
    state.competitors[id] = { ...old, name:String(item.name || old.name || '').slice(0,80), roomId:String(item.roomId || old.roomId || ''), isSelf:id === String(state.anchorId || event.anchorId || '') };
  }
  const self = participants.find(item => item.anchorId && String(item.anchorId) === state.anchorId)
    || participants.find(item => item.roomId && String(item.roomId) === state.roomId);
  if (!state.anchorId && self) state.anchorId = String(self.anchorId || '');
  if (self?.name) state.anchorName = self.name;
  const rivals = participants.filter(item => String(item.anchorId) !== state.anchorId);
  const rival = rivals.find(item => String(item.anchorId) === state.opponentId) || (self && rivals.length === 1 ? rivals[0] : null);
  if (rival) {
    state.opponentId = String(rival.anchorId); state.opponentName = rival.name || state.opponentName;
    if (rival.roomId && !state.opponentRoomIds.includes(String(rival.roomId))) state.opponentRoomIds.push(String(rival.roomId));
  }
  const scores = Array.isArray(event.scores) ? event.scores : [];
  const ownScore = scores.find(item => item.anchorId && String(item.anchorId) === state.anchorId);
  const others = scores.filter(item => String(item.anchorId) !== state.anchorId);
  const otherScore = scores.find(item => item.anchorId && String(item.anchorId) === state.opponentId)
    || (ownScore && others.length === 1 ? others[0] : null);
  if (otherScore && !state.opponentId) state.opponentId = String(otherScore.anchorId);
  const meta = item => Object.fromEntries(['scoreVersion', 'contributorCount', 'buffScoreRatio'].filter(field => item[field] != null).map(field => [field, item[field]]));
  const names = new Map(participants.map(item => [String(item.anchorId), item.name || '']));
  const competitorScores = scores.filter(item => item?.anchorId && Number.isFinite(item.score) && item.score >= 0).map(item => ({
    anchorId:String(item.anchorId), name:names.get(String(item.anchorId)) || state.competitors[String(item.anchorId)]?.name || '',
    score:item.score, scoreMeta:meta(item), isSelf:String(item.anchorId) === String(state.anchorId || event.anchorId || '')
  }));
  return { ...event, ...(competitorScores.length ? { competitorScores } : {}), ...(ownScore ? { selfScore: ownScore.score, selfScoreMeta: meta(ownScore) } : {}), ...(otherScore ? { opponentScore: otherScore.score, opponentScoreMeta: meta(otherScore) } : {}) };
}

function multiPrediction(state, now, sampleSize) {
  const competitors = Object.values(state.competitors).filter(item => item.scoreObserved);
  const all = Object.values(state.competitors);
  if (all.length < 3) return null;
  const base = { selfWin:null, opponentWin:null, draw:null, confidence:0, sampleSize, factors:[], status:'unknown', competitors:[] };
  if (state.phase === 'active' && state.remainingMs === 0) return { ...base, status:'awaiting-final', factors:['倒计时已归零，等待平台终局确认'] };
  if (competitors.length < 3 || competitors.length !== all.length) return { ...base, factors:['等待所有参战主播的实时比分'] };
  const age = Math.max(...competitors.map(item => Math.max(0, now - item.scoreAt)));
  if (state.phase !== 'ended' && age > 60000) return { ...base, factors:['多人比分已过期，等待实时更新'] };
  if (state.phase === 'ended') {
    const max = Math.max(...competitors.map(item => item.score));
    const winners = competitors.filter(item => item.score === max);
    const results = competitors.map(item => ({ anchorId:item.anchorId, name:item.name || item.anchorId, win:winners.some(winner => winner.anchorId === item.anchorId) ? 1 / winners.length : 0 }));
    return { ...base, selfWin:results.find(item => item.anchorId === state.anchorId)?.win ?? null, opponentWin:null, draw:winners.length > 1 ? 1 : 0,
      confidence:1, status:'final', factors:['已观测全部参战主播的终局比分'], competitors:results };
  }
  const remaining = Number.isFinite(state.remainingMs) ? Math.max(0,state.remainingMs / 1000) : 0;
  const projected = competitors.map(item => {
    const prior = [...state.history].reverse().find(point => point.competitorScores?.[item.anchorId] != null && point.at <= now - 15000);
    const latest = [...state.history].reverse().find(point => point.competitorScores?.[item.anchorId] != null && point.at <= now);
    const interval = prior && latest ? Math.max(1,(latest.at-prior.at)/1000) : 0;
    const rate = interval ? Math.max(0,(latest.competitorScores[item.anchorId]-prior.competitorScores[item.anchorId])/interval) : 0;
    return { ...item, projected:item.score + rate * remaining };
  });
  const max = Math.max(...projected.map(item => item.projected));
  const scale = Math.max(1, ...projected.map(item => Math.abs(item.projected-max) * .12), max * .04);
  const weights = projected.map(item => Math.exp(Math.max(-30,Math.min(0,(item.projected-max)/scale))));
  const total = weights.reduce((sum,value)=>sum+value,0);
  const confidence = clamp((.2 + Math.min(.55, finite(state.dataQuality.scoreSamples) / 20)) * clamp(1-age/60000) * (Number.isFinite(state.remainingMs) ? 1 : .45));
  const results = projected.map((item,index)=>({anchorId:item.anchorId,name:item.name || item.anchorId,score:item.score,projectedScore:item.projected,win:weights[index]/total}));
  return { ...base, selfWin:results.find(item=>item.anchorId===state.anchorId)?.win ?? null, opponentWin:null, draw:0, confidence,
    status:confidence < .35 ? 'low-confidence' : 'estimated', factors:['按各主播当前比分与观测速度估算夺冠概率；多人场次概率总和为 100%','参战方比分覆盖完整'], competitors:results };
}

function chatSide(state, event) {
  if (event.side === 'self' || event.side === 'opponent') return event.side;
  const roomId = String(event.roomId || '');
  if (roomId && roomId === state.roomId) return 'self';
  if (roomId && state.opponentRoomIds.includes(roomId)) return 'opponent';
  return null;
}

function classifyChat(text) {
  const value = String(text || '').slice(0, 300);
  const result = { positive: 0, negative: 0, request: 0, comeback: 0 };
  for (const [kind, terms] of Object.entries(CHAT_TERMS)) result[kind] = terms.some(term => value.includes(term)) ? 1 : 0;
  return result;
}

function ingestChat(state, event, at) {
  const text = String(event.text || '').trim();
  if (!text) return;
  const side = chatSide(state, event), signals = classifyChat(text);
  if (!side || state.phase !== 'active') return;
  const item = { at, roomId: String(event.roomId || ''), side, signals, text: text.slice(0, 160) };
  state.chatHistory.push(item); state.chatHistory = state.chatHistory.slice(-240);
  const bucket = state.chatSignals[side] || state.chatSignals.self;
  bucket.total += 1;
  for (const key of Object.keys(signals)) bucket[key] += signals[key];
  state.chatSignals.total += 1; state.chatSignals.latestAt = at; state.chatSignals.sampleSize = state.chatHistory.length;
  state.chatSignals.recent = state.chatHistory.filter(entry => at - entry.at <= 60000).length;
}

function empirical(items) {
  const observed = items.filter(item => typeof item.success === 'boolean' || typeof item.triggered === 'boolean' || typeof item.won === 'boolean');
  const successes = observed.filter(item => item.success === true || item.triggered === true || item.won === true).length;
  return observeRate(successes, observed.length);
}

function addUser(state, side, user, value, at, count = 1) {
  const key = keyOf(user);
  if (!key) return;
  const bucket = side === 'self' ? state.selfUsers : state.opponentUsers;
  const old = bucket[key] || { key, id: user.id || '', name: user.name || '', wealthLevel: user.wealthLevel ?? null, fanLevel: user.fanLevel ?? null, gifts: 0, value: 0, lastAt: 0, events: 0 };
  old.gifts += count; old.value += Math.max(0, value); old.lastAt = at; old.events += 1;
  if (user.name) old.name = String(user.name).slice(0, 80);
  if (Number.isFinite(user.wealthLevel)) old.wealthLevel = user.wealthLevel;
  if (Number.isFinite(user.fanLevel)) old.fanLevel = user.fanLevel;
  bucket[key] = old;
  boundUsers(state, bucket);
}

function boundUsers(state, bucket) {
  const users = Object.values(bucket);
  if (users.length <= 1000) return;
  users.sort((a,b)=>(b.lastAt || b.scoreAt || 0)-(a.lastAt || a.scoreAt || 0));
  for (const user of users.slice(1000)) delete bucket[user.key];
  state.dataQuality.contributorsTruncated = true;
}

function sideForGift(state, event) {
  if (event.side === 'self' || event.side === 'opponent') return event.side;
  const id = String(event.recipientId || event.targetAnchorId || event.anchorId || event.user?.anchorId || '');
  if (id && id === state.opponentId) return 'opponent';
  if (id && id === state.anchorId) return 'self';
  if (event.isOpponent === true) return 'opponent';
  if (id) return null;
  if (event.roomId && String(event.roomId) === state.roomId) return 'self';
  if (event.roomId && state.opponentRoomIds.includes(String(event.roomId))) return 'opponent';
  return null;
}

function mergeContributors(state, event, at) {
  const side = sideForGift(state, event);
  if (!side) return;
  if (Number.isFinite(event.contributorCount)) state[`${side}ScoreMeta`] = { ...state[`${side}ScoreMeta`], contributorCount: event.contributorCount };
  for (const entry of (event.contributors || []).slice(0, 100)) {
    const user = entry.user || entry, key = keyOf(user);
    if (!key || !Number.isFinite(entry.score) || entry.score < 0) continue;
    const bucket = state[`${side}Users`];
    const old = bucket[key] || { key, id: user.id || '', name: user.name || '', gifts: 0, value: 0, lastAt: 0, events: 0 };
    if (old.scoreAt != null && at < old.scoreAt) continue;
    bucket[key] = { ...old, ...Object.fromEntries(['name', 'wealthLevel', 'fanLevel'].filter(field => user[field] != null).map(field => [field, user[field]])),
      score: entry.score, rank: Number.isFinite(entry.rank) ? entry.rank : null, scoreAt: at,
      lastAt: Math.max(old.lastAt, entry.score > finite(old.score) ? at : old.lastAt) };
  }
  boundUsers(state, state[`${side}Users`]);
}

function velocity(state, side, now, windowMs) {
  const cutoff = now - windowMs;
  const field = side === 'self' ? 'selfDelta' : 'opponentDelta';
  const observedDelta = state.history.reduce((sum, item) => {
    const endAt = item[`${side}At`] ?? item.at;
    if (endAt > now || endAt <= cutoff) return sum;
    const startAt = item[`${side}FromAt`];
    // 断线或稀疏采样只证明整个区间的增量，不能将其全部当作刚刚发生。
    const intervalMs = Number.isFinite(startAt) ? endAt - startAt : 0;
    const weight = intervalMs > 15000 ? Math.max(0, endAt - Math.max(cutoff, startAt)) / intervalMs : 1;
    return sum + finite(item[field]) * weight;
  }, 0);
  return observedDelta / (windowMs / 1000);
}

function contributionIntent(users, now) {
  const values = Object.values(users);
  if (!values.length) return { probability: null, expected: null, sampleSize: 0, confidence: 0 };
  const active = values.filter(user => now - user.lastAt <= 90000);
  const probability = active.length / values.length;
  const expected = active.reduce((sum, user) => sum + user.value, 0);
  const confidence = clamp(Math.min(1, values.length / 8) * (active.length ? .8 : .35));
  return { probability, expected, sampleSize: values.length, confidence, kind: 'observed-activity', description: '已观测贡献者中近 90 秒活跃的比例；不代表未来付费概率' };
}

function scoreQuality(state, now) {
  const competitors=Object.values(state.competitors || {});
  if (competitors.length >= 3) {
    const observed=competitors.filter(item=>item.scoreObserved && Number.isFinite(item.scoreAt));
    const complete=observed.length===competitors.length;
    const scoreAgeMs=complete ? Math.max(...observed.map(item=>Math.max(0,now-item.scoreAt))) : null;
    return { ...state.dataQuality, selfScoreAgeMs:state.anchorId ? Math.max(0,now-(state.competitors[state.anchorId]?.scoreAt ?? now)) : null,
      opponentScoreAgeMs:scoreAgeMs, scoreAgeMs, stale:state.phase!=='ended' && (!complete || scoreAgeMs>15000), complete, remainingKnown:Number.isFinite(state.remainingMs) };
  }
  const age = side => state[`${side}ScoreObserved`] && Number.isFinite(state[`${side}ScoreAt`]) ? Math.max(0, now - state[`${side}ScoreAt`]) : null;
  const selfScoreAgeMs = age('self'), opponentScoreAgeMs = age('opponent');
  const complete = selfScoreAgeMs !== null && opponentScoreAgeMs !== null;
  const scoreAgeMs = complete ? Math.max(selfScoreAgeMs, opponentScoreAgeMs) : null;
  return { ...state.dataQuality, selfScoreAgeMs, opponentScoreAgeMs, scoreAgeMs,
    stale: state.phase !== 'ended' && (!complete || scoreAgeMs > 15000), complete,
    remainingKnown: Number.isFinite(state.remainingMs) };
}

function updateClock(state, event, at) {
  if (state.clockAt != null && at < state.clockAt) return;
  let value = event.remainingMs;
  if (!Number.isFinite(value) && Number.isFinite(event.endsAt)) value = event.endsAt - at;
  if (!Number.isFinite(value) && Number.isFinite(event.durationMs) && event.type === 'pk-start' && state.clockAt == null) value = event.durationMs;
  if (!Number.isFinite(value)) return;
  state.remainingMs = Math.max(0, value); state.remainingUpdatedAt = at; state.clockAt = at;
}

function recordScores(state, event, at) {
  const eventId = event.id ? String(event.id) : '';
  if (eventId && state.scoreEventIds.includes(eventId)) return false;
  let accepted = false;
  const point = { kind: 'score', at, selfDelta: 0, opponentDelta: 0,
    selfScore: state.selfScoreObserved && state.selfScoreAt <= at ? state.selfScore : null,
    opponentScore: state.opponentScoreObserved && state.opponentScoreAt <= at ? state.opponentScore : null };
  for (const item of event.competitorScores || []) {
    const id = String(item.anchorId || '');
    if (!id || !Number.isFinite(item.score) || item.score < 0) continue;
    const old = state.competitors[id] || { anchorId:id, name:'', roomId:'', score:0, scoreObserved:false, scoreAt:null, scoreMeta:{} };
    const timestamp = Number.isFinite(item.scoreAt) ? Math.min(at,item.scoreAt) : at;
    if (old.scoreObserved && ((old.scoreAt != null && timestamp < old.scoreAt) || item.score < old.score)) { state.dataQuality.rejectedScoreEvents += 1; continue; }
    state.competitors[id] = { ...old, name:String(item.name || old.name || '').slice(0,80), isSelf:Boolean(item.isSelf || id === String(state.anchorId || '')),
      score:item.score, scoreObserved:true, scoreAt:timestamp, scoreMeta:{...old.scoreMeta,...(item.scoreMeta || {})} };
    accepted = true;
  }
  for (const side of ['self', 'opponent']) {
    const value = event[`${side}Score`] ?? (event.side === side || (side === 'self' && !event.side) ? event.score : undefined);
    if (!Number.isFinite(value) || value < 0) continue;
    const timestamp = Number.isFinite(event[`${side}ScoreAt`]) ? Math.min(at, event[`${side}ScoreAt`]) : at;
    const oldAt = state[`${side}ScoreAt`], observed = state[`${side}ScoreObserved`];
    if (observed && ((oldAt != null && timestamp < oldAt) || value < state[`${side}Score`])) {
      state.dataQuality.rejectedScoreEvents += 1; continue;
    }
    point[`${side}Delta`] = observed ? value - state[`${side}Score`] : 0;
    point[`${side}At`] = timestamp;
    point[`${side}FromAt`] = observed ? oldAt : timestamp;
    state[`${side}Score`] = value; state[`${side}ScoreObserved`] = true; state[`${side}ScoreAt`] = timestamp;
    if (event[`${side}ScoreMeta`]) state[`${side}ScoreMeta`] = { ...state[`${side}ScoreMeta`], ...event[`${side}ScoreMeta`] };
    point[`${side}Score`] = value; accepted = true;
  }
  if (!accepted) return false;
  point.competitorScores = Object.fromEntries(Object.values(state.competitors).filter(item=>item.scoreObserved).map(item=>[item.anchorId,item.score]));
  if (eventId) state.scoreEventIds = [...state.scoreEventIds, eventId].slice(-500);
  // A point records what was known at this instant; an unobserved side is never a zero.
  state.history.push(point); state.history = state.history.slice(-600);
  state.lastScoreAt = Math.max(state.lastScoreAt, at); state.dataQuality.scoreSamples += 1;
  return true;
}

function analyzePK(state) {
  const complete = state.selfScoreObserved && state.opponentScoreObserved;
  const gap = complete ? state.selfScore - state.opponentScore : null;
  const remaining = Number.isFinite(state.remainingMs) ? state.remainingMs / 1000 : null;
  const selfRate = state.selfSpeed * .65 + state.selfVelocity60 * .35;
  const opponentRate = state.opponentSpeed * .65 + state.opponentVelocity60 * .35;
  const speedGap = selfRate - opponentRate;
  const awaitingFinal = state.phase === 'active' && remaining === 0;
  const canProject = state.phase === 'active' && !state.dataQuality.stale && remaining > 0;
  const projectedGap = gap != null && canProject ? gap + speedGap * remaining : null;
  const requiredRate = gap != null && gap < 0 && canProject ? opponentRate + (-gap + 1) / remaining : null;
  const catchUpSeconds = gap != null && gap < 0 && canProject && speedGap > 0 ? -gap / speedGap : null;
  const risks = [];
  if (!complete) risks.push('双方比分尚未完整观测');
  if (state.dataQuality.stale) risks.push('比分已过期，等待实时更新');
  if (remaining == null) risks.push('未获取剩余时间，无法判断冲刺阶段');
  if (awaitingFinal) risks.push('倒计时已归零，等待平台终局确认');
  if (state.history.filter(point => point.kind === 'score').length < 3) risks.push('比分变化样本不足，短时速度参考有限');
  if (gap != null && projectedGap != null && gap * projectedGap < 0) risks.push('按近期速度延续，当前领先可能反转');
  const lead = gap == null ? 'unknown' : gap === 0 ? 'tie' : gap > 0 ? 'self' : 'opponent';
  const summary = state.phase === 'ended' && complete ? (gap === 0 ? '本场平局' : `${gap > 0 ? '己方' : '对方'}获胜`)
    : awaitingFinal ? '倒计时归零，等待平台终局确认'
    : !complete ? '等待双方实时比分' : `${gap === 0 ? '双方暂时持平' : `${gap > 0 ? '己方领先' : '己方落后'} ${Math.abs(gap).toLocaleString()} 分`}${state.dataQuality.stale ? '，比分待刷新' : ''}`;
  return { summary, lead, gap, projectedGap, requiredRate, catchUpSeconds, selfRate, opponentRate, speedGap, awaitingFinal,
    volatileLead: gap != null && projectedGap != null && gap * projectedGap < 0, risks,
    basis: '近期 15 秒与 60 秒官方比分增量的加权线性外推；不是官方胜率，也不假定礼物价值等于 PK 分' };
}

export function predictPK(state, now = Date.now(), history = []) {
  // history 是 tracker 级别的已结束场次；当前状态的 pk-end 不再重复计入。
  const sampleSize = history.length;
  const multi = multiPrediction(state, now, sampleSize);
  if (multi) return multi;
  const total = state.selfScore + state.opponentScore;
  const elapsed = state.startedAt ? Math.max(1, (Math.min(now, state.endedAt || now) - state.startedAt) / 1000) : 0;
  const quality = scoreQuality(state, now);
  if (state.phase === 'active' && state.remainingMs === 0) return { selfWin: null, opponentWin: null, draw: null, confidence: 0, sampleSize, factors: ['倒计时已归零，等待平台终局确认'], status: 'awaiting-final', elapsed };
  if (state.phase === 'idle' || !state.selfScoreObserved || !state.opponentScoreObserved || (state.phase !== 'ended' && (quality.scoreAgeMs == null || quality.scoreAgeMs > 60000))) {
    return { selfWin: null, opponentWin: null, draw: null, confidence: 0, sampleSize, factors: [], status: 'unknown' };
  }
  if (state.phase === 'ended') return { selfWin: Number(state.selfScore > state.opponentScore), opponentWin: Number(state.selfScore < state.opponentScore), draw: Number(state.selfScore === state.opponentScore), confidence: 1, sampleSize, factors: ['已观测终局比分'], status: 'final', elapsed };
  const scoreGap = state.selfScore - state.opponentScore;
  const speedGap = state.selfVelocity60 - state.opponentVelocity60;
  const remainingKnown = Number.isFinite(state.remainingMs);
  const remaining = remainingKnown ? Math.max(0, state.remainingMs / 1000) : 0;
  // 只做透明的 log-odds 基线；系数来自特征尺度，不代表官方权重。
  const scale = Math.max(1, Math.abs(total) * .12, Math.abs(speedGap) * Math.max(10, remaining));
  const logOdds = scoreGap / scale + speedGap * Math.min(60, remaining) / Math.max(1, total * .3);
  const draw = clamp(Math.min(.18, .06 + (remainingKnown && remaining < 10 ? .04 : 0) + (total === 0 ? .08 : 0)));
  const selfWin = (1 - draw) * sigmoid(logOdds), opponentWin = 1 - draw - selfWin;
  const freshness = clamp(1 - quality.scoreAgeMs / 60000);
  const confidence = clamp((.2 + Math.min(.55, finite(quality.scoreSamples) / 20)) * freshness * (remainingKnown ? 1 : .45) * (quality.stale ? .4 : 1));
  const factors = ['基于观测比分的趋势估计，未经真实胜负样本校准'];
  if (Math.abs(scoreGap) > 0) factors.push(`${scoreGap >= 0 ? '己方' : '对方'}当前分差 ${Math.abs(Math.round(scoreGap)).toLocaleString()} 分`);
  if (Math.abs(speedGap) > 0.1) factors.push(`${speedGap >= 0 ? '己方' : '对方'}近 60 秒得分速度更快`);
  if (remainingKnown && remaining <= 30) factors.push(`剩余 ${Math.ceil(remaining)} 秒，结果对速度更敏感`);
  if (!remainingKnown) factors.push('剩余时间未知，降低可信度');
  if (quality.stale) factors.push('比分过期，降低可信度');
  return { selfWin, opponentWin, draw, confidence, sampleSize, factors, status: confidence < .35 ? 'low-confidence' : 'estimated', elapsed };
}

export class PKTracker {
  constructor({ now = Date.now, maxBattles = 40 } = {}) {
    this.now = now; this.maxBattles = maxBattles; this.states = new Map(); this.activeKey = '';
    this.results = []; this.multiplier = []; this.cards = [];
  }
  key(event) { return String(event.battleId || event.pkId || `${event.roomId || 'room'}:${event.opponentId || 'opponent'}`); }
  pruneStates(protectedKey = '') {
    const limit = Math.max(1, Math.floor(finite(this.maxBattles, 40)));
    if (this.states.size <= limit) return;
    const activeKey = this.states.get(this.activeKey)?.phase === 'active' ? this.activeKey : '';
    const phaseRank = state => state.phase === 'active' ? 1 : 0;
    const candidates = [...this.states.values()]
      .filter(state => state.key !== activeKey && state.key !== protectedKey)
      .sort((a, b) => phaseRank(a) - phaseRank(b) || (a.lastEventAt || 0) - (b.lastEventAt || 0));
    while (this.states.size > limit && candidates.length) this.states.delete(candidates.shift().key);
  }
  stateFor(event = {}) {
    const explicit = event.battleId || event.pkId;
    let key = explicit ? this.key(event) : '';
    const contextOnly = ['gift', 'chat'].includes(event.type);
    // 中途入场可能先收到没有 battle_id 的比分；随后补到战局 ID 时保留已观测的比分。
    const activeStates = [...this.states.values()].filter(state => state.phase === 'active');
    const roomStates = event.roomId ? activeStates.filter(state => state.roomId === String(event.roomId) || state.opponentRoomIds.includes(String(event.roomId))) : [];
    const active = event.roomId ? (roomStates.length === 1 ? roomStates[0] : null) : (activeStates.length === 1 ? activeStates[0] : null);
    const sameRoom = event.roomId && active?.roomId === String(event.roomId);
    // 普通直播聊天/礼物属于直播统计；没有明确活跃 PK 上下文时不建立空战局。
    if (contextOnly) {
      const contextual = key ? this.states.get(key) : active;
      if (!contextual || contextual.phase !== 'active') return null;
      if (event.type === 'chat' && !chatSide(contextual, event)) return null;
      if (!key && !event.roomId && event.side !== 'self' && event.side !== 'opponent') return null;
      return contextual;
    }
    if (key && !this.states.has(key) && active?.provisional && sameRoom) {
      this.states.delete(active.key); active.key = key; active.provisional = false;
      this.states.set(key, active); this.activeKey = key;
    }
    if (!key && event.type !== 'pk-start' && active) key = active.key;
    // 无房间、无战局且同时有多场 PK，不能把它塞给最近打开的战局。
    if (!key && event.type !== 'pk-start' && ((!event.roomId && activeStates.length > 1) || roomStates.length > 1)) return null;
    const latestEnd = !key && event.roomId ? [...this.states.values()]
      .filter(state => state.phase === 'ended' && state.roomId === String(event.roomId))
      .sort((a,b)=>b.endedAt-a.endedAt)[0] : null;
    if (latestEnd && event.type === 'pk-end') return latestEnd;
    if (latestEnd && !['pk-start', 'pk-end'].includes(event.type)) {
      // 无 ID 的迟到旧比分和新局首帧无法仅凭分数区别；需要较新的开局时间来证明新局。
      if (!(Number.isFinite(event.startedAt) && event.startedAt > latestEnd.startedAt && event.startedAt >= latestEnd.endedAt)) return null;
      key = `${this.key(event)}:${event.startedAt}`;
    }
    if (!key && event.type === 'pk-start' && latestEnd) key = `${this.key(event)}:${event.startedAt || event.at || event.receivedAt || this.now()}`;
    key ||= this.key(event);
    let state = this.states.get(key);
    if (!state) {
      state = emptyPKState(key);
      state.provisional = !explicit;
      this.states.set(key, state);
      this.pruneStates(key);
    }
    return state;
  }
  ingest(event = {}) {
    if (!event || (!PK_EVENT_TYPES.has(event.type) && !['gift', 'chat', 'room-state'].includes(event.type))) return null;
    const now = finite(event.receivedAt ?? event.capturedAt ?? (event.at > 0 ? event.at : this.now()), this.now());
    const suppliedScoreAt = event.scoreAt ?? (event.at > 0 ? event.at : now);
    const scoreAt = Math.min(now, finite(suppliedScoreAt, now));
    if (event.type === 'pk-multiplier') { this.multiplier.push({ ...event, observedAt: now }); this.multiplier = this.multiplier.slice(-500); return this.snapshot(); }
    if (event.type === 'pk-card') { this.cards.push({ ...event, observedAt: now }); this.cards = this.cards.slice(-1000); return this.snapshot(); }
    const state = this.stateFor(event);
    if (!state) return this.snapshot();
    ensureState(state, event); event = orientScores(state, event);
    for (const board of Object.values(state.contributionBoards)) mergeContributors(state, board, board.observedAt);
    if (state.phase === 'ended') return this.snapshot(state.key);
    state.lastEventAt = Math.max(state.lastEventAt, now); state.dataQuality.events += 1; state.dataQuality.lastAt = now;
    if (event.type === 'chat') {
      ingestChat(state, event, now);
    } else if (event.type === 'pk-start') {
      state.phase = 'active'; state.startedAt = event.startedAt || state.startedAt || now; state.endedAt = 0;
      updateClock(state, event, scoreAt);
      recordScores(state, event, scoreAt);
      this.activeKey = state.key;
    } else if (['pk-score', 'room-state', 'pk-contribution'].includes(event.type)) {
      const hasScore = [event.selfScore, event.opponentScore, event.score].some(Number.isFinite) || (event.competitorScores || []).some(item=>Number.isFinite(item.score));
      if (hasScore) {
        if (state.phase === 'idle') { state.phase = 'active'; state.startedAt = event.startedAt || now; this.activeKey = state.key; }
        const accepted = recordScores(state, event, scoreAt);
        if (accepted) state.dataQuality.lagMs = Math.max(0, this.now() - scoreAt);
      }
      updateClock(state, event, scoreAt);
      if (event.type === 'pk-contribution') {
        const boardKey = String(event.anchorId || event.side || event.roomId || 'unknown');
        const previous = state.contributionBoards[boardKey];
        if (!previous || scoreAt >= previous.observedAt) {
          state.contributionBoards[boardKey] = { anchorId: event.anchorId, roomId: event.roomId, side: event.side,
            contributorCount: event.contributorCount, contributors: (event.contributors || []).slice(0, 100), observedAt: scoreAt };
          for (const key of Object.keys(state.contributionBoards).slice(0,-8)) delete state.contributionBoards[key];
          mergeContributors(state, event, scoreAt);
        }
      }
    } else if (event.type === 'gift') {
      if (state.phase !== 'active') return this.snapshot(state.key);
      const side = sideForGift(state, event);
      if (!side) { state.dataQuality.unassignedGifts += 1; return this.snapshot(state.key); }
      const count = Math.max(1, finite(event.count, 1));
      const identity = event.groupId || event.id;
      const comboKey = identity ? JSON.stringify([side, event.roomId || '', keyOf(event.user), event.giftId || event.giftName || '', identity]) : '';
      const previous = comboKey ? finite(state.giftCombos[comboKey]) : 0;
      const increment = Math.max(0, count - previous);
      if (!increment) return this.snapshot(state.key);
      if (comboKey) {
        state.giftCombos[comboKey] = Math.max(previous, count);
        const keys = Object.keys(state.giftCombos);
        for (const key of keys.slice(0, Math.max(0, keys.length - 2000))) delete state.giftCombos[key];
      }
      const value = Math.max(0, finite(event.unitValue)) * increment;
      state[`${side}Gifts`] += increment; state[`${side}GiftValue`] += value;
      addUser(state, side, event.user, value, now, increment);
      // 礼物金额、连击和官方 PK 积分分别计量，礼物不能直接更改比分。
    } else if (event.type === 'pk-effect') {
      const side = sideForGift(state, event);
      const effect = { ...event, side: side || 'unknown', observedAt: now };
      const index = state.effects.findIndex(item => event.id && item.id === event.id);
      if (index >= 0) state.effects[index] = effect;
      else state.effects.push(effect);
      state.effects = state.effects.slice(-100);
    } else if (event.type === 'pk-end') {
      recordScores(state, event, scoreAt);
      state.phase = 'ended'; state.endedAt = now; state.remainingMs = 0; state.remainingUpdatedAt = now;
      if (!this.activeKey) this.activeKey = state.key;
      if (Object.keys(state.competitors).length >= 3 && Object.values(state.competitors).every(item=>item.scoreObserved)) {
        const scores = Object.values(state.competitors), high = Math.max(...scores.map(item=>item.score));
        const winners = scores.filter(item=>item.score===high).map(item=>item.anchorId);
        this.results.push({key:state.key,at:now,winner:winners.length===1 ? winners[0] : 'draw',winnerIds:winners,scores:Object.fromEntries(scores.map(item=>[item.anchorId,item.score]))});
        this.results=this.results.slice(-200); state.history.push({kind:'pk-end',at:now,winner:winners.length===1 ? winners[0] : 'draw',winnerIds:winners});
      } else if (state.selfScoreObserved && state.opponentScoreObserved) {
        const winner = state.selfScore === state.opponentScore ? 'draw' : state.selfScore > state.opponentScore ? 'self' : 'opponent';
        this.results.push({ key: state.key, at: now, winner, selfScore: state.selfScore, opponentScore: state.opponentScore });
        this.results = this.results.slice(-200); state.history.push({ kind: 'pk-end', at: now, winner });
      }
    }
    return this.snapshot(state.key);
  }
  snapshot(key = this.activeKey) {
    const state = this.states.get(key); if (!state) return { activeKey: this.activeKey, states: [], results: this.results.slice(-50), multipliers: this.multiplier.slice(-100), cards: this.cards.slice(-100) };
    const now = this.now();
    const remainingMs = state.phase === 'active' && Number.isFinite(state.remainingMs) && Number.isFinite(state.remainingUpdatedAt)
      ? Math.max(0, state.remainingMs - Math.max(0, now - state.remainingUpdatedAt))
      : state.remainingMs;
    const view = { ...state, remainingMs, remainingUpdatedAt: Number.isFinite(remainingMs) ? now : state.remainingUpdatedAt,
      selfSpeed: velocity(state, 'self', now, 15000), opponentSpeed: velocity(state, 'opponent', now, 15000),
      selfVelocity60: velocity(state, 'self', now, 60000), opponentVelocity60: velocity(state, 'opponent', now, 60000),
      dataQuality: scoreQuality(state, now) };
    view.prediction = predictPK(view, now, this.results);
    view.analysis = analyzePK(view);
    const selfIntent = contributionIntent(state.selfUsers, now), opponentIntent = contributionIntent(state.opponentUsers, now);
    const chatSignals = { ...state.chatSignals, self: { ...state.chatSignals.self }, opponent: { ...state.chatSignals.opponent }, recent: state.chatHistory.filter(item => now - item.at <= 60000).length };
    const rankUsers = users => Object.values(users).sort((a,b)=>(b.score ?? -1)-(a.score ?? -1) || b.value-a.value).slice(0,20);
    const effects = state.effects.map(effect => {
      const endAt = Number.isFinite(effect.endAt) ? effect.endAt : Number.isFinite(effect.startAt) && Number.isFinite(effect.durationMs) ? effect.startAt + effect.durationMs : null;
      return { ...effect, endAt, active: endAt != null && endAt > now && (!Number.isFinite(effect.startAt) || effect.startAt <= now) && effect.status !== 'ended' };
    });
    const trend = state.history.filter(item => item.kind === 'score').map(({at,selfScore,opponentScore,competitorScores}) => ({at,selfScore,opponentScore,competitorScores})).sort((a,b)=>a.at-b.at);
    const competitors = Object.values(state.competitors).map(item=>({ ...item, scoreAgeMs:item.scoreObserved ? Math.max(0,now-item.scoreAt) : null })).sort((a,b)=>(b.scoreObserved ? b.score : -1)-(a.scoreObserved ? a.score : -1));
    return { ...view, competitors, effects, trend, selfUsers: rankUsers(state.selfUsers), opponentUsers: rankUsers(state.opponentUsers), opponentRoomIds: [...state.opponentRoomIds], chatSignals, chatHistory: state.chatHistory.slice(-30), selfIntent, opponentIntent, multiplierStats: empirical(this.multiplier), cardStats: empirical(this.cards), results: this.results.slice(-50), multipliers: this.multiplier.slice(-100), cards: this.cards.slice(-100) };
  }
  current() { return this.snapshot(this.activeKey); }
  all() { return [...this.states.values()].map(state => this.snapshot(state.key)); }
  export() {
    // 持久化内部数据而非面板的 top 20 / 最近 30 条视图。倒计时保留原始时钟基准。
    const states = [...this.states.values()].map(state => ({ ...state,
      selfUsers: Object.values(state.selfUsers), opponentUsers: Object.values(state.opponentUsers),
      chatHistory: state.chatHistory.slice(-240) }));
    return { version: 2, activeKey: this.activeKey, states, results: this.results, multipliers: this.multiplier, cards: this.cards };
  }
  restore(saved) {
    if (!saved || ![1, 2].includes(saved.version)) return false;
    const legacy = saved.version === 1;
    this.states.clear(); this.activeKey = saved.activeKey || '';
    // v1 的启发式协议曾把用户 ID 当比分、普通连麦当 PK，不能继续用于胜负样本。
    this.results = !legacy && Array.isArray(saved.results) ? saved.results.slice(-200) : [];
    this.multiplier = Array.isArray(saved.multipliers) ? saved.multipliers.slice(-500) : [];
    this.cards = Array.isArray(saved.cards) ? saved.cards.slice(-1000) : [];
    for (const item of saved.states || []) {
      if (!item?.key) continue;
      const base = emptyPKState(item.key);
      const state = {
        ...base, ...item,
        dataQuality: { ...base.dataQuality, ...(item.dataQuality || {}) },
        selfScoreAt: item.selfScoreAt ?? (item.selfScoreObserved ? item.lastScoreAt || item.lastEventAt || null : null),
        opponentScoreAt: item.opponentScoreAt ?? (item.opponentScoreObserved ? item.lastScoreAt || item.lastEventAt || null : null),
        effects: Array.isArray(item.effects) ? item.effects.slice(-100) : [],
        history: Array.isArray(item.history) ? item.history.slice(-600) : [],
        opponentRoomIds: Array.isArray(item.opponentRoomIds) ? item.opponentRoomIds.map(String).slice(-8) : [],
        chatHistory: Array.isArray(item.chatHistory) ? item.chatHistory.slice(-240) : [],
        chatSignals: { ...base.chatSignals, ...(item.chatSignals || {}), self: { ...base.chatSignals.self, ...(item.chatSignals?.self || {}) }, opponent: { ...base.chatSignals.opponent, ...(item.chatSignals?.opponent || {}) } },
        selfUsers: Object.fromEntries((item.selfUsers || []).slice(-1000).map(user => [user.key, user])),
        opponentUsers: Object.fromEntries((item.opponentUsers || []).slice(-1000).map(user => [user.key, user]))
      };
      if (legacy) for (const field of ['phase','startedAt','endedAt','remainingMs','remainingUpdatedAt','selfScore','opponentScore','selfScoreObserved','opponentScoreObserved','selfScoreAt','opponentScoreAt','selfSpeed','opponentSpeed','selfVelocity60','opponentVelocity60','lastScoreAt','history','prediction']) state[field] = base[field];
      if (!state.remainingUpdatedAt) state.remainingUpdatedAt = state.lastEventAt || state.startedAt;
      this.states.set(item.key, state);
    }
    this.pruneStates(); return true;
  }
}

export function observeRate(successes, trials, { priorAlpha = 1, priorBeta = 1 } = {}) {
  const n = Math.max(0, Math.floor(finite(trials))); const k = Math.max(0, Math.min(n, Math.floor(finite(successes))));
  const alpha = priorAlpha + k, beta = priorBeta + n - k, mean = alpha / (alpha + beta), z = 1.96, denom = 1 + z * z / (alpha + beta), center = (mean + z * z / (2 * (alpha + beta))) / denom, margin = z * Math.sqrt((mean * (1 - mean) + z * z / (4 * (alpha + beta))) / (alpha + beta)) / denom;
  return { successes:k, trials:n, rate: n ? k / n : null, posteriorMean: n ? mean : null, low: n ? clamp(center - margin) : null, high: n ? clamp(center + margin) : null, confidence: n ? clamp(1 - 1 / Math.sqrt(n + 1)) : 0 };
}
