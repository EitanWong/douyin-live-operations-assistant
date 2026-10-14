import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, copy, Engine, welcomeDecision, matchesUser, validateConfig, mergeConfig, inTimeWindow } from '../src/core.js';

const user = { id: '9007199254740993123', name: '青山', wealthLevel: 35, fanClubs: [{ anchorId: '1234567890', level: 8, status: 1 }] };
function harness(change = () => {}) {
  const c = copy(DEFAULTS); c.anchorId = '1234567890'; c.gift.templates = ['{user}：{gift}×{count}，{value}钻石']; change(c);
  let time = 1800000000000; const sent = [], logs = [];
  const e = new Engine({ config: c, now: () => time, send: async text => { sent.push(text); return { submitted: true }; }, log: (category, text) => logs.push({ category, text }) });
  e.start(); return { e, sent, logs, advance: ms => { time += ms; }, time: () => time };
}
const gift = (override = {}) => ({ type: 'gift', user, giftId: '123', giftName: '星星', unitValue: 50, count: 1, groupId: 'group', ...override });

test('礼物感谢间隔默认 1 秒，仍受全局发送节奏限制', () => {
  assert.equal(DEFAULTS.gift.cooldownSec, 1);
  assert.equal(DEFAULTS.sending.intervalSec, 10);
  assert.equal(DEFAULTS.gift.templates.length, 4);
  assert.ok(DEFAULTS.gift.templates.every(text => text.includes('{user} 哥')));
});
test('礼物回复不因相同文本去重丢失，其他类别仍保留重复过滤', () => {
  const { e } = harness();
  e.duplicates.set('感谢青山哥送的星星！', e.now());
  assert.equal(e.enqueue('gift', '感谢青山哥送的星星！'), true);
  assert.equal(e.enqueue('gift', '感谢青山哥送的星星！'), true);
  assert.equal(e.enqueue('welcome', '欢迎大家'), true);
  assert.equal(e.enqueue('welcome', '欢迎大家'), false);
  assert.equal(e.enqueue('like', '谢谢青山哥点赞！'), true);
  assert.equal(e.enqueue('like', '谢谢青山哥点赞！'), true);
  assert.equal(e.queue.filter(item => item.kind === 'gift').length, 2);
});
test('点赞感谢按用户冷却，规则话术轮换且同文本不会过滤事件回复', async () => {
  const { e, advance } = harness(c => { c.like.enabled = true; c.like.templates = ['谢谢 {user} 哥点赞！', '感谢 {user} 哥的赞！']; });
  e.ingest({ type: 'like', id: 'like-1', user, count: 30 });
  assert.equal(e.queue[0].text, '谢谢 青山 哥点赞！');
  e.ingest({ type: 'like', id: 'like-2', user, count: 30 });
  assert.equal(e.queue.length, 1);
  advance(60001); e.ingest({ type: 'like', id: 'like-3', user, count: 20 });
  assert.equal(e.queue.length, 2); assert.equal(e.queue[1].text, '感谢 青山 哥的赞！');
});
test('点赞 AI 生成失败时回退到轮换话术，保留审核队列', async () => {
  const { e } = harness(c => { c.mode = 'review'; c.ai.enabled = true; c.like.enabled = true; c.like.responseMode = 'ai'; });
  e.ai = async () => { throw new Error('offline'); };
  e.ingest({ type: 'like', id: 'like-ai', user, count: 12 }); await new Promise(setImmediate);
  assert.equal(e.queue.length, 1); assert.equal(e.queue[0].kind, 'like'); assert.equal(e.queue[0].approved, false);
  assert.match(e.queue[0].text, /青山 哥.*赞/);
});
test('礼物 AI 关闭或不可用时使用轮换规则话术兜底', async () => {
  const { e } = harness(c => { c.mode = 'review'; c.gift.responseMode = 'ai'; c.gift.minValue = 50; c.gift.templates = ['感谢 {user} 哥送的 {gift}']; });
  e.ingest(gift({ final: true })); await e.tick();
  assert.equal(e.queue[0].kind, 'gift'); assert.match(e.queue[0].text, /青山\s*哥送的\s*星星/);
});
test('旧版定时配置迁移为规则话术模式', () => {
  const old = mergeConfig({ timers: [{ id: 'old', enabled: false, intervalSec: 300, start: '', end: '', quietSec: 15, messages: [] }] });
  assert.equal(old.timers[0].responseMode, 'rules');
});

test('欢迎必须同时满足荣誉等级、本主播粉丝团和点亮状态', () => {
  const c = copy(DEFAULTS); c.anchorId = '1234567890';
  assert.equal(welcomeDecision(user, c).pass, true);
  for (const u of [{ ...user, wealthLevel: null }, { ...user, wealthLevel: 29 }, { ...user, fanClubs: [] }, { ...user, fanClubs: [{ anchorId: 'other', level: 30, status: 1 }] }, { ...user, fanClubs: [{ anchorId: c.anchorId, level: 8, status: 2 }] }, { ...user, fanClubs: [{ anchorId: c.anchorId, level: 8, status: null }] }]) assert.equal(welcomeDecision(u, c).pass, false);
  c.anchorId = ''; assert.equal(welcomeDecision(user, c).pass, false);
});
test('指定名单可独立欢迎；昵称只接受显式 name 前缀', () => {
  const c = copy(DEFAULTS); c.welcome.listed = ['uid:9007199254740993123'];
  assert.equal(welcomeDecision({ ...user, wealthLevel: 1, fanClubs: [] }, c).pass, true);
  c.welcome.mode = 'qualified'; assert.equal(welcomeDecision(user, c).pass, false);
  assert.equal(matchesUser(user, ['青山']), false); assert.equal(matchesUser(user, ['name:青山']), true);
});
test('连击 1、2、3 结算为 3 个而非 6；重复最终推送不再感谢', async () => {
  const { e, logs } = harness();
  for (let count = 1; count <= 3; count++) e.ingest(gift({ id: `g${count}`, count, final: count === 3 }));
  await e.tick(); assert.equal(e.stats.previews, 1); assert.ok(logs.some(l => l.category === 'preview' && l.text.includes('×3，150钻石')));
  e.ingest(gift({ id: 'g-final-duplicate', count: 3, final: true })); await e.tick(); assert.equal(e.stats.previews, 1);
});
test('总价与单价阈值有不同结果', async () => {
  const { e: total } = harness(); total.ingest(gift({ count: 3, final: true })); await total.tick(); assert.equal(total.stats.previews, 1);
  const { e: unit } = harness(c => { c.gift.basis = 'unit'; }); unit.ingest(gift({ count: 3, final: true })); await unit.tick(); assert.equal(unit.stats.previews, 0);
});
test('未知礼物单价跳过，补价格表可恢复', async () => {
  const a = harness(); a.e.ingest(gift({ unitValue: null, count: 3, final: true })); await a.e.tick(); assert.equal(a.e.stats.previews, 0);
  const b = harness(c => { c.gift.prices = { '123': 50 }; }); b.e.ingest(gift({ unitValue: null, count: 3, final: true })); await b.e.tick(); assert.equal(b.e.stats.previews, 1);
});
test('先出现低价子连击，稍后累积达标仍感谢累计价值', async () => {
  const { e, advance, logs } = harness();
  e.ingest(gift({ id: 'first', count: 1, final: false })); advance(4100); await e.tick(); assert.equal(e.stats.previews, 0);
  e.ingest(gift({ id: 'second', count: 3, final: true })); await e.tick(); assert.equal(e.stats.previews, 1);
  assert.ok(logs.some(l => l.category === 'preview' && l.text.includes('150钻石')));
});
test('长时间连击阶段感谢只计算新增数量', async () => {
  const { e, advance, logs } = harness(c => { c.gift.cooldownSec = 0; });
  e.ingest(gift({ count: 3, final: false })); advance(4100); await e.tick();
  advance(10000); e.ingest(gift({ count: 5, final: true })); await e.tick();
  assert.equal(e.stats.previews, 2); assert.ok(logs.some(l => l.category === 'preview' && l.text.includes('×2，100钻石')));
});
test('历史事件、重复事件、忽略用户和自己均不回复', async () => {
  const { e, time } = harness(c => { c.selfId = user.id; });
  e.ingest({ type: 'enter', id: 'self', user }); assert.equal(e.queue.length, 0);
  const a = harness(); a.e.ingest({ type: 'enter', id: 'old', at: time() - 31000, user }); assert.equal(a.e.queue.length, 0);
  a.e.ingest({ type: 'enter', id: 'same', user }); a.e.ingest({ type: 'enter', id: 'same', user }); assert.equal(a.e.queue.length, 1);
  const b = harness(c => { c.ignored = [`uid:${user.id}`]; }); b.e.ingest(gift({ final: true, count: 3 })); await b.e.tick(); assert.equal(b.e.stats.previews, 0);
});
test('礼物优先、发送间隔、每分钟总量、过期队列均生效', async () => {
  const { e, advance, logs } = harness(c => { c.sending.perMinute = 2; });
  e.enqueue('timer', '定时提醒'); e.enqueue('welcome', '欢迎青山'); e.enqueue('gift', '感谢礼物');
  await e.tick(); assert.equal(logs.find(l => l.category === 'preview').text, '感谢礼物');
  await e.tick(); assert.equal(e.stats.previews, 1);
  advance(10001); await e.tick(); assert.equal(e.stats.previews, 2);
  advance(10001); await e.tick(); assert.equal(e.stats.previews, 2);
  advance(50000); await e.tick(); assert.equal(e.queue.length, 0); assert.equal(e.stats.previews, 2);
});
test('人工审核模式不会自动发送，批准后才提交', async () => {
  const { e, sent } = harness(c => { c.mode = 'review'; }); e.enqueue('ai', '欢迎大家'); await e.tick(); assert.equal(sent.length, 0);
  e.approve(e.queue[0].id, '一起聊聊吧'); await e.tick(); assert.deepEqual(sent, ['一起聊聊吧']);
});
test('审核修改也需要字数与屏蔽词检查', () => {
  const { e } = harness(c => { c.mode = 'review'; c.blockedWords = ['禁止']; }); e.enqueue('ai', '正常候选');
  assert.equal(e.approve(e.queue[0].id, '禁止内容'), false); assert.equal(e.approve(e.queue[0].id, '长'.repeat(101)), false);
});
test('暂停清除队列；延迟 AI 响应不进入重启后的队列', async () => {
  const { e } = harness(c => { c.ai.enabled = true; }); let resolve; e.ai = () => new Promise(r => { resolve = r; });
  const pending = e.requestAI({ user, text: '怎么参与？' }); e.enqueue('welcome', '旧欢迎'); e.stop(); assert.equal(e.queue.length, 0); e.start();
  resolve('迟到的回复'); await pending; assert.equal(e.queue.length, 0);
});
test('暂停后迟到的礼物 AI 响应不会触发规则兜底', async () => {
  const { e } = harness(c => { c.ai.enabled = true; }); let resolve;
  e.ai = () => new Promise(r => { resolve = r; });
  const pending = e.requestAI({ type: 'gift', user }, { kind: 'gift', fallback: '感谢青山哥送的星星！' });
  e.stop(); e.start(); resolve('迟到的回复'); await pending;
  assert.equal(e.queue.length, 0);
});
test('AI 调用频率、每小时预算与最近上下文', async () => {
  const { e, advance } = harness(c => { c.ai.enabled = true; c.ai.maxPerHour = 1; }); const prompts = []; e.ai = async prompt => { prompts.push(prompt); return '[SKIP]'; };
  e.ingest({ type: 'chat', id: 'chat', user, text: '普通弹幕' }); await e.requestAI({ user, text: '哪里？' });
  assert.equal(prompts[0].context.length, 1); await e.requestAI(); assert.equal(prompts.length, 1);
  advance(60000); await e.requestAI(); assert.equal(prompts.length, 1);
  advance(3600000); await e.requestAI(); assert.equal(prompts.length, 2); assert.equal(prompts[1].context.length, 0);
});
test('@登录账号弹幕跳过普通触发条件，AI 可使用此前聊天上下文', async () => {
  const { e } = harness(c => { c.ai.enabled = true; c.ai.chatEnabled = true; c.ai.trigger = 'question'; });
  e.setIdentity({ self: { id: 'self-1', name: '小助手' } });
  const prompts = []; e.ai = async prompt => { prompts.push(prompt); return '刚才大家提到周末有活动。'; };
  e.ingest({ type: 'chat', id: 'context', user: { id: 'viewer-1', name: '观众甲' }, text: '周末活动安排刚才已经在直播间聊过了' });
  e.ingest({ type: 'chat', id: 'mention', user: { id: 'viewer-2', name: '观众乙' }, text: '请问刚才说的活动几点开始', mentions: ['self-1'] });
  await new Promise(setImmediate);
  assert.equal(prompts.length, 1); assert.equal(prompts[0].context.length, 2);
  assert.match(prompts[0].task.instruction, /最近直播间聊天记录/);
  assert.equal(prompts[0].target.text, '请问刚才说的活动几点开始');
});
test('辱骂识别仅计数并在滚动时间窗达到阈值时提醒', () => {
  const { e, logs, advance } = harness(c => { c.keyword.enabled = false; c.moderation.threshold = 2; c.moderation.windowSec = 60; });
  e.ingest({ type: 'chat', id: 'bad-1', user, text: '你这个傻逼' });
  assert.equal(logs.filter(item => item.category === 'moderation').length, 1);
  e.ingest({ type: 'chat', id: 'bad-2', user, text: '脑残' });
  assert.equal(logs.filter(item => item.category === 'moderation').length, 3);
  assert.match(logs.at(-1).text, /未验证，未执行封禁/);
  advance(61000); e.ingest({ type: 'chat', id: 'bad-3', user, text: '去死' });
  assert.match(logs.at(-1).text, /1\/2 次/);
});
test('管理员身份未验证不产生管理动作，辱骂提醒可关闭', () => {
  const { e, logs } = harness(c => { c.moderation.enabled = false; });
  e.ingest({ type: 'chat', id: 'bad', user, text: '傻逼' });
  assert.equal(logs.filter(item => item.category === 'moderation').length, 0);
  assert.equal(e.selfIdentity, null);
});
test('关键词首条命中后不再触发 AI', () => {
  const { e } = harness(c => { c.keyword.enabled = true; c.ai.enabled = true; c.keyword.rules.push({ keywords: ['开播'], reply: '第二条', exact: false }); });
  e.ingest({ type: 'chat', user, text: '一般几点开播？' }); assert.equal(e.queue.length, 1); assert.equal(e.queue[0].kind, 'keyword'); assert.equal(e.stats.aiCalls, 0);
  e.ingest({ type: 'chat', user, text: '几点开播呢？' }); assert.equal(e.queue.length, 1); assert.equal(e.stats.aiCalls, 0);
});
test('关键词 AI 模式仍按关键词匹配，并将候选归入关键词回复队列', async () => {
  const { e } = harness(c => { c.ai.enabled = true; c.keyword.enabled = true; c.keyword.responseMode = 'ai'; });
  let prompt; e.ai = async value => { prompt = value; return '开播时间请看主页公告。'; };
  e.ingest({ type: 'chat', user, text: '几点开播？' }); await new Promise(setImmediate);
  assert.equal(prompt.task.kind, 'keyword'); assert.equal(e.queue[0].kind, 'keyword');
  assert.match(prompt.task.instruction, /命中了关键词规则/);
});
test('礼物 AI 模式保留价格阈值并把礼物数据交给模型', async () => {
  const { e } = harness(c => { c.ai.enabled = true; c.gift.responseMode = 'ai'; c.gift.minValue = 50; });
  let prompt; e.ai = async value => { prompt = value; return '谢谢青山送来的星星！'; };
  e.ingest(gift({ final: true })); await e.tick(); await new Promise(setImmediate);
  assert.equal(prompt.task.kind, 'gift'); assert.equal(prompt.task.data.giftName, '星星');
  assert.equal(prompt.task.data.totalDiamonds, 50); assert.equal(e.queue[0].kind, 'gift');
});
test('进场欢迎和定时消息可独立使用 AI 生成', async () => {
  const welcome = harness(c => { c.ai.enabled = true; c.welcome.responseMode = 'ai'; });
  let prompt; welcome.e.ai = async value => { prompt = value; return '欢迎青山哥来到直播间！'; };
  welcome.e.ingest({ type: 'enter', user }); await new Promise(setImmediate);
  assert.equal(prompt.task.kind, 'welcome'); assert.equal(welcome.e.queue[0].kind, 'welcome');

  const timer = harness(c => { c.ai.enabled = true; c.timers[0].enabled = true; c.timers[0].responseMode = 'ai'; c.timers[0].intervalSec = 30; });
  timer.e.ai = async value => { prompt = value; return '喜欢的话点点关注，一起聊聊吧！'; };
  await timer.e.tick(); timer.advance(31000); await timer.e.tick(); await new Promise(setImmediate);
  assert.equal(prompt.task.kind, 'timer'); assert.equal(timer.e.queue[0].kind, 'timer');
});
test('定时任务跨午夜、优先避让互动、恢复后台不补发', async () => {
  assert.equal(inTimeWindow('22:00', '02:00', Date.parse('2026-10-14T23:00:00+08:00')), true);
  assert.equal(inTimeWindow('22:00', '02:00', Date.parse('2026-10-14T12:00:00+08:00')), false);
  const { e, advance } = harness(c => { c.timers[0].enabled = true; c.timers[0].intervalSec = 30; });
  await e.tick(); advance(31000); e.ingest({ type: 'chat', user, text: '你好' }); await e.tick(); assert.equal(e.stats.previews, 0);
  advance(600000); await e.tick(); assert.equal(e.stats.previews, 1); await e.tick(); assert.equal(e.stats.previews, 1);
});
test('格式错误和危险频率被拒绝，配置不携带未知密钥', () => {
  assert.throws(() => validateConfig(mergeConfig({ sending: { intervalSec: 0 } })));
  assert.throws(() => validateConfig(mergeConfig({ gift: { prices: { x: '100' } } })));
  assert.throws(() => mergeConfig({ mode: false }));
  const config = mergeConfig(JSON.parse('{"__proto__":{"polluted":true},"apiKey":"secret","mode":"preview"}'));
  assert.equal(config.apiKey, undefined); assert.equal({}.polluted, undefined);
});
test('发送失败自动暂停且不重试；真实发送中的暂停令取消函数失效', async () => {
  const { e } = harness(c => { c.mode = 'auto'; }); e.send = async () => { throw new Error('不可用'); }; e.enqueue('gift', '感谢'); await e.tick(); assert.equal(e.running, false);
  const b = harness(c => { c.mode = 'auto'; }); let finish;
  b.e.send = async (text, current) => { await new Promise(r => { finish = r; }); assert.equal(current(), false); return { submitted: false }; };
  b.e.enqueue('gift', '感谢'); const task = b.e.tick(); b.e.stop(); finish(); await task; assert.equal(b.e.stats.submitted, 0);
});
