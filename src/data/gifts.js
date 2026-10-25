const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
export const giftDate = (at = Date.now()) => {
  const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(at)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const emptyGiftTotal = () => ({ totalDiamonds: 0, unknownCount: 0, giftCount: 0, estimatedIncome: 0 });
const CONTRIBUTION_YUAN_PER_POINT = 0.1;

// Room URLs are aliases; a verified anchor UID is the identity. Never merge
// equal nicknames, and keep every alias so existing room data stays accessible.
export function uniqueAnchorProfiles(profiles, preferredRoom = '') {
  const byRoom = new Map();
  for (const profile of profiles) for (const value of profile.rooms || [profile.room]) {
    const room = String(value).replace(/^0+(?=\d)/, '');
    if (!/^(\d+|demo)$/.test(room)) continue;
    const old = byRoom.get(room);
    byRoom.set(room,{...old,...profile,room,anchorId:/^\d+$/.test(String(profile.anchorId || '')) ? String(profile.anchorId) : old?.anchorId || ''});
  }
  const groups = new Map();
  for (const profile of byRoom.values()) {
    const key = profile.anchorId ? `uid:${profile.anchorId}` : `room:${profile.room}`;
    const group = groups.get(key) || []; group.push(profile); groups.set(key,group);
  }
  return [...groups.values()].map(group => {
    group.sort((a,b) => Number(b.room === preferredRoom)-Number(a.room === preferredRoom) || (b.updatedAt || 0)-(a.updatedAt || 0) || a.room.localeCompare(b.room));
    const best = group[0], named = group.find(item=>item.name && !/^直播间 \d+$/.test(item.name));
    const {rooms, ...profile} = best;
    return {...profile,name:named?.name || best.name || `直播间 ${best.room}`,...(group.length > 1 ? {rooms:group.map(item=>item.room)} : {})};
  }).sort((a,b)=>(b.updatedAt || 0)-(a.updatedAt || 0));
}

// Name-only rows are never accumulated as users across observations. Each
// board supplies a fresh conservative total; UID rows can be reconciled with
// gifts. Conflicting names collapse to one maximum when UID is unavailable.
export function contributionSnapshot(rows, knownUsers = []) {
  const nameKey = value => String(value || '').replace(/\s+/g,'').trim();
  const uidKey = value => /^(?:uid:)?\d+$/.test(String(value || '')) ? `uid:${String(value).replace(/^uid:/,'')}` : '';
  const identities = new Map();
  for (const user of [...knownUsers,...rows.map(row=>({id:row.userId,name:row.name}))]) {
    const id = uidKey(user.id), name = nameKey(user.name);
    if (!id || !name) continue;
    const ids = identities.get(name) || new Set(); ids.add(id); identities.set(name,ids);
  }
  const users = new Map(), boards = new Map(), resolvedRows = [];
  for (const row of rows) {
    if (!Number.isFinite(row.score) || row.score < 0 || row.score > 1e9 || !nameKey(row.name)) continue;
    const matches = identities.get(nameKey(row.name));
    const userId = uidKey(row.userId) || (matches?.size === 1 ? [...matches][0] : '');
    const entry = {...row,userId}; resolvedRows.push(entry);
    const board = boards.get(row.source || 'audience') || []; board.push(entry); boards.set(row.source || 'audience',board);
    if (!userId) continue;
    const previous = users.get(userId);
    if (!previous || entry.score > previous.score || entry.score === previous.score && previous.scoreIsFloor && !entry.scoreIsFloor) users.set(userId,entry);
  }
  let floor = {score:0,users:0,unmatched:0,hasFloor:false};
  for (const board of boards.values()) {
    const totals = new Map(), namedUIDs = new Map();
    for (const row of board) if (row.userId) {
      const name = nameKey(row.name), ids = namedUIDs.get(name) || new Set(); ids.add(row.userId); namedUIDs.set(name,ids);
    }
    for (const row of board) {
      // An ambiguous name-only duplicate must not be added to named UID rows.
      if (!row.userId && namedUIDs.has(nameKey(row.name))) continue;
      const key = row.userId || `name:${nameKey(row.name)}`, previous = totals.get(key);
      if (!previous || row.score > previous.score || row.score === previous.score && previous.scoreIsFloor && !row.scoreIsFloor) totals.set(key,row);
    }
    const entries = [...totals.values()], score = entries.reduce((sum,row)=>sum+row.score,0);
    if (score > floor.score) floor = {score,users:entries.length,unmatched:entries.filter(row=>!row.userId).length,hasFloor:entries.some(row=>row.scoreIsFloor)};
  }
  return {entries:[...users.values()],rows:resolvedRows,floor};
}

export class GiftLedger {
  constructor({ maxActive = 500, maxFinalized = 2000, state, now = Date.now } = {}) {
    this.maxActive = maxActive; this.maxFinalized = maxFinalized; this.now = now;
    if (state) state = JSON.parse(JSON.stringify(state));
    this.active = new Map(state?.version >= 1 ? state.active : []);
    this.finalized = new Map(state?.version >= 1 ? state.finalized : []);
    this.days = new Map(state?.version >= 1 ? state.days : []);
    this.sessions = new Map(state?.version >= 2 ? state.sessions : []);
    this.currentSessionId = state?.version >= 2 ? state.currentSessionId || '' : '';
    // Keep legacy daily totals separate: dates alone cannot reconstruct broadcasts.
    this.legacyDays = new Map((state?.version >= 3 ? state.legacyDays : state?.days || []).map(([date, total]) => [date, {...total}]));
    if (state?.version === 2) {
      const accounted = new Map();
      const subtract = (date, total) => {
        const legacy = this.legacyDays.get(date);
        if (legacy) for (const key of Object.keys(emptyGiftTotal())) legacy[key] = Math.max(0, legacy[key] - total[key]);
      };
      for (const progress of [...this.active.values(), ...this.finalized.values()]) {
        for (const segment of progress?.segments || []) {
          if (!this.sessions.has(segment.sessionId)) continue;
          const total = {giftCount:segment.count, unknownCount:progress.unitValue === null ? segment.count : 0,
            totalDiamonds:segment.count * (progress.unitValue || 0), estimatedIncome:segment.count * (progress.unitValue || 0) * segment.rate};
          subtract(segment.date, total);
          const sum = accounted.get(segment.sessionId) || emptyGiftTotal();
          for (const key of Object.keys(sum)) sum[key] += total[key];
          accounted.set(segment.sessionId, sum);
        }
      }
      for (const session of this.sessions.values()) {
        const rest = emptyGiftTotal(), sum = accounted.get(session.id) || emptyGiftTotal();
        for (const key of Object.keys(rest)) rest[key] = Math.max(0, session[key] - sum[key]);
        subtract(giftDate(session.startAt), rest);
      }
    }
    // Persist per-user totals independently of the bounded combo checkpoints.
    // Older ledgers can only recover retained checkpoints; unmatched income is
    // treated conservatively when computing leaderboard gaps.
    if (state?.version < 4) for (const [key, progress] of [...this.active, ...this.finalized]) {
      const userId = key.match(/:uid:(\d+):/)?.[1];
      if (!userId || !progress?.segments) continue;
      for (const segment of progress.segments) {
        const session = this.sessions.get(segment.sessionId);
        if (session) {
          session.giftUsers ||= {};
          const uid = `uid:${userId}`;
          session.giftUsers[uid] = (session.giftUsers[uid] || 0) + segment.count * (progress.unitValue || 0) * segment.rate;
        }
      }
    }
    // 旧账本只有逐用户人民币累计。钻石从保留的礼物进度恢复，
    // 不能用当前收入比例反推；无法归属的历史钻石在补差时保守抵扣。
    if (state?.version < 5) {
      for (const session of this.sessions.values()) session.giftUserDiamonds = {};
      for (const [key, progress] of [...this.active, ...this.finalized]) {
        const userId = key.match(/:uid:(\d+):/)?.[1];
        const uid = progress?.incomeUser || (userId ? `uid:${userId}` : '');
        if (!uid || !progress?.segments) continue;
        for (const segment of progress.segments) {
          const session = this.sessions.get(segment.sessionId);
          if (session) session.giftUserDiamonds[uid] = (session.giftUserDiamonds[uid] || 0) + segment.count * (progress.unitValue || 0);
        }
      }
    }
    this.serial = 0;
  }

  observe(event, room, userKey, rate = 0.05) {
    const group = event.groupId || event.id || `event:${this.now()}:${++this.serial}`;
    const key = `${event.roomId || room}:${userKey}:${event.giftId || event.giftName || 'gift'}:${group}`;
    const checkpoint = this.finalized.get(key);
    const incomeUser = /^\d+$/.test(String(event.user?.id || '')) ? `uid:${event.user.id}` : /^uid:\d+$/.test(userKey) ? userKey : '';
    // 旧版本只存了 true，继续保留其去重语义；新记录保留数量和计价片段，支持乱序补全。
    if (checkpoint === true) return false;
    const count = Math.max(1, Math.floor(Number(event.count) || 1));
    const knownValue = Number.isFinite(event.unitValue) && event.unitValue > 0 ? event.unitValue : null;
    const previous = this.active.get(key) || checkpoint || { count: 0, unitValue: null, segments: [] };
    const unitValue = knownValue ?? previous.unitValue;
    const nextCount = Math.max(previous.count, count), added = nextCount - previous.count;
    // 连击跨日、单价稍后补到时，仍将价值记回原先收到礼物的日期和比例。
    if (unitValue !== null && previous.unitValue !== unitValue) {
      for (const segment of previous.segments) {
        const day = this.days.get(segment.date);
        if (previous.unitValue === null) day.unknownCount -= segment.count;
        const delta = segment.count * (unitValue - (previous.unitValue || 0));
        day.totalDiamonds += delta; day.estimatedIncome += delta * segment.rate;
        const session = this.sessions.get(segment.sessionId);
        if (session) {
          if (previous.unitValue === null) session.unknownCount -= segment.count;
          session.totalDiamonds += delta; session.estimatedIncome += delta * segment.rate;
          const uid = previous.incomeUser || incomeUser;
          if (uid) {
            session.giftUsers ||= {}; session.giftUsers[uid] = (session.giftUsers[uid] || 0) + delta * segment.rate;
            session.giftUserDiamonds ||= {}; session.giftUserDiamonds[uid] = (session.giftUserDiamonds[uid] || 0) + delta;
          }
        } else {
          const legacy = this.legacyDays.get(segment.date);
          if (legacy) {
            if (previous.unitValue === null) legacy.unknownCount -= segment.count;
            legacy.totalDiamonds += delta; legacy.estimatedIncome += delta * segment.rate;
          }
        }
      }
    }
    if (added) {
      const now = this.now();
      const capturedAt = Number.isFinite(event.capturedAt) && event.capturedAt > 0 && event.capturedAt <= now
        ? event.capturedAt
        : Number.isFinite(event.receivedAt) && event.receivedAt > 0 && event.receivedAt <= now ? event.receivedAt : now;
      const platformAt = Number.isFinite(event.at) && event.at > 0 ? event.at : 0;
      const date = giftDate(platformAt && capturedAt - platformAt <= 600000 && platformAt - capturedAt <= 60000 ? platformAt : capturedAt);
      const previousSession = this.sessions.get(previous.segments.at(-1)?.sessionId);
      const session = previousSession || this.sessionForGift(capturedAt, event.roomId);
      const day = this.days.get(date) || emptyGiftTotal();
      const appliedRate = Number.isFinite(rate) && rate >= 0 ? rate : 0.05;
      day.giftCount += added;
      if (unitValue === null) day.unknownCount += added;
      else { day.totalDiamonds += added * unitValue; day.estimatedIncome += added * unitValue * appliedRate; }
      this.days.set(date, day);
      session.giftCount += added;
      if (unitValue === null) session.unknownCount += added;
      else { session.totalDiamonds += added * unitValue; session.estimatedIncome += added * unitValue * appliedRate; }
      if (incomeUser && unitValue !== null) {
        session.giftUsers ||= {};
        session.giftUsers[incomeUser] = (session.giftUsers[incomeUser] || 0) + added * unitValue * appliedRate;
        session.giftUserDiamonds ||= {};
        session.giftUserDiamonds[incomeUser] = (session.giftUserDiamonds[incomeUser] || 0) + added * unitValue;
      }
      const last = previous.segments.at(-1);
      if (last?.date === date && last.rate === appliedRate && last.sessionId === session.id) last.count += added;
      else previous.segments.push({ date, count: added, rate: appliedRate, sessionId: session.id });
    }
    const changed = Boolean(added || previous.unitValue !== unitValue || (event.final && this.active.has(key)));
    const next = { count: nextCount, unitValue, segments: previous.segments, incomeUser:previous.incomeUser || incomeUser };
    this.active.delete(key);
    if (event.final || checkpoint) this.rememberFinalized(key, next);
    else {
      this.active.set(key, next);
      while (this.active.size > this.maxActive) {
        const [oldest, progress] = this.active.entries().next().value;
        this.active.delete(oldest); this.rememberFinalized(oldest, progress);
      }
    }
    return changed;
  }

  ensureSession(at, source, roomId = '') {
    const current = this.sessions.get(this.currentSessionId);
    if (current && !current.endAt) return current;
    let id;
    do { id = `session:${at}:${++this.serial}`; } while (this.sessions.has(id));
    const session = { id, roomId, startAt: at, endAt: 0, startSource: source, endSource: '', ...emptyGiftTotal() };
    this.sessions.set(id, session); this.currentSessionId = id;
    return session;
  }

  sessionForGift(at, roomId = '') {
    // Delayed/retried facts belong to the broadcast in which they were captured.
    const known = roomId && [...this.sessions.values()].find(session => session.roomId === roomId);
    if (known) { known.startAt = Math.min(known.startAt, at); return known; }
    const matching = [...this.sessions.values()].filter(session =>
      (!roomId || !session.roomId || session.roomId === roomId) && session.startAt <= at && (!session.endAt || at <= session.endAt)
    ).sort((a,b) => b.startAt-a.startAt)[0];
    if (matching) { if (!matching.roomId && roomId) matching.roomId = roomId; return matching; }
    const current = this.sessions.get(this.currentSessionId);
    const next = [...this.sessions.values()].filter(session => session.startAt > at).sort((a,b) => a.startAt-b.startAt)[0];
    if (next) {
      const id = `session:${at}:${++this.serial}`;
      const historical = {id,roomId,startAt:at,endAt:next.startAt,startSource:'first-observed',endSource:'next-observed',...emptyGiftTotal()};
      this.sessions.set(id, historical);
      return historical;
    }
    if (current && roomId && current.roomId && roomId !== current.roomId) this.endSession(at, 'room-changed', current.roomId);
    const session = this.ensureSession(at, 'first-observed', roomId);
    session.startAt = Math.min(session.startAt, at);
    return session;
  }

  startSession(at = this.now(), source = 'explicit', roomId = '', observedAt = at) {
    const known = roomId && [...this.sessions.values()].find(session => session.roomId === roomId);
    if (known?.endAt) {
      // Late platform metadata can refine a completed broadcast without reopening it.
      if (source === 'platform' && at <= known.endAt && (known.startSource !== 'platform' || at < known.startAt)) {
        known.startAt = at; known.startSource = source; return known;
      }
      return false;
    }
    let session = this.sessions.get(this.currentSessionId);
    if (session && !session.endAt) {
      if (observedAt < session.startAt) return false;
      if (roomId && session.roomId && roomId !== session.roomId) {
        if (at < session.startAt) return false;
        this.endSession(at, 'room-changed', session.roomId);
      }
      else {
        if (session.startSource === 'first-observed' || source === 'platform' && session.startSource !== 'platform') {
          session.startAt = Math.min(at, session.startAt); session.startSource = source;
          if (roomId) session.roomId = roomId;
          return session;
        }
        if (roomId && !session.roomId) { session.roomId = roomId; return session; }
        return false;
      }
    }
    if ([...this.sessions.values()].some(item => item.endAt && (item.endAt > observedAt || item.endAt === observedAt && (!roomId || item.roomId === roomId)))) return false;
    return this.ensureSession(at, source, roomId);
  }

  endSession(at = this.now(), source = 'explicit', roomId = '') {
    const session = roomId && [...this.sessions.values()].find(item => item.roomId === roomId) || this.sessions.get(this.currentSessionId);
    if (!session || at < session.startAt || roomId && session.roomId && session.roomId !== roomId) return false;
    if (session.endAt) {
      if (source !== 'platform' || session.endSource === 'platform') return false;
      const next = [...this.sessions.values()].filter(item => item.startAt > session.startAt).sort((a,b) => a.startAt-b.startAt)[0];
      if (next && at > next.startAt) return false;
    }
    session.endAt = at; session.endSource = source;
    if (this.currentSessionId === session.id) this.currentSessionId = '';
    return true;
  }

  observeSession({type, at = this.now(), source = 'platform', roomId = '', observedAt = at, startAt = 0}) {
    if (type === 'start') return this.startSession(at, source, roomId, observedAt);
    const known = roomId && [...this.sessions.values()].find(session => session.roomId === roomId);
    const refined = known && startAt > 0 && startAt <= at ? this.startSession(startAt, 'platform', roomId, observedAt) : false;
    return this.endSession(at, source, roomId) || refined;
  }

  observeContribution({userId, name, score, scoreIsFloor, capturedAt, roomId, rate}) {
    // A sample without a confirmed live session must never revive a finished
    // broadcast or put a stale board in the next broadcast.
    const session = roomId ? [...this.sessions.values()].find(item => item.roomId === roomId) : this.sessions.get(this.currentSessionId);
    if (!session || session.endAt && capturedAt > session.endAt || capturedAt < session.startAt) return false;
    session.contributions ||= {};
    const previous = session.contributions[userId];
    if (previous && (previous.score > score || previous.score === score && (!previous.scoreIsFloor || scoreIsFloor))) return false;
    session.contributions[userId] = {userId,name:String(name).slice(0,60),score,scoreIsFloor:Boolean(scoreIsFloor),observedAt:capturedAt,
      incomeEstimate:(previous?.incomeEstimate || 0) + (score-(previous?.score || 0))*rate};
    return true;
  }

  observeContributionSnapshot({rows,capturedAt,roomId,rate}) {
    const session = roomId ? [...this.sessions.values()].find(item=>item.roomId === roomId) : this.sessions.get(this.currentSessionId);
    if (!session || capturedAt < session.startAt || session.endAt && capturedAt > session.endAt) return false;
    const snapshot = contributionSnapshot(rows);
    let changed = false;
    for (const entry of snapshot.entries) changed = this.observeContribution({...entry,capturedAt,roomId,rate}) || changed;
    const previous = session.contributionFloor;
    if (snapshot.floor.score > (previous?.score || 0)) {
      session.contributionFloor = {...snapshot.floor,observedAt:capturedAt,
        incomeEstimate:(previous?.incomeEstimate || 0) + (snapshot.floor.score-(previous?.score || 0))*rate};
      changed = true;
    } else if (previous && snapshot.floor.score === previous.score &&
      (snapshot.floor.unmatched < previous.unmatched || previous.hasFloor && !snapshot.floor.hasFloor)) {
      session.contributionFloor = {...previous,...snapshot.floor,observedAt:capturedAt}; changed = true;
    }
    return changed;
  }

  calibratedSession(session) {
    if (!session) return null;
    const {giftUsers = {}, giftUserDiamonds = {}, contributions = {}, contributionFloor, ...raw} = session;
    const entries = Object.values(contributions);
    if (!entries.length && !contributionFloor) return {...raw};
    const unidentified = Math.max(0, session.estimatedIncome - Object.values(giftUsers).reduce((sum,value) => sum+value,0));
    // Boards contain cumulative totals, not transactions. Never add one board
    // to another or to the same user's captured gifts. Late gifts/prices absorb
    // the inferred gap automatically. Unknown historical senders may overlap.
    const missing = entries.reduce((sum,entry) => sum + Math.max(0,entry.incomeEstimate - (giftUsers[entry.userId] || 0)),0);
    const calibrationIncome = Math.max(0,missing-unidentified,(contributionFloor?.incomeEstimate || 0)-session.estimatedIncome);
    // 榜单分数按既有口径 1 分对应 1 钻。按用户扣除已采集礼物，
    // 再与整榜下限取较高值；后到礼物/补价会消耗钻石补差，不重复相加。
    const unidentifiedDiamonds = Math.max(0,session.totalDiamonds - Object.values(giftUserDiamonds).reduce((sum,value)=>sum+value,0));
    const missingDiamonds = entries.reduce((sum,entry)=>sum+Math.max(0,entry.score-(giftUserDiamonds[entry.userId] || 0)),0);
    const calibrationDiamonds = Math.max(0,missingDiamonds-unidentifiedDiamonds,(contributionFloor?.score || 0)-session.totalDiamonds);
    return {...raw,giftDiamonds:session.totalDiamonds,calibrationDiamonds,totalDiamonds:session.totalDiamonds+calibrationDiamonds,
      giftIncome:session.estimatedIncome,calibrationIncome,estimatedIncome:session.estimatedIncome+calibrationIncome,
      calibration:{users:entries.length,observations:entries.length,score:Math.max(entries.reduce((sum,entry)=>sum+entry.score,0),contributionFloor?.score || 0),
        incomeEstimate:Math.max(entries.reduce((sum,entry)=>sum+entry.incomeEstimate,0),contributionFloor?.incomeEstimate || 0),
        visibleUsers:contributionFloor?.users || 0,unmatched:contributionFloor?.unmatched || 0,
        visibleScoreFloor:contributionFloor?.score || 0,visibleIncomeFloor:contributionFloor?.incomeEstimate || 0,observedAt:contributionFloor?.observedAt || 0,
        hasFloor:entries.some(entry=>entry.scoreIsFloor) || Boolean(contributionFloor?.hasFloor || contributionFloor?.unmatched)}};
  }

  rememberFinalized(key, progress) {
    this.finalized.delete(key); this.finalized.set(key, progress);
    while (this.finalized.size > this.maxFinalized) this.finalized.delete(this.finalized.keys().next().value);
  }
  snapshot() {
    const total = this.summary();
    return { totalDiamonds: total.totalDiamonds, unknownCount: total.unknownCount, giftCount: total.giftCount };
  }
  summary(month = '') {
    const total = emptyGiftTotal();
    for (const [date, day] of this.days) if (date.startsWith(month)) for (const key of Object.keys(total)) total[key] += day[key];
    return total;
  }
  currentSession() { return this.sessions.get(this.currentSessionId) || [...this.sessions.values()].sort((a,b) => b.startAt-a.startAt)[0] || null; }
  serialize() { return { version: 5, days: [...this.days], legacyDays: [...this.legacyDays], active: [...this.active], finalized: [...this.finalized], sessions: [...this.sessions], currentSessionId: this.currentSessionId }; }
}

// 存储层供扩展后台和用户脚本共用；持久数据每次从存储读取，服务工作线程重启不丢账。
// tail 只串行化正在进行的读改写，避免多个标签页覆盖彼此的增量。
export class GiftStore {
  constructor({ get, set, all, now = Date.now, retryWait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) { this.get = get; this.set = set; this.all = all; this.now = now; this.retryWait = retryWait; this.tail = Promise.resolve(); }
  transaction(work) {
    const previous = this.tail;
    const task = (async () => {
      try { await previous; } catch {}
      return work();
    })();
    this.tail = task; return task;
  }
  profile(profile) {
    return this.transaction(async () => {
      const room = String(profile.room).replace(/^0+(?=\d)/, '');
      if (!/^(\d+|demo)$/.test(room)) throw new Error('直播间地址无效');
      const key = `live-assistant:profile:${room}`, old = await this.get(key, {});
      const next = { ...old, room, name: String(profile.name || old.name || `直播间 ${room}`).slice(0, 60), anchorId: /^\d+$/.test(profile.anchorId || '') ? profile.anchorId : old.anchorId || '', updatedAt: this.now() };
      await this.set(key, next); return next;
    });
  }
  record({ room, event, userKey, rate, capturedAt }) {
    const now = this.now();
    // Durable pending facts retain their original capture time across long outages.
    // Fresh callers without a capture checkpoint retain the historical-push filter.
    const hasCapturedAt = Number.isFinite(capturedAt) && capturedAt > 0 && capturedAt <= now;
    const hasRecentReceipt = Number.isFinite(event?.receivedAt) && event.receivedAt > 0 && event.receivedAt <= now && now - event.receivedAt < 600000;
    const receivedAt = hasCapturedAt ? capturedAt : hasRecentReceipt ? event.receivedAt : now;
    return this.transaction(async () => {
      if (!/^(\d+|demo)$/.test(room) || event?.type !== 'gift') throw new Error('礼物记录无效');
      if (!Number.isFinite(event.count) || event.count < 1 || event.count > 1e9 || !Number.isFinite(rate) || rate < 0 || rate > 10) throw new Error('礼物数值无效');
      // A captured live gift is authoritative even if the platform clock is far
      // from local time. Use its capture date instead of silently dropping income.
      const platformAt = Number.isFinite(event.at) && event.at > 0 ? event.at : 0;
      if (platformAt && (receivedAt - platformAt > 600000 || platformAt - receivedAt > 60000)) {
        if (!hasCapturedAt && !hasRecentReceipt) return false;
        event = { ...event, at:receivedAt };
      }
      const key = `live-assistant:income:${room}`;
      for (let attempt = 0; ; attempt++) {
        try {
          // 重读持久进度再试：写入已成功但调用报错时也不能重复入账。
          const ledger = new GiftLedger({ state: await this.get(key, null), now: this.now });
          const changed = ledger.observe({...event, capturedAt:receivedAt}, room, String(userKey).slice(0, 200), rate);
          if (changed) await this.set(key, ledger.serialize());
          return changed;
        } catch (error) {
          if (attempt >= 2) throw error;
          await this.retryWait(attempt === 0 ? 100 : 400);
        }
      }
    });
  }
  recordSession({ room, type, at = this.now(), source = 'platform', roomId = '', observedAt = at, startAt = 0 }) {
    return this.transaction(async () => {
      if (!/^(\d+|demo)$/.test(String(room)) || !['start','end'].includes(type) || !Number.isFinite(at) || at <= 0 || !Number.isFinite(observedAt) || observedAt <= 0 || typeof roomId !== 'string' || roomId.length > 100) throw new Error('直播场次事件无效');
      const key = `live-assistant:income:${room}`;
      const ledger = new GiftLedger({ state: await this.get(key, null), now: this.now });
      const changed = ledger.observeSession({type, at, source, roomId, observedAt, startAt});
      if (changed) await this.set(key, ledger.serialize());
      return changed;
    });
  }
  recordContribution({ room, date = giftDate(this.now()), userId, name = '', score, scoreIsFloor = false, capturedAt, roomId = '', rate = 0.05 }) {
    return this.transaction(async () => {
      if (!/^\d+$/.test(String(room)) || !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date) || giftDate(Date.parse(`${date}T12:00:00+08:00`)) !== date || !/^uid:\d+$/.test(String(userId)) || !Number.isFinite(score) || score < 0 || score > 1e9) throw new Error('榜单校准数据无效');
      if (capturedAt !== undefined) {
        if (!Number.isFinite(capturedAt) || capturedAt <= 0 || capturedAt > this.now() + 60000 || typeof roomId !== 'string' || roomId.length > 100 || !Number.isFinite(rate) || rate < 0 || rate > 10) throw new Error('榜单校准数据无效');
        const incomeKey = `live-assistant:income:${room}`;
        const ledger = new GiftLedger({state:await this.get(incomeKey,null),now:this.now});
        const changed = ledger.observeContribution({userId,name,score,scoreIsFloor,capturedAt,roomId,rate});
        if (changed) await this.set(incomeKey,ledger.serialize());
        return changed;
      }
      // Legacy callers/records have only a calendar date. Keep them as a
      // separate reference; their broadcast cannot be reconstructed safely.
      const key = `live-assistant:income-calibration:${room}`;
      const state = await this.get(key, { version: 1, entries: [] });
      const entries = new Map(Array.isArray(state?.entries) ? state.entries : []);
      const entryKey = `${date}:${userId}`;
      const previous = entries.get(entryKey);
      if (previous && (Number(previous.score) > score || (Number(previous.score) === score && (!previous.scoreIsFloor || scoreIsFloor)))) return false;
      entries.set(entryKey, { date, userId, name: String(name).slice(0, 60), score, scoreIsFloor:Boolean(scoreIsFloor), observedAt: this.now() });
      // 历史月报依赖这些持久记录，新一天采样不能删除以前的收入估值。
      await this.set(key, { version: 1, entries: [...entries] });
      return true;
    });
  }
  recordContributionSnapshot({room,rows,capturedAt,roomId = '',rate = 0.05}) {
    return this.transaction(async () => {
      if (!/^\d+$/.test(String(room)) || !Array.isArray(rows) || rows.length > 1000 ||
        !Number.isFinite(capturedAt) || capturedAt <= 0 || capturedAt > this.now()+60000 ||
        typeof roomId !== 'string' || roomId.length > 100 || !Number.isFinite(rate) || rate < 0 || rate > 10 ||
        rows.some(row=>!row || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 60 ||
          row.userId && !/^(?:uid:)?\d+$/.test(String(row.userId)) || !Number.isFinite(row.score) || row.score < 0 || row.score > 1e9 ||
          row.source != null && !['audience','thousand'].includes(row.source))) throw new Error('榜单校准数据无效');
      const key = `live-assistant:income:${room}`, ledger = new GiftLedger({state:await this.get(key,null),now:this.now});
      const changed = ledger.observeContributionSnapshot({rows,capturedAt,roomId,rate});
      if (changed) await this.set(key,ledger.serialize());
      return changed;
    });
  }
  async profiles() {
    const data = await this.all(), profiles = new Map();
    // 兼容已经按房间保存的旧配置，首次升级即可看到以前配置过的主播。
    for (const [key, config] of Object.entries(data)) {
      const room = key.match(/^live-assistant:config:(\d+|demo)$/)?.[1];
      if (room) profiles.set(room, { room, name: `直播间 ${room}`, anchorId: config?.anchorId || '' });
    }
    for (const [key, profile] of Object.entries(data)) {
      const room = key.match(/^live-assistant:profile:(\d+|demo)$/)?.[1];
      if (room && profile) profiles.set(room, {...profiles.get(room),...profile,room,anchorId:profile.anchorId || profiles.get(room)?.anchorId || ''});
    }
    return uniqueAnchorProfiles([...profiles.values()]);
  }
  async report(room, month = giftDate(this.now()).slice(0, 7), {includeAllSessions = false} = {}) {
    await this.tail.catch(() => {});
    if (!/^(\d+|demo)$/.test(room) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('统计日期或直播间无效');
    const ledger = new GiftLedger({ state: await this.get(`live-assistant:income:${room}`, null), now: this.now });
    const days = [...ledger.days].filter(([date]) => date.startsWith(month)).sort(([a], [b]) => b.localeCompare(a)).map(([date, day]) => ({ date, ...day }));
    const calibrationState = await this.get(`live-assistant:income-calibration:${room}`, null);
    const entries = (Array.isArray(calibrationState?.entries) ? calibrationState.entries.map(([, entry]) => entry) : []).filter(entry => entry.date.startsWith(month));
    const byDay = new Map();
    const monthUsers = new Set();
    for (const entry of entries) {
      const day = byDay.get(entry.date) || { calibrationUsers: 0, calibrationScore: 0, calibratedIncomeEstimate: 0, calibrationHasFloor: false };
      day.calibrationUsers++;
      day.calibrationScore += entry.score;
      day.calibratedIncomeEstimate += entry.score * CONTRIBUTION_YUAN_PER_POINT;
      day.calibrationHasFloor ||= Boolean(entry.scoreIsFloor);
      byDay.set(entry.date, day);
      monthUsers.add(entry.userId);
    }
    const mergedDays = new Map(days.map(day => [day.date, day]));
    for (const [date, calibration] of byDay) mergedDays.set(date, { ...(mergedDays.get(date) || { date, totalDiamonds: 0, unknownCount: 0, giftCount: 0, estimatedIncome: 0 }), ...calibration });
    const reportDays = [...mergedDays.values()].sort((a, b) => b.date.localeCompare(a.date));
    const calibration = entries.reduce((total, entry) => {
      total.observations++; total.score += entry.score; total.incomeEstimate += entry.score * CONTRIBUTION_YUAN_PER_POINT; total.hasFloor ||= Boolean(entry.scoreIsFloor); return total;
    }, { users: monthUsers.size, observations: 0, score: 0, incomeEstimate: 0, hasFloor: false });
    const allSessions = [...ledger.sessions.values()]
      .filter(session => session.startAt)
      .map(session => ledger.calibratedSession(session))
      .sort((a,b) => b.startAt-a.startAt);
    const sessions = allSessions.filter(session => giftDate(session.startAt).startsWith(month));
    const legacyDays = [...ledger.legacyDays].filter(([date, total]) => date.startsWith(month) && total.giftCount)
      .map(([date,total]) => ({date,...total})).sort((a,b) => b.date.localeCompare(a.date));
    const summary = emptyGiftTotal();
    for (const total of [...sessions, ...legacyDays]) for (const key of Object.keys(summary)) summary[key] += total[key];
    const sessionEntries = sessions.flatMap(session => Object.values(ledger.sessions.get(session.id)?.contributions || {}));
    const calibratedSessions = sessions.filter(session=>session.calibration);
    if (calibratedSessions.length) {
      const users = new Set(sessionEntries.map(entry=>entry.userId));
      calibration.legacyIncomeEstimate = calibration.incomeEstimate;
      calibration.users = users.size;
      calibration.observations = sessionEntries.length;
      calibration.score = calibratedSessions.reduce((sum,session)=>sum+session.calibration.score,0);
      calibration.incomeEstimate = calibratedSessions.reduce((sum,session)=>sum+session.calibration.incomeEstimate,0);
      calibration.hasFloor = calibratedSessions.some(session=>session.calibration.hasFloor);
      calibration.unmatched = calibratedSessions.reduce((sum,session)=>sum+session.calibration.unmatched,0);
      calibration.visibleUsers = calibratedSessions.reduce((sum,session)=>sum+session.calibration.visibleUsers,0);
      calibration.appliedIncome = sessions.reduce((sum,session)=>sum+(session.calibrationIncome || 0),0);
      summary.giftIncome = summary.estimatedIncome-calibration.appliedIncome;
      summary.calibrationIncome = calibration.appliedIncome;
      summary.calibrationDiamonds = sessions.reduce((sum,session)=>sum+(session.calibrationDiamonds || 0),0);
      summary.giftDiamonds = summary.totalDiamonds-summary.calibrationDiamonds;
    }
    return { room, month, timezone: 'Asia/Shanghai', monthBasis:'session-start', calibrationBasis: { yuanPerPoint: CONTRIBUTION_YUAN_PER_POINT, anchor: '历史日榜按1000分约¥100面值；场次榜单按1分对应1钻，以观测时配置的元/钻比例估算收入' }, calibration, summary, days: reportDays, legacyDays, sessions, ...(includeAllSessions ? {allSessions} : {}), currentSession:ledger.calibratedSession(ledger.currentSession()) };
  }
}
