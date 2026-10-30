import { IDIOM_GAME_DEFAULTS } from './idiom-game.js';
import { Moderation, MODERATION_DEFAULTS } from './moderation.js';
import { addressedToSelf, RoomBot } from './bot.js';
import { DEFAULT_PHRASES, DEFAULT_TIMER_PHRASES, DEFAULT_KEYWORD_RULES, choosePhrase } from './phrases.js';
import { LEGACY_PHRASES, LEGACY_TIMER_PHRASES, PREVIOUS_DEFAULT_PHRASES } from './legacy-phrases.js';
import { DeliveryTracker } from '../runtime/delivery.js';
import { LiveMetrics } from '../runtime/live-metrics.js';
import { REWARDS_DEFAULTS } from '../browser/rewards.js';
import { LiveModeTracker, isLiveModeEvent } from '../runtime/live-mode.js';
import { PKTracker, PK_EVENT_TYPES } from '../pk/model.js';
import { PKOperations, PK_OPERATIONS_DEFAULTS, buildPKStrategyContext, strategyRegime } from '../pk/operations.js';
import { milestoneThankYou, recognizeMilestone } from './milestones.js';
import { AudienceProfiles, audienceAddress, audienceTitle, renderAudienceTemplate, validAudienceAI } from './audience.js';
import { AnchorStats } from './anchor-stats.js';
import { audienceReplyContext, giftReplyContext, isIntrusiveReply, liveReplyContext, observedReplyEvent } from './reply-context.js';

export { recognizeMilestone };

export const DEFAULTS = {
  version: 2,
  mode: 'auto',
  automation: { autoStart: false },
  rewards: REWARDS_DEFAULTS,
  anchorId: '', selfId: '', ignored: [], blockedWords: [],
  identity: { autoAnchor: true, autoSelf: true },
  moderation: MODERATION_DEFAULTS,
  incomeEnabled: true,
  pkOperations: PK_OPERATIONS_DEFAULTS,
  // 消息按优先级连续出队；发送控件本身仍串行确认每条消息。
  sending: { maxLength: 50, duplicateSec: 120, queueLimit: 200 },
  gift: {
    enabled: true, responseMode: 'rules', minValue: 1, basis: 'total', mergeSec: 0, cooldownSec: 0, batchEnabled: true, yuanPerDiamond: 0.05,
    prices: {}, templates: DEFAULT_PHRASES.gift
  },
  welcome: {
    enabled: true, responseMode: 'rules', mode: 'qualified-or-listed', minWealth: 30, requireFan: true,
    minFanLevel: 1, requireLit: true, listed: [], cooldownSec: 0,
    admin: { enabled: false, minWealth: 60, minFanLevel: 1 },
    templates: DEFAULT_PHRASES.welcome
  },
  like: {
    enabled: false, responseMode: 'rules', cooldownSec: 0,
    templates: DEFAULT_PHRASES.like
  },
  keyword: { enabled: false, responseMode: 'rules', rules: DEFAULT_KEYWORD_RULES, cooldownSec: 0 },
  bot: { ...IDIOM_GAME_DEFAULTS, enabled: false, guessEnabled: true, truthEnabled: true, dareEnabled: true, idiomEnabled: true },
  timersEnabled: false,
  ai: {
    enabled: false, chatEnabled: false, endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash',
    intervalSec: 0, userCooldownSec: 0,
    contextSize: 30, contextAgeSec: 180, maxPerHour: 3600, idleEnabled: false, idleSec: 180,
    persona: '你在直播间帮忙做简单招呼。说话简短、平常，欢迎或谢谢一句就够。把注意力留给主播，不主动找话题，不自称主持，不说帮忙转达或安排，没有必要就不插话。',
    knowledge: '', temperature: 0.7
  },
  timers: [{ id: 'welcome', enabled: false, responseMode: 'rules', intervalSec: 300, start: '', end: '', quietSec: 15, messages: DEFAULT_TIMER_PHRASES }],
  adapter: { inputSelector: '', sendSelector: '', chatSelector: '', nicknameSelector: '', contentSelector: '', startSelector: '', endSelector: '' }
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
  if (base === DEFAULTS && input.moderation?.banThreshold === undefined) result.moderation.banThreshold = Math.max(result.moderation.threshold, DEFAULTS.moderation.banThreshold);
  if (base === DEFAULTS && input.timersEnabled === undefined) result.timersEnabled = result.timers.some(timer => timer.enabled);
  if (base === DEFAULTS && result.mode === 'review') result.mode = 'auto';
  // 只有与旧版默认值完全一致才更新；自定义内容、启停和定时参数原样保留。
  if (base === DEFAULTS) {
    const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    for (const feature of ['gift', 'welcome', 'like']) {
      if ([LEGACY_PHRASES[feature], PREVIOUS_DEFAULT_PHRASES[feature]].some(templates => same(input[feature]?.templates, templates))) result[feature].templates = copy(DEFAULT_PHRASES[feature]);
    }
    if (input.ai?.maxPerHour === 30) result.ai.maxPerHour = DEFAULTS.ai.maxPerHour;
    if (same(input.keyword?.rules, [{ keywords: ['几点开播'], reply: '{user}，开播时间请看主播主页公告～', exact: false }])) result.keyword.rules = copy(DEFAULT_KEYWORD_RULES);
    for (const timer of result.timers) {
      if (LEGACY_TIMER_PHRASES.some(messages => same(timer.messages, messages))) timer.messages = copy(DEFAULT_TIMER_PHRASES);
    }
    if (['你是直播间场控。用语自然、稍正式，简洁有礼、平和克制，直接回应具体内容。不冒充主播，不装熟，不煽情、不奉承，不夸大承诺。', '你是直播间的温和场控，语气自然、简短，不冒充主播，不夸大承诺。', '你是直播间帮忙招呼观众的场控。像平常聊天一样说话，短句为主，接着对方的话聊。不冒充主播，不装熟，不夸大承诺。'].includes(input.ai?.persona)) result.ai.persona = DEFAULTS.ai.persona;
  }
  // 为旧版仅含荣誉门槛的配置补齐灯牌条件，保留原有配置与基础欢迎下限。
  if (base === DEFAULTS && input.welcome?.admin?.minFanLevel === undefined) {
    result.welcome.admin.minWealth = Math.max(result.welcome.admin.minWealth, result.welcome.minWealth);
    result.welcome.admin.minFanLevel = Math.max(result.welcome.admin.minFanLevel, result.welcome.minFanLevel);
  }
  if (base === DEFAULTS && (input.version || 1) < 2) {
    result.version = 2;
    for (const feature of ['gift','welcome','like','keyword']) result[feature].cooldownSec = 0;
    result.gift.mergeSec = 0;
    result.ai.intervalSec = 0; result.ai.userCooldownSec = 0;
  }
  return result;
}

export function validateConfig(c) {
  const range = (v, min, max, name) => { if (!Number.isFinite(v) || v < min || v > max) throw new Error(`${name}范围为 ${min}–${max}`); };
  const choice = (v, values, name) => { if (!values.includes(v)) throw new Error(`${name}无效`); };
  const strings = (v, name) => { if (!Array.isArray(v) || v.length > 200 || v.some(x => typeof x !== 'string' || x.length > 4000)) throw new Error(`${name}必须是文本数组（最多 200 条）`); };
  choice(c.mode, ['preview', 'auto'], '发送模式');
  for (const key of ['enabled','luckyBag','redPacket','nativePassword']) if (typeof c.rewards[key] !== 'boolean') throw new Error('福袋红包自动参与开关无效');
  if (typeof c.rewards.entryXPath !== 'string' || c.rewards.entryXPath.length > 2000 || c.rewards.entryXPath && !c.rewards.entryXPath.startsWith('/')) throw new Error('福袋入口 XPath 应以 / 开头，最多 2000 字符');
  if (typeof c.automation.autoStart !== 'boolean' || typeof c.gift.batchEnabled !== 'boolean') throw new Error('自动开启或合并感谢开关无效');
  if (typeof c.timersEnabled !== 'boolean') throw new Error('定时消息开关无效');
  for (const key of ['enabled','announceLifecycle','reportEnabled','midnightEnabled','aiEnabled']) if (typeof c.pkOperations[key] !== 'boolean') throw new Error('PK 播报开关无效');
  for (const [key,min,max] of [['reportSec',30,86400],['durationSec',30,3600],['crossMidnightSec',1,120],['preparationSec',10,600],['aiIntervalSec',15,600]]) {
    range(c.pkOperations[key],min,max,'PK 时间设置');
    if (!Number.isSafeInteger(c.pkOperations[key])) throw new Error('PK 时间设置必须为整数秒');
  }
  if (c.pkOperations.crossMidnightSec >= c.pkOperations.durationSec) throw new Error('跨零点余量应小于 PK 时长');
  choice(c.gift.basis, ['total', 'unit'], '礼物价值口径');
  choice(c.welcome.mode, ['qualified', 'listed', 'qualified-or-listed'], '欢迎方式');
  range(c.moderation.threshold, 1, 20, '违规提醒次数'); range(c.moderation.windowSec, 30, 86400, '违规统计时长');
  choice(c.moderation.detector, ['ai','local'], '内容检测方式');
  for (const key of ['repeatAction','severeAction']) choice(c.moderation[key], ['notify','mute','ban'], '内容处置方式');
  for (const value of [c.moderation.enabled,c.moderation.warningsEnabled,c.moderation.escalateBan,...Object.values(c.moderation.categories)]) if (typeof value !== 'boolean') throw new Error('内容检测开关无效');
  for (const [value,label] of [[c.moderation.threshold,'禁言阈值'],[c.moderation.banThreshold,'封禁阈值'],[c.moderation.windowSec,'统计时长'],[c.moderation.maxPerHour,'AI 检测上限']]) if (!Number.isSafeInteger(value)) throw new Error(`${label}必须为整数`);
  range(c.moderation.banThreshold, c.moderation.threshold, 100, '封禁次数');
  range(c.moderation.minConfidence, 0.5, 1, 'AI 最低置信度'); range(c.moderation.maxPerHour, 1, 36000, 'AI 检测每小时上限');
  for (const key of ['sensitiveTerms','trollTerms','severeTerms']) strings(c.moderation[key], '内容检测词库');
  if (typeof c.moderation.warningTemplate !== 'string' || !c.moderation.warningTemplate.trim() || c.moderation.warningTemplate.length>200 || /\{(?!user\}|count\})/.test(c.moderation.warningTemplate)) throw new Error('提醒话术只支持 {user} 与 {count}，最多 200 字');
  for (const [mode, name] of [[c.gift.responseMode,'礼物回复方式'], [c.welcome.responseMode,'欢迎回复方式'], [c.like.responseMode,'点赞感谢方式'], [c.keyword.responseMode,'关键词回复方式']]) choice(mode, ['rules','ai'], name);
  range(c.sending.maxLength, 10, 50, '消息长度'); range(c.sending.queueLimit, 1, 2000, '队列上限');
  range(c.sending.duplicateSec, 10, 3600, '重复消息冷却');
  range(c.gift.minValue, 0, 1e9, '礼物阈值'); range(c.gift.mergeSec, 0, 30, '连击合并秒数');
  range(c.gift.yuanPerDiamond, 0, 10, '元/钻估算比例');
  range(c.gift.cooldownSec, 0, 3600, '礼物用户冷却'); range(c.welcome.cooldownSec, 0, 86400, '欢迎冷却');
  range(c.welcome.minWealth, 0, 100, '荣誉等级'); range(c.welcome.minFanLevel, 0, 100, '粉丝团等级');
  if (typeof c.welcome.admin.enabled !== 'boolean') throw new Error('管理员弹幕开关无效');
  range(c.welcome.admin.minWealth, 1, 100, '管理员弹幕最低荣誉等级');
  range(c.welcome.admin.minFanLevel, 0, 100, '管理员弹幕最低灯牌等级');
  if (c.welcome.admin.enabled && c.welcome.admin.minWealth < c.welcome.minWealth) throw new Error('管理员弹幕最低荣誉等级不能低于基础欢迎的最低荣誉等级');
  if (c.welcome.admin.enabled && c.welcome.admin.minFanLevel < c.welcome.minFanLevel) throw new Error('管理员弹幕最低灯牌等级不能低于基础欢迎的最低粉丝团等级');
  range(c.keyword.cooldownSec, 0, 3600, '关键词用户冷却');
  for (const [key,value] of Object.entries(c.bot)) if (key.endsWith('Enabled') || key === 'enabled') { if (typeof value !== 'boolean') throw new Error('机器人功能开关无效'); }
  for (const [key,min,max,label] of [['idiomMaxAttempts',1,1000,'接龙每局次数'],['idiomGames',1,20,'接龙游戏局数'],['idiomPoints',1,1000,'接龙答对积分'],['idiomPenalty',0,1000,'接龙答错扣分'],['idiomHintIntervalSec',5,600,'接龙提示间隔']]) {
    range(c.bot[key],min,max,label);
    if (!Number.isSafeInteger(c.bot[key])) throw new Error(`${label}必须为整数`);
  }
  for (const key of ['idiomNasalRelaxed','idiomCountCorrectOnly']) if (typeof c.bot[key] !== 'boolean') throw new Error('接龙规则开关无效');
  range(c.like.cooldownSec, 0, 3600, '点赞用户感谢间隔');
  range(c.ai.intervalSec, 0, 3600, 'AI 间隔'); range(c.ai.userCooldownSec, 0, 86400, 'AI 用户冷却');
  range(c.ai.contextSize, 1, 100, '上下文条数'); range(c.ai.contextAgeSec, 10, 600, '上下文有效秒数');
  range(c.ai.maxPerHour, 1, 36000, 'AI 每小时调用上限'); range(c.ai.idleSec, 60, 3600, '冷场秒数');
  range(c.ai.temperature, 0, 2, 'AI 温度');
  if (c.anchorId && !/^\d+$/.test(c.anchorId)) throw new Error('主播 UID 应为纯数字');
  if (c.selfId && !/^\d+$/.test(c.selfId)) throw new Error('发送账号 UID 应为纯数字');
  for (const [list, name] of [[c.ignored, '忽略用户'], [c.blockedWords, '屏蔽词'], [c.moderation.terms, '辱骂识别词'], [c.welcome.listed, '指定欢迎用户'], [c.gift.templates, '礼物话术'], [c.welcome.templates, '欢迎话术'], [c.like.templates, '点赞感谢话术']]) strings(list, name);
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
  constructor({ config = copy(DEFAULTS), now = Date.now, random = Math.random, send = async () => {}, ai = async () => '', log = () => {}, changed = () => {}, checkpoint = async () => {}, manage = async () => ({submitted:false,reason:'管理能力不可用，请管理员手动核查'}), onStop = () => {}, liveData = () => ({}) } = {}) {
    this.config = validateConfig(mergeConfig(config)); this.now = now; this.send = send; this.ai = ai; this.log = log; this.changed = changed; this.checkpoint = checkpoint; this.onStop = onStop;
    this.queue = []; this.giftJobs = new Map(); this.history = []; this.seen = new Map(); this.cooldowns = new Map(); this.gifts = new Map(); this.duplicates = new Map();
    this.calls = []; this.running = false; this.epoch = 0; this.serial = 0;
    this.chatAIQueue = []; this.chatAIBackground = null; this.replyEvents = [];
    this.contextChat = []; this.liveData = liveData;
    this.lastChat = now(); this.lastInteraction = now(); this.lastAI = -Infinity; this.aiBusy = false; this.busy = false;
    this.timerDue = new Map(); this.rotation = new Map(); this.selfTexts = new Map(); this.selfIdentity = null; this.giftStyleSerial = 0;
    this.moderation = new Moderation(this, manage);
    this.lastMaintenance = -Infinity;
    this.giftSentAt = new Map();
    this.milestoneSeen = new Map();
    this.milestoneSession = {roomId:'',endedAt:null};
    this.audience = new AudienceProfiles({now});
    this.inFlight = null;
    this.deliveries = new DeliveryTracker({now});
    this.backlogLimit = 2000;
    this.bot = new RoomBot({now, random}); this.lastBotSend = -Infinity; this.lastGiftSend = -Infinity;
    this.pk = new PKTracker({ now });
    this.liveMetrics = new LiveMetrics({now});
    this.liveMode = new LiveModeTracker({now});
    this.pkSeen = new Map();
    this.roomData = {stats:null,audience:null,activities:[]};
    this.anchorStats = new AnchorStats({now});
    this.pkOperations = new PKOperations(this);
    this.observationSignatures = new Map();
    this.stats = { events: 0, filtered: 0, previews: 0, submitted: 0, aiCalls: 0, retries: 0, expired: 0, overflow: 0, maxQueueWaitMs: 0 };
  }
  update(config) {
    // 配置保存不会中断正在运行的场控；新规则从下一条事件开始生效。
    this.config = validateConfig(mergeConfig(config));
    if (!this.config.ai.enabled || !this.config.ai.chatEnabled) this.chatAIBackground = null;
    if (!this.config.ai.enabled || !(this.config.ai.chatEnabled || this.config.bot.enabled)) this.chatAIQueue = [];
    if (!this.config.moderation.enabled || !this.config.moderation.warningsEnabled) this.queue = this.queue.filter(job => job.kind !== 'moderation');
    this.rotation.clear();
    this.changed();
  }
  setIdentity(identity) { this.selfIdentity = identity?.self || null; }
  snapshot() {
    const entries = map => [...map.entries()].slice(-5000);
    const bot = this.bot.session ? { ...this.bot.session, used: this.bot.session.used ? [...this.bot.session.used] : undefined } : null;
    return cloneRuntime({
      version: 1, savedAt: this.now(), running: this.running || Boolean(this.resumeRequested),
      queue: this.queue, gifts: [...this.gifts.entries()], bot, botIdiomResult:this.bot.lastIdiomResult, botQuestions:this.bot.questionHistory,
      seen: entries(this.seen), cooldowns: entries(this.cooldowns), duplicates: entries(this.duplicates),
      timerDue: entries(this.timerDue), rotation: entries(this.rotation), giftSentAt: entries(this.giftSentAt), milestoneSeen: entries(this.milestoneSeen), milestoneSession:this.milestoneSession,
      moderation:this.moderation.snapshot(), history: this.history.slice(-80), contextChat:this.contextChat.slice(-100),replyEvents:this.replyEvents.slice(-40),stats: this.stats, serial: this.serial,
      lastInteraction: this.lastInteraction, lastChat: this.lastChat,
      inFlight: this.inFlight, deliveries:this.deliveries.snapshot(), liveMetrics:this.liveMetrics.snapshot(), liveMode:this.liveMode.snapshot(), audience:this.audience.snapshot()
      , pk: this.pk.export(), roomData:this.roomData, anchorStats:this.anchorStats.snapshot(), pkOperations:this.pkOperations.snapshot()
    });
  }
  restore(snapshot) {
    if (!snapshot || snapshot.version !== 1 || !Number.isFinite(snapshot.savedAt)) return false;
    snapshot = cloneRuntime(snapshot);
    this.moderation.restore(snapshot.moderation);
    const map = value => new Map(Array.isArray(value) ? value.filter(pair => Array.isArray(pair) && pair.length === 2) : []);
    this.queue = Array.isArray(snapshot.queue) ? snapshot.queue.filter(job => job && typeof job.text === 'string' && Number.isFinite(job.created)) : [];
    this.gifts = map(snapshot.gifts);
    this.bot.reset();
    this.bot.lastIdiomResult = snapshot.botIdiomResult || null;
    this.bot.questionHistory = Object.fromEntries(['truth','dare'].map(type => {
      const valid = new Set(this.bot.questionBank(type).map(item => item.id));
      return [type, [...new Set((Array.isArray(snapshot.botQuestions?.[type]) ? snapshot.botQuestions[type] : []).filter(id => valid.has(id)))]];
    }));
    // 刷新后原请求已不存在，直接发送保留的本地回复。
    for (const job of this.queue) if (job.kind === 'bot' && job.aiPending) { job.aiPending=false; job.readyAt=this.now(); }
    if (snapshot.bot && typeof snapshot.bot.type === 'string') {
      this.bot.session = { ...snapshot.bot, used: Array.isArray(snapshot.bot.used) ? new Set(snapshot.bot.used) : undefined };
      if (snapshot.bot.type === 'idiom') this.bot.restoreIdiomGame(snapshot.bot, this.config.bot);
    }
    for (const [property, value] of [['seen',snapshot.seen],['cooldowns',snapshot.cooldowns],['duplicates',snapshot.duplicates],['timerDue',snapshot.timerDue],['rotation',snapshot.rotation],['giftSentAt',snapshot.giftSentAt],['milestoneSeen',snapshot.milestoneSeen]]) this[property] = map(value);
    // 旧快照按排名存储；同一个用户的不同排名合并为本场的一条记录。
    this.milestoneSeen = new Map([...this.milestoneSeen].map(([key,at]) => [key.replace(/^(contribution:.*):\d+$/u,'$1'),at]));
    this.milestoneSession = {roomId:String(snapshot.milestoneSession?.roomId || ''),endedAt:Number.isFinite(snapshot.milestoneSession?.endedAt) ? snapshot.milestoneSession.endedAt : null};
    this.audience.restore(snapshot.audience);
    this.history = Array.isArray(snapshot.history) ? snapshot.history.slice(-80) : [];
    this.contextChat = Array.isArray(snapshot.contextChat) ? snapshot.contextChat.slice(-100) : [];
    this.replyEvents = Array.isArray(snapshot.replyEvents) ? snapshot.replyEvents.slice(-40) : [];
    this.stats = snapshot.stats && typeof snapshot.stats === 'object' ? { ...this.stats, ...snapshot.stats } : this.stats;
    this.serial = Number.isSafeInteger(snapshot.serial) ? snapshot.serial : this.serial;
    this.lastInteraction = Number.isFinite(snapshot.lastInteraction) ? snapshot.lastInteraction : this.now();
    this.lastChat = Number.isFinite(snapshot.lastChat) ? snapshot.lastChat : this.now();
    this.deliveries.restore(snapshot.deliveries || []);
    this.pk.restore(snapshot.pk || {});
    this.anchorStats.restore(snapshot.anchorStats || {});
    this.pkOperations.restore(snapshot.pkOperations);
    this.liveMetrics.restore(snapshot.liveMetrics);
    this.liveMode.restore(snapshot.liveMode);
    if (snapshot.roomData && typeof snapshot.roomData === 'object') this.roomData = {
      stats:snapshot.roomData.stats && typeof snapshot.roomData.stats === 'object' ? snapshot.roomData.stats : null,
      audience:snapshot.roomData.audience && typeof snapshot.roomData.audience === 'object' ? snapshot.roomData.audience : null,
      activities:Array.isArray(snapshot.roomData.activities) ? snapshot.roomData.activities.slice(-100) : []
    };
    const uncertain = this.queue.filter(job => job.deliveryUncertain);
    this.queue = this.queue.filter(job => !job.deliveryUncertain);
    const tracked = new Set(this.deliveries.records.flatMap(record => record.jobs.map(job => job.id)));
    const knownFlight = this.deliveries.records.some(record=>record.id === snapshot.inFlight?.deliveryId);
    for (const job of [...(knownFlight ? [] : snapshot.inFlight?.jobs || []), ...uncertain]) if (!tracked.has(job.id)) {
      const record = this.deliveries.create(snapshot.inFlight?.text || job.text, [job], this.selfIdentity || {id:this.config.selfId});
      this.deliveries.finish(record,'unknown','刷新前发送结果未知；不自动重发'); tracked.add(job.id);
    }
    // 旧版会把回显超时的消息重新放入队列；升级恢复时也不能再次点击。
    for (const record of this.deliveries.records) if (record.state === 'retrying' && !record.retrySafe) {
      const ids = new Set(record.retryJobIds || []);
      this.queue = this.queue.filter(job=>!ids.has(job.id));
      record.retryJobIds = [];
      this.deliveries.finish(record,'unknown','旧版发送结果未知；不自动重发');
    }
    for (const record of this.deliveries.pending()) this.retryDelivery(record, '恢复未点击或明确被拒绝的消息');
    this.queue = this.queue.filter(job=>!job.deliveryUncertain);
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
  acceptMilestone(milestone) {
    if (!milestone?.name || !milestoneThankYou(milestone)) return false;
    const key = milestone.kind === 'contribution' ? `contribution:${milestone.name}` : `${milestone.kind}:${milestone.name}:${milestone.rank ?? ''}`;
    const now = this.now(), previous = this.milestoneSeen.get(key);
    if (Number.isFinite(previous) && (milestone.kind === 'contribution' || now - previous < 600000)) return false;
    this.milestoneSeen.set(key, now);
    this.pruneMilestones(now);
    while (this.milestoneSeen.size > 5000) this.milestoneSeen.delete(this.milestoneSeen.keys().next().value);
    return true;
  }
  pruneMilestones(now) {
    // 贡献达标是本场的一次性事件，不能随普通冷却窗口过期。
    for (const [key, at] of this.milestoneSeen) if (!key.startsWith('contribution:') && now - at >= 600000) this.milestoneSeen.delete(key);
  }
  queueMilestone(milestone) {
    const profile = this.audience.findByName(milestone?.name);
    const canonical = profile ? {...milestone,name:profile.name} : milestone;
    if (!this.acceptMilestone(canonical)) return;
    const text = milestoneThankYou(canonical,profile ? audienceAddress(profile,this.now()) : canonical.name);
    this.lastInteraction = this.now(); this.enqueue('milestone',text);
  }
  observeMilestoneSession(event) {
    const roomId = event.source === 'socket' && ['chat','gift','start'].includes(event.type) ? String(event.roomId || '') : '';
    const nextSession = roomId && this.milestoneSession.roomId && roomId !== this.milestoneSession.roomId
      || event.type === 'start' && this.milestoneSession.endedAt !== null && (event.receivedAt || event.at || this.now()) > this.milestoneSession.endedAt;
    if (nextSession) {
      for (const key of this.milestoneSeen.keys()) if (key.startsWith('contribution:')) this.milestoneSeen.delete(key);
      for (const text of this.duplicates.keys()) if (recognizeMilestone(text)?.kind === 'contribution') this.duplicates.delete(text);
      this.milestoneSession.endedAt = null;
    }
    if (roomId) this.milestoneSession.roomId = roomId;
    if (event.type === 'end') this.milestoneSession.endedAt = event.receivedAt || event.at || this.now();
  }
  acceptsSelfGameChat(event) {
    if (!this.running || event?.type !== 'chat' || !this.config.bot.enabled || (this.selfTexts.get(event.text) || 0) > this.now()) return false;
    const type = this.bot.session?.type;
    const command = addressedToSelf(event, this.selfIdentity, this.config.selfId);
    const startType = this.bot.startType(command ?? event.text);
    if (startType === 'idiom' && this.config.bot.idiomEnabled) return true;
    return Boolean(this.config.bot[`${type}Enabled`] && (type === 'idiom' || this.bot.acceptsAnswer(command ?? event.text, keyFor(event.user || {}), command !== null)));
  }
  observeEcho(event) {
    const record = this.deliveries.observe(event);
    if (!record) return false;
    const retryIds = new Set(record.retryJobIds || []);
    if (retryIds.size) {
      this.queue = this.queue.filter(job=>!retryIds.has(job.id));
      record.retryJobIds = [];
      this.rebuildGiftIndex();
    }
    this.stats.echoed = (this.stats.echoed || 0) + 1;
    this.log('sent',`已回显（${record.latencyMs} ms）：${record.text}`); this.changed(); return true;
  }
  retryDelivery(record, reason = '发送未完成；稍后重试') {
    if (!record?.jobs?.length || !['prepared','failed'].includes(record.state)) return false;
    const queued = new Set(this.queue.map(job=>job.id));
    const delay = Math.min(30000, 500 * 2 ** Math.min(record.attempts || 0, 6));
    for (const source of record.jobs) {
      if (queued.has(source.id)) continue;
      const job = cloneRuntime(source); delete job.deliveryUncertain;
      job.attempts = Math.max(job.attempts || 0, record.attempts || 0) + 1;
      job.created = this.now();
      if (!job.pkNotice) job.expires = Infinity;
      job.retryAt = this.now() + delay;
      this.queue.push(job); this.indexGiftJob(job); queued.add(job.id);
    }
    record.retryJobIds = record.jobs.map(job=>job.id);
    record.retrySafe = true;
    record.attempts = (record.attempts || 0) + 1;
    record.jobs = [];
    this.deliveries.finish(record,'retrying',`${reason}；${Math.ceil(delay/1000)} 秒后重试`);
    this.stats.retries += 1;
    this.changed();
    return true;
  }
  assertCapacity(event) {
    if (!this.running || event?.type !== 'gift' || !this.config.gift.enabled) return;
    const key = `${event.roomId || ''}:${keyFor(event.user || {})}:${event.giftId || event.giftName}:${event.groupId || 'window'}`;
    if (this.queue.length >= this.backlogLimit || this.gifts.size >= this.backlogLimit && !this.gifts.has(key)) {
      throw Object.assign(new Error('礼物感谢积压已达上限；礼物日志保留，恢复后继续处理'),{code:'BACKPRESSURE'});
    }
  }
  start() {
    if (this.running) return;
    const resuming = Boolean(this.resumeRequested);
    this.running = true; this.resumeRequested = false; this.epoch++;
    for (const record of this.deliveries.pending()) this.retryDelivery(record, '恢复未点击或明确被拒绝的消息');
    if (!resuming) { this.lastChat = this.now(); this.lastInteraction = this.now(); this.timerDue.clear(); }
    this.log('system', resuming ? '场控已从上次状态恢复' : '场控已开始'); this.changed();
  }
  stop(reason = '已暂停', { preserveWork = false } = {}) {
    this.running = false; this.epoch++;
    this.chatAIQueue = []; this.chatAIBackground = null;
    // 人工暂停、切房间和配置变更继续清空现场任务；发送异常则由调用方保留 outbox，
    // 让管理员修复控件后可以继续发送，避免“已入队但未确认”变成静默丢失。
    if (!preserveWork) { this.queue = []; this.giftJobs.clear(); this.gifts.clear(); this.bot.reset(); this.timerDue.clear(); this.history = []; }
    else if (this.inFlight?.jobs?.length && !this.inFlight.deliveryId) {
      const known = new Set(this.queue.map(job => job.id));
      for (const job of this.inFlight.jobs) if (!known.has(job.id)) this.queue.unshift({ ...job, deliveryUncertain:true });
      this.inFlight = null; this.rebuildGiftIndex();
    }
    if (preserveWork && this.inFlight?.deliveryId) {
      const record = this.deliveries.records.find(item=>item.id === this.inFlight.deliveryId);
      if (record && ['prepared','clicked'].includes(record.state)) {
        this.deliveries.finish(record,'unknown','运行中断，结果未知；不自动重发');
      }
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
  welcomeChannel(user) {
    const w = this.config.welcome, rule = w.admin;
    if (!rule.enabled || !Number.isFinite(user?.wealthLevel) || user.wealthLevel < Math.max(rule.minWealth, w.minWealth)) return 'chat';
    const minFanLevel = Math.max(rule.minFanLevel, w.minFanLevel);
    if (minFanLevel > 0 || w.requireFan) {
      const club = this.config.anchorId && user.fanClubs?.find(f => f.anchorId === this.config.anchorId);
      if (!club || !Number.isFinite(club.level) || club.level < minFanLevel || (w.requireFan && w.requireLit && club.status !== 1)) return 'chat';
    }
    return 'admin';
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
    const item = { id: ++this.serial, kind, text: checked.text, priority: ({ gift: 100, pk: 105, bot: 90, moderation: 110, milestone: 85, welcome: 80, keyword: 60, ai: 40, like: 30, timer: 20 })[kind] || 10, created: now, expires: now + (kind === 'gift' ? 120000 : 45000), ...extra };
    // 礼物是已发生的事实，不能因为普通互动积压而静默丢弃。
    // 普通互动仍受 queueLimit 约束，并优先淘汰低优先级、较旧的任务。
    const isGift = kind === 'gift' || extra.giftReply;
    if (isGift && this.queue.length >= this.backlogLimit) return false;
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
  ingestPK(event) {
    if (isLiveModeEvent(event)) {
      this.liveMode.ingest(event, {anchorId:this.config.anchorId});
      if (event.type !== 'room-state') return true;
    }
    if (!PK_EVENT_TYPES.has(event?.type) && !['room-state','gift','chat'].includes(event?.type)) return false;
    // The read-only PK path runs before the durable interaction inbox. Use an
    // independent bounded identity map so journal replay cannot count it twice.
    const identity=event.id || event._journalId;
    if (identity) {
      const key=JSON.stringify([event.type,identity,event.battleId,event.roomId,event.anchorId,event.side,event.scores,event.participants,event.selfScore,event.opponentScore,event.remainingMs,event.count,event.final,event.contributors,event.effectType,event.startAt,event.endAt]);
      if(this.pkSeen.has(key))return false;
      this.pkSeen.set(key,this.now());
      while(this.pkSeen.size>5000)this.pkSeen.delete(this.pkSeen.keys().next().value);
    }
    const metadata=['pk-start','pk-score','pk-end','room-state'].includes(event.type);
    const normalized = {...event,...(metadata ? {anchorId:this.config.anchorId || event.anchorId} : {}),receivedAt:event.receivedAt || this.now()};
    this.pkOperations.observeBroadcast(normalized);
    // A platform end message is the only point at which the current score is
    // promoted to an explicitly final observation. Prediction.final and an
    // ended phase alone are intentionally insufficient for historical stats.
    if (normalized.type === 'pk-end') {
      if (Array.isArray(normalized.scores)) normalized.scores = normalized.scores.map(item => ({...item, final:true}));
      for (const side of ['self','opponent']) if (Number.isFinite(normalized[`${side}Score`])) normalized[`${side}ScoreMeta`] = {...normalized[`${side}ScoreMeta`],final:true};
    }
    const state = this.pk.ingest(normalized);
    this.liveMode.ingest(normalized, {anchorId:this.config.anchorId,pk:state});
    if (state?.key) this.anchorStats.ingestBattle(state);
    this.pkOperations.lifecycle(normalized, state);
    return true;
  }
  ingestEvent(event) {
    this.assertCapacity(event);
    const now = this.now(); this.stats.events++;
    // PK 事件是只读分析数据，允许在场控暂停时继续进入统计；发送规则仍只处理运行中的互动事件。
    if (event.id) {
      // 同一个消息 ID 可能承载更新后的连击进度/单价；由礼物状态按累计增量去重。
      const seenKey = event.type === 'gift' ? JSON.stringify([event.type, event.id, event.roomId, keyFor(event.user || {}), event.giftId, event.groupId, event.count, event.unitValue, event.final]) : `${event.type}:${event.id}`;
      if (this.seen.has(seenKey)) return;
      this.seen.set(seenKey, now); if (this.seen.size > 5000) this.seen.delete(this.seen.keys().next().value);
    }
    this.liveMetrics.ingest(event);
    if (event.type === 'start') this.pkOperations.observeBroadcast(event);
    this.ingestPK(event);
    if (event.type === 'anchor-pk-tasks') this.pkOperations.ingestTasks(event);
    if (['anchor-fanclub','fansclub-statistics','fansclub','fansclub-push','room-likes','like','anchor-exhibition','pk-rank-season','anchor-exhibition-retention','room-indicator'].includes(event.type)) this.anchorStats.ingest(event, {anchorId:this.config.anchorId,roomId:event.roomId});
    // 按帧实际到达时间区分历史补推；主线程解码积压不能让实时消息变成历史消息。
    const hasReceipt = Number.isFinite(event.receivedAt) && event.receivedAt <= now;
    const hasRecentReceipt = hasReceipt && now - event.receivedAt < 600000;
    const arrival = hasRecentReceipt ? event.receivedAt : now;
    // 礼物的平台时间可能偏离公屏时间，实时礼物以本机捕获时间为准。
    // 已积压十分钟的日志仍不补发；没有捕获时间时保留平台时间检查。
    if (event.type === 'gift' && hasReceipt && !hasRecentReceipt) { this.filtered('历史礼物事件已忽略'); return; }
    if (!(event.type === 'gift' && hasRecentReceipt) && event.at && (arrival - event.at > 30000 || event.at - arrival > 60000)) { this.filtered('历史或异常时间事件已忽略'); return; }
    const observation = observedReplyEvent(event, now);
    if (observation) this.replyEvents = [...this.replyEvents.filter(item => now - item.at <= 600000), observation].slice(-40);
    if (event.type === 'chat' && event.text) this.contextChat = [...this.contextChat.filter(row=>now-row.at<=600000),{name:String(event.user?.name || '').slice(0,40),text:String(event.text).slice(0,300),at:arrival}].slice(-100);
    this.observeMilestoneSession(event);
    if (event.user) event = {...event,user:this.audience.remember(event.user)};
    if (event.type === 'room-audience') for (const row of [...(event.ranks || []),...(event.seats || [])]) if (row.user) this.audience.remember(row.user);
    if (['room-stats','room-audience','social','fansclub'].includes(event.type)) {
      let text = '';
      if (event.type === 'room-stats') {
        this.roomData.stats = {...event, receivedAt:arrival};
        const signature = JSON.stringify([event.metricType,event.displayValue,event.displayLong,event.hidden]);
        if (this.observationSignatures.get(event.type) === signature) return;
        this.observationSignatures.set(event.type, signature);
        text = event.hidden ? '直播间统计有更新（平台标记为隐藏）' : `直播间统计：${event.displayLong || event.displayMiddle || event.displayShort || (event.displayValue ?? '未知')}`;
      } else if (event.type === 'room-audience') {
        this.roomData.audience = {...event, receivedAt:arrival};
        const signature = JSON.stringify([event.onlineCount,event.cumulativeUsers,event.popularity,event.ranks?.map(row=>[row.user?.id,row.score,row.rank])]);
        if (this.observationSignatures.get(event.type) === signature) return;
        this.observationSignatures.set(event.type, signature);
        const leaders = (event.ranks || []).slice(0,5).map(row=>`${row.rank ?? '?'}:${String(row.user?.name || '观众').slice(0,20)} ${row.score ?? '?'}分`).join('、');
        text = `观众状态：在线 ${event.onlineDisplay || (event.onlineCount ?? '未知')}；累计 ${event.cumulativeUsersDisplay || (event.cumulativeUsers ?? '未知')}；榜单 ${event.ranks?.length || 0} 人${leaders ? `；${leaders}` : ''}`;
      } else if (event.type === 'social') {
        this.roomData.activities.push(event); this.roomData.activities = this.roomData.activities.slice(-100);
        const name = String(event.user?.name || '观众').slice(0,40);
        text = event.actionName === 'follow' ? `${name} 关注了主播${event.followCount == null ? '' : `；关注数 ${event.followCount}`}`
          : event.actionName === 'share' ? `${name} 分享了直播间${event.shareCount == null ? '' : `；分享数 ${event.shareCount}`}`
            : `收到 Social 消息（action ${event.action ?? '未知'}）`;
      } else {
        this.roomData.activities.push(event); this.roomData.activities = this.roomData.activities.slice(-100);
        text = String(event.description || `${event.user?.name || '观众'} 粉丝团状态更新`).slice(0,180);
      }
      this.log('system', text); return;
    }
    if (['emoji-chat','screen-chat','room-notice','room-rank','rank-update','room-notify','room-sync','audio-chat','highlight-comment','light-gift','live-shopping','product-change','room-banner','rank-award','red-packet','activity-signal','chat-like','fan-ticket','room-activity-state','gift-panel-state','room-indicator','gift-catalog','battle-bonus','battle-property','battle-season-honor','popular-card','fansclub-statistics','group-live-members','group-live-income','room-ticket','linkmic-positions','guest-link-state','fansclub-push'].includes(event.type)) {
      this.roomData.activities.push({...event,receivedAt:arrival});
      this.roomData.activities = this.roomData.activities.slice(-100);
      const labels = {
        'emoji-chat':'表情弹幕', 'screen-chat':'醒目留言', 'room-notice':'房间公告',
        'room-rank':'房间排行', 'rank-update':'榜单更新', 'room-notify':'房间通知', 'room-sync':'房间同步',
        'audio-chat':'语音弹幕转写', 'highlight-comment':'置顶评论', 'light-gift':'轻量礼物',
        'live-shopping':'直播购物状态', 'product-change':'商品列表变化', 'room-banner':'直播间横幅', 'rank-award':'榜单奖励',
        'red-packet':'红包预览', 'activity-signal':'活动信号', 'chat-like':'弹幕点赞',
        'fan-ticket':'粉丝票统计', 'room-activity-state':'房间活动状态', 'gift-panel-state':'礼物面板状态',
        'room-indicator':'房间状态标记', 'gift-catalog':'团播礼物目录候选', 'battle-bonus':'PK 奖励',
        'battle-property':'PK 道具状态', 'battle-season-honor':'PK 赛季荣誉', 'popular-card':'人气卡状态',
        'fansclub-statistics':'粉丝团人数', 'group-live-members':'团播成员榜', 'group-live-income':'团播成员收益', 'room-ticket':'付费房票状态',
        'linkmic-positions':'连麦席位状态', 'guest-link-state':'嘉宾连麦状态', 'fansclub-push':'粉丝团播报'
      };
      const detail = event.text || event.notifySubType || event.syncType || event.activityKind || event.title || event.display || event.scene || event.status || (event.type === 'gift-catalog' ? `${event.itemCount || 0} 项候选` : '') || event.products?.map(row=>row.promotionId).filter(Boolean).join('、') || event.updates?.map(row=>row.text).filter(Boolean).join('、') || '';
      this.log('system', `${labels[event.type]}${detail ? `：${String(detail).slice(0,160)}` : '已更新'}`);
      return;
    }
    if (!this.running) return;
    if (event.type === 'end') { this.log('system', '收到直播结束事件；场控保持运行，等待手动暂停'); return; }
    if (event.type === 'milestone') {
      if ((this.selfTexts.get(event.text) || 0) > now) return;
      this.queueMilestone(event.milestone);
      return;
    }
    const u = event.user || {};
    const isSelf = this.isSelfUser(u);
    // 登录账号可以手动接龙或回答真心话；自动发送的公屏回显仍被过滤。
    if (isSelf && !this.acceptsSelfGameChat(event)) { this.filtered('当前登录账号的互动事件已忽略'); return; }
    if ((!u.name && event.type !== 'gift') || matchesUser(u, this.config.ignored)) return;
    if (event.type === 'chat') {
      if (!event.text || (this.selfTexts.get(event.text) || 0) > now) return;
      if (this.config.moderation.enabled && !isSelf) this.moderation.inspect(event, () => this.handleChat(event, now));
      else this.handleChat(event, now);
    } else if (event.type === 'enter' && this.config.welcome.enabled) {
      const decision = welcomeDecision(u, this.config);
      if (!decision.pass) this.filtered(`${u.name}：${decision.reason}`);
      else {
        this.lastInteraction = now;
        const club = (u.fanClubs || []).find(c => c.anchorId === this.config.anchorId);
        const fallback = renderAudienceTemplate(this.choose('welcome', this.config.welcome.templates), u, { level: u.wealthLevel ?? '?', fanLevel: club?.level ?? '?' }, now);
        const extra = { channel: this.welcomeChannel(u), welcomeUser: copy(u) };
        if (this.config.welcome.responseMode === 'ai') void this.requestAI({ type: 'welcome', user: u }, { kind: 'welcome', instruction: '只用 target.address 简短欢迎这位观众，一句招呼就结束。近期话题仅用于避免打断，不接话题、不邀聊、不劝留、不加关注提醒，不解释场控职责。', data: audienceReplyContext(u, this.config.anchorId), fallback, extra });
        else this.enqueue('welcome', fallback, extra);
      }
    } else if (event.type === 'gift' && this.config.gift.enabled) this.recordGift(u.name ? event : { ...event, user:{ ...u, name:'观众' } });
    else if (event.type === 'like' && this.config.like.enabled) this.recordLike(event);
  }
  handleBot(event, command) {
    const userKey = keyFor(event.user);
    const reply = this.bot.reply(command, this.config.bot, this.config.sending.maxLength, event.user.name, userKey);
    if (!reply) return false;
    if (this.queue.some(q => q.kind === 'bot' && q.botUser === userKey) && !this.bot.acceptsAnswer(command, userKey, true)) {
      this.filtered('机器人：该用户已有互动等待发送'); return true;
    }
    this.queueBotReply(event, reply);
    return true;
  }
  queueBotReply(event, reply, extra = {}) {
    // 先占据同一个发送位置并提交一次游戏状态，AI 仅改写该位置；失败不另排一条。
    const checkedMessages = [reply.text, ...(reply.messages || [])].map(text => cleanMessage(text, this.config));
    if (checkedMessages.some(message => !message.ok)) { this.filtered('机器人：回复格式或屏蔽词校验未通过'); return false; }
    const messages = checkedMessages.map(message => message.text);
    if (!this.enqueue('bot', messages[0], {botUser:keyFor(event.user), ...extra})) return false;
    const job = this.queue.at(-1);
    // One accepted game response may span multiple platform-sized messages. Reserve the
    // whole response before committing scores, including every tied winner, even at queueLimit=1.
    job.botGroup = job.id; job.botPart = 0;
    if (reply.hintToken) job.idiomHintToken=reply.hintToken;
    if (reply.persistent) job.expires = Infinity;
    for (const [index,text] of messages.slice(1).entries()) this.queue.push({...job, id:++this.serial, text, botPart:index+1});
    if (reply.ai?.mode === 'feedback') job.afterBot = this.bot.session?.questionJobId;
    reply.commit?.();
    this.pruneIdiomHints();
    if (reply.commit && !reply.ai && this.bot.session?.phase === 'answer') this.bot.session.questionJobId = job.id;
    if (!this.config.ai.enabled || reply.localOnly) return true;
    const feedback = reply.ai?.mode === 'feedback';
    const prefix = feedback ? `${[...(reply.ai.name || '朋友')].slice(0,6).join('')}，` : `${reply.text} `;
    const suffix = feedback && reply.ai.next ? ` ${reply.ai.next}` : '';
    const budget = this.config.sending.maxLength - [...prefix, ...suffix].length;
    // 菜单/操作提示优先完整展示，字数不足时保留内置回复。
    if (budget < 4) return true;
    const deadline = this.now() + 5000;
    Object.assign(job, {revision:1, readyAt:deadline, aiPending:true});
    void this.requestAI(event, {
      kind:'bot', targetJob:job, revision:job.revision, deadline, timeoutMs:5000,
      maxLength:budget, fallback:reply.text,
      instruction:feedback
        ? '根据真心话或大冒险的题目和回答，给回答者一句具体、友善、自然的回应。只输出回应正文，不含昵称或下一步提示；接纳简短答案和表情，不判对错、不追问隐私。只依据文字，不声称看到表演或已验证挑战完成。'
        : '为这次互动补充一句简短、自然的鼓励或接话。只输出附加短句，不重复题目、昵称和操作提示，不输出任何数字、输赢、正反面、游戏判定或新规则；题目与结果已由本地算法确定。',
      data:feedback ? reply.ai : {localReply:reply.text},
      transform:output => {
        const reaction = String(output || '').trim();
        if (!reaction || reaction === '[SKIP]' || (!feedback && /[0-9０-９]|正面|反面|赢|输|平局|答案|下一题|请接|开头/u.test(reaction))) return '';
        if ([...reaction].length > budget) return '';
        return prefix + reaction + suffix;
      }
    });
    return true;
  }
  pruneIdiomHints() {
    const token=this.config.bot.enabled && this.config.bot.idiomEnabled && this.bot.session?.hintsEnabled ? this.bot.hintToken() : '';
    const before=this.queue.length;
    this.queue=this.queue.filter(job=>!job.idiomHintToken || job.idiomHintToken===token);
    return this.queue.length!==before;
  }
  handleChat(event, now) {
    const u = event.user || {}, isSelf = this.isSelfUser(u);
      const milestone = recognizeMilestone(event.text);
      if (milestone) {
        this.queueMilestone(milestone);
        return;
      }
      this.lastChat = now; this.lastInteraction = now;
      this.history.push({ name: u.name.slice(0, 40), text: String(event.text).slice(0, 300), at: now });
      const contextAge = this.config.ai.contextAgeSec * 1000;
      while (this.history.length && (now - this.history[0].at > contextAge || this.history.length > this.config.ai.contextSize)) this.history.shift();
      const a = this.config.ai;
      const command = addressedToSelf(event, this.selfIdentity, this.config.selfId);
      if (command !== null) {
        if (this.config.bot.enabled && this.handleBot(event, command)) return;
        if (a.enabled && (a.chatEnabled || this.config.bot.enabled)) this.requestChatAI(event, true);
        return;
      }
      if (this.config.bot.enabled) {
        // 超时/结束提示引导直接发“开始…”，明确的开局指令无需 @，
        // 且要先于参与逻辑处理，避免刚超时的会话吞掉重开消息。
        if (this.bot.startType(event.text)) { this.handleBot(event, event.text); return; }
        // 房间游戏启动后，参与者无需再次 @。只有游戏真正识别的消息才会被消费，
        // 报名/回答入队成功后才提交会话状态，避免队列拥堵造成状态与播报不一致。
        const game = this.bot.participate(event.text, u, this.config.bot, this.config.sending.maxLength);
        if (game.handled) {
          if (game.text) this.queueBotReply(event, game, {quietOverflow:true});
          return;
        }
      }
      if (isSelf) return;
      if (this.config.keyword.enabled) {
        const rule = this.config.keyword.rules.find(r => r.keywords.some(k => k && (r.exact ? event.text === k : event.text.includes(k))));
        if (rule) {
          if (this.config.keyword.responseMode === 'ai') void this.requestAI(event, { kind: 'keyword', instruction: `回复命中了关键词规则：${rule.keywords.join('、')}。请围绕该规则回应。固定话术参考：${rule.reply}`, fallback: renderTemplate(rule.reply, { user: u.name }) });
          else this.enqueue('keyword', renderTemplate(rule.reply, { user: u.name }));
          return;
        }
      }
      if (a.enabled && a.chatEnabled) this.requestChatAI(event, false);
  }
  requestChatAI(event, addressed) {
    const pending = {event:copy(event), addressed, at:this.now(), epoch:this.epoch};
    if (addressed) {
      if (this.chatAIQueue.length >= 20) { this.filtered('AI 对话等待已满，本条不再排队'); return; }
      this.chatAIQueue.push(pending);
    } else {
      // 高频公屏只保留最新待判断弹幕；此前聊天仍在上下文中，避免逐条积压插话。
      this.chatAIBackground = pending;
    }
    this.drainChatAI();
  }
  drainChatAI() {
    const a = this.config.ai, now = this.now();
    const valid = item => item.epoch === this.epoch && now - item.at < 45000;
    this.chatAIQueue = this.chatAIQueue.filter(valid);
    if (this.chatAIBackground && !valid(this.chatAIBackground)) this.chatAIBackground = null;
    if (!this.running || !a.enabled || this.aiBusy || now - this.lastAI < a.intervalSec * 1000 || this.calls.filter(at => now - at < 3600000).length >= a.maxPerHour) return;
    const pending = this.chatAIQueue.shift() || this.chatAIBackground;
    if (!pending) return;
    if (pending === this.chatAIBackground) this.chatAIBackground = null;
    if (pending.addressed ? !(a.chatEnabled || this.config.bot.enabled) : !a.chatEnabled) return;
    void this.requestAI(pending.event, {
      kind:'ai', data:{replyMode:pending.addressed ? 'direct' : 'contextual', addressedToOther:!pending.addressed && (Boolean(pending.event.mentions?.length) || /^\s*@/u.test(pending.event.text))},
      instruction:pending.addressed
        ? '观众明确 @ 了当前登录场控账号，希望与你直接对话。结合目标弹幕、最近直播间聊天记录和 live_context 简短回应，不要求问句或呼叫词；普通招呼和闲聊也可回答。涉及主播安排等事实只用已核实资料，缺少资料时坦诚说明；仍跳过挑衅、不安全内容和完全相同的已回答请求。不要把普通聊天变成游戏或菜单。'
        : '先根据目标弹幕、最近直播间聊天记录、recent_replies 和 live_context 判断此时是否有必要由场控接话，再决定回复。问句不代表需要回复；观众彼此聊天、反问、起哄、随口感叹、重复已答问题、等待主播回应或资料不足以提供帮助时，输出 [SKIP]。data.addressedToOther=true 表示提及了其他账号，优先视为对他人的话而保持安静。结合当前游戏、PK和互动节奏避免打断；有明确求助且能提供有用信息、或承接场控对话时才简短回复。非问句也可以需要回复。判断与回复在本次请求完成，只输出回复正文或 [SKIP]，不输出判断过程。'
    });
  }
  recordLike(event) {
    const user = event.user, config = this.config.like;
    this.lastInteraction = this.now();
    const fallback = renderAudienceTemplate(this.choose('like', config.templates), user, {count:event.count || 1},this.now());
    if (config.responseMode === 'ai') {
      void this.requestAI({ type: 'like', user }, {
        kind: 'like', instruction: '使用 target.address 感谢这位观众给直播间点赞，语气自然简短，不要引导继续打赏。',
        data: { likeCount: event.count || 1 }, fallback
      });
    } else this.enqueue('like', fallback);
  }
  recordGift(e) {
    const g = this.config.gift, now = this.now();
    const count = Number(e.count);
    if (!Number.isSafeInteger(count) || count < 1 || count > 1000000) { this.filtered('礼物数量无效'); return; }
    // 单独点击的非连击礼物没有平台连击 ID。把短时间内同用户的同一种
    // 礼物合并，并按原始 groupId 保存累计进度，兼容延迟/重复到达的帧。
    const singleGroup = typeof e.groupId === 'string' && e.groupId.startsWith('single:') ? e.groupId : '';
    const key = `${e.roomId || ''}:${keyFor(e.user)}:${e.giftId || e.giftName}:${singleGroup ? 'single-window' : e.groupId || 'window'}`;
    let state = this.gifts.get(key);
    if (singleGroup && state && now - state.touched > 120000 && state.count === state.credited) state = null;
    if (!state || (!singleGroup && !e.groupId && (state.ended || count < state.count))) {
      if (state && state.count > state.credited && !this.settleGift(state)) {
        // 无 groupId 的新一组不能覆盖尚未入队的旧组。
        this.gifts.set(`${key}:pending:${++this.serial}`, state);
      }
      state = { ...e, count: 0, credited: 0, pendingSince: now, touched: now, ended: false, ...(singleGroup ? {singleProgress:{}} : {}) };
    }
    const wasSettled = state.count === state.credited;
    let increased;
    if (singleGroup) {
      const previousCount = Number(state.singleProgress?.[singleGroup]) || 0;
      increased = count > previousCount;
      if (increased) state.singleProgress[singleGroup] = count;
      state.count = Object.values(state.singleProgress).reduce((sum, value) => sum + value, 0);
      // Unlike a combo's final frame, a single gift's final flag only closes
      // that gift. Keep the aggregate open for late neighboring gift events.
      state.ended = false;
    } else {
      increased = count > state.count;
      state.count = Math.max(state.count, count);
      state.ended ||= Boolean(e.final);
    }
    if (increased && wasSettled) state.pendingSince = now;
    if (Number.isFinite(e.unitValue) && e.unitValue > 0) state.unitValue = e.unitValue;
    state.user = e.user; state.giftName = e.giftName || state.giftName;
    state.touched = now;
    // 使用短静默窗口合并连击，避免默认等待 4～8 秒才感谢；同时设置最大聚合窗口，
    // 让持续连击在高峰期也能分段结算。final 帧仍立即结算。
    if (singleGroup) {
      if (increased || !Number.isFinite(state.due)) {
        const price = Number.isFinite(state.unitValue) && state.unitValue > 0 ? state.unitValue : g.prices[state.giftId] ?? g.prices[state.giftName];
        state.due = Number.isFinite(price) && price >= g.minValue || (!Number.isFinite(price) && g.minValue <= 1)
          ? now
          : Math.min(now + 2000, state.pendingSince + 5000);
      }
    } else if (increased || e.final || !Number.isFinite(state.due)) {
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
      const text = renderAudienceTemplate(reply.template, reply.user, {gift,count,value,unit:reply.items[0]?.price || 0},this.now());
      if (cleanMessage(text, this.config).ok) return text;
    }
    // 只缩短昵称/礼物描述，不把整条感谢因长昵称直接丢弃。
    const clip = (text, length) => [...text].slice(0, length).join('');
    for (const limit of [12, 8, 4, 1]) {
      const gifts = reply.items.map(item => `${clip(item.name, limit)}×${item.count}`).join('、');
      const text = `感谢${audienceAddress(reply.user,this.now(),limit)}的${gifts}！`;
      if ([...text].length <= this.config.sending.maxLength) return text;
    }
    // 多种礼物再缩短名称也可能超长，改为总数量，确保能进入队列。
    const summaries = [
      `感谢${audienceAddress(reply.user,this.now(),4)}的${count}个礼物！`,
      `感谢${audienceAddress(reply.user,this.now(),1)}的礼物支持！`,
      '谢谢礼物支持！'
    ];
    return summaries.find(text => [...text].length <= this.config.sending.maxLength);
  }
  settleGift(s) {
    const g = this.config.gift, price = Number.isFinite(s.unitValue) && s.unitValue > 0 ? s.unitValue : g.prices[s.giftId] ?? g.prices[s.giftName];
    const count = s.count - s.credited;
    if (count <= 0) return true;
    if (!Number.isFinite(price) || price <= 0) {
      if (g.minValue > 1) { if (!s.unknownReported) { this.filtered(`${s.giftName || '礼物'}：单价未知，无法判断是否达到 ${g.minValue} 钻门槛`); s.unknownReported = true; } return false; }
      const name = audienceAddress(s.user,this.now(),8), gift = [...String(s.giftName || '礼物')].slice(0,10).join('');
      const text = `谢谢${name}送的${gift}${count > 1 ? `×${count}` : ''}，谢谢支持！`;
      if (this.config.blockedWords.some(word => word && `${name} ${gift} ${text}`.toLocaleLowerCase().includes(word.toLocaleLowerCase()))) { this.filtered('礼物感谢命中屏蔽词'); s.credited = s.count; return true; }
      const giftReply = {userKey:keyFor(s.user),user:s.user,items:[{key:s.giftId || s.giftName,name:s.giftName || '礼物',count,price:null}],template:text};
      if (!this.enqueue('gift',text,{giftReply,revision:1,readyAt:this.now(),quietOverflow:true})) return false;
      this.prepareGiftAI(this.queue.at(-1));
      s.credited = s.count; return true;
    }
    if ((g.basis === 'unit' ? price : s.count * price) < g.minValue) return false;
    const userKey = keyFor(s.user), old = this.giftJobs.get(userKey)?.values().next().value;
    const reply = old ? { ...old.giftReply, items: old.giftReply.items.map(item => ({...item})) } : {
      userKey, user: s.user, items: [], template: this.choose('gift', g.templates)
    };
    reply.user = s.user;
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
      this.prepareGiftAI(old);
    } else {
      if (!this.enqueue('gift', text, {giftReply:reply, revision:1, readyAt:this.now(), quietOverflow:true})) return false;
      this.prepareGiftAI(this.queue.at(-1));
    }
    s.credited = s.count;
    return true;
  }
  prepareGiftAI(job) {
    job.aiGenerated = false; job.needsGiftAI = false;
    if (this.config.gift.responseMode !== 'ai') return;
    job.readyAt = this.now() + 5000; job.aiPending = true; job.needsGiftAI = true;
    this.requestGiftAI(job);
  }
  requestGiftAI(job) {
    // 连击更新先使旧响应失效；等当前请求结束，再按合并后的完整礼物重新生成。
    if (this.aiBusy || !job.needsGiftAI) return;
    job.needsGiftAI = false;
    void this.requestAI({type:'gift',user:job.giftReply.user}, {
      kind:'gift', instruction:'以场控视角简短感谢这位观众，结合礼物单价、合并总价值、用户等级与近期弹幕语境微调答谢的郑重程度，一句致谢就结束，不扩展话题，不渲染情绪，不冒充主播。',
      data:{...giftReplyContext(job.giftReply.items),style:++this.giftStyleSerial},
      fallback:job.text, targetJob:job, revision:job.revision, deadline:job.readyAt, timeoutMs:5000
    });
  }
  giftReady(q, now) {
    return (!q.botGroup || !this.queue.some(job => job.botGroup === q.botGroup && job.botPart < q.botPart)) && (!q.afterBot || !this.queue.some(job => job.id === q.afterBot)) && (q.retryAt || 0) <= now && now >= (q.readyAt || 0) && (!q.giftReply || now >= Math.max(q.readyAt || 0, (this.giftSentAt.get(q.giftReply.userKey) ?? -Infinity) + this.config.gift.cooldownSec * 1000));
  }
  giftBatch(first, now) {
    const jobs = [first]; let text = first.text;
    if (!first.giftReply || first.aiGenerated || !this.config.gift.batchEnabled) return {jobs,text};
    const clip = value => [...value].slice(0, 8).join('');
    const part = q => `${audienceAddress(q.giftReply.user,this.now(),8)}的${q.giftReply.items.map(item => `${clip(item.name)}×${item.count}`).join('、')}`;
    const ready = [];
    let readyCount = 0;
    for (const q of this.queue) {
      if (q === first || !q.giftReply || q.aiGenerated || !this.giftReady(q, now)) continue;
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
      if (item.kind === 'bot' && earlier(item, waitingBot)) waitingBot = item;
    }
    if (!best) return null;
    if (!oldestGift) return waitingBot || best;

    // 礼物感谢是事实型事件，等待过久后必须占用下一个发送槽。
    // 礼物高峰期间每隔一个短时间片仍允许已等待的 @ 互动发送，避免游戏永久饥饿。
    const giftWait = now - oldestGift.created;
    if (waitingBot && giftWait < 5000) return waitingBot;
    return oldestGift;
  }
  aiContext(config=this.config) {
    const liveContext=liveReplyContext(this,this.now(),config);
    return {liveContext,context:liveContext.recentChat,recentReplies:[...this.duplicates.keys(),...this.queue.map(job=>job.text)].slice(-8)};
  }
  async requestAI(event = null, task = { kind: 'ai', instruction: '只简短回答目标弹幕中需要回答的问题，没有必要回复时输出 [SKIP]，不主动发起话题。' }) {
    const a = this.config.ai, now = this.now(), epoch = this.epoch;
    const currentJob = () => task.targetJob && this.queue.includes(task.targetJob) && task.targetJob.revision === task.revision && task.targetJob.aiPending;
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
    if (this.aiBusy || (task.kind === 'gift' && task.targetJob && this.queue.filter(q => q.kind === 'gift').length >= 3) || now - this.lastAI < a.intervalSec * 1000 || this.calls.length >= a.maxPerHour) { fallback('AI 调用频率或额度已达上限'); return; }
    if (event?.user && !this.cooldown(`ai-user:${task.kind}:${keyFor(event.user)}`, a.userCooldownSec)) { fallback('该用户 AI 回复冷却中'); return; }
    this.aiBusy = true; this.lastAI = now; this.calls.push(now); this.stats.aiCalls++;
    const prompt = {
      persona: a.persona, knowledge: a.knowledge, ...this.aiContext(),
      target: event ? { type: event.type, name: event.user?.name || '', text: event.text || '', address:audienceAddress(event.user,now), title:audienceTitle(event.user,now), ...(['gift','welcome'].includes(task.kind) ? audienceReplyContext(event.user, this.config.anchorId) : {}) } : null,
      task: { kind: task.kind, instruction: task.instruction, data: task.data || null }, maxLength: task.maxLength ?? this.config.sending.maxLength
    };
    let aiTimer;
    try {
      const request = this.ai(prompt, a);
      const rawOutput = task.timeoutMs ? await Promise.race([request, new Promise((_, reject) => {
        aiTimer = setTimeout(() => reject(new Error('互动 AI 等待超时')), task.timeoutMs);
      })]) : await request;
      const output = task.transform ? task.transform(rawOutput) : rawOutput;
      // 拒绝明确的代主持和留存分析用语；昵称自身不参与措辞判断。
      let wording = String(output || '');
      for (const name of [audienceAddress(event?.user,now),event?.user?.name].filter(Boolean)) wording = wording.split(name).join('');
      if (task.kind !== 'bot' && isIntrusiveReply(wording)) { fallback('AI 回复主动代主持或劝留'); return; }
      if (['gift','like','welcome'].includes(task.kind) && !validAudienceAI(output,event?.user,now)) { fallback('AI 称呼与公开资料不符'); return; }
      if (this.running && epoch === this.epoch && this.now() - now < 45000) {
        if (task.kind === 'ai' && task.data?.replyMode && (!this.config.ai.enabled || (task.data.replyMode === 'direct' ? !(this.config.ai.chatEnabled || this.config.bot.enabled) : !this.config.ai.chatEnabled))) return;
        if (task.targetJob) {
          if (currentJob() && this.now() <= task.deadline) {
            const checked = cleanMessage(output, this.config);
            if (String(output || '').trim() !== '[SKIP]' && checked.ok) {
              task.targetJob.text = checked.text;
              if (task.kind === 'gift') task.targetJob.aiGenerated = true;
            }
            task.targetJob.readyAt = this.now(); task.targetJob.aiPending = false;
          }
          return;
        }
        if (output.trim() === '[SKIP]') { this.log('ai', 'AI 判断无需回复'); if (task.kind !== 'timer') fallback('AI 未生成回复'); }
        else if (!this.enqueue(task.kind, output, task.extra)) fallback('AI 回复未通过检查');
      }
    } catch (error) { this.log('error', `AI 调用失败：${error.message}`); fallback('AI 调用失败'); }
    finally { clearTimeout(aiTimer); this.aiBusy = false; this.changed(); this.drainChatAI(); }
  }
  requestPKStrategy(pk) {
    const now = this.now(), battle = pk.key;
    const rank = this.anchorStats.rank.get(this.config.anchorId), retention = this.anchorStats.retentionFor(this.config.anchorId);
    const context = buildPKStrategyContext(pk, liveReplyContext(this, now), rank || retention ? {...rank,exhibitionRetention:retention} : null);
    if (!context || pk.dataQuality?.stale || !Number.isFinite(pk.remainingMs) || pk.remainingMs <= 0) return;
    const regime = strategyRegime(pk);
    const isCurrent = () => this.config.pkOperations.enabled && this.config.pkOperations.aiEnabled && this.pk.current()?.key === battle && this.pk.current()?.phase === 'active' && this.pk.current()?.remainingMs > 0 && !this.pk.current()?.dataQuality?.stale && strategyRegime(this.pk.current()) === regime && this.now() - now <= 10000;
    const self=context.competitors.find(row=>row.self), rivals=context.competitors.filter(row=>!row.self && row.score!==null);
    if(self?.score==null || !rivals.length)return;
    const top=Math.max(...rivals.map(row=>row.score)),gap=self.score-top;
    const fixed=`PK剩余${Math.ceil(pk.remainingMs/1000)}秒，己方${self.score}分，${gap>0 ? `领先${gap}分` : gap<0 ? `落后${-gap}分` : '当前持平'}。`;
    this.pkOperations.strategy={text:fixed,at:now,battle,regime,source:'rules'};
    this.pkOperations.notice(`strategy:${battle}:${Math.floor(now/(this.config.pkOperations.aiIntervalSec*1000))}`,fixed,
      {channel:'admin',pkNotice:true,pkFeature:'aiEnabled',pkStrategy:true,pkRegime:regime,pkBattle:battle,expires:now+15000},
      {kind:'pk',data:context,current:isCurrent,accept:text=>{
        if(cleanMessage(text,this.config).ok && !isIntrusiveReply(text))this.pkOperations.strategy={text,at:this.now(),battle,regime,source:'ai'};
      }});
  }

  async tick(canSend = true) {
    const expiredDeliveries = this.deliveries.expire();
    if (expiredDeliveries.length) {
      for (const record of expiredDeliveries) this.log('system',`未收到公屏回显，不自动重发：${record.text}`);
      this.changed();
    }
    if (!this.running || this.busy) return;
    const now = this.now(); let stateChanged = false;
    this.pkOperations.tick(canSend);
    this.drainChatAI();
    for (const job of this.queue) if (job.aiPending && now >= job.readyAt) { job.aiPending=false; job.needsGiftAI=false; stateChanged=true; }
    const sessionNotice = this.config.bot.enabled ? this.bot.expire(now) : null;
    if (sessionNotice) { stateChanged = true; this.enqueue('bot', sessionNotice, { quietOverflow:true }); }
    if (this.pruneIdiomHints()) stateChanged=true;
    if (canSend && this.config.bot.enabled && this.config.bot.idiomEnabled && !this.queue.some(job=>job.idiomHintToken)) {
      const hint=this.bot.idiomHint(this.config.sending.maxLength,true);
      if (hint) this.queueBotReply({user:{id:'idiom-auto-hint',name:''}},hint,{quietOverflow:true});
    }
    // 高频弹幕期间不每秒遍历所有去重/冷却记录；冷却按各自有效时长清理。
    if (now - this.lastMaintenance >= 30000) {
      this.lastMaintenance = now;
      const retention = Math.max(this.config.gift.cooldownSec, this.config.welcome.cooldownSec, this.config.keyword.cooldownSec, this.config.like.cooldownSec, this.config.ai.userCooldownSec) * 1000;
      this.pruneMilestones(now);
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
    for (const job of this.queue) if (job.needsGiftAI && job.aiPending) this.requestGiftAI(job);
    if (this.config.timersEnabled) for (const t of this.config.timers) {
      if (!t.enabled) continue;
      if (!this.timerDue.has(t.id)) { this.timerDue.set(t.id, now + t.intervalSec * 1000); stateChanged = true; }
      if (now < this.timerDue.get(t.id)) continue;
      this.timerDue.set(t.id, now + t.intervalSec * 1000); stateChanged = true; // 后台计时恢复时不补发。
      if (!inTimeWindow(t.start, t.end, now) || now - this.lastInteraction < t.quietSec * 1000 || this.queue.some(q => q.kind === 'timer')) continue;
      const fallback = this.choose(`timer:${t.id}`, t.messages);
      if (t.responseMode === 'ai') void this.requestAI(null, { kind: 'timer', instruction: '保留本次参考话术的原意，只写一句简短提醒。默认只欢迎大家、轻轻提醒喜欢可以关注，不发起话题，不征集问题或点歌，不说替大家转达。现场正在聊天、近期已有类似招呼或没有必要插话时输出 [SKIP]。', data: { intervalSec: t.intervalSec, reference: fallback }, fallback });
      else this.enqueue('timer', fallback);
    }
    if (this.config.ai.enabled && this.config.ai.chatEnabled && this.config.ai.idleEnabled && now - this.lastChat >= this.config.ai.idleSec * 1000 && now - this.lastInteraction >= this.config.ai.idleSec * 1000) {
      this.lastInteraction = now; stateChanged = true; void this.requestAI(null, { kind: 'ai', instruction: '直播间暂时没有新弹幕，这不表示主播需要救场。没有明确需要补充的已核实信息时输出 [SKIP]；不为了冷场主动征集话题、点歌、提问或劝观众留下，不声称帮忙转达。' });
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
    const delivery = this.config.mode === 'preview' ? null : this.deliveries.create(batch.text,batch.jobs,{id:this.config.selfId || this.selfIdentity?.id,secUid:this.selfIdentity?.secUid});
    if (delivery) this.inFlight.deliveryId = delivery.id;
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
    const checkpointForSend = async (required = false) => {
      let timer;
      try {
        const write = this.checkpoint();
        await Promise.race([
          Promise.resolve(write),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('运行状态保存超时')), 500); })
        ]);
      } catch (error) {
        if (this.lastCheckpointWarning !== error.message) {
          this.lastCheckpointWarning = error.message;
          this.log('error', `运行状态保存暂不可用：${error.message}`);
        }
        if (required) throw Object.assign(error,{retryable:true});
      } finally { clearTimeout(timer); }
    };
    try {
      if (this.config.mode === 'preview') { submitted(); this.stats.previews++; this.log('preview', batch.text); }
      else {
        void checkpointForSend();
        if (this.epoch !== epoch) return;
        this.selfTexts.set(batch.text, now + 120000);
        const channel = q.kind === 'welcome' ? this.welcomeChannel(q.welcomeUser) : q.channel || 'chat';
        const result = await this.send(batch.text, () => this.running && this.epoch === epoch && this.pkOperations.validJob(q) && (!q.idiomHintToken || q.idiomHintToken===this.bot.hintToken()), {channel, beforeClick:async()=>{
          this.deliveries.clicked(delivery);
          try { await checkpointForSend(true); }
          catch (error) { this.deliveries.finish(delivery,'prepared','点击意图未保存，尚未点击'); delete delivery.clickedAt; throw error; }
        }});
        if (this.epoch !== epoch) return;
        if (result?.submitted || result?.clicked) {
          this.deliveries.clicked(delivery);
          if (result.failed) { this.deliveries.finish(delivery,'failed',result.reason); this.retryDelivery(delivery,`平台拒绝后自动重发：${result.reason || '未知原因'}`); }
          else if (!result.submitted) this.deliveries.finish(delivery,'unknown',result.reason || '点击后结果未知；不自动重发');
          submitted(); this.lastRetryReason = ''; this.stats.submitted++;
          const channelNote = result.channelUsed === 'admin' ? '（管理员弹幕）' : result.modeFallback ? `（普通弹幕：${result.modeFallback}）` : '';
          this.log('sent',`${result.failed ? '平台拒绝，自动重发' : result.submitted ? result.transport === 'request' ? '请求已提交，等待公屏回显' : '已点击，等待公屏回显' : '结果未知，不自动重发'}${channelNote}：${batch.text}`);
          if (result.displayWarning) this.log('error', result.displayWarning);
          void checkpointForSend();
          if (result.failed) this.log('error', `平台拒绝消息，场控保持运行：${result.reason || '未知原因'}`);
        } else {
          this.deliveries.finish(delivery,'cancelled','未点击，任务可安全重试'); delivery.jobs = [];
          retry(result?.reason || '发送控件暂不可用');
        }
      }
    } catch (error) {
      if (this.epoch === epoch) {
        if (delivery && (delivery.state !== 'prepared' || error.clicked)) {
          this.deliveries.finish(delivery,'unknown',error.message || '点击后结果未知；不自动重发');
        } else {
          if (delivery) { this.deliveries.finish(delivery,'cancelled',error.message); delivery.jobs = []; }
          retry(error.message || '发送异常');
        }
        if (error.retryable) this.log('system', `发送暂不可用：${error.message}；消息保留，稍后继续发送`);
        else this.log('error', `发送失败，场控保持运行：${error.message}`);
      }
    }
    finally {
      if (delivery && this.epoch !== epoch && ['prepared','clicked'].includes(delivery.state)) {
        if (delivery.state === 'prepared') { this.deliveries.finish(delivery,'cancelled','点击前任务已取消'); delivery.jobs = []; }
        else this.deliveries.finish(delivery,'unknown','点击后运行中断；不自动重发');
      }
      this.inFlight = null; this.busy = false; this.changed();
    }
  }
}
