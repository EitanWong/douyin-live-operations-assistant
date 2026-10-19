const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
export const giftDate = (at = Date.now()) => {
  const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(at)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const emptyGiftTotal = () => ({ totalDiamonds: 0, unknownCount: 0, giftCount: 0, estimatedIncome: 0 });
const CONTRIBUTION_YUAN_PER_POINT = 0.1;

export class GiftLedger {
  constructor({ maxActive = 500, maxFinalized = 2000, state, now = Date.now } = {}) {
    this.maxActive = maxActive; this.maxFinalized = maxFinalized; this.now = now;
    if (state) state = JSON.parse(JSON.stringify(state));
    this.active = new Map(state?.version === 1 ? state.active : []);
    this.finalized = new Map(state?.version === 1 ? state.finalized : []);
    this.days = new Map(state?.version === 1 ? state.days : []);
    this.serial = 0;
  }

  observe(event, room, userKey, rate = 0.05) {
    const group = event.groupId || event.id || `event:${this.now()}:${++this.serial}`;
    const key = `${event.roomId || room}:${userKey}:${event.giftId || event.giftName || 'gift'}:${group}`;
    const checkpoint = this.finalized.get(key);
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
      }
    }
    if (added) {
      const now = this.now();
      const capturedAt = Number.isFinite(event.capturedAt) && event.capturedAt > 0 && event.capturedAt <= now
        ? event.capturedAt
        : Number.isFinite(event.receivedAt) && event.receivedAt > 0 && event.receivedAt <= now ? event.receivedAt : now;
      const platformAt = Number.isFinite(event.at) && event.at > 0 ? event.at : 0;
      const date = giftDate(platformAt && capturedAt - platformAt <= 600000 && platformAt - capturedAt <= 60000 ? platformAt : capturedAt);
      const day = this.days.get(date) || emptyGiftTotal();
      const appliedRate = Number.isFinite(rate) && rate >= 0 ? rate : 0.05;
      day.giftCount += added;
      if (unitValue === null) day.unknownCount += added;
      else { day.totalDiamonds += added * unitValue; day.estimatedIncome += added * unitValue * appliedRate; }
      this.days.set(date, day);
      const last = previous.segments.at(-1);
      if (last?.date === date && last.rate === appliedRate) last.count += added;
      else previous.segments.push({ date, count: added, rate: appliedRate });
    }
    const changed = Boolean(added || previous.unitValue !== unitValue || (event.final && this.active.has(key)));
    const next = { count: nextCount, unitValue, segments: previous.segments };
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
  serialize() { return { version: 1, days: [...this.days], active: [...this.active], finalized: [...this.finalized] }; }
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
      const room = String(profile.room);
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
  recordContribution({ room, date = giftDate(this.now()), userId, name = '', score, scoreIsFloor = false }) {
    return this.transaction(async () => {
      if (!/^\d+$/.test(String(room)) || !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date) || giftDate(Date.parse(`${date}T12:00:00+08:00`)) !== date || !/^uid:\d+$/.test(String(userId)) || !Number.isFinite(score) || score < 0 || score > 1e9) throw new Error('榜单校准数据无效');
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
  async profiles() {
    const data = await this.all(), profiles = new Map();
    // 兼容已经按房间保存的旧配置，首次升级即可看到以前配置过的主播。
    for (const [key, config] of Object.entries(data)) {
      const room = key.match(/^live-assistant:config:(\d+|demo)$/)?.[1];
      if (room) profiles.set(room, { room, name: `直播间 ${room}`, anchorId: config.anchorId || '' });
    }
    for (const [key, profile] of Object.entries(data)) if (/^live-assistant:profile:(\d+|demo)$/.test(key)) profiles.set(profile.room, profile);
    return [...profiles.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  async report(room, month = giftDate(this.now()).slice(0, 7)) {
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
    return { room, month, timezone: 'Asia/Shanghai', calibrationBasis: { yuanPerPoint: CONTRIBUTION_YUAN_PER_POINT, anchor: '1000 分约 ¥100' }, calibration, summary: ledger.summary(month), days: reportDays };
  }
}
