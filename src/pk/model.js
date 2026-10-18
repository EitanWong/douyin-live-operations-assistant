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

export const PK_EVENT_TYPES = new Set(['pk-start', 'pk-score', 'pk-end', 'pk-multiplier', 'pk-card']);

export function emptyPKState(key = '') {
  return {
    key, provisional: false, roomId: '', anchorId: '', anchorName: '', opponentId: '', opponentName: '',
    startedAt: 0, endedAt: 0, remainingMs: null, remainingUpdatedAt: 0, phase: 'idle',
    selfScore: 0, opponentScore: 0, selfSpeed: 0, opponentSpeed: 0,
    selfScoreObserved: false, opponentScoreObserved: false,
    selfVelocity60: 0, opponentVelocity60: 0, lastScoreAt: 0, lastEventAt: 0,
    selfGifts: 0, opponentGifts: 0, selfGiftValue: 0, opponentGiftValue: 0,
    selfUsers: {}, opponentUsers: {}, opponentRoomIds: [], chatHistory: [],
    chatSignals: { total: 0, recent: 0, self: { total: 0, positive: 0, negative: 0, request: 0, comeback: 0 }, opponent: { total: 0, positive: 0, negative: 0, request: 0, comeback: 0 }, latestAt: 0, sampleSize: 0 },
    history: [],
    multiplierObservations: [], cardObservations: [],
    prediction: { selfWin: null, opponentWin: null, draw: null, confidence: 0, sampleSize: 0, factors: [], status: 'unknown' },
    source: 'observed', dataQuality: { events: 0, lastAt: 0, lagMs: null, missingScoreEvents: 0 }
  };
}

function ensureState(state, event) {
  if (!state) state = emptyPKState(event.battleId || event.roomId || 'default');
  // 对面房间的聊天事件用于归属判断，不能覆盖战局的主房间 ID。
  // 新建状态或同一主房间聊天仍然需要补齐 roomId。
  if (event.roomId && (event.type !== 'chat' || !state.roomId || state.roomId === String(event.roomId))) state.roomId = String(event.roomId);
  if (event.anchorId) state.anchorId = String(event.anchorId);
  if (event.anchorName) state.anchorName = String(event.anchorName).slice(0, 80);
  if (event.opponentId) state.opponentId = String(event.opponentId);
  if (event.opponentName) state.opponentName = String(event.opponentName).slice(0, 80);
  const roomIds = Array.isArray(event.opponentRoomIds) ? event.opponentRoomIds : event.opponentRoomId ? [event.opponentRoomId] : [];
  for (const roomId of roomIds) if (roomId != null && String(roomId) !== state.roomId && !state.opponentRoomIds.includes(String(roomId))) state.opponentRoomIds.push(String(roomId));
  state.opponentRoomIds = state.opponentRoomIds.slice(-8);
  return state;
}

function orientScores(state, event) {
  const participants = Array.isArray(event.participants) ? event.participants : [];
  const self = participants.find(item => item.anchorId === state.anchorId)
    || participants.find(item => item.roomId && item.roomId === state.roomId);
  if (!state.anchorId && self) state.anchorId = self.anchorId;
  if (self?.name) state.anchorName = self.name;
  const rivals = participants.filter(item => item.anchorId !== state.anchorId);
  const rival = rivals.find(item => item.anchorId === state.opponentId) || (self && rivals.length === 1 ? rivals[0] : null);
  if (rival) {
    state.opponentId = rival.anchorId; state.opponentName = rival.name || state.opponentName;
    if (rival.roomId && !state.opponentRoomIds.includes(rival.roomId)) state.opponentRoomIds.push(rival.roomId);
  }
  const scores = Array.isArray(event.scores) ? event.scores : [];
  const ownScore = scores.find(item => item.anchorId === state.anchorId);
  const others = scores.filter(item => item.anchorId !== state.anchorId);
  const otherScore = scores.find(item => item.anchorId === state.opponentId)
    || (ownScore && others.length === 1 ? others[0] : null);
  if (otherScore && !state.opponentId) state.opponentId = otherScore.anchorId;
  return { ...event, ...(ownScore ? { selfScore: ownScore.score } : {}), ...(otherScore ? { opponentScore: otherScore.score } : {}) };
}

function chatSide(state, event) {
  if (event.side === 'self' || event.side === 'opponent') return event.side;
  const roomId = String(event.roomId || '');
  if (roomId && roomId === state.roomId) return 'self';
  if (roomId && state.opponentRoomIds.includes(roomId)) return 'opponent';
  // A chat event from an explicitly opened auxiliary room is treated as opponent context.
  return roomId ? 'opponent' : 'self';
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

function addUser(state, side, user, value, at) {
  const key = keyOf(user);
  if (!key) return;
  const bucket = side === 'self' ? state.selfUsers : state.opponentUsers;
  const old = bucket[key] || { key, id: user.id || '', name: user.name || '', wealthLevel: user.wealthLevel ?? null, fanLevel: user.fanLevel ?? null, gifts: 0, value: 0, lastAt: 0, events: 0 };
  old.gifts += 1; old.value += Math.max(0, value); old.lastAt = at; old.events += 1;
  if (user.name) old.name = String(user.name).slice(0, 80);
  if (Number.isFinite(user.wealthLevel)) old.wealthLevel = user.wealthLevel;
  if (Number.isFinite(user.fanLevel)) old.fanLevel = user.fanLevel;
  bucket[key] = old;
}

function sideForGift(state, event) {
  if (event.side === 'self' || event.side === 'opponent') return event.side;
  const id = String(event.anchorId || event.user?.anchorId || '');
  if (id && id === state.opponentId) return 'opponent';
  if (event.isOpponent === true) return 'opponent';
  return 'self';
}

function velocity(state, side, now, windowMs) {
  const cutoff = now - windowMs;
  const values = state.history.filter(item => item.at >= cutoff);
  const field = side === 'self' ? 'selfDelta' : 'opponentDelta';
  return values.reduce((sum, item) => sum + finite(item[field]), 0) / (windowMs / 1000);
}

function contributionIntent(users, now) {
  const values = Object.values(users);
  if (!values.length) return { probability: null, expected: null, sampleSize: 0, confidence: 0 };
  const active = values.filter(user => now - user.lastAt <= 90000);
  const probability = active.length / values.length;
  const expected = active.reduce((sum, user) => sum + user.value, 0);
  const confidence = clamp(Math.min(1, values.length / 8) * (active.length ? .8 : .35));
  return { probability, expected, sampleSize: values.length, confidence };
}

export function predictPK(state, now = Date.now(), history = []) {
  // history 是 tracker 级别的已结束场次；当前状态的 pk-end 不再重复计入。
  const sampleSize = history.length;
  const total = state.selfScore + state.opponentScore;
  const elapsed = state.startedAt ? Math.max(1, (Math.min(now, state.endedAt || now) - state.startedAt) / 1000) : 0;
  if (state.phase === 'idle' || !state.selfScoreObserved || !state.opponentScoreObserved || (!total && !state.selfSpeed && !state.opponentSpeed)) {
    return { selfWin: null, opponentWin: null, draw: null, confidence: 0, sampleSize, factors: [], status: 'unknown' };
  }
  const scoreGap = state.selfScore - state.opponentScore;
  const speedGap = state.selfVelocity60 - state.opponentVelocity60;
  const remaining = state.remainingMs == null ? 60 : Math.max(0, state.remainingMs / 1000);
  // 只做透明的 log-odds 基线；系数来自特征尺度，不代表官方权重。
  const scale = Math.max(1, Math.abs(total) * .12, Math.abs(speedGap) * Math.max(10, remaining));
  const logOdds = scoreGap / scale + speedGap * Math.min(60, remaining) / Math.max(1, total * .3) + (state.selfScore >= state.opponentScore ? .18 : -.18);
  const selfWin = clamp(sigmoid(logOdds));
  const draw = clamp(Math.min(.18, .06 + (remaining < 10 ? .04 : 0) + (total === 0 ? .08 : 0)));
  const opponentWin = clamp(1 - selfWin - draw);
  const quality = clamp(Math.min(1, (state.dataQuality.events || 0) / 20) * (state.dataQuality.lagMs == null ? 1 : Math.max(0, 1 - state.dataQuality.lagMs / 10000)));
  const confidence = clamp(.2 + quality * .6 + Math.min(.2, sampleSize / 50));
  const factors = [];
  if (Math.abs(scoreGap) > 0) factors.push(`${scoreGap >= 0 ? '己方' : '对方'}当前分差 ${Math.abs(Math.round(scoreGap)).toLocaleString()} 分`);
  if (Math.abs(speedGap) > 0.1) factors.push(`${speedGap >= 0 ? '己方' : '对方'}近 60 秒得分速度更快`);
  if (remaining <= 30) factors.push(`剩余 ${Math.ceil(remaining)} 秒，结果对速度更敏感`);
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
    // 中途入场可能先收到没有 battle_id 的比分；随后补到战局 ID 时保留已观测的比分。
    const roomStates = event.roomId ? [...this.states.values()].filter(state => state.phase === 'active' && state.roomId === String(event.roomId)) : [];
    const active = roomStates.length === 1 ? roomStates[0] : this.states.get(this.activeKey);
    const sameRoom = event.roomId && active?.roomId === String(event.roomId);
    if (key && !this.states.has(key) && active?.phase === 'active' && active.provisional && sameRoom) {
      this.states.delete(active.key); active.key = key; active.provisional = false;
      this.states.set(key, active); this.activeKey = key;
    }
    if (!key && ['pk-score','pk-end','room-state','gift'].includes(event.type)) {
      if (active?.phase === 'active' && (!event.roomId || !active.roomId || String(event.roomId) === active.roomId)) key = active.key;
    }
    if (!key && event.type === 'chat') {
      const roomId = String(event.roomId || '');
      const active = this.states.get(this.activeKey);
      if (active && (roomId === active.roomId || active.opponentRoomIds.includes(roomId))) key = active.key;
      if (!key && roomId) for (const state of this.states.values()) {
        if (state.roomId === roomId || state.opponentRoomIds.includes(roomId)) { key = state.key; break; }
      }
      else if (active && active.phase === 'active') key = active.key;
    }
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
    const now = finite(event.receivedAt || event.capturedAt || event.at, this.now());
    if (event.type === 'pk-multiplier') { this.multiplier.push({ ...event, observedAt: now }); this.multiplier = this.multiplier.slice(-500); return this.snapshot(); }
    if (event.type === 'pk-card') { this.cards.push({ ...event, observedAt: now }); this.cards = this.cards.slice(-1000); return this.snapshot(); }
    const state = this.stateFor(event); ensureState(state, event); event = orientScores(state, event);
    if (event.type === 'pk-score' && state.phase === 'ended') return this.snapshot(state.key);
    state.lastEventAt = now; state.dataQuality.events += 1; state.dataQuality.lastAt = now; state.dataQuality.lagMs = Math.max(0, this.now() - now);
    if (event.type === 'chat') {
      ingestChat(state, event, now);
    } else if (event.type === 'pk-start') {
      const continuing = state.phase === 'active';
      state.phase = 'active'; state.startedAt = event.startedAt || state.startedAt || now; state.endedAt = 0;
      if (Number.isFinite(event.remainingMs)) { state.remainingMs = event.remainingMs; state.remainingUpdatedAt = now; }
      else if (Number.isFinite(event.endsAt) || Number.isFinite(event.durationMs)) { state.remainingMs = Math.max(0, Number.isFinite(event.endsAt) ? event.endsAt - now : event.durationMs); state.remainingUpdatedAt = now; }
      if (Number.isFinite(event.selfScore)) state.selfScore = Math.max(0, event.selfScore);
      if (Number.isFinite(event.opponentScore)) state.opponentScore = Math.max(0, event.opponentScore);
      state.selfScoreObserved = (continuing && state.selfScoreObserved) || Number.isFinite(event.selfScore);
      state.opponentScoreObserved = (continuing && state.opponentScoreObserved) || Number.isFinite(event.opponentScore);
      if (!continuing) state.history = [];
      this.activeKey = state.key;
    } else if (event.type === 'pk-score' || event.type === 'room-state') {
      const hasScore = [event.selfScore, event.opponentScore, event.score].some(Number.isFinite);
      if (!hasScore) return this.snapshot(state.key);
      if (state.phase === 'idle') { state.phase = 'active'; state.startedAt = event.startedAt || now; this.activeKey = state.key; }
      const previousSelf = state.selfScore, previousOpponent = state.opponentScore;
      const hadSelf = state.selfScoreObserved, hadOpponent = state.opponentScoreObserved;
      if (Number.isFinite(event.selfScore)) state.selfScore = Math.max(0, event.selfScore);
      if (Number.isFinite(event.opponentScore)) state.opponentScore = Math.max(0, event.opponentScore);
      if (Number.isFinite(event.score)) event.side === 'opponent' ? state.opponentScore = Math.max(state.opponentScore, event.score) : state.selfScore = Math.max(state.selfScore, event.score);
      state.selfScoreObserved ||= Number.isFinite(event.selfScore) || (Number.isFinite(event.score) && event.side !== 'opponent');
      state.opponentScoreObserved ||= Number.isFinite(event.opponentScore) || (Number.isFinite(event.score) && event.side === 'opponent');
      if (Number.isFinite(event.remainingMs)) { state.remainingMs = Math.max(0, event.remainingMs); state.remainingUpdatedAt = now; }
      const selfDelta = hadSelf ? Math.max(0, state.selfScore - previousSelf) : 0, opponentDelta = hadOpponent ? Math.max(0, state.opponentScore - previousOpponent) : 0;
      if (selfDelta + opponentDelta === 0 && (previousSelf || previousOpponent)) state.dataQuality.missingScoreEvents += 1;
      state.history.push({ kind: 'score', at: now, selfDelta, opponentDelta, selfScore: state.selfScore, opponentScore: state.opponentScore });
      state.history = state.history.slice(-240); state.lastScoreAt = now;
      state.selfVelocity60 = velocity(state, 'self', now, 60000); state.opponentVelocity60 = velocity(state, 'opponent', now, 60000);
      state.selfSpeed = velocity(state, 'self', now, 15000); state.opponentSpeed = velocity(state, 'opponent', now, 15000);
    } else if (event.type === 'gift') {
      const side = sideForGift(state, event), value = Math.max(0, finite(event.unitValue) * Math.max(1, finite(event.count, 1))); state[`${side}Gifts`] += Math.max(1, finite(event.count, 1)); state[`${side}GiftValue`] += value; addUser(state, side, event.user, value, now);
      const key = side === 'self' ? 'selfScore' : 'opponentScore'; if (event.scoreContribution) state[key] += Math.max(0, finite(event.scoreContribution));
    } else if (event.type === 'pk-end') {
      const alreadyEnded = state.phase === 'ended';
      state.phase = 'ended'; state.endedAt = now; if (Number.isFinite(event.selfScore)) { state.selfScore = event.selfScore; state.selfScoreObserved = true; } if (Number.isFinite(event.opponentScore)) { state.opponentScore = event.opponentScore; state.opponentScoreObserved = true; }
      state.remainingMs = 0; state.remainingUpdatedAt = now;
      if (!this.activeKey) this.activeKey = state.key;
      if (!alreadyEnded && state.selfScoreObserved && state.opponentScoreObserved) {
        const winner = state.selfScore === state.opponentScore ? 'draw' : state.selfScore > state.opponentScore ? 'self' : 'opponent'; this.results.push({ key: state.key, at: now, winner, selfScore: state.selfScore, opponentScore: state.opponentScore }); this.results = this.results.slice(-200); state.history.push({ kind: 'pk-end', at: now, winner });
      }
    }
    state.prediction = predictPK(state, this.now(), this.results);
    return this.snapshot(state.key);
  }
  snapshot(key = this.activeKey) {
    const state = this.states.get(key); if (!state) return { activeKey: this.activeKey, states: [], results: this.results.slice(-50), multipliers: this.multiplier.slice(-100), cards: this.cards.slice(-100) };
    const now = this.now();
    const remainingMs = state.phase === 'active' && Number.isFinite(state.remainingMs) && state.remainingUpdatedAt
      ? Math.max(0, state.remainingMs - Math.max(0, now - state.remainingUpdatedAt))
      : state.remainingMs;
    const view = { ...state, remainingMs };
    view.prediction = predictPK(view, now, this.results);
    const selfIntent = contributionIntent(state.selfUsers, now), opponentIntent = contributionIntent(state.opponentUsers, now);
    const chatSignals = { ...state.chatSignals, self: { ...state.chatSignals.self }, opponent: { ...state.chatSignals.opponent }, recent: state.chatHistory.filter(item => now - item.at <= 60000).length };
    return { ...view, selfUsers: Object.values(state.selfUsers).sort((a,b)=>b.value-a.value).slice(0,20), opponentUsers: Object.values(state.opponentUsers).sort((a,b)=>b.value-a.value).slice(0,20), opponentRoomIds: [...state.opponentRoomIds], chatSignals, chatHistory: state.chatHistory.slice(-30), selfIntent, opponentIntent, multiplierStats: empirical(this.multiplier), cardStats: empirical(this.cards), results: this.results.slice(-50), multipliers: this.multiplier.slice(-100), cards: this.cards.slice(-100) };
  }
  current() { return this.snapshot(this.activeKey); }
  all() { return [...this.states.values()].map(state => this.snapshot(state.key)); }
  export() { return { version: 2, activeKey: this.activeKey, states: this.all(), results: this.results, multipliers: this.multiplier, cards: this.cards }; }
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
        opponentRoomIds: Array.isArray(item.opponentRoomIds) ? item.opponentRoomIds.map(String).slice(-8) : [],
        chatHistory: Array.isArray(item.chatHistory) ? item.chatHistory.slice(-240) : [],
        chatSignals: { ...base.chatSignals, ...(item.chatSignals || {}), self: { ...base.chatSignals.self, ...(item.chatSignals?.self || {}) }, opponent: { ...base.chatSignals.opponent, ...(item.chatSignals?.opponent || {}) } },
        selfUsers: Object.fromEntries((item.selfUsers || []).map(user => [user.key, user])),
        opponentUsers: Object.fromEntries((item.opponentUsers || []).map(user => [user.key, user]))
      };
      if (legacy) for (const field of ['phase','startedAt','endedAt','remainingMs','remainingUpdatedAt','selfScore','opponentScore','selfScoreObserved','opponentScoreObserved','selfSpeed','opponentSpeed','selfVelocity60','opponentVelocity60','lastScoreAt','history','prediction']) state[field] = base[field];
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
