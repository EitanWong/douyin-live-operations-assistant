const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
export const giftDate = (at = Date.now()) => {
  const parts = Object.fromEntries(dayFormatter.formatToParts(new Date(at)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const emptyGiftTotal = () => ({ totalDiamonds: 0, unknownCount: 0, giftCount: 0, estimatedIncome: 0 });

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
      const date = giftDate(Number.isFinite(event.at) && event.at > 0 ? event.at : this.now());
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
    const task = this.tail.catch(() => {}).then(work); this.tail = task; return task;
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
  record({ room, event, userKey, rate }) {
    const now = this.now();
    const receivedAt = Number.isFinite(event?.receivedAt) && event.receivedAt <= now && now - event.receivedAt < 600000 ? event.receivedAt : now;
    return this.transaction(async () => {
      if (!/^(\d+|demo)$/.test(room) || event?.type !== 'gift') throw new Error('礼物记录无效');
      if (!Number.isFinite(event.count) || event.count < 1 || event.count > 1e9 || !Number.isFinite(rate) || rate < 0 || rate > 10) throw new Error('礼物数值无效');
      // 按进入存储队列时判断，不能因磁盘写入积压漏记；容纳服务端延迟的近十分钟事件。
      // 更久的历史补推仍不冒充完整收入；去重依赖持久化连击进度。
      if (event.at && (receivedAt - event.at > 600000 || event.at - receivedAt > 60000)) return false;
      const key = `live-assistant:income:${room}`;
      for (let attempt = 0; ; attempt++) {
        try {
          // 重读持久进度再试：写入已成功但调用报错时也不能重复入账。
          const ledger = new GiftLedger({ state: await this.get(key, null), now: this.now });
          const changed = ledger.observe(event, room, String(userKey).slice(0, 200), rate);
          if (changed) await this.set(key, ledger.serialize());
          return changed;
        } catch (error) {
          if (attempt >= 2) throw error;
          await this.retryWait(attempt === 0 ? 100 : 400);
        }
      }
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
    return { room, month, timezone: 'Asia/Shanghai', summary: ledger.summary(month), days };
  }
}
