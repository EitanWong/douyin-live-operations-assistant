import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, DEFAULTS, copy, mergeConfig, validateConfig } from '../../src/core/engine.js';
import { RoomBot } from '../../src/core/bot.js';
import { lookupIdiom, idiomConnects, hasIdiomSuccessor, idiomHintCandidate } from '../../src/core/idiom-game.js';

function game(options = {}) {
  const bot = new RoomBot({random:()=>0});
  const config = {...DEFAULTS.bot, ...options};
  bot.startSession('idiom', '主持', 'host', '一心一意', config);
  const play = (word, id = 'a', name = id) => {
    const reply = bot.participate(word, {id,name}, config, 50);
    reply.commit?.();
    return reply;
  };
  return {bot, config, play};
}

function timedGame(options = {}) {
  let now=1800000000000;
  const config=copy(DEFAULTS); Object.assign(config.bot,{enabled:true,idiomHintIntervalSec:5,...options});
  const sent=[];
  const engine=new Engine({config,now:()=>now,random:()=>0,send:async text=>{sent.push(text);return {submitted:true};}});
  engine.setIdentity({self:{id:'self',name:'场控'}}); engine.start();
  engine.bot.startSession('idiom','主持','host','一心一意',config.bot);
  let serial=0;
  return {engine,config:engine.config,sent,advance:ms=>{now+=ms;},
    chat:text=>engine.ingest({type:'chat',id:String(++serial),text,user:{id:'a',name:'甲'}}),
    hint:()=>engine.queueBotReply({user:{id:'a',name:'甲'}},engine.bot.idiomHint(50))};
}

test('词典精确校验，不接受四字拼凑；同音不区分声调，默认仅放宽前后鼻音', () => {
  assert.equal(lookupIdiom('意甲联赛'), undefined);
  assert.equal(lookupIdiom('你好世界'), undefined);
  assert.ok(lookupIdiom('入乡随俗'));
  assert.equal(idiomConnects('一心一意', '以德报怨'), true);
  assert.equal(idiomConnects('行云流水', '随遇而安'), false);
  assert.equal(idiomConnects('掉以轻心', '行云流水'), true);
  assert.equal(idiomConnects('掉以轻心', '行云流水', false), false);
  const {bot,play} = game();
  const invalid = play('意甲联赛');
  assert.equal(invalid.handled,true);
  assert.match(invalid.text,/未在成语词典收录/);
  assert.equal(bot.session.word,'一心一意');
  assert.equal(bot.session.attempts,0);
  assert.deepEqual(bot.idiomScores().map(p=>[p.points,p.correct,p.incorrect]),[[0,0,1]]);
});

test('多音字使用成语词条读音，并支持四字以外的词典成语', () => {
  assert.equal(idiomConnects('大腹便便','片言只语'),true);
  assert.equal(idiomConnects('大腹便便','便宜行事'),false);
  assert.equal(idiomConnects('人才济济','济济一堂'),true);
  assert.equal(idiomConnects('安步当车','车水马龙'),true);
  assert.equal(idiomConnects('五十步笑百步','步步为营'),true);
});

test('按账号累计积分；相同昵称独立，同一账号改名仍累计；重复、错误不加分', () => {
  const {bot,play} = game({idiomPoints:7});
  play('意气风发','a','同名');
  play('发扬光大','b','同名');
  play('大有可为','a','新昵称');
  assert.deepEqual(bot.idiomScores().map(p=>[p.key,p.name,p.points,p.correct]),[['a','新昵称',14,2],['b','同名',7,1]]);
  const word = bot.session.word;
  for (const input of ['接龙 意气风发','接龙 你好世界','一马当先']) play(input,'c');
  assert.equal(bot.session.word,word);
  assert.equal(bot.session.attempts,3);
  assert.equal(bot.session.totalAttempts,6);
  assert.equal(bot.idiomScores().length,3);
  assert.equal(bot.session.used.has('你好世界'),false);
});

test('次数用尽含最后一题积分，公布所有并列冠军，结束后保留结果', () => {
  const {bot,play} = game({idiomMaxAttempts:2});
  play('意气风发','a','甲');
  const end = play('发扬光大','b','乙');
  assert.equal(bot.session,null);
  assert.equal(bot.lastIdiomResult.attempts,2);
  assert.deepEqual(bot.lastIdiomResult.winners.map(p=>[p.name,p.points]),[['甲',10],['乙',10]]);
  assert.match([end.text,...end.messages].join(''),/并列冠军：甲，10分.*并列冠军：乙，10分/);
  assert.equal(bot.idiomScores().length,2);
  end.commit();
  assert.equal(bot.lastIdiomResult.round,2);
});

test('错误消耗最后一次机会，无人答对时不虚构冠军；闲聊与状态查询不计次', () => {
  const {bot,play,config} = game({idiomMaxAttempts:1,idiomCountCorrectOnly:false});
  assert.equal(play('明天见呀').handled,false);
  bot.reply('游戏状态',config,50,'观众','a').commit?.();
  assert.equal(bot.session.attempts,0);
  const reply = play('接龙 你好世界');
  assert.equal(bot.session,null);
  assert.match(reply.messages.join(''),/暂无获胜玩家/);
});

test('手动结束也结算；新开局积分归零，不受上一局结果影响', () => {
  const {bot,play,config} = game();
  play('意气风发');
  const stop = bot.reply('结束游戏',config,50,'主持','host');
  assert.ok(bot.session);
  stop.commit();
  assert.equal(bot.session,null);
  assert.equal(bot.lastIdiomResult.winners[0].points,10);
  bot.reply('开始接龙',config,50,'主持','host').commit();
  assert.equal(bot.session.attempts,0);
  assert.equal(bot.lastIdiomResult,null);
  assert.deepEqual(bot.idiomScores(),[]);
});

test('无法接续的成语提前结算，避免进入死局', () => {
  const {bot,play} = game();
  bot.reset(); bot.startSession('idiom','','','一团和气');
  assert.equal(hasIdiomSuccessor('七拼八凑'),false);
  const reply = play('七拼八凑');
  assert.equal(bot.session,null);
  assert.equal(bot.lastIdiomResult.reason,'无可用后继');
  assert.equal(bot.lastIdiomResult.winners[0].points,10);
  assert.match(reply.messages.join(''),/无可用后继/);
});

test('配置迁移补齐默认值，次数和分数只接受限定范围内整数', () => {
  assert.equal(mergeConfig({bot:{enabled:true}}).bot.idiomMaxAttempts,20);
  assert.equal(mergeConfig({}).bot.idiomPoints,10);
  for (const [key,values] of [['idiomMaxAttempts',[0,1001,1.5,NaN]],['idiomGames',[0,21,1.5]],['idiomPoints',[0,1001,1.5]],['idiomPenalty',[-1,1001,1.5]],['idiomHintIntervalSec',[4,601,1.5]]]) {
    for (const value of values) { const config=copy(DEFAULTS); config.bot[key]=value; assert.throws(()=>validateConfig(config),/接龙/); }
  }
  for (const key of ['idiomNasalRelaxed','idiomCountCorrectOnly','idiomHintsEnabled']) {
    const config=copy(DEFAULTS); config.bot[key]='true'; assert.throws(()=>validateConfig(config));
  }
});

test('入队失败不扣次数或加分，发送重试不重复加分；结算分条播报不丢失', async () => {
  let now=1800000000000, serial=0, sends=0;
  const config=copy(DEFAULTS); Object.assign(config.bot,{enabled:true,idiomMaxAttempts:1}); config.sending.queueLimit=1;
  const engine=new Engine({config,now:()=>now,send:async()=>++sends===1 ? {retryable:true,reason:'暂忙'} : {submitted:true}});
  engine.setIdentity({self:{id:'self',name:'场控'}}); engine.start();
  engine.bot.startSession('idiom','','','一心一意',config.bot);
  const chat=()=>engine.ingest({type:'chat',id:String(++serial),text:'意气风发',user:{id:'a',name:'冠军玩家'}});
  engine.enqueue('gift','谢谢礼物'); chat();
  assert.equal(engine.bot.session.attempts,0);
  assert.deepEqual(engine.bot.idiomScores(),[]);
  engine.queue=[]; chat();
  assert.equal(engine.bot.lastIdiomResult.winners[0].points,10);
  assert.equal(engine.queue.length,3);
  await engine.tick();
  assert.equal(engine.stats.retries,1);
  assert.equal(engine.bot.lastIdiomResult.winners[0].points,10);
  now+=501;
  while(engine.queue.length) { await engine.tick(); now+=501; }
  assert.equal(engine.stats.submitted,3);
});

test('运行快照恢复次数、积分及本局固定规则，旧快照也可继续；结果与待播报名单可恢复', () => {
  const config=copy(DEFAULTS); config.bot.enabled=true;
  const engine=new Engine({config,random:()=>0}); engine.start();
  engine.bot.startSession('idiom','','','一心一意',config.bot);
  engine.bot.participate('意气风发',{id:'a',name:'甲'},config.bot,50).commit();
  const snapshot=engine.snapshot();
  const restored=new Engine({config:mergeConfig({bot:{idiomMaxAttempts:3,idiomPoints:99}})});
  assert.equal(restored.restore(snapshot),true);
  assert.equal(restored.bot.session.attempts,1);
  assert.equal(restored.bot.session.maxAttempts,20);
  assert.equal(restored.bot.session.pointsPerCorrect,10);
  assert.equal(restored.bot.session.used.has('意气风发'),true);
  assert.equal(restored.bot.idiomScores()[0].points,10);
  for (const key of ['attempts','players','maxAttempts','pointsPerCorrect']) delete snapshot.bot[key];
  assert.equal(restored.restore(snapshot),true);
  assert.equal(restored.bot.session.attempts,1);
  assert.equal(restored.bot.session.maxAttempts,3);
  assert.deepEqual(restored.bot.idiomScores(),[]);
  const stop=engine.bot.reply('结束游戏',config.bot,50,'主持','h');
  engine.queueBotReply({user:{id:'h',name:'主持'}},stop);
  const final=new Engine({config}); final.restore(engine.snapshot());
  assert.equal(final.bot.session,null);
  assert.equal(final.bot.lastIdiomResult.winners[0].points,10);
  assert.ok(final.queue.some(job=>job.text.includes('冠军：甲')));
});

test('接龙判定和积分播报不调用 AI，长昵称冠军全部分条发送且不超过字数上限', () => {
  const config=copy(DEFAULTS); config.bot.enabled=true; config.ai.enabled=true; config.sending.maxLength=10;
  const engine=new Engine({config,random:()=>0,ai:()=>assert.fail('接龙不调用AI')}); engine.start();
  engine.bot.startSession('idiom','','','一心一意',{...config.bot,idiomMaxAttempts:1});
  const name='长昵称🏆'.repeat(8);
  const reply=engine.bot.participate('意气风发',{id:'a',name},config.bot,10);
  engine.queueBotReply({user:{id:'a',name}},reply);
  assert.ok(engine.queue.every(job=>[...job.text].length<=10));
  assert.ok(engine.queue.map(job=>job.text).join('').includes(`冠军：${name}，10分`));
  assert.equal(engine.stats.aiCalls,0);
});

test('扩展词典收录新增词条，仍拒绝四字拼凑', () => {
  for (const word of ['一举两便','一世师表','一丸可封']) assert.ok(lookupIdiom(word),word);
  assert.equal(lookupIdiom('今天吃啥'),undefined);
  assert.equal(idiomConnects('一心一意','一举两便'),true);
});

test('默认放宽 an/ang、en/eng、in/ing，仍不混淆平翘舌和其他声母', () => {
  for (const [previous,next] of [['掉以轻心','行云流水'],['身体力行','新陈代谢'],['独善其身','生龙活虎'],['随遇而安','昂首挺胸']]) {
    assert.equal(idiomConnects(previous,next),true,`${previous} → ${next}`);
    assert.equal(idiomConnects(previous,next,false),false);
  }
  assert.equal(idiomConnects('行云流水','随遇而安'),false);
  assert.equal(idiomConnects('一心一意','来日方长'),false);
});

test('扣分按账号独立且最低零分；重复、未收录和接错都扣分，重复提交不重复扣分', () => {
  const {bot,play,config}=game({idiomPenalty:3});
  play('意气风发','a'); play('发扬光大','b');
  const wrong=bot.participate('接龙 你好世界',{id:'a',name:'甲'},config,50);
  wrong.commit(); wrong.commit();
  assert.equal(bot.idiomScores().find(p=>p.key==='a').points,7);
  assert.equal(bot.idiomScores().find(p=>p.key==='b').points,10);
  play('接龙 意气风发','a'); play('一马当先','a'); play('接龙 你好世界','a');
  const player=bot.idiomScores().find(p=>p.key==='a');
  assert.deepEqual([player.points,player.correct,player.incorrect],[0,1,4]);
  assert.equal(bot.session.attempts,2);
  assert.equal(bot.session.totalAttempts,6);
  const noPenalty=game({idiomPenalty:0}); noPenalty.play('意气风发'); noPenalty.play('接龙 你好世界');
  assert.equal(noPenalty.bot.idiomScores()[0].points,10);
});

test('多局自动续局并累计积分，重置本局用词与次数，最后一局才公布总冠军', () => {
  const {bot,play,config}=game({idiomMaxAttempts:1,idiomGames:2,idiomPoints:7});
  const first=play('意气风发','a','甲');
  assert.equal(bot.lastIdiomResult,null);
  assert.equal(bot.session.gameNumber,2);
  assert.equal(bot.session.word,'一心一意');
  assert.equal(bot.session.attempts,0);
  assert.equal(bot.session.used.has('意气风发'),false);
  assert.equal(bot.session.totalCorrect,1);
  assert.match([first.text,...first.messages].join(''),/积分累计/);
  config.idiomPoints=99; config.idiomGames=10;
  const end=play('意气风发','a','甲');
  assert.equal(bot.session,null);
  assert.equal(bot.lastIdiomResult.games,2);
  assert.equal(bot.lastIdiomResult.round,2);
  assert.equal(bot.lastIdiomResult.winners[0].points,14);
  assert.match(end.messages.join(''),/冠军：甲，14分/);
});

test('错误计次模式也能跨局，零分时仅答对过的玩家可以获胜', () => {
  const {bot,play}=game({idiomGames:2,idiomMaxAttempts:2,idiomCountCorrectOnly:false,idiomPenalty:20});
  play('意气风发','a'); play('接龙 你好世界','a');
  assert.equal(bot.session.gameNumber,2);
  play('接龙 你好世界','b'); play('接龙 你好世界','b');
  assert.equal(bot.session,null);
  assert.equal(bot.lastIdiomResult.attempts,4);
  assert.deepEqual(bot.lastIdiomResult.winners.map(p=>[p.key,p.points]),[['a',0]]);
});

test('观众可免 @ 请求提示，逐级展示同一有效成语，冷却与提示均不扣分不计次', () => {
  const f=timedGame(), {bot}=f.engine;
  const initial=bot.session;
  f.chat('求提示');
  assert.equal(bot.session.hintLevel,1);
  const word=bot.session.hintWord;
  assert.ok(lookupIdiom(word)); assert.equal(idiomConnects(initial.word,word,initial.nasalRelaxed),true);
  assert.equal(initial.used.has(word),false);
  assert.match(f.engine.queue[0].text,/提示1.*□/);
  f.chat('接龙提示');
  assert.equal(bot.session.hintLevel,1);
  assert.match(f.engine.queue.at(-1).text,/5秒/);
  f.advance(5000); f.chat('给个提示');
  assert.equal(bot.session.hintLevel,2);
  assert.equal(bot.session.hintWord,word);
  f.advance(5000); f.chat('接龙 提示');
  assert.equal(bot.session.hintLevel,3);
  assert.ok(f.engine.queue.at(-1).text.includes(word));
  assert.equal(bot.session.attempts,0); assert.equal(bot.session.totalAttempts,0);
  assert.deepEqual(bot.idiomScores(),[]);
  f.chat('提示');
  assert.ok(f.engine.queue.at(-1).idiomHintToken);
  assert.equal(bot.session.hintLevel,3);
  f.chat(word);
  assert.equal(bot.session.hintLevel,0);
  assert.equal(bot.session.hintWord,'');
  assert.equal(bot.session.attempts,1);
  assert.equal(f.engine.queue.some(job=>job.idiomHintToken),false);
});

test('自动提示以最近接对或提示的时间计时，闲聊和答错不延后，三级后停止', async () => {
  const f=timedGame();
  f.advance(4000); f.chat('晚饭吃了没'); f.chat('接龙 你好世界');
  await f.engine.tick();
  assert.equal(f.engine.bot.session.hintLevel,0);
  f.advance(1000); await f.engine.tick();
  assert.equal(f.engine.bot.session.hintLevel,1);
  f.advance(5000); await f.engine.tick();
  assert.equal(f.engine.bot.session.hintLevel,2);
  f.advance(5000); await f.engine.tick();
  assert.equal(f.engine.bot.session.hintLevel,3);
  const count=f.sent.length;
  f.advance(5000); await f.engine.tick();
  assert.equal(f.sent.length,count);
  f.chat(f.engine.bot.session.hintWord);
  assert.equal(f.engine.bot.session.hintLevel,0);
  f.advance(4999); await f.engine.tick();
  assert.equal(f.engine.bot.session.hintLevel,0);
  f.advance(1); await f.engine.tick();
  assert.equal(f.engine.bot.session.hintLevel,1);
});

test('自动提示遵守运行、可发送、机器人和提示开关', async () => {
  for (const mode of ['stopped','offline','bot-disabled','idiom-disabled','hints-disabled']) {
    const f=timedGame(mode==='hints-disabled' ? {idiomHintsEnabled:false} : {});
    if (mode==='stopped') f.engine.running=false;
    if (mode==='bot-disabled') f.config.bot.enabled=false;
    if (mode==='idiom-disabled') f.config.bot.idiomEnabled=false;
    f.advance(10000); await f.engine.tick(mode!=='offline');
    assert.equal(f.engine.bot.session.hintLevel,0,mode);
    assert.equal(f.sent.length,0,mode);
  }
  const f=timedGame({idiomHintsEnabled:false}); f.chat('提示');
  assert.match(f.engine.queue[0].text,/未开启提示/);
  assert.equal(f.engine.bot.session.totalAttempts,0);
});

test('提示入队失败不晋级，发送重试不再次晋级，答错也不会重复扣分', async () => {
  const f=timedGame(); f.config.sending.queueLimit=1;
  f.engine.enqueue('gift','谢谢礼物');
  assert.equal(f.hint(),false);
  assert.equal(f.engine.bot.session.hintLevel,0);
  f.engine.queue=[];
  assert.equal(f.hint(),true);
  let sends=0; f.engine.send=async()=>++sends===1 ? {retryable:true,reason:'暂忙'} : {submitted:true};
  await f.engine.tick();
  assert.equal(f.engine.bot.session.hintLevel,1);
  f.advance(501); await f.engine.tick();
  assert.equal(f.engine.bot.session.hintLevel,1);
  f.chat('意气风发'); f.engine.queue=[];
  f.chat('接龙 你好世界');
  assert.equal(f.engine.bot.idiomScores()[0].points,8);
  sends=0; await f.engine.tick(); f.advance(501); await f.engine.tick();
  assert.equal(f.engine.bot.idiomScores()[0].points,8);
});

test('切换局数、结束、关闭功能时清除待发送旧提示，新场同词也不复用旧提示', async () => {
  for (const action of ['next','end','disable','new-match']) {
    const f=timedGame({idiomGames:2,idiomMaxAttempts:1});
    f.hint(); const token=f.engine.bot.hintToken();
    if (action==='next') f.chat('意气风发');
    if (action==='end' || action==='new-match') f.engine.queueBotReply({user:{id:'host'}},f.engine.bot.reply('结束游戏',f.config.bot,50,'主持','host'));
    if (action==='new-match') { f.engine.queue=[]; f.chat('开始接龙'); assert.notEqual(f.engine.bot.hintToken(),token); }
    if (action==='disable') { f.config.bot.idiomEnabled=false; await f.engine.tick(); }
    assert.equal(f.engine.queue.some(job=>job.idiomHintToken===token),false,action);
  }
});

test('恢复快照保留多局总分、固定规则、分级提示及其时间，兼容真实旧结构', () => {
  const f=timedGame({idiomGames:3,idiomMaxAttempts:1,idiomPenalty:4});
  f.chat('意气风发'); f.advance(3000); f.hint();
  const snapshot=f.engine.snapshot(), restored=new Engine({config:copy(DEFAULTS)});
  assert.equal(restored.restore(snapshot),true);
  const session=restored.bot.session;
  assert.deepEqual([session.gameNumber,session.gamesToPlay,session.totalCorrect,session.totalAttempts],[2,3,1,1]);
  assert.deepEqual([session.penalty,session.nasalRelaxed,session.countCorrectOnly],[4,true,true]);
  assert.equal(session.hintLevel,1);
  assert.equal(session.hintWord,f.engine.bot.session.hintWord);
  assert.equal(session.lastHintAt,f.engine.bot.session.lastHintAt);
  assert.equal(session.players[0].points,10);
  assert.ok(restored.queue.some(job=>job.idiomHintToken===restored.bot.hintToken()));
  const legacy={type:'idiom',word:'一心一意',used:['一心一意'],round:1,errors:1,lastAt:1800000000000};
  restored.bot.restoreIdiomGame(legacy,DEFAULTS.bot);
  assert.deepEqual([restored.bot.session.nasalRelaxed,restored.bot.session.countCorrectOnly,restored.bot.session.penalty],[false,false,0]);
  assert.equal(restored.bot.session.totalAttempts,2);
  assert.equal(restored.bot.session.gameNumber,1);
  assert.ok(idiomHintCandidate(restored.bot.session));
});
