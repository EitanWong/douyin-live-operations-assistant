import { addressedToSelf, RoomBot } from './bot.js';
import { DEFAULT_PHRASES, choosePhrase } from './phrases.js';

export const DEFAULTS = {
  version: 1,
  mode: 'auto',
  automation: { autoStart: false },
  anchorId: '', selfId: '', ignored: [], blockedWords: [],
  identity: { autoAnchor: true, autoSelf: true },
  moderation: { enabled: false, terms: ['傻逼', '煞笔', '脑残', '去死'], threshold: 3, windowSec: 600 },
  incomeEnabled: true,
  // 消息按优先级连续出队；发送控件本身仍串行确认每条消息。
  sending: { maxLength: 50, duplicateSec: 120, queueLimit: 200 },
  gift: {
    enabled: true, responseMode: 'rules', minValue: 100, basis: 'total', mergeSec: 4, cooldownSec: 1, batchEnabled: true, yuanPerDiamond: 0.05,
    prices: {}, templates: DEFAULT_PHRASES.gift
  },
  welcome: {
    enabled: true, responseMode: 'rules', mode: 'qualified-or-listed', minWealth: 30, requireFan: true,
    minFanLevel: 1, requireLit: true, listed: [], cooldownSec: 600,
    templates: DEFAULT_PHRASES.welcome
  },
  like: {
    enabled: false, responseMode: 'rules', cooldownSec: 60,
    templates: DEFAULT_PHRASES.like
  },
  keyword: { enabled: false, responseMode: 'rules', rules: [{ keywords: ['几点开播'], reply: '{user}，开播时间请看主播主页公告～', exact: false }], cooldownSec: 60 },
  bot: { enabled: false, cooldownSec: 3, diceEnabled: true, coinEnabled: true, choiceEnabled: true, rpsEnabled: true, guessEnabled: true, truthEnabled: true, dareEnabled: true, idiomEnabled: true },
  timersEnabled: false,
  ai: {
    enabled: false, chatEnabled: false, endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash',
    trigger: 'question', mentions: ['@场控'], intervalSec: 45, userCooldownSec: 120,
    contextSize: 30, contextAgeSec: 180, maxPerHour: 30, idleEnabled: false, idleSec: 180,
    persona: '你是直播间的温和场控，语气自然、简短，不冒充主播，不夸大承诺。',
    knowledge: '', temperature: 0.7
  },
  timers: [{ id: 'welcome', enabled: false, responseMode: 'rules', intervalSec: 300, start: '', end: '', quietSec: 15, messages: ['喜欢直播内容的朋友，可以点点关注～', '欢迎新来的朋友，一起聊聊吧！'] }],
  adapter: { inputSelector: '', sendSelector: '', chatSelector: '', nicknameSelector: '', contentSelector: '', endSelector: '' }
};

export const copy = value => JSON.parse(JSON.stringify(value));
const object = v => v && typeof v === 'object' && !Array.isArray(v);
export function mergeConfig(input = {}, base = DEFAULTS) {
  const result = copy(base);
  if (!object(input)) throw new Error('配置必须是 JSON 对象');
  for (const key of Object.keys(base)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype' || input[key] === undefined) continue;
    if (object(base[key]) && Object.keys(base[key]).length) result[key] = mergeConfig(input[key], base[key]);
    else if (object(base[key])) result[key] = Object.fromEntries(Object.entries(input[key] || {}).filter(([k]) => !['__proto__', 'constructor', 'prototype'].includes(k)));
    else if (Array.isArray(base[key])) result[key] = Array.isArray(input[key])
      ? (base[key].length && object(base[key][0]) ? input[key].map(item => object(item) ? mergeConfig(item, base[key][0]) : item) : copy(input[key]))
      : copy(base[key]);
    else if (typeof input[key] !== typeof base[key]) throw new Error(`配置类型错误：${key}`);
    else result[key] = input[key];
  }
  if (base === DEFAULTS && input.timersEnabled === undefined) result.timersEnabled = result.timers.some(timer => timer.enabled);
  if (base === DEFAULTS && result.mode === 'review') result.mode = 'auto';
  return result;
}

export function validateConfig(c) {
  const range = (v, min, max, name) => { if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${name}范围为 ${min}–${max}`); };
  const choice = (v, values, name) => { if (!values.includes(v)) throw new Error(`${name}无效`); };
  const strings = (v, name) => { if (!Array.isArray(v) || v.length > 200 || v.some(x => typeof x !== 'string' || x.length > 4000)) throw new Error(`${name}必须是文本数组（最多 200 条）`); };
  choice(c.mode, ['preview', 'auto'], '发送模式');
  if (typeof c.automation.autoStart !== 'boolean' || typeof c.gift.batchEnabled !== 'boolean') throw new Error('自动开启或合并感谢开关无效');
  if (typeof c.timersEnabled !== 'boolean') throw new Error('定时消息开关无效');
  choice(c.gift.basis, ['total', 'unit'], '礼物价值口径');
  choice(c.welcome.mode, ['qualified', 'listed', 'qualified-or-listed'], '欢迎方式');
  choice(c.ai.trigger, ['question', 'mention', 'all'], 'AI 触发方式');
  range(c.moderation.threshold, 1, 20, '违规提醒次数'); range(c.moderation.windowSec, 30, 86400, '违规统计时长');
  for (const [mode, name] of [[c.gift.responseMode,'礼物回复方式'], [c.welcome.responseMode,'欢迎回复方式'], [c.like.responseMode,'点赞感谢方式'], [c.keyword.responseMode,'关键词回复方式']]) choice(mode, ['rules','ai'], name);
  range(c.sending.maxLength, 10, 50, '消息长度'); range(c.sending.queueLimit, 1, 2000, '队列上限');
  range(c.sending.duplicateSec, 10, 3600, '重复消息冷却');
  range(c.gift.minValue, 0, 1e9, '礼物阈值'); range(c.gift.mergeSec, 1, 30, '连击合并秒数');
  range(c.gift.yuanPerDiamond, 0, 10, '元/钻估算比例');
  range(c.gift.cooldownSec, 0, 3600, '礼物用户冷却'); range(c.welcome.cooldownSec, 10, 86400, '欢迎冷却');
  range(c.welcome.minWealth, 0, 100, '荣誉等级'); range(c.welcome.minFanLevel, 0, 100, '粉丝团等级');
  range(c.keyword.cooldownSec, 5, 3600, '关键词用户冷却');
  range(c.bot.cooldownSec, 1, 120, '机器人用户间隔');
  for (const [key, value] of Object.entries(c.bot)) if (key !== 'cooldownSec' && typeof value !== 'boolean') throw new Error('机器人功能开关无效');
  range(c.like.cooldownSec, 1, 3600, '点赞用户感谢间隔');
  range(c.ai.intervalSec, 15, 3600, 'AI 间隔'); range(c.ai.userCooldownSec, 15, 86400, 'AI 用户冷却');
  range(c.ai.contextSize, 1, 100, '上下文条数'); range(c.ai.contextAgeSec, 10, 600, '上下文有效秒数');
  range(c.ai.maxPerHour, 1, 300, 'AI 每小时调用上限'); range(c.ai.idleSec, 60, 3600, '冷场秒数');
  range(c.ai.temperature, 0, 2, 'AI 温度');
  if (c.anchorId && !/^\d+$/.test(c.anchorId)) throw new Error('主播 UID 应为纯数字');
  if (c.selfId && !/^\d+$/.test(c.selfId)) throw new Error('发送账号 UID 应为纯数字');
  for (const [list, name] of [[c.ignored, '忽略用户'], [c.blockedWords, '屏蔽词'], [c.moderation.terms, '辱骂识别词'], [c.welcome.listed, '指定欢迎用户'], [c.gift.templates, '礼物话术'], [c.welcome.templates, '欢迎话术'], [c.like.templates, '点赞感谢话术'], [c.ai.mentions, 'AI 呼叫词']]) strings(list, name);
  if (c.gift.enabled && !c.gift.templates.some(s => s.trim())) throw new Error('请至少填写一条礼物话术');
  if (c.welcome.enabled && !c.welcome.templates.some(s => s.trim())) throw new Error('请至少填写一条欢迎话术');
  if (c.like.enabled && !c.like.templates.some(s => s.trim())) throw new Error('请至少填写一条点赞感谢话术');
  for (const [key, value] of Object.entries(c.gift.prices)) { if (!key) throw new Error('礼物价格表键不能为空'); range(value, 0, 1e9, '礼物单价'); }
  if (c.keyword.rules.length > 100 || c.timers.length > 30) throw new Error('关键词最多 100 组，定时任务最多 30 组');
  for (const rule of c.keyword.rules) {
    if (!object(rule) || typeof rule.reply !== 'string' || typeof rule.exact !== 'boolean') throw new Error('关键词规则格式错误');
    strings(rule.keywords, '关键词');
  }
  const timerIds = new Set();
  for (const t of c.timers) {
    if (!object(t) || typeof t.id !== 'string' || !t.id || timerIds.has(t.id) || typeof t.enabled !== 'boolean') throw new Error('定时任务需要唯一 id 和 enabled 开关');
    choice(t.responseMode, ['rules','ai'], '定时回复方式');
    timerIds.add(t.id); strings(t.messages, '定时话术');
    range(t.intervalSec, 30, 86400, '定时间隔'); range(t.quietSec, 0, 600, '避让秒数');
    for (const time of [t.start, t.end]) if (typeof time !== 'string' || (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error('定时时段请使用 HH:mm 或空文本');
    if (t.enabled && !t.messages.some(s => s.trim())) throw new Error('启用的定时任务需要话术');
  }
  return c;
}

export function matchesUser(user, list) {
  return list.some(item => {
    if (item.startsWith('uid:')) return user.id && user.id === item.slice(4);
    if (item.startsWith('sec:')) return user.secUid && user.secUid === item.slice(4);
    if (item.startsWith('name:')) return user.name === item.slice(5);
    return user.id === item; // 未加前缀的条目只能按 UID 匹配，绝不猜昵称。
  });
}
export function welcomeDecision(user, config) {
  const w = config.welcome;
  const listed = matchesUser(user, w.listed);
  if (w.mode !== 'qualified' && listed) return { pass: true, reason: '指定用户' };
  if (w.mode === 'listed') return { pass: false, reason: '不在指定名单' };
  if (!Number.isFinite(user.wealthLevel) || user.wealthLevel < w.minWealth) return { pass: false, reason: '荣誉等级不足或未知' };
  if (w.requireFan) {
    if (!config.anchorId) return { pass: false, reason: '缺少主播 UID，无法核对本直播间粉丝团' };
    const club = (user.fanClubs || []).find(f => f.anchorId === config.anchorId);
    if (!club || !Number.isFinite(club.level) || club.level < w.minFanLevel) return { pass: false, reason: '本直播间粉丝团等级不足或未知' };
    if (w.requireLit && club.status !== 1) return { pass: false, reason: '本直播间粉丝牌未点亮或状态未知' };
  }
  return { pass: true, reason: '等级与粉丝团条件通过' };
}
export function renderTemplate(template, variables) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (original, key) => Object.hasOwn(variables, key) ? String(variables[key]) : original);
}
export function cleanMessage(text, config) {
  const s = String(text || '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return { ok: false, reason: '空消息' };
  if ([...s].length > config.sending.maxLength) return { ok: false, reason: '消息超长，请缩短话术' };
  if (config.blockedWords.some(w => w && s.toLocaleLowerCase().includes(w.toLocaleLowerCase()))) return { ok: false, reason: '命中屏蔽词' };
  return { ok: true, text: s };
}
export function inTimeWindow(start, end, now) {
  if (!start || !end || start === end) return true;
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });
  const current = f.format(new Date(now));
  return start < end ? current >= start && current < end : current >= start || current < end;
}
// Runtime deadlines may be Infinity; JSON round-tripping changes their meaning.
function cloneRuntime(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  if (Array.isArray(value)) return value.map(cloneRuntime);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneRuntime(item)]));
  return value;
}
const keyFor = u => u.id || u.secUid || `name:${u.name}`;

export class Engine {
  constructor({ config = copy(DEFAULTS), now = Date.now, random = Math.random, send = async () => {}, ai = async () => '', log = () => {}, changed = () => {}, checkpoint = async () => {}, onStop = () => {} } = {}) {
    this.config = validateConfig(mergeConfig(config)); this.now = now; this.send = send; this.ai = ai; this.log = log; this.changed = changed; this.checkpoint = checkpoint; this.onStop = onStop;
    this.queue = []; this.giftJobs = new Map(); this.history = []; this.seen = new Map(); this.cooldowns = new Map(); this.gifts = new Map(); this.duplicates = new Map();
    this.calls = []; this.running = false; this.epoch = 0; this.serial = 0;
    this.lastChat = now(); this.lastInteraction = now(); this.lastAI = -Infinity; this.aiBusy = false; this.busy = false;
    this.timerDue = new Map(); this.rotation = new Map(); this.selfTexts = new Map(); this.offenses = new Map(); this.selfIdentity = null; this.giftStyleSerial = 0;
    this.lastMaintenance = -Infinity;
    this.giftSentAt = new Map();
    this.inFlight = null;
    this.bot = new RoomBot({now, random}); this.lastBotSend = -Infinity; this.lastGiftSend = -Infinity;
    this.stats = { events: 0, filtered: 0, previews: 0, submitted: 0, aiCalls: 0, retries: 0, expired: 0, overflow: 0, maxQueueWaitMs: 0 };
  }
  update(config) { this.stop('配置已更新，请重新开始'); this.config = validateConfig(mergeConfig(config)); this.rotation.clear(); }
  setIdentity(identity) { this.selfIdentity = identity?.self || null; }
  snapshot() {
    const entries = map => [...map.entries()].slice(-5000);
    const bot = this.bot.session ? { ...this.bot.session, used: this.bot.session.used ? [...this.bot.session.used] : undefined } : null;
    return cloneRuntime({
      version: 1, savedAt: this.now(), running: this.running || Boolean(this.resumeRequested),
      queue: this.queue, gifts: [...this.gifts.entries()], bot,
      seen: entries(this.seen), cooldowns: entries(this.cooldowns), duplicates: entries(this.duplicates),
      timerDue: entries(this.timerDue), rotation: entries(this.rotation), giftSentAt: entries(this.giftSentAt),
      history: this.history.slice(-80), stats: this.stats, serial: this.serial,
      lastInteraction: this.lastInteraction, lastChat: this.lastChat,
      inFlight: this.inFlight
    });
  }
  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1 || !Number.isFinite(snapshot.savedAt) || this.now() - snapshot.savedAt > 24 * 60 * 60 * 1000) return false;
    snapshot = cloneRuntime(snapshot);
    const map = value => new Map(Array.isArray(value) ? value.filter(pair => Array.isArray(pair) && pair.length === 2) : []);
    this.queue = Array.isArray(snapshot.queue) ? snapshot.queue.filter(job => job && typeof job.text === 'string' && Number.isFinite(job.created)) : [];
    this.gifts = map(snapshot.gifts);
    this.bot.reset();
    if (snapshot.bot && typeof snapshot.bot.type === 'string') {
      this.bot.session = { ...snapshot.bot, used: Array.isArray(snapshot.bot.used) ? new Set(snapshot.bot.used) : undefined };
      if (snapshot.bot.type === 'idiom') this.bot.chain = { word:snapshot.bot.word, used:new Set(snapshot.bot.used || []), at:snapshot.bot.lastAt };
    }
    for (const [property, value] of [['seen',snapshot.seen],['cooldowns',snapshot.cooldowns],['duplicates',snapshot.duplicates],['timerDue',snapshot.timerDue],['rotation',snapshot.rotation],['giftSentAt',snapshot.giftSentAt]]) this[property] = map(value);
    this.history = Array.isArray(snapshot.history) ? snapshot.history.slice(-80) : [];
    this.stats = snapshot.stats && typeof snapshot.stats === 'object' ? { ...this.stats, ...snapshot.stats } : this.stats;
    this.serial = Number.isSafeInteger(snapshot.serial) ? snapshot.serial : this.serial;
    this.lastInteraction = Number.isFinite(snapshot.lastInteraction) ? snapshot.lastInteraction : this.now();
    this.lastChat = Number.isFinite(snapshot.lastChat) ? snapshot.lastChat : this.now();
    // A page can disappear after the click but before its promise resolves. Keep the job
    // recoverable; delivery is at-least-once across that narrow ambiguous window.
    if (snapshot.inFlight?.jobs?.length) {
      const known = new Set(this.queue.map(job => job.id));
      for (const job of snapshot.inFlight.jobs) if (!known.has(job.id)) this.queue.unshift({ ...job, retryAt:this.now(), attempts:(job.attempts || 0) + 1, deliveryUncertain:true });
      this.recoveredUncertainSend = true;
    }
    this.rebuildGiftIndex();
    this.resumeRequested = Boolean(snapshot.running);
    this.changed();
    return true;
  }
  isSelfUser(user) {
    if (!user) return false;
    const selfId = this.config.selfId || this.selfIdentity?.id;
    const selfSecUid = this.selfIdentity?.secUid;
    return Boolean((selfId && user.id && String(user.id) === String(selfId)) || (selfSecUid && user.secUid && user.secUid === selfSecUid));
  }
  start() {
    if (this.running) return;
    const resuming = Boolean(this.resumeRequested);
    this.running = true; this.resumeRequested = false; this.epoch++;
    if (!resuming) { this.lastChat = this.now(); this.lastInteraction = this.now(); this.timerDue.clear(); }
    this.log('system', resuming ? '场控已从上次状态恢复' : '场控已开始'); this.changed();
  }
  stop(reason = '已暂停', { preserveWork = false } = {}) {
    this.running = false; this.epoch++;
    // 人工暂停、切房间和配置变更继续清空现场任务；发送异常则由调用方保留 outbox，
    // 让管理员修复控件后可以继续发送，避免“已入队但未确认”变成静默丢失。
    if (!preserveWork) { this.queue = []; this.giftJobs.clear(); this.gifts.clear(); this.bot.reset(); this.botAIUsers = new Set(); this.timerDue.clear(); this.history = []; }
    else if (this.inFlight?.jobs?.length) {
      const known = new Set(this.queue.map(job => job.id));
      for (const job of this.inFlight.jobs) if (!known.has(job.id)) this.queue.unshift({ ...job, deliveryUncertain:true });
      this.inFlight = null; this.rebuildGiftIndex();
    }
    if (!preserveWork) this.resumeRequested = false;
    this.onStop(); this.log('system', preserveWork ? `${reason}；未确认消息已保留，恢复后继续` : reason); this.changed();
  }
  cooldown(key, seconds) {
    const now = this.now();
    if (this.cooldowns.has(key) && now - this.cooldowns.get(key) < seconds * 1000) return false;
    this.cooldowns.set(key, now); return true;
  }
  choose(key, templates) {
    return choosePhrase(this.rotation, key, templates);
  }
  filtered(reason) { this.stats.filtered++; this.log('filter', reason); }
  indexGiftJob(job) {
    const userKey = job.giftReply?.userKey;
    if (!userKey) return;
    let jobs = this.giftJobs.get(userKey);
    if (!jobs) this.giftJobs.set(userKey, jobs = new Set());
    jobs.add(job);
  }
  deindexGiftJob(job) {
    const userKey = job.giftReply?.userKey, jobs = userKey && this.giftJobs.get(userKey);
    if (!jobs) return;
    jobs.delete(job); if (!jobs.size) this.giftJobs.delete(userKey);
  }
  rebuildGiftIndex() {
    this.giftJobs.clear();
    for (const job of this.queue) this.indexGiftJob(job);
  }
  enqueue(kind, text, extra = {}) {
    const checked = cleanMessage(text, this.config);
    if (!checked.ok) { this.filtered(`${kind}：${checked.reason}`); return false; }
    const now = this.now();
    const eventReplies = kind === 'gift' || kind === 'like' || kind === 'bot';
    if (!eventReplies && ((this.duplicates.get(checked.text) ?? -Infinity) + this.config.sending.duplicateSec * 1000 > now || this.queue.some(q => q.text === checked.text))) { this.filtered('重复话术已过滤'); return false; }
    const item = { id: ++this.serial, kind, text: checked.text, priority: ({ gift: 100, bot: 90, welcome: 80, keyword: 60, ai: 40, like: 30, timer: 20 })[kind] || 10, created: now, expires: now + (kind === 'gift' ? 120000 : 45000), ...extra };
    // 礼物是已发生的事实，不能因为普通互动积压而静默丢弃。
    // 普通互动仍受 queueLimit 约束，并优先淘汰低优先级、较旧的任务。
    const isGift = kind === 'gift' || extra.giftReply;
    if (!isGift && this.queue.length >= this.config.sending.queueLimit) {
      let lowest = null, lowestIndex = -1;
      for (let index = 0; index < this.queue.length; index++) {
        const q = this.queue[index];
        if (q.giftReply || q.kind === 'bot') continue;
        if (!lowest || q.priority < lowest.priority || q.priority === lowest.priority && q.created < lowest.created) { lowest = q; lowestIndex = index; }
      }
      if (!lowest || lowest.priority >= item.priority) { if (!extra.quietOverflow) { this.stats.overflow++; this.filtered('队列已满，本次互动未入队'); } return false; }
      this.queue.splice(lowestIndex, 1); this.stats.overflow++; this.filtered(`队列已满，移除${lowest.kind}消息`);
    }
    this.queue.push(item); this.indexGiftJob(item);
    this.log('queue', `${kind}：${checked.text}`); this.changed(); return true;
  }
  ingest(event) {
    try { this.ingestEvent(event); } finally { this.changed(); }
  }
  ingestEvent(event) {
    const now = this.now(); this.stats.events++;
    if (event.id) {
      // 同一个消息 ID 可能承载更新后的连击进度/单价；由礼物状态按累计增量去重。
      const seenKey = event.type === 'gift' ? JSON.stringify([event.type, event.id, event.roomId, keyFor(event.user || {}), event.giftId, event.groupId, event.count, event.unitValue, event.final]) : `${event.type}:${event.id}`;
      if (this.seen.has(seenKey)) return;
      this.seen.set(seenKey, now); if (this.seen.size > 5000) this.seen.delete(this.seen.keys().next().value);
    }
    // 按帧实际到达时间区分历史补推；主线程解码积压不能让实时消息变成历史消息。
    const arrival = Number.isFinite(event.receivedAt) && event.receivedAt <= now && now - event.receivedAt < 600000 ? event.receivedAt : now;
    if (event.at && (arrival - event.at > 30000 || event.at - arrival > 60000)) { this.filtered('历史或异常时间事件已忽略'); return; }
    if (!this.running) return;
    if (event.type === 'end') { this.stop('直播已结束'); return; }
    const u = event.user || {};
    const isSelf = this.isSelfUser(u);
    if (isSelf) { this.filtered('当前登录账号的互动事件已忽略'); return; }
    if (!u.name || matchesUser(u, this.config.ignored)) return;
    if (event.type === 'chat') {
      if (!event.text || (this.selfTexts.get(event.text) || 0) > now) return;
      this.lastChat = now; this.lastInteraction = now;
      this.history.push({ name: u.name.slice(0, 40), text: String(event.text).slice(0, 300), at: now });
      const contextAge = this.config.ai.contextAgeSec * 1000;
      while (this.history.length && (now - this.history[0].at > contextAge || this.history.length > this.config.ai.contextSize)) this.history.shift();
      if (this.config.moderation.enabled) this.checkModeration(event, now);
      const a = this.config.ai;
      const command = addressedToSelf(event, this.selfIdentity, this.config.selfId);
      if (command !== null) {
        if (this.config.bot.enabled) { this.handleBot(event, command); return; }
        if (a.enabled && a.chatEnabled) void this.requestAI(event, { kind: 'ai', instruction: '观众明确 @ 了当前登录场控账号。请结合目标问题和最近直播间聊天记录回答；只回答能从上下文或已核实资料确认的内容，不确定时简短说明并请主播确认。' });
        return;
      }
      // 房间游戏启动后，参与者无需再次 @。只有游戏真正识别的消息才会被消费，
      // 报名/回答入队成功后才提交会话状态，避免队列拥堵造成状态与播报不一致。
      if (this.config.bot.enabled) {
        const game = this.bot.participate(event.text, u, this.config.bot, this.config.sending.maxLength);
        if (game.handled) {
          if (game.text && this.enqueue('bot', game.text, { botUser:keyFor(u), quietOverflow:true })) game.commit?.();
          return;
        }
      }
      if (this.config.keyword.enabled) {
        const rule = this.config.keyword.rules.find(r => r.keywords.some(k => k && (r.exact ? event.text === k : event.text.includes(k))));
        if (rule) {
          if (this.cooldown(`keyword:${keyFor(u)}`, this.config.keyword.cooldownSec)) {
            if (this.config.keyword.responseMode === 'ai') void this.requestAI(event, { kind: 'keyword', instruction: `回复命中了关键词规则：${rule.keywords.join('、')}。请围绕该规则回应。固定话术参考：${rule.reply}`, fallback: renderTemplate(rule.reply, { user: u.name }) });
            else this.enqueue('keyword', renderTemplate(rule.reply, { user: u.name }));
          }
          return; // 固定规则冷却期间也不让 AI 接管同一问题。
        }
      }
      const trigger = a.trigger === 'all' || (a.trigger === 'mention' && a.mentions.some(k => k && event.text.includes(k))) || (a.trigger === 'question' && /[?？]|怎么|如何|什么|哪里|多少|几点|吗|么|能否/.test(event.text));
      if (a.enabled && a.chatEnabled && trigger) void this.requestAI(event, { kind: 'ai', instruction: '根据目标弹幕和最近聊天自然回复。' });
    } else if (event.type === 'enter' && this.config.welcome.enabled) {
      const decision = welcomeDecision(u, this.config);
      if (!decision.pass) this.filtered(`${u.name}：${decision.reason}`);
      else if (this.cooldown(`welcome:${keyFor(u)}`, this.config.welcome.cooldownSec)) {
        this.lastInteraction = now;
        const club = (u.fanClubs || []).find(c => c.anchorId === this.config.anchorId);
        const fallback = renderTemplate(this.choose('welcome', this.config.welcome.templates), { user: u.name, level: u.wealthLevel ?? '?', fanLevel: club?.level ?? '?' });
        if (this.config.welcome.responseMode === 'ai') void this.requestAI({ type: 'welcome', user: u }, { kind: 'welcome', instruction: '礼貌欢迎这位刚进场的观众。', data: { wealthLevel: u.wealthLevel ?? '未知', fanLevel: club?.level ?? '未知', fanClubLit: club ? club.status === 1 : '未知' }, fallback });
        else this.enqueue('welcome', fallback);
      }
    } else if (event.type === 'gift' && this.config.gift.enabled) this.recordGift(event);
    else if (event.type === 'like' && this.config.like.enabled) this.recordLike(event);
  }
  handleBot(event, command) {
    const userKey = keyFor(event.user), now = this.now(), cooldownKey = `bot:${userKey}`;
    if (now - (this.cooldowns.get(cooldownKey) ?? -Infinity) < this.config.bot.cooldownSec * 1000 || this.queue.some(q => q.kind === 'bot' && q.botUser === userKey) || this.botAIUsers?.has(userKey)) {
      this.filtered('机器人：该用户互动处理中或间隔未到'); return;
    }
    const reply = this.bot.reply(command, this.config.bot, this.config.sending.maxLength, event.user.name, userKey);
    if (reply) {
      if (this.enqueue('bot', reply.text, {botUser:userKey})) { this.cooldowns.set(cooldownKey, now); reply.commit?.(); }
    } else if (this.config.ai.enabled && this.config.ai.chatEnabled) {
      this.cooldowns.set(cooldownKey, now);
      this.botAIUsers ||= new Set(); this.botAIUsers.add(userKey);
      const activeUsers = this.botAIUsers;
      void this.requestAI({...event, text:command}, {kind:'bot', extra:{botUser:userKey}, instruction:'观众 @ 当前场控提问。结合直播上下文简短回答，不确定就说明。', fallback:this.config.sending.maxLength >= 23 ? 'AI 暂不可用，发送菜单可查看本地互动。' : 'AI忙，请发菜单'}).finally(() => activeUsers.delete(userKey));
    } else {
      const text = this.config.sending.maxLength >= 20 ? '发送「菜单」查看互动；例如：骰子、硬币。' : '发送菜单查看互动';
      if (this.enqueue('bot', text, {botUser:userKey})) this.cooldowns.set(cooldownKey, now);
    }
  }
  checkModeration(event, now) {
    const text = String(event.text || '').toLocaleLowerCase();
    const matches = this.config.moderation.terms.filter(term => term.trim() && text.includes(term.toLocaleLowerCase()));
    if (!matches.length) return;
    const key = keyFor(event.user || {}), since = now - this.config.moderation.windowSec * 1000;
    const records = (this.offenses.get(key) || []).filter(record => record.at >= since);
    records.push({ at: now, terms: matches }); this.offenses.set(key, records);
    const count = records.length;
    this.log('moderation', `${event.user?.name || '未知用户'}：疑似辱骂/恶意弹幕 ${count}/${this.config.moderation.threshold} 次（命中词：${matches.join('、')}）`);
    if (count === this.config.moderation.threshold) this.log('moderation', `已达到提醒阈值，请管理员核查 ${event.user?.name || '该用户'} 的发言。当前账号管理员身份未验证，未执行封禁。`);
    if (this.offenses.size > 1000) this.offenses.delete(this.offenses.keys().next().value);
  }
  recordLike(event) {
    const user = event.user, config = this.config.like;
    if (!this.cooldown(`like:${keyFor(user)}`, config.cooldownSec)) { this.filtered(`${user.name} 点赞感谢冷却中`); return; }
    this.lastInteraction = this.now();
    const fallback = renderTemplate(this.choose('like', config.templates), { user: user.name, count: event.count || 1 });
    if (config.responseMode === 'ai') {
      void this.requestAI({ type: 'like', user }, {
        kind: 'like', instruction: `感谢观众 ${user.name} 哥给直播间点赞，语气自然简短，不要引导继续打赏。`,
        data: { likeCount: event.count || 1 }, fallback
      });
    } else this.enqueue('like', fallback);
  }
  recordGift(e) {
    const g = this.config.gift, now = this.now();
    const count = Number(e.count);
    if (!Number.isSafeInteger(count) || count < 1 || count > 1000000) { this.filtered('礼物数量无效'); return; }
    const key = `${e.roomId || ''}:${keyFor(e.user)}:${e.giftId || e.giftName}:${e.groupId || 'window'}`;
    let state = this.gifts.get(key);
    if (!state || (!e.groupId && (state.ended || count < state.count))) {
      if (state && state.count > state.credited && !this.settleGift(state)) {
        // 无 groupId 的新一组不能覆盖尚未入队的旧组。
        this.gifts.set(`${key}:pending:${++this.serial}`, state);
      }
      state = { ...e, count: 0, credited: 0, pendingSince: now, touched: now, ended: false };
    }
    const increased = count > state.count;
    if (increased && state.count === state.credited) state.pendingSince = now;
    state.count = Math.max(state.count, count);
    if (Number.isFinite(e.unitValue) && e.unitValue > 0) state.unitValue = e.unitValue;
    state.user = e.user; state.giftName = e.giftName || state.giftName;
    state.touched = now; state.ended ||= Boolean(e.final);
    // 使用短静默窗口合并连击，避免默认等待 4～8 秒才感谢；同时设置最大聚合窗口，
    // 让持续连击在高峰期也能分段结算。final 帧仍立即结算。
    if (increased || e.final || !Number.isFinite(state.due)) {
      const quietMs = Math.min(g.mergeSec * 1000, 1500);
      const maxWindowMs = Math.min(g.mergeSec * 1000, 3000);
      state.due = state.ended ? now : Math.min(now + quietMs, state.pendingSince + maxWindowMs);
    }
    this.gifts.set(key, state); this.lastInteraction = now;
    // 内存回收只能移除已入队的结算记录，不能删掉队列满时仍在等待感谢的礼物。
    if (this.gifts.size > 5000) {
      for (const [oldKey, old] of this.gifts) {
        if (old.count === old.credited) this.gifts.delete(oldKey);
        if (this.gifts.size <= 5000) break;
      }
      if (this.gifts.size > 5000 && !this.giftBacklogWarned) { this.giftBacklogWarned = true; this.log('system', '礼物结算积压超过 5000 组，未感谢记录继续保留；请检查发送连接与感谢门槛'); }
    } else this.giftBacklogWarned = false;
  }
  giftText(reply, compact = false) {
    const g = this.config.gift;
    const count = reply.items.reduce((n, item) => n + item.count, 0), value = reply.items.reduce((n, item) => n + item.count * item.price, 0);
    const gift = reply.items.map(item => item.name).join('、');
    if (!compact && reply.items.length === 1) {
      const text = renderTemplate(reply.template, { user: reply.user.name, gift, count, value, unit: reply.items[0]?.price || 0 });
      if (cleanMessage(text, this.config).ok) return text;
    }
    // 只缩短昵称/礼物描述，不把整条感谢因长昵称直接丢弃。
    const clip = (text, length) => [...text].slice(0, length).join('');
    for (const limit of [12, 8, 4, 1]) {
      const gifts = reply.items.map(item => `${clip(item.name, limit)}×${item.count}`).join('、');
      const text = `感谢${clip(reply.user.name, limit)}的${gifts}！`;
      if ([...text].length <= this.config.sending.maxLength) return text;
    }
    // 多种礼物再缩短名称也可能超长，改为总数量，确保能进入队列。
    const summaries = [
      `感谢${clip(reply.user.name, 4)}的${count}个礼物！`,
      `感谢${clip(reply.user.name, 1)}的礼物支持！`,
      '谢谢礼物支持！'
    ];
    return summaries.find(text => [...text].length <= this.config.sending.maxLength);
  }
  settleGift(s) {
    const g = this.config.gift, price = Number.isFinite(s.unitValue) && s.unitValue > 0 ? s.unitValue : g.prices[s.giftId] ?? g.prices[s.giftName];
    if (!Number.isFinite(price) || price <= 0) { if (!s.unknownReported) { this.filtered(`${s.giftName || '礼物'}：单价未知，等待单价或价格表`); s.unknownReported = true; } return false; }
    const count = s.count - s.credited;
    if (count <= 0) return true;
    if ((g.basis === 'unit' ? price : s.count * price) < g.minValue) return false;
    const userKey = keyFor(s.user), old = this.giftJobs.get(userKey)?.values().next().value;
    const reply = old ? { ...old.giftReply, items: old.giftReply.items.map(item => ({...item})) } : {
      userKey, user: s.user, items: [], template: this.choose('gift', g.templates)
    };
    const giftKey = s.giftId || s.giftName;
    const item = reply.items.find(item => item.key === giftKey && item.price === price);
    if (item) item.count += count;
    else reply.items.push({key:giftKey,name:s.giftName || '礼物',count,price});
    const text = this.giftText(reply);
    // 屏蔽词是显式规则，不能通过缩短话术绕过。
    if (this.config.blockedWords.some(word => word && `${s.user.name} ${s.giftName} ${reply.template} ${text}`.toLocaleLowerCase().includes(word.toLocaleLowerCase()))) {
      this.filtered('礼物感谢命中屏蔽词'); s.credited = s.count; return true;
    }
    if (old) {
      old.giftReply = reply; old.text = text; old.revision++; old.aiPending = false;
      old.readyAt = Math.min(old.readyAt, this.now());
    } else {
      if (!this.enqueue('gift', text, {giftReply:reply, revision:1, readyAt:this.now(), quietOverflow:true})) return false;
      const job = this.queue.at(-1);
      if (g.responseMode === 'ai') {
        job.readyAt = this.now() + 1500; job.aiPending = true;
        void this.requestAI({type:'gift',user:s.user}, {
          kind:'gift', instruction:'简短感谢这位观众，礼物名称和数量必须与数据一致。',
          data:{giftName:s.giftName,count,totalDiamonds:count*price,unitDiamonds:price,style:++this.giftStyleSerial},
          fallback:text, targetJob:job, revision:job.revision, deadline:this.now()+1500
        });
      }
    }
    s.credited = s.count;
    return true;
  }
  giftReady(q, now) {
    return (q.retryAt || 0) <= now && (!q.giftReply || now >= Math.max(q.readyAt || 0, (this.giftSentAt.get(q.giftReply.userKey) ?? -Infinity) + this.config.gift.cooldownSec * 1000));
  }
  giftBatch(first, now) {
    const jobs = [first]; let text = first.text;
    if (!first.giftReply || !this.config.gift.batchEnabled) return {jobs,text};
    const clip = value => [...value].slice(0, 8).join('');
    const part = q => `${clip(q.giftReply.user.name)}的${q.giftReply.items.map(item => `${clip(item.name)}×${item.count}`).join('、')}`;
    const ready = [];
    let readyCount = 0;
    for (const q of this.queue) {
      if (q === first || !q.giftReply || !this.giftReady(q, now)) continue;
      readyCount++;
      let index = ready.findIndex(item => item.created > q.created || item.created === q.created && item.id > q.id);
      if (index < 0) index = ready.length;
      if (index < 5) { ready.splice(index, 0, q); if (ready.length > 5) ready.pop(); }
    }
    if (!readyCount || (readyCount < 2 && now - first.created < 2000)) return {jobs,text};
    const parts = [part(first)];
    for (const q of ready) {
      const candidate = `感谢${[...parts,part(q)].join('，')}！`;
      if (!cleanMessage(candidate, this.config).ok) break;
      jobs.push(q); parts.push(part(q)); text = candidate;
    }
    return {jobs,text};
  }
  selectNextJob(queue, now) {
    let best = null, oldestGift = null, waitingBot = null;
    const earlier = (a, b) => !b || a.created < b.created || a.created === b.created && a.id < b.id;
    const higherPriority = (a, b) => !b || a.priority > b.priority || a.priority === b.priority && earlier(a, b);
    for (const item of queue) {
      if (!this.giftReady(item, now)) continue;
      if (higherPriority(item, best)) best = item;
      if (item.kind === 'gift' && earlier(item, oldestGift)) oldestGift = item;
      if (item.kind === 'bot' && now - item.created >= 3000 && earlier(item, waitingBot)) waitingBot = item;
    }
    if (!best) return null;
    if (!oldestGift) return waitingBot || best;

    // 礼物感谢是事实型事件，等待过久后必须占用下一个发送槽。
    // 礼物高峰期间每隔一个短时间片仍允许已等待的 @ 互动发送，避免游戏永久饥饿。
    const giftWait = now - oldestGift.created;
    if (waitingBot && now - this.lastGiftSend >= 1500 && giftWait < 5000) return waitingBot;
    return oldestGift;
  }
  async requestAI(event = null, task = { kind: 'ai', instruction: '根据最近公屏进行轻量互动。' }) {
    const a = this.config.ai, now = this.now(), epoch = this.epoch;
    const currentJob = () => task.targetJob && this.queue.includes(task.targetJob) && task.targetJob.revision === task.revision;
    const fallback = reason => {
      if (this.running && epoch === this.epoch && task.kind !== 'ai' && task.fallback) {
        if (task.targetJob) {
          if (currentJob()) { task.targetJob.readyAt = this.now(); task.targetJob.aiPending = false; }
          return;
        }
        this.log('ai', `${task.kind}：${reason}，改用规则话术`);
        this.enqueue(task.kind, task.fallback, task.extra);
      }
    };
    this.calls = this.calls.filter(t => now - t < 3600000);
    if (!this.running) return;
    if (!a.enabled) { fallback('AI 服务未启用'); return; }
    if (this.aiBusy || (task.targetJob && this.queue.filter(q => q.kind === 'gift').length >= 3) || now - this.lastAI < a.intervalSec * 1000 || this.calls.length >= a.maxPerHour) { fallback('AI 调用频率或额度已达上限'); return; }
    if (event?.user && !this.cooldown(`ai-user:${task.kind}:${keyFor(event.user)}`, a.userCooldownSec)) { fallback('该用户 AI 回复冷却中'); return; }
    this.aiBusy = true; this.lastAI = now; this.calls.push(now); this.stats.aiCalls++;
    const context = this.history.filter(c => now - c.at <= a.contextAgeSec * 1000).slice(-a.contextSize);
    const prompt = {
      persona: a.persona, knowledge: a.knowledge, context,
      target: event ? { type: event.type, name: event.user?.name || '', text: event.text || '' } : null,
      task: { kind: task.kind, instruction: task.instruction, data: task.data || null }, maxLength: this.config.sending.maxLength
    };
    try {
      const output = await this.ai(prompt, a);
      if (this.running && epoch === this.epoch && this.now() - now < 45000) {
        if (task.targetJob) {
          if (currentJob() && this.now() <= task.deadline) {
            if (output.trim() !== '[SKIP]' && cleanMessage(output, this.config).ok) task.targetJob.text = output;
            task.targetJob.readyAt = this.now(); task.targetJob.aiPending = false;
          }
          return;
        }
        if (output.trim() === '[SKIP]') { this.log('ai', 'AI 判断无需回复'); fallback('AI 未生成回复'); }
        else if (!this.enqueue(task.kind, output, task.extra)) fallback('AI 回复未通过检查');
      }
    } catch (error) { this.log('error', `AI 调用失败：${error.message}`); fallback('AI 调用失败'); }
    finally { this.aiBusy = false; this.changed(); }
  }
  async tick(canSend = true) {
    if (!this.running || this.busy) return;
    const now = this.now(); let stateChanged = false;
    const sessionNotice = this.config.bot.enabled ? this.bot.expire(now) : null;
    if (sessionNotice) { stateChanged = true; this.enqueue('bot', sessionNotice, { quietOverflow:true }); }
    // 高频弹幕期间不每秒遍历所有去重/冷却记录；冷却按各自有效时长清理。
    if (now - this.lastMaintenance >= 30000) {
      this.lastMaintenance = now;
      const retention = Math.max(this.config.gift.cooldownSec, this.config.welcome.cooldownSec, this.config.keyword.cooldownSec, this.config.like.cooldownSec, this.config.bot.cooldownSec, this.config.ai.userCooldownSec) * 1000;
      for (const [map, age] of [[this.seen, 120000], [this.cooldowns, retention], [this.duplicates, this.config.sending.duplicateSec * 1000], [this.selfTexts, 0], [this.giftSentAt, Math.max(120000, this.config.gift.cooldownSec * 1000)]]) {
        for (const [key, at] of map) if (now - at > age) { map.delete(key); stateChanged = true; }
        while (map.size > 5000) { map.delete(map.keys().next().value); stateChanged = true; }
      }
    }
    for (const [key, s] of this.gifts) {
      if (s.due <= now && s.count > s.credited) {
        const settled = this.settleGift(s);
        stateChanged = true;
        const price = Number.isFinite(s.unitValue) && s.unitValue > 0 ? s.unitValue : this.config.gift.prices[s.giftId] ?? this.config.gift.prices[s.giftName];
        // 未知/低于门槛的礼物不忙循环；收到后续累计帧仍会立即重新安排结算。
        const belowThreshold = (this.config.gift.basis === 'unit' ? price : s.count * price) < this.config.gift.minValue;
        s.due = settled || !Number.isFinite(price) || price <= 0 || belowThreshold ? Infinity : now + 500;
      }
      if (now - s.touched > 120000 && s.count === s.credited) { this.gifts.delete(key); stateChanged = true; }
      else if (now - s.touched > 600000 && s.count > s.credited) {
        const price = Number.isFinite(s.unitValue) && s.unitValue > 0 ? s.unitValue : this.config.gift.prices[s.giftId] ?? this.config.gift.prices[s.giftName];
        if (!price || (this.config.gift.basis === 'unit' ? price : s.count * price) < this.config.gift.minValue) { this.gifts.delete(key); stateChanged = true; this.filtered('未达到感谢门槛或单价未知的礼物，等待十分钟后结束结算'); }
      }
    }
    if (this.config.timersEnabled) for (const t of this.config.timers) {
      if (!t.enabled) continue;
      if (!this.timerDue.has(t.id)) { this.timerDue.set(t.id, now + t.intervalSec * 1000); stateChanged = true; }
      if (now < this.timerDue.get(t.id)) continue;
      this.timerDue.set(t.id, now + t.intervalSec * 1000); stateChanged = true; // 后台计时恢复时不补发。
      if (!inTimeWindow(t.start, t.end, now) || now - this.lastInteraction < t.quietSec * 1000 || this.queue.some(q => q.kind === 'timer')) continue;
      const fallback = this.choose(`timer:${t.id}`, t.messages);
      if (t.responseMode === 'ai') void this.requestAI(null, { kind: 'timer', instruction: '生成一句自然、克制的直播间定时互动话术。', data: { intervalSec: t.intervalSec }, fallback });
      else this.enqueue('timer', fallback);
    }
    if (this.config.ai.enabled && this.config.ai.chatEnabled && this.config.ai.idleEnabled && now - this.lastChat >= this.config.ai.idleSec * 1000 && now - this.lastInteraction >= this.config.ai.idleSec * 1000) {
      this.lastInteraction = now; stateChanged = true; void this.requestAI(null, { kind: 'ai', instruction: '直播间暂时冷场，请生成一句轻量互动邀请。' });
    }
    // 礼物感谢已经完成了连击结算，发送失败/断线时必须保留；普通互动仍按短时效清理。
    // 否则高峰期遇到长连接重连，120 秒后会静默丢掉已统计的感谢任务。
    let expiredCount = 0;
    for (const q of this.queue) if (q.expires <= now && !q.giftReply) expiredCount++;
    if (expiredCount) {
      this.stats.expired += expiredCount; this.log('filter', `${expiredCount} 条排队消息已过期`);
      let write = 0;
      for (let read = 0; read < this.queue.length; read++) {
        const job = this.queue[read];
        if (job.expires > now || job.giftReply) this.queue[write++] = job;
      }
      this.queue.length = write; stateChanged = true;
    }
    const q = canSend ? this.selectNextJob(this.queue, now) : null;
    if (!q) { if (stateChanged) this.changed(); return; }
    const batch = q.kind === 'gift' ? this.giftBatch(q, now) : {jobs:[q],text:q.text};
    const checked = cleanMessage(batch.text, this.config);
    const selectedJobs = new Set(batch.jobs); let write = 0;
    for (let read = 0; read < this.queue.length; read++) {
      const job = this.queue[read];
      if (!selectedJobs.has(job)) this.queue[write++] = job;
    }
    this.queue.length = write;
    for (const job of batch.jobs) this.deindexGiftJob(job);
    if (!checked.ok) {
      // 礼物已被统计，格式检查失败时重新放回队列，等待下一次压缩或配置修复。
      if (q.kind === 'gift') for (const job of batch.jobs) { this.queue.push(job); this.indexGiftJob(job); }
      else this.filtered(checked.reason);
      this.changed(); return;
    }
    this.busy = true;
    const epoch = this.epoch;
    this.inFlight = { text:batch.text, jobs:batch.jobs, startedAt:this.now() };
    this.changed();
    const submitted = () => {
      const sentAt = this.now();
      this.stats.maxQueueWaitMs = Math.max(this.stats.maxQueueWaitMs || 0, sentAt - Math.min(...batch.jobs.map(job => job.created)));
      if (q.kind === 'bot') this.lastBotSend = sentAt;
      if (q.kind === 'gift') this.lastGiftSend = sentAt;
      if (!['gift','like','bot'].includes(q.kind)) this.duplicates.set(q.text, sentAt);
      for (const job of batch.jobs) if (job.giftReply) this.giftSentAt.set(job.giftReply.userKey, sentAt);
    };
    const retry = reason => {
      this.stats.retries += batch.jobs.length;
      for (const job of batch.jobs) {
        job.attempts = (job.attempts || 0) + 1; job.retryAt = this.now() + Math.min(5000, 500 * 2 ** Math.min(job.attempts-1,4));
        this.queue.push(job); this.indexGiftJob(job);
      }
      if (this.lastRetryReason !== reason) { this.lastRetryReason = reason; this.log('system', `${reason}；消息保留，稍后继续发送`); }
    };
    try {
      if (this.config.mode === 'preview') { submitted(); this.stats.previews++; this.log('preview', batch.text); }
      else {
        await this.checkpoint();
        if (this.epoch !== epoch) return;
        this.selfTexts.set(batch.text, now + 120000);
        const result = await this.send(batch.text, () => this.running && this.epoch === epoch);
        if (this.epoch !== epoch) return;
        if (result?.submitted) { submitted(); this.lastRetryReason = ''; this.stats.submitted++; this.log('sent', `已提交，尚未核实公屏回显：${batch.text}`); }
        else if (result?.retryable) retry(result.reason || '发送控件暂不可用');
        // send() 未明确确认提交时不能直接丢弃任务。适配器会在真正点击前返回
        // retryable；即使页面在点击后没有清空输入框，也保留任务交给下一轮核验。
        else retry(result?.reason || '未确认发送');
      }
    } catch (error) {
      if (this.epoch === epoch) {
        retry(error.message || '发送异常');
        if (error.retryable) this.log('system', `发送暂不可用：${error.message}；消息保留，稍后继续发送`);
        else { this.log('error', `发送停止：${error.message}`); this.stop('发送失败，检查登录、输入框和发送按钮后再开始', { preserveWork: true }); }
      }
    }
    finally { this.inFlight = null; this.busy = false; this.changed(); }
  }
}
