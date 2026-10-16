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
  assert.throws(()=>validateConfig({...config,bot:{...config.bot,diceEnabled:'yes'}}),/机器人/);
  assert.throws(()=>validateConfig({...config,bot:{...config.bot,cooldownSec:0}}),/机器人/);
});

test('不开启模块、未识别账号、自己或忽略用户均不触发机器人', () => {
  const {engine,chat} = fixture(c=>{c.bot.enabled=false;}); chat('@小明 菜单'); assert.equal(engine.queue.length,0);
  engine.config.bot.enabled=true; engine.setIdentity({}); chat('@小明 菜单'); assert.equal(engine.queue.length,0);
  engine.setIdentity({self}); chat('@小明 菜单',{user:self}); assert.equal(engine.queue.length,0);
  engine.config.ignored=['uid:200'];chat('@小明 菜单');assert.equal(engine.queue.length,0);
});

test('本地指令优先于关键词和 AI，同一条帧不重复执行', () => {
  const {engine,chat} = fixture(c=>{c.ai.enabled=true;c.ai.chatEnabled=true;c.keyword.enabled=true;});
  engine.ai=async()=>assert.fail('本地指令不调用 AI');
  chat('@小明 骰子',{id:'one'});chat('@小明 骰子',{id:'one'});
  assert.equal(engine.queue.length,1);assert.equal(engine.queue[0].kind,'bot');assert.match(engine.queue[0].text,/1 点/);
  assert.equal(engine.stats.aiCalls,0);
});

test('菜单按开关生成，最短字数限制下可翻页，不列出禁用玩法', () => {
  const config = copy(DEFAULTS.bot);config.truthEnabled=false;config.dareEnabled=false;
  const bot = new RoomBot();
  assert.doesNotMatch(bot.menu(config,50),/真心话|大冒险/);
  const pages = Array.from({length:4},(_,i)=>bot.reply(`菜单 ${i+1}`,config,10,'非常长的观众昵称').text);
  assert.ok(pages.every(text=>[...text].length<=10));assert.ok(pages.some(text=>text.includes('接龙')));
  assert.match(bot.reply('骰子',{...config,diceEnabled:false},50,'观众').text,/已关闭/);
});

test('骰子、硬币、选择、真心话和大冒险都在本地即时生成', () => {
  const {engine,chat} = fixture();
  const commands = ['骰子','硬币','选择 唱歌/聊天','真心话','大冒险'];
  commands.forEach((command,i)=>chat(`@小明 ${command}`,{user:{id:`user-${i}`,name:'观众'}}));
  assert.equal(engine.queue.length,5);assert.match(engine.queue[0].text,/1 点/);assert.match(engine.queue[1].text,/正面/);assert.match(engine.queue[2].text,/唱歌/);
  assert.ok(engine.queue.every(job=>job.kind==='bot'&&[...job.text].length<=50));
  assert.equal(engine.stats.aiCalls,0);
});

test('猜拳回复短而可读，猜数字是房间级会话且可免 @ 参与', () => {
  const f = fixture(c => { c.bot.rpsEnabled = true; c.bot.guessEnabled = true; });
  f.chat('@小明 猜拳 石头', { user:{id:'rps-user',name:'观众'} });
  assert.match(f.engine.queue[0].text, /你石头/);
  assert.match(f.engine.queue[0].text, /｜/);
  assert.ok([...f.engine.queue[0].text].length <= 50);

  f.advance(4000);
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

  const closed = fixture(c => { c.bot.rpsEnabled = false; });
  closed.chat('@小明 猜拳 石头', { user:{id:'closed-user',name:'观众'} });
  assert.equal(closed.engine.queue.length, 1);
  assert.match(closed.engine.queue[0].text, /已关闭/);
});

test('机器人菜单使用短 emoji，并在分页时引导下一页', () => {
  const bot = new RoomBot();
  const config = copy(DEFAULTS.bot);
  const text = bot.menu(config, 50);
  assert.match(text, /🎮菜单/);
  assert.match(text, /菜单/);
  assert.ok([...text].length <= 50);
  const page = bot.menu(config, 22, 1);
  assert.ok([...page].length <= 22);
  assert.match(page, /菜单2|菜单/);
});

test('限制单人积压，但不同观众可得到相同结果；冷却后同一指令可再次回复', async () => {
  const {engine,chat,advance} = fixture();
  chat('@小明 硬币');advance(4000);chat('@小明 硬币');assert.equal(engine.queue.length,1);
  chat('@小明 硬币',{user:{id:'300',name:'观众'}});assert.equal(engine.queue.length,2);
  await engine.tick();advance(4000);chat('@小明 硬币');assert.equal(engine.queue.length,2);
});

test('接龙共享一局，拒绝重复/非词库/错开头；入队失败不推进游戏', async () => {
  const {engine,chat,advance} = fixture();
  chat('@小明 接龙');assert.match(engine.queue[0].text,/一心一意/);await engine.tick();advance(4000);
  chat('@小明 接龙 意气风发');assert.equal(engine.bot.chain.word,'意气风发');await engine.tick();advance(4000);
  chat('@小明 接龙 你好世界');assert.match(engine.queue[0].text,/未收录/);assert.equal(engine.bot.chain.word,'意气风发');await engine.tick();advance(4000);
  chat('@小明 接龙 一心一意');assert.match(engine.queue[0].text,/已用过/);await engine.tick();advance(4000);
  engine.config.sending.queueLimit=1;engine.enqueue('gift','谢谢礼物');
  chat('@小明 接龙 发扬光大');assert.equal(engine.bot.chain.word,'意气风发');
  await engine.tick();advance(4000);chat('@小明 接龙 发扬光大');assert.equal(engine.bot.chain.word,'发扬光大');
  await engine.tick();advance(300001);chat('@小明 接龙');assert.match(engine.queue[0].text,/一心一意/);
  engine.stop();assert.equal(engine.bot.chain,null);
});

test('房间级成语接龙启动后，普通观众无需 @ 即可参与', () => {
  const {engine,chat} = fixture();
  chat('@小明 开始成语接龙',{user:{id:'300',name:'主持观众'}});
  assert.equal(engine.bot.session?.type,'idiom');
  chat('意气风发');
  assert.equal(engine.bot.session?.word,'意气风发');
  assert.ok(engine.queue.some(job=>/意气风发/.test(job.text)));
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
  assert.ok(engine.queue.some(job=>job.kind==='bot' && /未收录/.test(job.text)));
});

test('成语接龙连续三次失败后结束本局，回答超时也会结束', async () => {
  const f = fixture();
  f.chat('@小明 开始成语接龙',{user:{id:'300',name:'主持观众'}});
  for (const word of ['接龙 你好世界','接龙 你好世界','接龙 你好世界']) f.chat(word);
  assert.equal(f.engine.bot.session,null);
  assert.ok(f.engine.queue.some(job=>/本局结束/.test(job.text)));

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

test('普通 @ 提问仅在 AI 服务及问答都开启时调用，忙碌/失败也有本地反馈', async () => {
  const f=fixture();f.chat('@小明 今天天气如何？');assert.match(f.engine.queue[0].text,/菜单/);assert.equal(f.engine.stats.aiCalls,0);
  const g=fixture(c=>{c.ai.enabled=true;c.ai.chatEnabled=true;});
  g.engine.ai=async()=>{throw new Error('offline');};g.chat('@小明 今天天气如何？');await new Promise(setImmediate);
  assert.equal(g.engine.queue.length,1);assert.match(g.engine.queue[0].text,/AI.*菜单/);assert.equal(g.engine.queue[0].botUser,viewer.id);
  g.chat('@小明 你好吗？',{user:{id:'300',name:'其他人'}});await new Promise(setImmediate);
  assert.equal(g.engine.stats.aiCalls,1);assert.equal(g.engine.queue.length,2);
});

test('普通 AI 问答仍受全局调用限额，暂停后迟到结果不会发送', async () => {
  const {engine,chat}=fixture(c=>{c.ai.enabled=true;c.ai.chatEnabled=true;});let complete;
  engine.ai=()=>new Promise(resolve=>{complete=resolve;});chat('@小明 介绍一下今天直播');chat('@小明 第二个问题');
  assert.equal(engine.stats.aiCalls,1);engine.stop();complete('今天聊音乐');await new Promise(setImmediate);assert.equal(engine.queue.length,0);
});

test('礼物持续涌入时 @ 请求得到调度，已接受的机器人任务不被高优先级挤掉', async () => {
  const {engine,chat,advance,logs}=fixture(c=>{c.gift.batchEnabled=false;});
  for(let i=0;i<15;i++) engine.enqueue('gift',`感谢观众${i}`);
  chat('@小明 骰子');await engine.tick();assert.equal(engine.stats.previews,1);
  advance(3000);await engine.tick();assert.ok(logs.some(log=>log.kind==='preview'&&/骰子/.test(log.text)));
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
