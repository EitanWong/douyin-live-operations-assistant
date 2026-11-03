import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, DEFAULTS, copy, mergeConfig, validateConfig } from '../../src/core/engine.js';
import { addressedToSelf, RoomBot, BOT_COMMANDS } from '../../src/core/bot.js';

const self = {id:'100',secUid:'sec-self',name:'小明'};
const viewer = {id:'200',name:'观众'};
function fixture(change = () => {}) {
  let now = 1800000000000;
  const config = copy(DEFAULTS); config.mode = 'preview'; config.bot.enabled = true; change(config);
  const logs = [], sent = [];
  const engine = new Engine({config, now:()=>now, random:()=>0, log:(kind,text)=>logs.push({kind,text}), send:async text=>{sent.push(text);return {submitted:true};}});
  engine.setIdentity({self}); engine.start();
  let serial = 0;
  return {engine, logs, sent, advance:ms=>{now+=ms;}, now:()=>now,
    chat:(text, extra={})=>engine.ingest({type:'chat',id:String(++serial),user:viewer,text,...extra})};
}

test('抽奖口令不会触发进行中的猜数字，普通猜测仍可正常参与',()=>{
  const f=fixture();f.chat('@小明 开始猜数字');
  const target=f.engine.bot.session.target, before=f.engine.queue.length;
  f.engine.ingest({type:'chat',id:'lottery',user:viewer,text:String(target)},{giveawayChat:true});
  assert.equal(f.engine.bot.session.type,'guess');assert.equal(f.engine.queue.length,before);
  f.chat(String(target));assert.equal(f.engine.bot.session,null);assert.match(f.engine.queue.at(-1).text,/猜中啦/);
});

test('抽奖口令不触发关键词或 AI，其他弹幕仍可触发各自回复',()=>{
  const f=fixture(c=>{c.bot.enabled=false;c.keyword.enabled=true;c.keyword.rules=[{keywords:['抽奖'],exact:false,reply:'关键词回复'}];c.ai.enabled=true;c.ai.chatEnabled=true;});
  const prompts=[];f.engine.ai=prompt=>{prompts.push(prompt);return new Promise(()=>{});};
  f.engine.ingest({type:'chat',id:'lottery-keyword',user:viewer,text:'参与抽奖'},{giveawayChat:true});
  assert.equal(f.engine.queue.length,0);assert.equal(prompts.length,0);
  f.chat('询问抽奖');assert.equal(f.engine.queue.at(-1).kind,'keyword');
  f.engine.config.keyword.enabled=false;
  f.engine.ingest({type:'chat',id:'lottery-ai',user:viewer,text:'参与抽奖'},{giveawayChat:true});
  assert.equal(prompts.length,0);
  f.chat('今天直播什么');assert.equal(prompts.length,1);
});

test('@ 文本完整匹配，UID 优先，不误回同名前缀或其他被 @ 账号', () => {
  for (const text of ['@小明 菜单','@小明\u2005菜单','@小明：菜单']) assert.equal(addressedToSelf({text},self),'菜单');
  assert.equal(addressedToSelf({text:'@小明同学 菜单'},self),null);
  assert.equal(addressedToSelf({text:'前缀@小明 菜单'},self),null);
  assert.equal(addressedToSelf({text:'@小明 菜单',mentions:['300']},self),null);
  assert.equal(addressedToSelf({text:'@小明 菜单',mentions:['100']},self),'菜单');
  assert.equal(addressedToSelf({text:'@场控 菜单',mentions:['100']},null,'100'),'菜单');
  assert.equal(addressedToSelf({text:'@小明 菜单'},self,'300'),null);
  assert.equal(addressedToSelf({text:'@小明 菜单',mentions:['sec-self']},self),'菜单');
});

test('旧配置升级保留机器人默认关闭，子功能和间隔类型均校验', () => {
  const config = mergeConfig({gift:{minValue:2}});
  assert.equal(config.bot.enabled,false); assert.equal(config.gift.minValue,2);
  assert.throws(()=>validateConfig({...config,bot:{...config.bot,guessEnabled:'yes'}}),/机器人/);
  assert.equal(mergeConfig({bot:{...config.bot,cooldownSec:3}}).bot.cooldownSec,undefined);
  const upgraded=mergeConfig({bot:{enabled:true,diceEnabled:true,coinEnabled:true,rpsEnabled:true,choiceEnabled:true,idiomEnabled:false}});
  for (const key of ['diceEnabled','coinEnabled','rpsEnabled','choiceEnabled']) assert.equal(Object.hasOwn(upgraded.bot,key),false);
  assert.equal(upgraded.bot.enabled,true);
  assert.equal(upgraded.bot.idiomEnabled,false);
});

test('不开启模块、未识别账号、自己或忽略用户均不触发机器人', () => {
  const {engine,chat} = fixture(c=>{c.bot.enabled=false;}); chat('@小明 菜单'); assert.equal(engine.queue.length,0);
  engine.config.bot.enabled=true; engine.setIdentity({}); chat('@小明 菜单'); assert.equal(engine.queue.length,0);
  engine.setIdentity({self}); chat('@小明 菜单',{user:self}); assert.equal(engine.queue.length,0);
  engine.config.ignored=['uid:200'];chat('@小明 菜单');assert.equal(engine.queue.length,0);
});

test('互动指令优先于关键词和普通聊天，同一条帧只运行一次并请求 AI', () => {
  const {engine,chat} = fixture(c=>{c.ai.enabled=true;c.ai.chatEnabled=true;c.keyword.enabled=true;});
  engine.ai=async()=> '说说你的故事吧！';
  chat('@小明 真心话',{id:'one'});chat('@小明 真心话',{id:'one'});
  assert.equal(engine.queue.length,1);assert.equal(engine.queue[0].kind,'bot');assert.ok(engine.queue[0].text.includes(engine.bot.session.prompt));
  assert.equal(engine.stats.aiCalls,1);
});

test('菜单本地响应，@普通聊天交给 AI；AI 服务关闭时未知文本静默', async () => {
  const {engine,chat} = fixture(c=>{c.ai.enabled=true;});
  const prompts=[]; let finish;
  engine.ai=prompt=>{prompts.push(prompt); return new Promise(resolve=>{finish=resolve;});};
  chat('@小明 随便聊聊');
  assert.equal(prompts.length,1);
  assert.equal(prompts[0].task.data.replyMode,'direct');
  chat('@小明 菜单');
  assert.equal(engine.queue.length,1);
  assert.match(engine.queue[0].text,/🎮菜单/);
  finish('好呀，想聊什么？'); await new Promise(setImmediate);
  assert.equal(engine.queue.length,2);
  assert.equal(engine.queue.filter(item=>item.kind==='bot').length,1);
  const quiet=fixture();
  quiet.chat('@小明'); quiet.chat('@小明 随便聊聊');
  assert.equal(quiet.engine.stats.aiCalls,0);
  assert.equal(quiet.engine.queue.length,0);
});

test('菜单按开关生成，最短字数限制下可翻页，不列出禁用玩法', () => {
  const config = copy(DEFAULTS.bot);config.truthEnabled=false;config.dareEnabled=false;
  const bot = new RoomBot();
  assert.doesNotMatch(bot.menu(config,50),/真心话|大冒险/);
  const pages = Array.from({length:4},(_,i)=>bot.reply(`菜单 ${i+1}`,config,10,'非常长的观众昵称').text);
  assert.ok(pages.every(text=>[...text].length<=10));assert.ok(pages.some(text=>text.includes('接龙')));
  assert.match(bot.reply('猜数字',{...config,guessEnabled:false},50,'观众').text,/已关闭/);
});

test('移除一次性随机玩法及全部别名，旧开关也无法重新启用本地游戏', () => {
  const {engine,chat}=fixture(c=>{Object.assign(c.bot,{diceEnabled:true,coinEnabled:true,rpsEnabled:true,choiceEnabled:true});});
  engine.ai=async()=>assert.fail('已移除的玩法不调用AI');
  for (const command of ['骰子','掷骰子','roll','硬币','抛硬币','coin','猜拳 石头','石头剪刀布','rps rock','选择 唱歌/聊天','帮我选 唱歌/聊天','choose a/b']) chat(`@小明 ${command}`);
  assert.equal(engine.queue.length,0);
  assert.equal(engine.bot.session,null);
  assert.equal(engine.stats.aiCalls,0);
  assert.deepEqual(BOT_COMMANDS.map(item=>item.key),['idiomEnabled','guessEnabled','truthEnabled','dareEnabled']);
});

test('猜数字是房间级会话且可免 @ 参与', () => {
  const f = fixture();
  f.chat('@小明 开始猜数字', { user:{id:'host-user',name:'主持观众'} });
  assert.equal(f.engine.bot.session?.type, 'guess');
  const target = f.engine.bot.session.target;
  f.chat(String(target), { user:{id:'guess-user',name:'猜谜观众'} });
  assert.equal(f.engine.bot.session, null);
  assert.match(f.engine.queue.at(-1).text, /猜中啦/);
});

test('猜数字六次未中结束，关闭新玩法后不生成回复', () => {
  const f = fixture(c => { c.bot.guessEnabled = true; });
  f.chat('@小明 开始猜数字', { user:{id:'host-user',name:'主持观众'} });
  const target = f.engine.bot.session.target;
  const wrong = target === 1 ? 2 : 1;
  for (let i = 0; i < 6; i++) f.chat(String(wrong), { user:{id:`guess-${i}`,name:`观众${i}`} });
  assert.equal(f.engine.bot.session, null);
  assert.match(f.engine.queue.at(-1).text, /本局结束/);

  const closed = fixture(c => { c.bot.guessEnabled = false; });
  closed.chat('@小明 开始猜数字', { user:{id:'closed-user',name:'观众'} });
  assert.equal(closed.engine.queue.length, 1);
  assert.match(closed.engine.queue[0].text, /已关闭/);
});

test('机器人菜单使用短 emoji，并在分页时引导下一页', () => {
  const bot = new RoomBot();
  const config = copy(DEFAULTS.bot);
  const text = bot.menu(config, 50);
  assert.match(text, /🎮菜单/);
  assert.match(text, /接龙.*猜数字.*真心话.*大冒险.*开始接龙/);
  assert.ok([...text].length <= 50);
  const page = bot.menu(config, 22, 1);
  assert.ok([...page].length <= 22);
  assert.match(page, /菜单2|菜单/);
  const truthOnly={truthEnabled:true};
  assert.match(bot.menu(truthOnly,50),/发「开始真心话」/);
  assert.doesNotMatch(bot.menu(truthOnly,50),/接龙|猜数字|大冒险/);
});

test('同一观众没有互动秒数冷却，但未发送的互动不重复排队', async () => {
  const {engine,chat} = fixture();
  chat('@小明 菜单');chat('@小明 菜单');assert.equal(engine.queue.length,1);
  await engine.tick();
  chat('@小明 菜单');assert.equal(engine.queue.length,1);
  chat('@小明 菜单',{user:{id:'300',name:'观众'}});assert.equal(engine.queue.length,2);
});

test('随机起始成语保证可接续，游戏入队失败不推进状态且接龙不会超时结束', async () => {
  const {engine,chat,advance} = fixture();
  chat('@小明 接龙');assert.match(engine.queue[0].text,/一心一意/);await engine.tick();advance(4000);
  chat('@小明 接龙 意气风发');assert.equal(engine.bot.chain.word,'意气风发');await engine.tick();advance(4000);
  chat('@小明 接龙 你好世界');assert.match(engine.queue[0].text,/未在成语词典收录/);assert.equal(engine.bot.chain.word,'意气风发');await engine.tick();advance(4000);
  chat('@小明 接龙 一心一意');assert.match(engine.queue[0].text,/已用过/);await engine.tick();advance(4000);
  engine.config.sending.queueLimit=1;engine.enqueue('gift','谢谢礼物');
  chat('@小明 接龙 发扬光大');assert.equal(engine.bot.chain.word,'意气风发');
  await engine.tick();advance(4000);chat('@小明 接龙 发扬光大');assert.equal(engine.bot.chain.word,'发扬光大');
  await engine.tick();advance(300001);chat('@小明 接龙');assert.match(engine.queue[0].text,/当前词「发扬光大」/);assert.equal(engine.bot.session?.word,'发扬光大');
  engine.stop();assert.equal(engine.bot.chain,null);
});

test('每局随机抽取词库中的可接续成语', () => {
  const bot = new RoomBot({random:()=>0.75});
  bot.startSession('idiom');
  assert.notEqual(bot.session.word,'一心一意');
  assert.equal(bot.session.used.has(bot.session.word),true);
});

test('只需 @ 一次启动接龙；之后所有观众无需 @，同音成语都能接续', () => {
  const {engine,chat} = fixture();
  chat('@小明 开始成语接龙',{user:{id:'300',name:'主持观众'}});
  assert.equal(engine.bot.session?.type,'idiom');
  chat('以德报怨',{user:{id:'301',name:'第一位玩家'}});
  assert.equal(engine.bot.session?.word,'以德报怨');
  chat('怨天尤人',{user:{id:'302',name:'第二位玩家'}});
  assert.equal(engine.bot.session?.word,'怨天尤人');
  assert.ok(engine.queue.some(job=>/以德报怨/.test(job.text)));
  assert.ok(engine.queue.some(job=>/怨天尤人/.test(job.text)));
});

test('明确开局无需 @，优先于普通聊天，AI 接话不重复开局', () => {
  for (const [command,type] of [['开始成语接龙','idiom'],['开始接龙','idiom'],['开始猜数字','guess'],['开始真心话','truth'],['开始大冒险','dare']]) {
    const {engine,chat} = fixture(c=>{
      c.keyword.enabled=true;c.keyword.rules=[{keywords:[command],reply:'关键词回复',exact:true}];
      c.ai.enabled=true;c.ai.chatEnabled=true;c.ai.trigger='all';
    });
    engine.ai=async()=> '欢迎来玩！';
    chat(command,{id:'start',user:{id:'301',name:'一只开心🎀'}});
    const session = engine.bot.session;
    assert.equal(session?.type,type);
    assert.equal(session.startedBy,'301');
    assert.equal(engine.queue.length,1);
    assert.equal(engine.queue[0].kind,'bot');
    assert.match(engine.queue[0].text,/开始/u);
    chat(command,{id:'start',user:{id:'301',name:'一只开心🎀'}});
    chat(command,{user:{id:'301',name:'一只开心🎀'}});
    assert.equal(engine.bot.session,session);
    assert.equal(engine.queue.length,1);
  }
});

test('成语接龙持续运行，直到主持人明确结束', async () => {
  for (const expireWithTick of [false,true]) {
    const {engine,chat,advance} = fixture();
    chat('@小明 开始成语接龙');
    await engine.tick();
    const previous = engine.bot.session;
    advance(300001);
    if (expireWithTick) await engine.tick();
    assert.equal(engine.bot.session,previous);
    chat('开始成语接龙',{user:{id:'301',name:'一只开心🎀'}});
    assert.equal(engine.bot.session?.type,'idiom');
    assert.equal(engine.bot.session,previous);
    assert.match(engine.queue.at(-1).text,/当前词/u);
    chat('意气风发',{user:{id:'302',name:'接龙观众'}});
    assert.equal(engine.bot.session.word,'意气风发');
  }
});

test('免 @ 开局仍遵守开关和用户过滤，入队失败不创建会话', () => {
  for (const change of [c=>{c.bot.enabled=false;},c=>{c.bot.idiomEnabled=false;},c=>{c.ignored=['uid:200'];}]) {
    const {engine,chat} = fixture(change);
    chat('开始成语接龙');
    assert.equal(engine.bot.session,null);
    assert.ok(engine.queue.every(job=>!/接龙开始/u.test(job.text)));
  }
  const {engine,chat} = fixture(c=>{c.sending.queueLimit=1;});
  engine.enqueue('gift','感谢送礼');
  chat('开始成语接龙');
  assert.equal(engine.bot.session,null);
  assert.equal(engine.queue.length,1);
  assert.equal(engine.queue[0].kind,'gift');
});

test('免 @ 仅识别明确开局，普通提及不启动，进行中的接龙不被重置', () => {
  const {engine,chat} = fixture();
  for (const text of ['成语接龙','我想开始成语接龙','开始成语接龙了吗','菜单']) chat(text);
  assert.equal(engine.bot.session,null);
  assert.equal(engine.queue.length,0);
  chat('开始成语接龙');
  chat('意气风发',{user:{id:'301',name:'接龙观众'}});
  const session = engine.bot.session;
  chat('开始成语接龙',{user:{id:'302',name:'另一位观众'}});
  assert.equal(engine.bot.session,session);
  assert.equal(engine.bot.session.word,'意气风发');
  assert.match(engine.queue.at(-1).text,/当前词「意气风发」/u);
});

test('接龙识别入不敷出，且本局中重复发词会反馈已用过（包括再次 @）', () => {
  const {engine,chat} = fixture();
  engine.bot.startSession('idiom','主持观众','uid:300','长驱直入');
  chat('入不敷出',{user:{id:'301',name:'一只开心🎀'}});
  assert.equal(engine.bot.session?.word,'入不敷出');
  assert.match(engine.queue.at(-1).text,/✅入不敷出/u);
  chat('@小明 入不敷出',{user:{id:'302',name:'一只开心🎀'}});
  assert.equal(engine.bot.session?.word,'入不敷出');
  assert.match(engine.queue.at(-1).text,/已用过/u);
});

test('主播本人可以继续已开始的接龙，常见成语不被小词库截断', () => {
  const {engine,chat} = fixture();
  engine.bot.startSession('idiom','一只开心🎀','uid:viewer','长驱直入');
  chat('入不敷出',{user:{id:'200',name:'一只开心🎀'}});
  chat('出谋划策',{user:self});
  chat('策无遗算',{user:self});
  assert.equal(engine.bot.session?.word,'策无遗算');
  assert.ok(engine.queue.some(job=>/✅出谋划策/u.test(job.text)));
  assert.ok(engine.queue.some(job=>/✅策无遗算/u.test(job.text)));
});

test('登录账号可开局，多个观众可随时接续，词典内成语可接续且错误不立即截断游戏', async () => {
  const {engine,chat,advance} = fixture();
  chat('开始接龙',{user:self});
  assert.equal(engine.bot.session?.type,'idiom');
  await engine.tick();
  const session = engine.bot.session;
  chat('意在笔先',{user:{id:'301',name:'新加入观众'}});
  assert.equal(session.word,'意在笔先');
  await engine.tick();
  for (let i=0;i<4;i++) {
    chat('@小明 接龙 你好世界',{user:{id:`error-${i}`,name:'路过观众'}});
    await engine.tick();
  }
  advance(86400000);
  await engine.tick();
  chat('@小明 先声夺人',{user:self});
  assert.equal(engine.bot.session,session);
  assert.equal(session.word,'先声夺人');
  chat('人山人海',{user:{id:'302',name:'另一位新观众'}});
  assert.equal(session.word,'人山人海');
});

test('接龙期间状态、菜单与结束命令优先于四字词识别，结束后仍可重新开局', async () => {
  const {engine,chat} = fixture();
  chat('开始接龙',{user:self});
  await engine.tick();
  const session = engine.bot.session;
  for (const command of ['游戏状态','菜单']) {
    chat(`@小明 ${command}`);
    assert.equal(engine.bot.session,session);
    assert.doesNotMatch(engine.queue.at(-1).text,/应接|请发四字/u);
    await engine.tick();
  }
  chat('@小明 结束游戏',{user:self});
  assert.equal(engine.bot.session,null);
  assert.ok(engine.queue.some(job=>/已结束/u.test(job.text)));
  await engine.tick();
  chat('开始接龙',{user:{id:'303',name:'下一位观众'}});
  assert.equal(engine.bot.session?.type,'idiom');
});

test('接龙区分平翘舌，shui 和 sui 不能接续', () => {
  const bot = new RoomBot();
  bot.startSession('idiom', '', '', '行云流水');
  const move = bot.participate('随遇而安',{id:'303',name:'近音玩家'},copy(DEFAULTS.bot),50);
  assert.equal(move.handled,true);
  move.commit();
  assert.equal(bot.session.word,'行云流水');
  assert.match(move.text,/应接 shui/);
});

test('关闭前后鼻音通用后，xin 和 xing 不能接续', () => {
  for (const [previous,next] of [['掉以轻心','行云流水'],['身体力行','新陈代谢']]) {
    const config={...DEFAULTS.bot,idiomNasalRelaxed:false};
    const bot = new RoomBot(); bot.startSession('idiom', '', '', previous,config);
    const move = bot.participate(next,{id:'player',name:'观众'},config,50);
    assert.equal(move.handled,true); assert.match(move.text,/应接/u);
    move.commit(); assert.equal(bot.session.word,previous);
  }
});

test('真心话和大冒险支持全房间报名与免 @ 回答', () => {
  for (const [command, type] of [['开始真心话','truth'],['开始大冒险','dare']]) {
    const {engine,chat} = fixture();
    chat(`@小明 ${command}`,{user:{id:'300',name:'主持观众'}});
    chat('报名',{user:{id:'301',name:'报名观众'}});
    assert.equal(engine.bot.session?.type,type);
    assert.equal(engine.bot.session?.phase,'answer');
    chat(type === 'truth' ? '我喜欢音乐' : '今天用三个表情',{user:{id:'301',name:'报名观众'}});
    assert.equal(engine.bot.session?.phase,'join');
  }
});

test('无关弹幕不会被游戏会话吞掉，并继续执行关键词规则', () => {
  const {engine,chat} = fixture(c=>{c.keyword.enabled=true;c.keyword.rules=[{keywords:['你好'],reply:'欢迎聊天',exact:true}];});
  chat('@小明 开始真心话',{user:{id:'300',name:'主持观众'}});
  const before = engine.bot.session?.phase;
  chat('你好');
  assert.equal(engine.bot.session?.phase,before);
  assert.ok(engine.queue.some(job=>job.kind==='keyword' && job.text==='欢迎聊天'));
});

test('成语接龙不会误吞普通四字弹幕，显式接龙前缀仍可反馈词库外成语', () => {
  const {engine,chat} = fixture(c=>{c.keyword.enabled=true;c.keyword.rules=[{keywords:['明天见'],reply:'晚点见',exact:false}];});
  chat('@小明 开始成语接龙',{user:{id:'300',name:'主持观众'}});
  chat('明天见呀',{user:{id:'301',name:'普通观众'}});
  assert.ok(engine.queue.some(job=>job.kind==='keyword' && job.text==='晚点见'));
  chat('接龙 明天见呀',{user:{id:'302',name:'游戏观众'}});
  assert.ok(engine.queue.some(job=>job.kind==='bot' && /未在成语词典收录/.test(job.text)));
});

test('成语接龙错误不会结束本局，其他游戏回答超时仍会结束', async () => {
  const f = fixture();
  f.chat('@小明 开始成语接龙',{user:{id:'300',name:'主持观众'}});
  for (const word of ['接龙 你好世界','接龙 你好世界','接龙 你好世界']) f.chat(word);
  assert.ok(f.engine.bot.session);
  assert.equal(f.engine.bot.session.errors,3);

  const g = fixture();
  g.chat('@小明 开始真心话',{user:{id:'300',name:'主持观众'}});
  g.chat('报名',{user:{id:'301',name:'报名观众'}});
  g.advance(60001); await g.engine.tick();
  assert.equal(g.engine.bot.session,null);
  assert.ok(g.logs.some(log=>/回答超时/.test(log.text)));
});

test('游戏回复入队失败时不推进会话状态，礼物队列保持优先', async () => {
  const {engine,chat} = fixture();
  chat('@小明 开始成语接龙',{user:{id:'300',name:'主持观众'}});
  await engine.tick();
  engine.config.sending.queueLimit = 1;
  engine.enqueue('gift','感谢送礼');
  chat('意气风发');
  assert.equal(engine.bot.session?.word,'一心一意');
  assert.equal(engine.queue[0].kind,'gift');
});

test('机器人开启时 @账号可直接聊天，连续请求按顺序等待且不变成菜单', async () => {
  const g=fixture(c=>{c.ai.enabled=true;c.ai.chatEnabled=true;});
  const prompts=[]; let complete;
  g.engine.ai=prompt=>{prompts.push(prompt);return new Promise(resolve=>{complete=resolve;});};
  g.chat('@小明 今天天气如何？');
  g.chat('@小明 你好吗？',{user:{id:'300',name:'其他人'}});
  assert.equal(prompts.length,1); assert.equal(g.engine.chatAIQueue.length,1);
  complete('天气还不清楚。'); await new Promise(setImmediate);
  assert.equal(prompts.length,2);
  complete('挺好的，谢谢。'); await new Promise(setImmediate);
  assert.equal(g.engine.queue.length,2);
  assert.ok(g.engine.queue.every(item=>item.kind==='ai'));
});

test('普通 AI 问答仍受全局调用限额，暂停后迟到结果不会发送', async () => {
  const {engine,chat}=fixture(c=>{c.bot.enabled=false;c.ai.enabled=true;c.ai.chatEnabled=true;});let complete;
  engine.ai=()=>new Promise(resolve=>{complete=resolve;});chat('@小明 介绍一下今天直播');chat('@小明 第二个问题');
  assert.equal(engine.stats.aiCalls,1);engine.stop();complete('今天聊音乐');await new Promise(setImmediate);assert.equal(engine.queue.length,0);
});

test('礼物持续涌入时 @ 请求得到调度，已接受的机器人任务不被高优先级挤掉', async () => {
  const {engine,chat,advance,logs}=fixture(c=>{c.gift.batchEnabled=false;});
  for(let i=0;i<15;i++) engine.enqueue('gift',`感谢观众${i}`);
  chat('@小明 菜单');await engine.tick();assert.equal(engine.stats.previews,1);
  advance(3000);await engine.tick();assert.ok(logs.some(log=>log.kind==='preview'&&/菜单/.test(log.text)));
  const g=fixture(c=>{c.sending.queueLimit=1;});g.chat('@小明 菜单');assert.equal(g.engine.enqueue('gift','感谢送礼'),true);assert.equal(g.engine.queue.filter(item=>item.kind==='gift').length,1);
});

test('机器人暂时发送失败保留任务重试，不重复运行游戏逻辑', async () => {
  const {engine,chat,advance,sent}=fixture(c=>{c.mode='auto';});let attempts=0;
  engine.send=async text=>{attempts++;if(attempts===1)return {retryable:true,reason:'按钮忙'};sent.push(text);return {submitted:true};};
  chat('@小明 接龙 意气风发');await engine.tick();assert.equal(engine.queue.length,1);assert.equal(engine.stats.retries,1);assert.equal(engine.bot.chain.word,'意气风发');
  advance(501);await engine.tick();assert.equal(sent.length,1);assert.equal(engine.queue.length,0);assert.equal(engine.stats.submitted,1);
});

test('解码积压按真实到达时间处理，同时仍过滤到达时已过期的历史补推', async () => {
  const {engine,now,chat}=fixture();
  chat('@小明 菜单',{at:now()-45000,receivedAt:now()-45000});assert.equal(engine.queue.length,1);
  const g=fixture();g.chat('@小明 菜单',{at:g.now()-45000,receivedAt:g.now()});assert.equal(g.engine.queue.length,0);
  engine.ingest({type:'gift',id:'backlog',user:viewer,giftId:'1',giftName:'星星',count:3,unitValue:100,groupId:'one',final:true,at:now()-45000,receivedAt:now()-45000});
  await engine.tick();assert.equal(engine.stats.previews,1);assert.ok(engine.gifts.size);
});
