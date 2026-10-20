import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, copy, Engine, welcomeDecision, matchesUser, validateConfig, mergeConfig, inTimeWindow, recognizeMilestone } from '../../src/core/engine.js';

const user = { id: '9007199254740993123', name: '青山', wealthLevel: 35, fanClubs: [{ anchorId: '1234567890', level: 8, status: 1 }] };
function harness(change = () => {}) {
  const c = copy(DEFAULTS); c.mode = 'preview'; c.anchorId = '1234567890'; c.gift.templates = ['{user}：{gift}×{count}，{value}钻石']; change(c);
  let time = 1800000000000; const sent = [], logs = [];
  const e = new Engine({ config: c, now: () => time, send: async text => { sent.push(text); return { submitted: true }; }, log: (category, text) => logs.push({ category, text }) });
  e.start(); return { e, sent, logs, advance: ms => { time += ms; }, time: () => time };
}
const gift = (override = {}) => ({ type: 'gift', user, giftId: '123', giftName: '星星', unitValue: 50, count: 1, groupId: 'group', ...override });

test('识别星守护和本场 1000 贡献榜系统播报', () => {
  assert.deepEqual(recognizeMilestone('恭喜 [图片] 孤独患者成为星守护'), { kind:'guardian', name:'孤独患者' });
  assert.deepEqual(recognizeMilestone('恭喜 孤独患者成为No.2本场1000贡献用户'), { kind:'contribution', name:'孤独患者', rank:2 });
  assert.deepEqual(recognizeMilestone('恭喜 孤独患者成为本场 No.2 1000 贡献用户'), { kind:'contribution', name:'孤独患者', rank:2 });
  assert.deepEqual(recognizeMilestone('感谢岁小孩LILAC成为本场No.1、1000票贡献用户！'), { kind:'contribution', name:'岁小孩LILAC', rank:1 });
  assert.equal(recognizeMilestone('恭喜大家晚上好'), null);
});

test('系统播报会分别排入星守护和 1000 票贡献榜感谢', () => {
  const { e } = harness();
  e.ingest({ type:'chat', id:'guardian', user:{id:'system',name:'系统'}, text:'恭喜 [图片] 孤独患者成为星守护' });
  e.ingest({ type:'chat', id:'rank', user:{id:'system',name:'系统'}, text:'恭喜 孤独患者成为No.2本场1000贡献用户' });
  e.ingest({ type:'chat', id:'fan-badge-rank', user:{id:'system',name:'系统'}, text:'感谢岁小孩LILAC成为本场No.1、1000票贡献用户！' });
  assert.deepEqual(e.queue.filter(item => item.kind === 'milestone').map(item => item.text), [
    '感谢孤独患者开通星守护，欢迎加入！',
    '感谢孤独患者成为本场No.2、1000票贡献用户！',
    '感谢岁小孩LILAC成为本场No.1、1000票贡献用户！'
  ]);
});
test('房间状态、关注分享和粉丝团事件只记录，不触发自动发送', () => {
  const logs = [], sent = [], e = new Engine({config:copy(DEFAULTS),now:()=>1800000000000,send:async text=>{sent.push(text);return {submitted:true};},log:(category,text)=>logs.push({category,text})});
  e.ingest({type:'room-stats',id:'stats-1',metricType:1,displayValue:10764,displayLong:'10,764 在线观众'});
  e.ingest({type:'room-stats',id:'stats-2',metricType:1,displayValue:10764,displayLong:'10,764 在线观众'});
  e.ingest({type:'room-audience',id:'audience-1',onlineCount:18,cumulativeUsers:'1234',ranks:[{user:{id:'7',name:'榜单用户'},score:100,rank:1}]});
  e.ingest({type:'social',id:'follow-1',action:1,actionName:'follow',user:{id:'8',name:'关注用户'},followCount:99});
  e.ingest({type:'fansclub',id:'club-1',action:2,actionName:'join',description:'成员加入粉丝团',user:{id:'9',name:'粉丝'} });
  assert.equal(logs.filter(item=>item.text.startsWith('直播间统计')).length,1,'相同统计快照不重复记日志');
  assert.ok(logs.some(item=>item.text.includes('在线 18')));
  assert.ok(logs.some(item=>item.text.includes('关注用户 关注了主播')));
  assert.ok(logs.some(item=>item.text.includes('成员加入粉丝团')));
  assert.deepEqual(sent,[]); assert.equal(e.queue.length,0);
  const restored = new Engine({config:copy(DEFAULTS),now:()=>1800000000000});
  assert.equal(restored.restore(e.snapshot()),true);
  assert.equal(restored.roomData.stats.displayValue,10764);
  assert.equal(restored.roomData.audience.ranks[0].user.name,'榜单用户');
  assert.equal(restored.roomData.activities.length,2);
});
test('表情、醒目留言、公告、排行、通知和 WRDS 仅作有界观察数据', () => {
  const sent=[], logs=[], e=new Engine({config:copy(DEFAULTS),now:()=>1800000000000,send:async text=>{sent.push(text);return {submitted:true};},log:(category,text)=>logs.push({category,text})});
  for (let index=0;index<105;index++) e.ingest({type:index%2?'screen-chat':'emoji-chat',id:`observed-${index}`,user:{id:String(index),name:'观众'},text:'只读内容'});
  e.ingest({type:'room-notice',id:'notice',text:'房间公告'});
  e.ingest({type:'room-rank',id:'rank',ranks:[{score:'520'}]});
  e.ingest({type:'rank-update',id:'rank-update',updates:[{text:'榜单更新'}]});
  e.ingest({type:'room-notify',id:'notify',notifySubType:'live_gift_notify'});
  e.ingest({type:'room-sync',id:'sync',syncType:'InteractEffectSyncData',syncDataBytes:128});
  e.ingest({type:'audio-chat',id:'audio',text:'谢谢主播'});
  e.ingest({type:'product-change',id:'products',products:[{promotionId:'12345'}]});
  e.ingest({type:'highlight-comment',id:'highlight',text:'置顶内容'});
  e.ingest({type:'activity-signal',id:'lottery',activityKind:'lottery-result'});
  e.ingest({type:'red-packet',id:'red',status:'发放中',count:5});
  e.ingest({type:'chat-like',id:'chat-likes',entries:[{messageId:'123',count:'5'}]});
  e.ingest({type:'fan-ticket',id:'tickets',display:'1.2万',total:'12000'});
  e.ingest({type:'room-activity-state',id:'game',title:'小游戏进行中'});
  assert.equal(e.roomData.activities.length,100); assert.ok(logs.some(row=>row.text.includes('房间公告')));
  assert.deepEqual(sent,[]); assert.equal(e.queue.length,0);
});
test('新增团播礼物目录和 PK 元数据在暂停时只读记录', () => {
  const sent=[], logs=[], e=new Engine({config:copy(DEFAULTS),now:()=>1800000000000,send:async text=>{sent.push(text);return {submitted:true};},log:(category,text)=>logs.push({category,text})});
  e.ingest({type:'gift-catalog',id:'menu',itemCount:2,items:[{id:'77',name:'熱氣球',price:520}]});
  e.ingest({type:'battle-bonus',id:'bonus',mvp:{user:{name:'MVP'}}});
  e.ingest({type:'battle-property',id:'props',rooms:[{roomId:'7',properties:[{name:'PK 宝箱'}]}]});
  e.ingest({type:'battle-season-honor',id:'honor',honors:[{name:'赛季荣誉'}]});
  e.ingest({type:'popular-card',id:'popular',enterNumber:12});
  assert.equal(e.roomData.activities.length,5);
  assert.ok(logs.some(row=>row.text.includes('团播礼物目录候选')));
  assert.ok(logs.some(row=>row.text.includes('PK 奖励')));
  assert.deepEqual(sent,[]); assert.equal(e.queue.length,0);
  const restored=new Engine({config:copy(DEFAULTS),now:()=>1800000000000});
  assert.equal(restored.restore(e.snapshot()),true); assert.equal(restored.roomData.activities.length,5);
});
test('粉丝团与团播成员/收益、房票状态在暂停时只读持久化', () => {
  const sent=[], logs=[], e=new Engine({config:copy(DEFAULTS),now:()=>1800000000000,send:async text=>{sent.push(text);return {submitted:true};},log:(category,text)=>logs.push({category,text})});
  for (const [type,id] of [['fansclub-statistics','club'],['group-live-members','members'],['group-live-income','income'],['room-ticket','ticket']]) e.ingest({type,id});
  assert.equal(e.roomData.activities.length,4); assert.deepEqual(sent,[]); assert.equal(e.queue.length,0);
  assert.ok(logs.some(row=>row.text.includes('团播成员收益')));
  const restored=new Engine({config:copy(DEFAULTS),now:()=>1800000000000});
  assert.equal(restored.restore(e.snapshot()),true); assert.equal(restored.roomData.activities.length,4);
});
test('连麦席位、嘉宾状态与粉丝团播报暂停时只读持久化', () => {
  const sent=[], e=new Engine({config:copy(DEFAULTS),now:()=>1800000000000,send:async text=>{sent.push(text);return {submitted:true};}});
  for (const [type,id] of [['linkmic-positions','positions'],['guest-link-state','guest-link'],['fansclub-push','fan-push']]) e.ingest({type,id});
  assert.equal(e.roomData.activities.length,3); assert.deepEqual(sent,[]); assert.equal(e.queue.length,0);
});
test('1000票播报跨 socket 弹幕与 DOM milestone 去重，并在恢复后保留去重状态', async () => {
  const {e, advance} = harness();
  const message = '感谢岁小孩LILAC成为本场No.1、1000票贡献用户！';
  e.ingest({type:'chat',id:'socket-row-1',user:{id:'system',name:'系统'},text:message,source:'socket'});
  e.ingest({type:'milestone',milestone:{kind:'contribution',name:'岁小孩LILAC',rank:1},source:'dom'});
  e.ingest({type:'milestone',milestone:{kind:'contribution',name:'岁小孩LILAC',rank:1},source:'dom'});
  e.ingest({type:'milestone',milestone:{kind:'contribution',name:'岁小孩LILAC',rank:2},source:'dom'});
  assert.equal(e.queue.filter(job=>job.kind==='milestone').length,2,'相同排名只感谢一次，不同排名保留');
  const restored = new Engine({config:e.config,now:e.now});
  restored.restore(e.snapshot());
  restored.ingest({type:'milestone',milestone:{kind:'contribution',name:'岁小孩LILAC',rank:1},source:'dom'});
  assert.equal(restored.queue.filter(job=>job.kind==='milestone').length,2,'刷新后迟到的另一来源不重复入队');
  await e.tick(); await e.tick();
  advance(600001);
  e.ingest({type:'milestone',milestone:{kind:'contribution',name:'岁小孩LILAC',rank:1},source:'dom'});
  assert.equal(e.queue.filter(job=>job.kind==='milestone').length,1,'去重窗口过期后允许新的一次播报');
});

test('复用消息 ID 的连击更新和结束消息仍结算到最新累计数量', async () => {
  const {e, logs} = harness();
  e.ingest(gift({id:'same',count:1}));
  e.ingest(gift({id:'same',count:4,final:true}));
  e.ingest(gift({id:'same',count:4,final:true}));
  await e.tick();
  assert.equal(e.stats.previews, 1); assert.ok(logs.some(item => item.text.includes('星星×4')));
});

test('互动队列默认不设全局发送节流并保留自动发送', () => {
  assert.equal(DEFAULTS.gift.cooldownSec, 0);
  assert.equal(DEFAULTS.gift.minValue, 2);
  assert.equal(DEFAULTS.gift.mergeSec, 0);
  assert.equal('intervalSec' in DEFAULTS.sending, false);
  assert.equal('perMinute' in DEFAULTS.sending, false);
  assert.equal(DEFAULTS.mode, 'auto');
  assert.ok(DEFAULTS.gift.templates.length >= 12);
  assert.ok(DEFAULTS.welcome.templates.length >= 10);
  assert.ok(DEFAULTS.like.templates.length >= 10);
});
test('旧配置等待秒数升级清零，保留功能开关、话术、价格和 AI 额度', () => {
  const legacy = copy(DEFAULTS); legacy.version = 1;
  legacy.gift.mergeSec = 4; legacy.gift.cooldownSec = 1;
  legacy.welcome.cooldownSec = 600; legacy.keyword.cooldownSec = 60; legacy.like.cooldownSec = 60;
  legacy.ai.intervalSec = 45; legacy.ai.userCooldownSec = 120; legacy.ai.maxPerHour = 70;
  legacy.gift.prices = {'暮光恋人':1999}; legacy.gift.templates = ['感谢 {user}'];
  const config = validateConfig(mergeConfig(legacy));
  assert.equal(config.version,2);
  for (const name of ['gift','welcome','keyword','like']) assert.equal(config[name].cooldownSec,0);
  assert.equal(config.gift.mergeSec,0); assert.equal(config.ai.intervalSec,0); assert.equal(config.ai.userCooldownSec,0);
  assert.equal(config.ai.maxPerHour,70); assert.deepEqual(config.gift.prices,legacy.gift.prices);
  assert.deepEqual(config.gift.templates,legacy.gift.templates); assert.equal(config.bot.enabled,legacy.bot.enabled);
});
test('事件型回复不按用户间隔过滤，礼物默认立即进入发送队列', async () => {
  const { e } = harness(c => {
    c.keyword.enabled = true;
    c.keyword.rules = [{keywords:['你好'],reply:'你好呀',exact:false},{keywords:['在吗'],reply:'我在',exact:false}];
    c.gift.mergeSec = 0;
  });
  e.ingest({type:'chat',id:'chat-a',user:{id:'viewer',name:'观众'},text:'你好'});
  e.ingest({type:'chat',id:'chat-b',user:{id:'viewer',name:'观众'},text:'在吗'});
  assert.equal(e.queue.filter(item=>item.kind==='keyword').length,2);
  e.queue.length = 0;
  e.ingest(gift({id:'gift-now',count:1,final:false}));
  await e.tick(false);
  assert.equal(e.queue.filter(item=>item.kind==='gift').length,1);
});
test('有礼物任务时机器人消息不等待固定的三秒发送门槛', () => {
  const { e, time } = harness();
  e.enqueue('gift','感谢礼物',{giftReply:{userKey:'uid:gift',user:{name:'送礼观众'},items:[],template:'谢谢'}});
  e.enqueue('bot','接龙继续',{botUser:'uid:player'});
  const next = e.selectNextJob(e.queue,time());
  assert.equal(next.kind,'bot');
});
test('空闲 tick 不触发运行快照，未就绪队列不重建礼物索引', async () => {
  const c = copy(DEFAULTS); c.mode = 'preview';
  let time = 1800000000000, changes = 0;
  const e = new Engine({ config:c, now:()=>time, changed:()=>{ changes++; } });
  e.start(); changes = 0;
  await e.tick(); await e.tick();
  assert.equal(changes, 0, '空闲周期不应要求 UI 或持久化刷新');

  e.queue.push({id:1,kind:'welcome',text:'等待重试',priority:80,created:time,expires:time+45000,retryAt:time+60000});
  e.indexGiftJob = () => assert.fail('队列未变化时不应重建礼物索引');
  await e.tick();
  assert.equal(changes, 0);
  time += 45001; await e.tick();
  assert.equal(e.queue.length, 0);
  assert.equal(changes, 1, '实际过期清理仍通知持久化');
});
test('引擎重建后恢复游戏、礼物连击、去重记录和发送队列', () => {
  const { e, time } = harness(c => { c.bot.enabled = true; c.bot.idiomEnabled = true; });
  e.bot.startSession('idiom', '管理员', 'uid:1');
  e.bot.session.word = '一心一意'; e.bot.session.used.add('一心一意');
  e.enqueue('gift', '感谢青山的星星×2！', { giftReply:{userKey:'uid:9',user:{name:'青山'},items:[{key:'star',name:'星星',count:2,price:50}],template:'谢谢'} });
  e.ingest(gift({id:'pending-combo',count:4,final:false}));
  const restored = new Engine({config:copy(e.config),now:time});
  assert.equal(restored.restore(e.snapshot()),true);
  assert.equal(restored.bot.session.type,'idiom'); assert.equal(restored.bot.session.used.has('一心一意'),true);
  assert.equal(restored.queue.length,1); assert.equal(restored.queue[0].giftReply.items[0].count,2);
  assert.equal([...restored.gifts.values()][0].count,4); assert.equal(restored.resumeRequested,true);
  assert.equal(restored.seen.size,e.seen.size);
});
test('运行快照与恢复实例深度隔离，原地出队和重试不改变旧快照', async () => {
  const {e, time} = harness(c => { c.gift.minValue = 1; c.gift.cooldownSec = 0; });
  e.ingest(gift({final:true})); await e.tick(false);
  const original = e.snapshot(), baseline = structuredClone(original);
  assert.equal(original.gifts[0][1].due, Infinity);
  e.config.mode = 'auto'; e.send = async () => ({retryable:true});
  await e.tick(); e.ingest(gift({count:5,final:true})); await e.tick(false);
  assert.deepEqual(original, baseline);
  const left = new Engine({config:e.config,now:time}), right = new Engine({config:e.config,now:time});
  left.restore(original); right.restore(original);
  left.queue[0].giftReply.items[0].count = 999;
  left.gifts.values().next().value.user.name = 'changed';
  assert.deepEqual(original, baseline);
  assert.notEqual(right.queue[0].giftReply.items[0].count, 999);
  assert.equal(right.gifts.values().next().value.user.name, user.name);
});
test('礼物格式检查失败后重新建立索引，后续连击合并至同一任务', async () => {
  const {e} = harness(c => { c.gift.minValue = 1; });
  e.ingest(gift({final:true})); await e.tick(false);
  const queued = e.queue[0], key = queued.giftReply.userKey;
  e.config.blockedWords = [queued.text]; await e.tick();
  assert.equal(e.queue[0], queued); assert.equal(e.giftJobs.get(key).has(queued), true);
  e.config.blockedWords = []; e.ingest(gift({count:3,final:true})); await e.tick(false);
  assert.equal(e.queue.length, 1); assert.equal(e.queue[0].giftReply.items[0].count, 3);
});
test('聊天提前返回与游戏提交仍通知持久化', () => {
  const {e} = harness(c => { c.bot.enabled = true; c.bot.guessEnabled = true; });
  let persisted; e.changed = () => { persisted = e.snapshot(); };
  e.handleBot = () => { e.bot.startSession('guess', '观众', 'viewer'); };
  e.selfIdentity = {id:'10',name:'场控'};
  e.ingest({type:'chat',id:'addressed',user, text:'@场控 猜数字'});
  assert.equal(persisted.history.at(-1).text, '@场控 猜数字');
  assert.equal(persisted.bot.type, 'guess');
});
test('尚未进入点击钩子的发送快照恢复后可安全重试', async () => {
  const { e, time } = harness(); let resolveSend;
  e.config.mode = 'auto'; e.send = () => new Promise(resolve => { resolveSend = resolve; });
  e.enqueue('gift','感谢青山！',{giftReply:{userKey:'uid:9',user:{name:'青山'},items:[],template:'谢谢'}});
  const pending = e.tick();
  await new Promise(setImmediate);
  const restored = new Engine({config:copy(e.config),now:time});
  assert.equal(restored.restore(e.snapshot()),true);
  assert.equal(restored.queue.length,1); assert.equal(restored.deliveries.records[0].state,'retrying');
  resolveSend({submitted:true}); await pending;
});
test('适配器尚未返回时页面离开，保留未知状态且迟到结果不覆盖', async () => {
  const { e } = harness(c => { c.mode = 'auto'; });
  let checkpointed = false, sendCalls = 0;
  e.checkpoint = async () => { assert.equal(e.snapshot().inFlight.jobs.length,1); checkpointed = true; };
  e.send = async () => { sendCalls++; assert.equal(checkpointed,true); return {submitted:true}; };
  e.enqueue('gift','感谢支持');
  await e.tick(); assert.equal(sendCalls,1);

  e.enqueue('gift','感谢下一份支持');
  e.checkpoint = () => new Promise(() => {});
  let finish;
  e.send = () => new Promise(resolve => { finish = resolve; });
  const sending = e.tick(); await new Promise(setImmediate);
  assert.equal(sendCalls,1);
  e.stop('刷新',{preserveWork:true});
  assert.equal(e.queue.length,0); assert.equal(e.deliveries.records.at(-1).state,'unknown');
  finish({submitted:true}); await sending;
  assert.equal(e.queue.length,0); assert.equal(e.deliveries.records.at(-1).state,'unknown');
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
test('点赞感谢即时处理同一用户的连续事件，规则话术轮换且不按用户间隔过滤', async () => {
  const { e } = harness(c => { c.like.enabled = true; c.like.templates = ['谢谢 {user} 哥点赞！', '感谢 {user} 哥的赞！']; });
  e.ingest({ type: 'like', id: 'like-1', user, count: 30 });
  assert.equal(e.queue[0].text, '谢谢 青山 哥点赞！');
  e.ingest({ type: 'like', id: 'like-2', user, count: 30 });
  assert.equal(e.queue.length, 2); assert.equal(e.queue[1].text, '感谢 青山 哥的赞！');
  e.ingest({ type: 'like', id: 'like-3', user, count: 20 });
  assert.equal(e.queue.length, 3); assert.match(e.queue[2].text,/点赞|的赞/u);
});
test('点赞 AI 生成失败时回退到轮换话术，不需要人工审核', async () => {
  const { e } = harness(c => { c.ai.enabled = true; c.like.enabled = true; c.like.responseMode = 'ai'; });
  e.ai = async () => { throw new Error('offline'); };
  e.ingest({ type: 'like', id: 'like-ai', user, count: 12 }); await new Promise(setImmediate);
  assert.equal(e.queue.length, 1); assert.equal(e.queue[0].kind, 'like'); assert.equal(e.queue[0].approved, undefined);
  assert.match(e.queue[0].text, /青山.*赞/);
});
test('礼物 AI 关闭或不可用时使用轮换规则话术兜底', async () => {
  const { e, logs } = harness(c => { c.gift.responseMode = 'ai'; c.gift.minValue = 50; c.gift.templates = ['感谢 {user} 哥送的 {gift}']; });
  e.ingest(gift({ final: true })); await e.tick();
  assert.ok(logs.some(item => item.category === 'preview' && /青山\s*哥送的\s*星星/.test(item.text)));
});
test('旧版定时配置迁移为规则话术模式', () => {
  const old = mergeConfig({ timers: [{ id: 'old', enabled: false, intervalSec: 300, start: '', end: '', quietSec: 15, messages: [] }] });
  assert.equal(old.timers[0].responseMode, 'rules');
  assert.equal(old.timersEnabled, false);
  assert.equal(mergeConfig({ timers: [{ id: 'old', enabled: true, intervalSec: 300, start: '', end: '', quietSec: 15, messages: ['hello'] }] }).timersEnabled, true);
});

test('欢迎必须同时满足荣誉等级、本主播粉丝团和点亮状态', () => {
  const c = copy(DEFAULTS); c.mode = 'preview'; c.anchorId = '1234567890';
  assert.equal(welcomeDecision(user, c).pass, true);
  for (const u of [{ ...user, wealthLevel: null }, { ...user, wealthLevel: 29 }, { ...user, fanClubs: [] }, { ...user, fanClubs: [{ anchorId: 'other', level: 30, status: 1 }] }, { ...user, fanClubs: [{ anchorId: c.anchorId, level: 8, status: 2 }] }, { ...user, fanClubs: [{ anchorId: c.anchorId, level: 8, status: null }] }]) assert.equal(welcomeDecision(u, c).pass, false);
  c.anchorId = ''; assert.equal(welcomeDecision(user, c).pass, false);
});

test('管理员弹幕欢迎必须启用并同时满足荣誉与本房粉丝团门槛', () => {
  const config = copy(DEFAULTS); config.anchorId = '1234567890';
  const e = new Engine({ config });
  e.config.welcome.admin.enabled = true; e.config.welcome.admin.minWealth = 60; e.config.welcome.admin.minFanLevel = 1;
  const qualified = {wealthLevel:60,fanClubs:[{anchorId:config.anchorId,level:1,status:1}]};
  assert.equal(e.welcomeChannel({...qualified,wealthLevel:59}), 'chat');
  assert.equal(e.welcomeChannel({...qualified,wealthLevel:null}), 'chat');
  assert.equal(e.welcomeChannel({...qualified,fanClubs:[]}), 'chat');
  assert.equal(e.welcomeChannel({...qualified,fanClubs:[{anchorId:'other',level:8,status:1}]}), 'chat');
  assert.equal(e.welcomeChannel({...qualified,fanClubs:[{anchorId:config.anchorId,level:1,status:2}]}), 'chat');
  assert.equal(e.welcomeChannel(qualified), 'admin');
});
test('管理员欢迎等级不得低于基础欢迎；旧配置补齐灯牌下限', () => {
  const c = copy(DEFAULTS); c.welcome.admin.enabled = true;
  c.welcome.minWealth = 61; assert.throws(()=>validateConfig(c), /不能低于基础欢迎/);
  c.welcome.admin.minWealth = 61; c.welcome.minFanLevel = 9; assert.throws(()=>validateConfig(c), /灯牌.*不能低于基础欢迎/);
  c.welcome.admin.minFanLevel = 9; assert.equal(validateConfig(c), c);
  const old = mergeConfig({ welcome:{minWealth:70,minFanLevel:10,admin:{enabled:true,minWealth:60}} });
  assert.equal(old.welcome.admin.minWealth,70); assert.equal(old.welcome.admin.minFanLevel,10); validateConfig(old);
});
test('排队的管理员欢迎在发送时重新核验新门槛', async () => {
  const {e} = harness(c=>{c.mode='auto';c.welcome.admin={enabled:true,minWealth:35,minFanLevel:8};});
  let channel; e.send = async (_text,_current,options)=>{channel=options.channel;return {submitted:true};};
  e.ingest({type:'enter',id:'admin-welcome',user}); assert.equal(e.queue[0].channel,'admin');
  e.config.welcome.admin.minFanLevel = 9;
  await e.tick(); assert.equal(channel,'chat');
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
  const { e: total } = harness(c => { c.gift.minValue = 100; }); total.ingest(gift({ count: 3, final: true })); await total.tick(); assert.equal(total.stats.previews, 1);
  const { e: unit } = harness(c => { c.gift.basis = 'unit'; c.gift.minValue = 100; }); unit.ingest(gift({ count: 3, final: true })); await unit.tick(); assert.equal(unit.stats.previews, 0);
});
test('礼物事件缺少昵称但有用户标识时仍会生成通用感谢', async () => {
  const { e, logs } = harness();
  e.config.gift.minValue = 0;
  e.ingest({type:'gift',id:'nameless-gift',user:{id:'viewer-20'},giftId:'rose',giftName:'玫瑰',unitValue:1,count:1,final:true});
  await e.tick();
  assert.equal(e.stats.previews,1);
  assert.ok(logs.some(item => /观众.*玫瑰/.test(item.text)));
});
test('未知礼物单价跳过，补价格表可恢复', async () => {
  const a = harness(); a.e.ingest(gift({ unitValue: null, count: 3, final: true })); await a.e.tick(); assert.equal(a.e.stats.previews, 0);
  const b = harness(c => { c.gift.prices = { '123': 50 }; }); b.e.ingest(gift({ unitValue: null, count: 3, final: true })); await b.e.tick(); assert.equal(b.e.stats.previews, 1);
});
test('先出现低价子连击，稍后累积达标仍感谢累计价值', async () => {
  const { e, advance, logs } = harness(c => { c.gift.minValue = 100; });
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
test('实时大礼物以 socket 收到时间为准，不因平台礼物时间偏差漏掉感谢', async () => {
  const { e, time, logs } = harness();
  const now = time();
  e.ingest(gift({id:'twilight-lover',giftName:'暮光恋人',unitValue:11999,count:1,final:true,at:now-120000,receivedAt:now}));
  await e.tick();
  assert.equal(e.stats.previews,1);
  assert.ok(logs.some(item=>item.category==='preview' && item.text.includes('暮光恋人×1，11999钻石')));
});
test('两笔亲吻各一份的平台时间偏差不漏感谢，重复推送不增加数量', async () => {
  const { e, time, logs } = harness();
  const now = time();
  for (const [index, skew] of [-120000, 120000].entries()) {
    const event = gift({id:`kiss-${index}`,user:{id:'kiss-viewer',name:'( ✘_✘ )↯'},giftName:'亲吻',unitValue:99,count:1,groupId:`single:kiss-${index}`,final:true,source:'socket',at:now+skew,receivedAt:now});
    e.ingest(event); e.ingest(event);
  }
  await e.tick();
  assert.equal(e.stats.previews,1);
  assert.equal(logs.find(item=>item.category==='preview')?.text,'( ✘_✘ )↯：亲吻×2，198钻石');
  assert.equal(e.stats.filtered,0);
});
test('逐个点击的小心心按用户与礼物短窗口累计，延迟帧与重复帧不刷感谢', async () => {
  const {e, advance, logs} = harness();
  const single = (id, at, extra = {}) => gift({id, giftId:'heart',giftName:'小心心',unitValue:1,count:1,groupId:`single:${id}`,final:true,receivedAt:at,...extra});
  const start = 1800000000000;
  e.ingest(single('heart-1',start));
  advance(700); e.ingest(single('heart-2',start+700));
  advance(600); e.ingest(single('heart-1',start,{count:1})); // 重复延迟帧
  advance(700); e.ingest(single('heart-3',start+2000));
  advance(1999); await e.tick(); assert.equal(e.stats.previews,0);
  advance(1); await e.tick();
  assert.equal(e.stats.previews,1);
  assert.match(logs.find(item=>item.category==='preview').text,/小心心×3，3钻石/);
  assert.equal([...e.gifts.values()][0].count,3);
});
test('单独礼物的累计进度乱序不回退，静默窗口后新点击可以再次结算', async () => {
  const {e, advance, logs} = harness();
  const one = (id, count = 1) => gift({id, giftId:'heart',giftName:'小心心',unitValue:1,count,groupId:`single:${id}`,final:true});
  e.ingest(one('heart-combo',2)); advance(100); e.ingest(one('heart-combo',1));
  e.ingest(one('heart-2')); advance(2000); await e.tick();
  assert.equal(e.stats.previews,1);
  assert.match(logs.find(item=>item.category==='preview').text,/小心心×3，3钻石/);
  e.ingest(one('heart-3')); advance(2000); await e.tick();
  assert.equal(e.stats.previews,2);
});
test('礼物捕获时间超过十分钟仍拒绝补发，缺少捕获时间不豁免历史检查', async () => {
  for (const receipt of ['stale','missing']) {
    const { e, time } = harness();
    e.ingest(gift({id:receipt,at:time()-600000,receivedAt:receipt==='stale' ? time()-600000 : undefined,final:true}));
    await e.tick();
    assert.equal(e.stats.previews,0,receipt);
    assert.equal(e.gifts.size,0,receipt);
    assert.equal(e.stats.filtered,1,receipt);
  }
});
test('自己的点赞与送礼事件不生成回复也不进入礼物累计', () => {
  const { e } = harness(c => { c.selfId = user.id; c.like.enabled = true; });
  e.ingest({ type: 'like', id: 'self-like', user, count: 30 });
  e.ingest(gift({ id: 'self-gift', final: true, count: 3 }));
  assert.equal(e.queue.length, 0);
  assert.equal(e.gifts.size, 0);
  assert.equal(e.stats.filtered, 2);

  const identified = harness(c => { c.like.enabled = true; });
  identified.e.setIdentity({ self: { id: user.id, name: '场控账号' } });
  identified.e.ingest({ type: 'like', id: 'identified-self-like', user, count: 10 });
  assert.equal(identified.e.queue.length, 0);
});
test('礼物优先出队，普通任务连续发送且过期消息清理', async () => {
  const { e, advance, logs } = harness();
  e.enqueue('timer', '定时提醒'); e.enqueue('welcome', '欢迎青山'); e.enqueue('gift', '感谢礼物');
  await e.tick(); assert.equal(logs.find(l => l.category === 'preview').text, '感谢礼物');
  await e.tick(); assert.equal(logs.find(l => l.category === 'preview' && l.text === '欢迎青山')?.text, '欢迎青山');
  await e.tick(); assert.equal(e.stats.previews, 3);
  e.enqueue('welcome', '过期欢迎'); advance(46000); await e.tick();
  assert.equal(e.queue.length, 0); assert.equal(e.stats.expired, 1);
});
test('自动发送直接提交；旧审核配置迁移为自动发送', async () => {
  const { e, sent } = harness(c => { c.mode = 'auto'; }); e.enqueue('ai', '欢迎大家'); await e.tick(); assert.deepEqual(sent, ['欢迎大家']);
  assert.equal(mergeConfig({ mode: 'review' }).mode, 'auto');
  assert.throws(() => validateConfig({ ...copy(DEFAULTS), mode: 'review' }), /发送模式无效/);
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
  const { e, logs, advance } = harness(c => { c.keyword.enabled = false; c.moderation.enabled = true; c.moderation.threshold = 2; c.moderation.windowSec = 60; });
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

  const timer = harness(c => { c.ai.enabled = true; c.timersEnabled = true; c.timers[0].enabled = true; c.timers[0].responseMode = 'ai'; c.timers[0].intervalSec = 30; });
  timer.e.ai = async value => { prompt = value; return '喜欢的话点点关注，一起聊聊吧！'; };
  await timer.e.tick(); timer.advance(31000); await timer.e.tick(); await new Promise(setImmediate);
  assert.equal(prompt.task.kind, 'timer'); assert.equal(timer.e.queue[0].kind, 'timer');
});
test('定时任务跨午夜、优先避让互动、恢复后台不补发', async () => {
  assert.equal(inTimeWindow('22:00', '02:00', Date.parse('2026-10-14T23:00:00+08:00')), true);
  assert.equal(inTimeWindow('22:00', '02:00', Date.parse('2026-10-14T12:00:00+08:00')), false);
  const { e, advance } = harness(c => { c.timersEnabled = true; c.timers[0].enabled = true; c.timers[0].intervalSec = 30; });
  await e.tick(); advance(31000); e.ingest({ type: 'chat', user, text: '你好' }); await e.tick(); assert.equal(e.stats.previews, 0);
  advance(600000); await e.tick(); assert.equal(e.stats.previews, 1); await e.tick(); assert.equal(e.stats.previews, 1);
});
test('旧版全局发送限速配置被忽略，配置不携带未知密钥', () => {
  const migrated = mergeConfig({ sending: { intervalSec: 0.5, perMinute: 120 } });
  assert.equal('intervalSec' in migrated.sending, false);
  assert.equal('perMinute' in migrated.sending, false);
  assert.doesNotThrow(() => validateConfig(migrated));
  assert.throws(() => validateConfig(mergeConfig({ gift: { prices: { x: '100' } } })));
  assert.throws(() => mergeConfig({ mode: false }));
  const config = mergeConfig(JSON.parse('{"__proto__":{"polluted":true},"apiKey":"secret","mode":"preview"}'));
  assert.equal(config.apiKey, undefined); assert.equal({}.polluted, undefined);
});
test('发送失败不主动暂停并保留任务；真实发送中的手动暂停令取消函数失效', async () => {
  const { e } = harness(c => { c.mode = 'auto'; }); e.send = async () => { throw new Error('不可用'); }; e.enqueue('gift', '感谢'); await e.tick(); assert.equal(e.running, true);
  assert.equal(e.queue.length, 1); assert.equal(e.queue[0].text, '感谢');
  const b = harness(c => { c.mode = 'auto'; }); let finish;
  b.e.send = async (text, current) => { await new Promise(r => { finish = r; }); assert.equal(current(), false); return { submitted: false }; };
  b.e.enqueue('gift', '感谢'); const task = b.e.tick(); await new Promise(setImmediate); b.e.stop(); finish(); await task; assert.equal(b.e.stats.submitted, 0);
});

test('没有全局间隔或每分钟上限，接受的消息可连续出队且默认自动发送',async()=>{
  const sent=[],e=new Engine({config:mergeConfig({selfId:'10'}),now:()=>100000,send:async (text,current,hooks)=>{await hooks.beforeClick();sent.push(text);e.observeEcho({type:'chat',source:'socket',user:{id:'10'},text,receivedAt:100000});return {submitted:true};}});
  e.start();for(let n=0;n<130;n++)e.enqueue('gift',`感谢支持 ${n}`);
  for(let n=0;n<130;n++)await e.tick();
  assert.equal(sent.length,130);assert.equal(e.queue.length,0);assert.equal(e.stats.submitted,130);assert.equal(e.stats.previews,0);
});

test('历史下播和新下播事件都不会主动暂停场控', () => {
  const {e,time}=harness();let stops=0;e.onStop=()=>stops++;
  e.ingest({type:'end',at:time()-31000});assert.equal(e.running,true);assert.equal(stops,0);
  e.ingest({type:'end',at:time()});assert.equal(e.running,true);assert.equal(stops,0);
  e.ingest({type:'end'});assert.equal(stops,0);
});
test('旧发送任务迟到的失败或成功不会暂停新一轮，也不写入新一轮提交记录', async () => {
  for(const fail of [true,false]) {
    const {e,logs}=harness(c=>c.mode='auto');let resolve,reject;
    e.send=()=>new Promise((yes,no)=>{resolve=yes;reject=no;});e.enqueue('gift','谢谢支持');const sending=e.tick();await new Promise(setImmediate);
    e.stop();e.start();e.enqueue('gift','新一轮礼物');
    if(fail)reject(new Error('旧任务失败'));else resolve({submitted:true});await sending;
    assert.equal(e.running,true);assert.equal(e.queue.length,2);assert.equal(e.stats.submitted,0);
    assert.equal(logs.some(l=>l.category==='error'||l.category==='sent'),false);assert.equal(e.busy,false);
  }
});

test('礼物高峰按用户合并并在可重试发送失败时保留任务', async () => {
  const { e, advance, logs } = harness(c => {
    c.gift.cooldownSec = 0;
    c.gift.batchEnabled = true;
  });
  const users = Array.from({ length: 8 }, (_, i) => ({ id: `peak-${i}`, name: `观众${i}` }));
  for (const [i, viewer] of users.entries()) e.ingest(gift({ id: `peak-${i}`, user: viewer, giftId: `gift-${i % 2}`, giftName: i % 2 ? '小星星' : '小心心', unitValue: 100, count: 1, final: true }));
  await e.tick();
  assert.equal(e.stats.previews, 1);
  assert.match(logs.find(item => item.category === 'preview').text, /观众0/);
  advance(300); await e.tick();
  assert.equal(e.stats.previews, 2);
  assert.ok(e.queue.length < users.length, '高峰应合并成较少的感谢任务');

  const retry = harness(c => { c.mode = 'auto'; c.gift.cooldownSec = 0; });
  retry.e.send = async () => ({ submitted: false, retryable: true, reason: '控件暂时不可用' });
  retry.e.ingest(gift({ final: true, unitValue: 100 })); await retry.e.tick();
  assert.equal(retry.e.running, true);
  assert.equal(retry.e.queue.length, 1);
  assert.equal(retry.e.stats.submitted, 0);
});

test('礼物连击使用短静默窗口，最长聚合不超过三秒', async () => {
  const { e, advance } = harness(c => { c.gift.mergeSec = 4; });
  e.ingest(gift({ id: 'quiet-1', count: 1, unitValue: 100, final: false }));
  advance(1499); await e.tick(); assert.equal(e.stats.previews, 0);
  advance(1); await e.tick(); assert.equal(e.stats.previews, 1);
  const b = harness(c => { c.gift.mergeSec = 20; });
  b.e.ingest(gift({ id: 'window-1', count: 1, unitValue: 100, final: false }));
  b.advance(1499); await b.e.tick(); assert.equal(b.e.stats.previews, 0);
  b.advance(1); await b.e.tick(); assert.equal(b.e.stats.previews, 1);
  const max = harness(c => { c.gift.mergeSec = 20; });
  max.e.ingest(gift({ id: 'window-max-1', count: 1, unitValue: 100, final: false }));
  max.advance(1000); max.e.ingest(gift({ id: 'window-max-2', count: 2, unitValue: 100, final: false }));
  max.advance(1000); max.e.ingest(gift({ id: 'window-max-3', count: 3, unitValue: 100, final: false }));
  max.advance(999); await max.e.tick(); assert.equal(max.e.stats.previews, 0);
  max.advance(1); await max.e.tick(); assert.equal(max.e.stats.previews, 1);
});

test('高并发礼物帧全部累计并最终进入感谢队列', async () => {
  const { e, advance } = harness(c => { c.gift.cooldownSec = 0; });
  const total = 1200;
  for (let i = 0; i < total; i++) {
    e.ingest(gift({
      id: `burst-${i}`,
      user: { id: `burst-user-${i}`, name: `观众${i}` },
      giftId: `burst-gift-${i}`,
      giftName: '星星',
      unitValue: 100,
      count: 1,
      final: true
    }));
  }
  assert.equal(e.gifts.size, total);
  assert.equal([...e.gifts.values()].reduce((sum, state) => sum + state.count, 0), total);
  await e.tick();
  assert.equal([...e.gifts.values()].reduce((sum, state) => sum + state.credited, 0), total);
  for (let i = 0; i < 800 && e.queue.length; i++) {
    advance(501);
    await e.tick();
  }
  assert.equal(e.queue.length, 0);
  assert.ok(e.stats.previews > 0);
});

test('礼物在普通队列达到上限时仍进入高优先级通道', () => {
  const { e } = harness(c => { c.sending.queueLimit = 1; });
  assert.equal(e.enqueue('bot', '菜单'), true);
  assert.equal(e.enqueue('gift', '感谢礼物'), true);
  assert.equal(e.queue.filter(item => item.kind === 'gift').length, 1);
});

test('未知价格不会每 500 毫秒忙循环，后续收到累计帧仍可结算', async () => {
  const { e, advance } = harness();
  e.ingest(gift({ unitValue: null, count: 1, final: true })); await e.tick();
  assert.equal(e.stats.previews, 0);
  const state = [...e.gifts.values()][0]; assert.equal(state.due, Infinity);
  advance(60000); await e.tick(); assert.equal(e.stats.previews, 0);
  e.ingest(gift({ unitValue: 100, count: 2, final: true })); await e.tick();
  assert.equal(e.stats.previews, 1);
});

test('礼物感谢在长时间断线期间不会过期，恢复后仍会发送', async () => {
  const { e, advance } = harness(c => { c.mode = 'auto'; c.gift.cooldownSec = 0; });
  let available = false;
  e.ingest(gift({ final: true, count: 3 }));
  await e.tick(available);
  assert.equal(e.queue.length, 1);
  advance(180000);
  await e.tick(available);
  assert.equal(e.queue.length, 1);
  e.send = async () => ({ submitted: true });
  available = true;
  await e.tick(available);
  assert.equal(e.queue.length, 0);
  assert.equal(e.stats.submitted, 1);
});

test('同一观众送多种礼物时降为总量感谢，最短字数限制下也不会丢队列', async () => {
  const { e, logs } = harness(c => { c.gift.cooldownSec = 0; c.sending.maxLength = 10; });
  for (let i = 0; i < 30; i++) e.ingest(gift({ id: `variety-${i}`, giftId: `variety-${i}`, giftName: `很长的礼物名称${i}`, unitValue: 100, final: true }));
  await e.tick();
  assert.equal(e.stats.previews, 1);
  assert.equal(e.queue.length, 0);
  assert.ok([...logs.find(item => item.category === 'preview').text].length <= 10);
  assert.ok([...e.gifts.values()].every(state => state.credited === 1));
});

test('按单价门槛过滤的礼物不忙循环；可重试异常退避后只成功发送一次', async () => {
  const low = harness(c => { c.gift.basis = 'unit'; c.gift.minValue = 100; });
  low.e.ingest(gift({ unitValue: 10, final: true, count: 100 })); await low.e.tick();
  assert.equal([...low.e.gifts.values()][0].due, Infinity);

  const { e, advance } = harness(c => { c.mode = 'auto'; c.gift.cooldownSec = 0; });
  let calls = 0;
  e.send = async () => { if (++calls < 3) throw Object.assign(new Error('按钮暂时缺失'), { retryable: true }); return { submitted: true }; };
  e.ingest(gift({ final: true, count: 3 }));
  await e.tick(); assert.equal(e.running, true); assert.equal(calls, 1);
  advance(499); await e.tick(); assert.equal(calls, 1);
  advance(1); await e.tick(); assert.equal(calls, 2);
  advance(999); await e.tick(); assert.equal(calls, 2);
  advance(1); await e.tick(); assert.equal(calls, 3);
  assert.equal(e.stats.submitted, 1); assert.equal(e.queue.length, 0);
});
