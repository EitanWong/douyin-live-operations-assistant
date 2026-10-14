export const DEFAULTS = {
  version: 1,
  mode: 'preview',
  anchorId: '', selfId: '', ignored: [], blockedWords: [],
  identity: { autoAnchor: true, autoSelf: true },
  moderation: { enabled: true, terms: ['傻逼', '煞笔', '脑残', '去死'], threshold: 3, windowSec: 600 },
  sending: { intervalSec: 10, perMinute: 4, maxLength: 50, duplicateSec: 120, queueLimit: 30 },
  gift: {
    enabled: true, responseMode: 'rules', minValue: 100, basis: 'total', mergeSec: 4, cooldownSec: 1,
    prices: {}, templates: [
      '感谢 {user} 哥送的 {gift}，太给力了！',
      '谢谢 {user} 哥的 {gift}，心意收到啦～',
      '{user} 哥送来 {gift} ×{count}，感谢支持！',
      '感谢 {user} 哥送的 {gift}，祝你今天开心！'
    ]
  },
  welcome: {
    enabled: true, responseMode: 'rules', mode: 'qualified-or-listed', minWealth: 30, requireFan: true,
    minFanLevel: 1, requireLit: true, listed: [], cooldownSec: 600,
    templates: ['欢迎 {user} 来到直播间，晚上好！', '{user} 来啦，欢迎回来！']
  },
  like: {
    enabled: false, responseMode: 'rules', cooldownSec: 60,
    templates: [
      '谢谢 {user} 哥给主播点的赞，感谢支持！',
      '{user} 哥的赞收到啦，感谢你！',
      '感谢 {user} 哥点赞，祝你今天开心！'
    ]
  },
  keyword: { enabled: false, responseMode: 'rules', rules: [{ keywords: ['几点开播'], reply: '{user}，开播时间请看主播主页公告～', exact: false }], cooldownSec: 60 },
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
  return result;
}

export function validateConfig(c) {
  const range = (v, min, max, name) => { if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${name}范围为 ${min}–${max}`); };
  const choice = (v, values, name) => { if (!values.includes(v)) throw new Error(`${name}无效`); };
  const strings = (v, name) => { if (!Array.isArray(v) || v.length > 200 || v.some(x => typeof x !== 'string' || x.length > 4000)) throw new Error(`${name}必须是文本数组（最多 200 条）`); };
  choice(c.mode, ['preview', 'review', 'auto'], '发送模式');
  choice(c.gift.basis, ['total', 'unit'], '礼物价值口径');
  choice(c.welcome.mode, ['qualified', 'listed', 'qualified-or-listed'], '欢迎方式');
  choice(c.ai.trigger, ['question', 'mention', 'all'], 'AI 触发方式');
  range(c.moderation.threshold, 1, 20, '违规提醒次数'); range(c.moderation.windowSec, 30, 86400, '违规统计时长');
  for (const [mode, name] of [[c.gift.responseMode,'礼物回复方式'], [c.welcome.responseMode,'欢迎回复方式'], [c.like.responseMode,'点赞感谢方式'], [c.keyword.responseMode,'关键词回复方式']]) choice(mode, ['rules','ai'], name);
  range(c.sending.intervalSec, 5, 600, '发送间隔秒数'); range(c.sending.perMinute, 1, 12, '每分钟上限');
  range(c.sending.maxLength, 10, 50, '消息长度'); range(c.sending.queueLimit, 1, 100, '队列上限');
  range(c.sending.duplicateSec, 10, 3600, '重复消息冷却');
  range(c.gift.minValue, 0, 1e9, '礼物阈值'); range(c.gift.mergeSec, 1, 30, '连击合并秒数');
  range(c.gift.cooldownSec, 0, 3600, '礼物用户冷却'); range(c.welcome.cooldownSec, 10, 86400, '欢迎冷却');
  range(c.welcome.minWealth, 0, 100, '荣誉等级'); range(c.welcome.minFanLevel, 0, 100, '粉丝团等级');
  range(c.keyword.cooldownSec, 5, 3600, '关键词用户冷却');
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
const keyFor = u => u.id || u.secUid || `name:${u.name}`;

export class Engine {
  constructor({ config = copy(DEFAULTS), now = Date.now, send = async () => {}, ai = async () => '', log = () => {}, changed = () => {} } = {}) {
    this.config = validateConfig(mergeConfig(config)); this.now = now; this.send = send; this.ai = ai; this.log = log; this.changed = changed;
    this.queue = []; this.history = []; this.seen = new Map(); this.cooldowns = new Map(); this.gifts = new Map(); this.duplicates = new Map();
    this.calls = []; this.sentTimes = []; this.running = false; this.epoch = 0; this.serial = 0; this.lastSend = -Infinity;
    this.lastChat = now(); this.lastInteraction = now(); this.lastAI = -Infinity; this.aiBusy = false; this.busy = false;
    this.timerDue = new Map(); this.rotation = new Map(); this.selfTexts = new Map(); this.offenses = new Map(); this.selfIdentity = null; this.giftStyleSerial = 0;
    this.lastMaintenance = -Infinity;
    this.stats = { events: 0, filtered: 0, previews: 0, submitted: 0, aiCalls: 0 };
  }
  update(config) { this.stop('配置已更新，请重新开始'); this.config = validateConfig(mergeConfig(config)); this.rotation.clear(); }
  setIdentity(identity) { this.selfIdentity = identity?.self || null; }
  start() { if (this.running) return; this.running = true; this.epoch++; this.lastChat = this.now(); this.lastInteraction = this.now(); this.timerDue.clear(); this.log('system', '场控已开始'); this.changed(); }
  stop(reason = '已暂停') { this.running = false; this.epoch++; this.queue = []; this.gifts.clear(); this.timerDue.clear(); this.history = []; this.log('system', reason); this.changed(); }
  cooldown(key, seconds) {
    const now = this.now();
    if (this.cooldowns.has(key) && now - this.cooldowns.get(key) < seconds * 1000) return false;
    this.cooldowns.set(key, now); return true;
  }
  choose(key, templates) {
    const list = templates.filter(x => x.trim()); if (!list.length) return '';
    const index = this.rotation.get(key) || 0; this.rotation.set(key, index + 1); return list[index % list.length];
  }
  filtered(reason) { this.stats.filtered++; this.log('filter', reason); }
  enqueue(kind, text, extra = {}) {
    const checked = cleanMessage(text, this.config);
    if (!checked.ok) { this.filtered(`${kind}：${checked.reason}`); return false; }
    const now = this.now();
    const eventReplies = kind === 'gift' || kind === 'like';
    if (!eventReplies && ((this.duplicates.get(checked.text) ?? -Infinity) + this.config.sending.duplicateSec * 1000 > now || this.queue.some(q => q.text === checked.text))) { this.filtered('重复话术已过滤'); return false; }
    const item = { id: ++this.serial, kind, text: checked.text, priority: ({ gift: 100, welcome: 80, keyword: 60, ai: 40, like: 30, timer: 20 })[kind] || 10, created: now, expires: now + (kind === 'gift' ? 120000 : 45000), approved: this.config.mode !== 'review', ...extra };
    if (this.queue.length >= this.config.sending.queueLimit) {
      const lowest = [...this.queue].sort((a, b) => a.priority - b.priority || a.created - b.created)[0];
      if (lowest.priority >= item.priority) { this.filtered('队列已满'); return false; }
      this.queue = this.queue.filter(q => q !== lowest); this.filtered(`队列已满，移除${lowest.kind}消息`);
    }
    this.queue.push(item); this.log('queue', `${kind}：${checked.text}`); this.changed(); return true;
  }
  approve(id, text) {
    const q = this.queue.find(q => q.id === id); if (!q) return false;
    const checked = cleanMessage(text ?? q.text, this.config); if (!checked.ok) { this.log('error', checked.reason); return false; }
    q.text = checked.text; q.approved = true; this.changed(); return true;
  }
  discard(id) { this.queue = this.queue.filter(q => q.id !== id); this.changed(); }
  ingest(event) {
    const now = this.now(); this.stats.events++;
    if (event.id) { if (this.seen.has(event.id)) return; this.seen.set(event.id, now); if (this.seen.size > 5000) this.seen.delete(this.seen.keys().next().value); }
    if (event.type === 'end') { this.stop('直播已结束'); return; }
    // 不消费历史推送，避免刷新后补发旧礼物和旧欢迎。
    if (event.at && (now - event.at > 30000 || event.at - now > 60000)) { this.filtered('历史或异常时间事件已忽略'); return; }
    if (!this.running) return;
    const u = event.user || {};
    if (!u.name || (this.config.selfId && u.id === this.config.selfId) || matchesUser(u, this.config.ignored)) return;
    if (event.type === 'chat') {
      if (!event.text || (this.selfTexts.get(event.text) || 0) > now) return;
      this.lastChat = now; this.lastInteraction = now;
      this.history.push({ name: u.name.slice(0, 40), text: String(event.text).slice(0, 300), at: now });
      this.history = this.history.filter(c => now - c.at <= this.config.ai.contextAgeSec * 1000).slice(-this.config.ai.contextSize);
      if (this.config.moderation.enabled) this.checkModeration(event, now);
      const a = this.config.ai;
      const self = this.selfIdentity;
      const mentionsSelf = Boolean(self && ((event.mentions || []).some(id => id === self.id) || (self.name && event.text.includes(`@${self.name}`))));
      if (mentionsSelf) {
        if (a.enabled && a.chatEnabled) void this.requestAI(event, { kind: 'ai', instruction: '观众明确 @ 了当前登录场控账号。请结合目标问题和最近直播间聊天记录回答；只回答能从上下文或已核实资料确认的内容，不确定时简短说明并请主播确认。' });
        return;
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
    this.changed();
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
    const key = `${keyFor(e.user)}:${e.giftId || e.giftName}:${e.groupId || 'window'}`;
    let state = this.gifts.get(key);
    if (!state) state = { ...e, count: 0, credited: 0, due: now + g.mergeSec * 1000, first: now, touched: now, ended: false };
    const count = Number(e.count);
    if (!Number.isSafeInteger(count) || count < 1 || count > 1000000) { this.filtered('礼物数量无效'); return; }
    // repeatCount 为同一连击的累计值，绝不把 1、2、3 累加成 6。
    if (!e.groupId && !state.ended && count < state.count) {
      this.settleGift(state); state = { ...e, count: 0, credited: 0, first: now, ended: false };
    }
    if (!e.groupId && state.ended) state = { ...e, count: 0, credited: 0, first: now, ended: false };
    state.count = Math.max(state.count, count);
    state.unitValue = e.unitValue ?? state.unitValue; state.user = e.user; state.giftName = e.giftName;
    state.touched = now; state.due = e.final ? now : Math.min(now + g.mergeSec * 1000, state.first + 30000);
    state.ended = Boolean(e.final); this.gifts.set(key, state); this.lastInteraction = now;
  }
  settleGift(s) {
    const g = this.config.gift;
    let price = Number.isFinite(s.unitValue) && s.unitValue > 0 ? s.unitValue : g.prices[s.giftId] ?? g.prices[s.giftName];
    if (!Number.isFinite(price) || price <= 0) { this.filtered(`${s.giftName || '礼物'}：单价未知，已跳过（可补价格表）`); return false; }
    const count = s.count - s.credited;
    if (count <= 0) return false;
    const value = count * price;
    if ((g.basis === 'unit' ? price : value) < g.minValue) { this.filtered(`${s.user.name} 的${s.giftName} ${value} 钻石：低于阈值`); return false; }
    if (!this.cooldown(`gift:${keyFor(s.user)}`, g.cooldownSec)) { this.filtered(`${s.user.name} 礼物回复冷却中`); return true; }
    const style = this.giftStyleSerial++ % 4 + 1;
    const giftData = { giftName: s.giftName || '礼物', count, totalDiamonds: value, unitDiamonds: price, style };
    const fallback = renderTemplate(this.choose('gift', g.templates), { user: s.user.name, gift: giftData.giftName, count, value, unit: price });
    if (g.responseMode === 'ai') void this.requestAI({ type: 'gift', user: s.user }, { kind: 'gift', instruction: `称呼观众为“${s.user.name}哥”，简短感谢他送出的礼物，不要引导继续打赏。表达风格使用轮换编号 ${style}，与固定套话保持变化。`, data: giftData, fallback });
    else this.enqueue('gift', fallback);
    return true;
  }
  async requestAI(event = null, task = { kind: 'ai', instruction: '根据最近公屏进行轻量互动。' }) {
    const a = this.config.ai, now = this.now(), epoch = this.epoch;
    const fallback = reason => {
      if (this.running && epoch === this.epoch && task.kind !== 'ai' && task.fallback) {
        this.log('ai', `${task.kind}：${reason}，改用规则话术`);
        this.enqueue(task.kind, task.fallback);
      }
    };
    this.calls = this.calls.filter(t => now - t < 3600000);
    if (!this.running) return;
    if (!a.enabled) { fallback('AI 服务未启用'); return; }
    if (this.aiBusy || now - this.lastAI < a.intervalSec * 1000 || this.calls.length >= a.maxPerHour) { fallback('AI 调用频率或额度已达上限'); return; }
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
        if (output.trim() === '[SKIP]') { this.log('ai', 'AI 判断无需回复'); fallback('AI 未生成回复'); }
        else if (!this.enqueue(task.kind, output)) fallback('AI 回复未通过检查');
      }
    } catch (error) { this.log('error', `AI 调用失败：${error.message}`); fallback('AI 调用失败'); }
    finally { this.aiBusy = false; this.changed(); }
  }
  async tick(canSend = true) {
    if (!this.running || this.busy) return;
    const now = this.now();
    // 高频弹幕期间不每秒遍历所有去重/冷却记录；冷却按各自有效时长清理。
    if (now - this.lastMaintenance >= 30000) {
      this.lastMaintenance = now;
      const retention = Math.max(this.config.gift.cooldownSec, this.config.welcome.cooldownSec, this.config.keyword.cooldownSec, this.config.like.cooldownSec, this.config.ai.userCooldownSec) * 1000;
      for (const [map, age] of [[this.seen, 120000], [this.cooldowns, retention], [this.duplicates, this.config.sending.duplicateSec * 1000], [this.selfTexts, 0]]) {
        for (const [key, at] of map) if (now - at > age) map.delete(key);
        while (map.size > 5000) map.delete(map.keys().next().value);
      }
    }
    for (const [key, s] of this.gifts) {
      if (s.due <= now && s.count > s.credited) {
        if (this.settleGift(s)) s.credited = s.count;
        s.due = Infinity;
      }
      if (now - s.touched > 120000) this.gifts.delete(key);
    }
    for (const t of this.config.timers.filter(t => t.enabled)) {
      if (!this.timerDue.has(t.id)) this.timerDue.set(t.id, now + t.intervalSec * 1000);
      if (now < this.timerDue.get(t.id)) continue;
      this.timerDue.set(t.id, now + t.intervalSec * 1000); // 后台计时恢复时不补发。
      if (!inTimeWindow(t.start, t.end, now) || now - this.lastInteraction < t.quietSec * 1000 || this.queue.some(q => q.kind === 'timer')) continue;
      const fallback = this.choose(`timer:${t.id}`, t.messages);
      if (t.responseMode === 'ai') void this.requestAI(null, { kind: 'timer', instruction: '生成一句自然、克制的直播间定时互动话术。', data: { intervalSec: t.intervalSec }, fallback });
      else this.enqueue('timer', fallback);
    }
    if (this.config.ai.enabled && this.config.ai.chatEnabled && this.config.ai.idleEnabled && now - this.lastChat >= this.config.ai.idleSec * 1000 && now - this.lastInteraction >= this.config.ai.idleSec * 1000) {
      this.lastInteraction = now; void this.requestAI(null, { kind: 'ai', instruction: '直播间暂时冷场，请生成一句轻量互动邀请。' });
    }
    const expired = this.queue.filter(q => q.expires <= now);
    if (expired.length) this.log('filter', `${expired.length} 条候选已过期`);
    this.queue = this.queue.filter(q => q.expires > now);
    const q = this.queue.filter(q => q.approved).sort((a, b) => b.priority - a.priority || a.created - b.created)[0];
    this.sentTimes = this.sentTimes.filter(t => now - t < 60000);
    if (!q || now - this.lastSend < this.config.sending.intervalSec * 1000 || this.sentTimes.length >= this.config.sending.perMinute || !canSend) { this.changed(); return; }
    const checked = cleanMessage(q.text, this.config);
    this.queue = this.queue.filter(item => item !== q);
    if (!checked.ok) { this.filtered(checked.reason); this.changed(); return; }
    this.busy = true; this.lastSend = now; this.sentTimes.push(now); if (q.kind !== 'gift' && q.kind !== 'like') this.duplicates.set(q.text, now);
    const epoch = this.epoch;
    try {
      if (this.config.mode === 'preview') { this.stats.previews++; this.log('preview', q.text); }
      else {
        this.selfTexts.set(q.text, now + 120000);
        const result = await this.send(q.text, () => this.running && this.epoch === epoch);
        if (result?.submitted) { this.stats.submitted++; this.log('sent', `已提交，尚未核实公屏回显：${q.text}`); }
        else this.log('filter', result?.reason || '已取消发送');
      }
    } catch (error) { this.log('error', `发送停止：${error.message}`); this.stop('发送失败，检查登录、输入框和发送按钮后再开始'); }
    finally { this.busy = false; this.changed(); }
  }
}
