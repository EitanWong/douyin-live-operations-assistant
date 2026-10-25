import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, mergeConfig } from '../../src/core/engine.js';
import { makeAIRequest } from '../../src/services/ai.js';

const settle = () => new Promise(setImmediate);
function room(change = {}) {
  let now = 1800000000000, serial = 0;
  const prompts = [], logs = [];
  const engine = new Engine({
    config:mergeConfig({mode:'preview', ai:{enabled:true, chatEnabled:true}, ...change}),
    now:()=>now, random:()=>0,
    ai:async prompt=>{prompts.push(prompt); return '[SKIP]';},
    log:(kind,text)=>logs.push({kind,text})
  });
  engine.setIdentity({self:{id:'self-id', name:'小助手'}}); engine.start();
  const chat = (text, extra={}) => engine.ingest({type:'chat', id:`chat-${++serial}`, user:{id:'viewer-id', name:'观众'}, text, ...extra});
  return {engine, prompts, logs, chat, advance:ms=>{now+=ms;}, now:()=>now};
}

test('普通弹幕不限问句，由模型决定接话或静默；旧触发条件无需继续配置', async () => {
  const r=room({ai:{enabled:true,chatEnabled:true,trigger:'mention',mentions:['旧呼叫词']}});
  assert.equal(Object.hasOwn(r.engine.config.ai,'trigger'),false);
  assert.equal(Object.hasOwn(r.engine.config.ai,'mentions'),false);
  r.chat('你也觉得刚才好笑吗？'); await settle();
  assert.equal(r.prompts.length,1); assert.equal(r.engine.queue.length,0);
  assert.ok(r.logs.some(item=>item.text==='AI 判断无需回复'));
  assert.equal(r.prompts[0].task.data.replyMode,'contextual');
  r.engine.ai=async prompt=>{r.prompts.push(prompt);return '点输入框旁的音量按钮试试。';};
  r.chat('我一直找不到音量入口'); await settle();
  assert.equal(r.engine.queue[0].text,'点输入框旁的音量按钮试试。');
  assert.match(r.prompts[1].task.instruction,/问句不代表需要回复/);
});

test('AI 接收有界直播摘要与时间、未知值，不发送原始 UID、URL、隐藏统计或游戏答案', async () => {
  const r=room({bot:{enabled:true}}), at=r.now();
  r.engine.ingest({type:'room-audience',at,onlineCount:120,cumulativeUsers:550,popularity:900,ranks:[{user:{id:'rank-secret',name:'榜首'},score:10}]});
  r.engine.ingest({type:'room-stats',at,hidden:true,displayValue:999,displayLong:'隐藏统计999'});
  r.engine.ingest({type:'room-notice',at,text:'今天聊旅行',url:'https://secret.test',user:{id:'notice-secret',name:'公告'}});
  r.engine.ingest({type:'gift',id:'gift',at,user:{id:'gift-secret',name:'小鱼'},giftName:'星星',giftId:'gift-id',count:3,unitValue:10,final:true});
  r.engine.ingest({type:'pk-start',battleId:'battle-secret',roomId:'room-secret',anchorId:'anchor-secret',opponentId:'opponent-secret',anchorName:'主播',opponentName:'对面',endsAt:at+60000});
  r.engine.ingest({type:'pk-score',battleId:'battle-secret',selfScore:100,opponentScore:120,at});
  r.engine.bot.startSession('guess','玩家','user-secret');
  r.chat('@小助手 介绍一下现场'); await settle();
  const prompt=r.prompts.at(-1), context=prompt.liveContext;
  assert.equal(context.audience.online,120); assert.equal(context.audience.at,at);
  assert.equal(context.roomStats.value,null); assert.equal(context.roomStats.display,'');
  assert.equal(context.activityLastMinute.gift,3); assert.equal(context.activityLastMinute.diamonds,30);
  assert.equal(context.recentEvents.find(item=>item.type==='gift').cumulative,true);
  assert.equal(context.pk.selfScore,100); assert.equal(context.pk.opponentScore,120);
  assert.equal(context.game.type,'guess'); assert.equal(context.game.target,undefined);
  const request=makeAIRequest(prompt,r.engine.config.ai), data=JSON.parse(request.messages[1].content);
  assert.deepEqual(data.live_context,context);
  assert.doesNotMatch(JSON.stringify(data),/-secret|https:\/\/secret|隐藏统计999/);
  assert.match(request.messages[0].content,/stale 比分不能当作当前事实/);
  r.advance(181000); r.chat('@小助手 现在呢'); await settle();
  assert.deepEqual(r.prompts.at(-1).liveContext.recentEvents,[]);
  assert.equal(r.prompts.at(-1).liveContext.pk.stale,true);
});

test('自动判断繁忙时合并待判断弹幕，@ 对话优先且菜单不受 AI 等待影响', async () => {
  const r=room({bot:{enabled:true}}); let finish;
  r.engine.ai=prompt=>{r.prompts.push(prompt);return new Promise(resolve=>{finish=resolve;});};
  r.chat('第一条');r.chat('第二条');r.chat('第三条');r.chat('@小助手 你好');
  r.chat('@小助手 菜单');
  assert.equal(r.prompts.length,1); assert.equal(r.engine.queue[0].kind,'bot');
  finish('[SKIP]');await settle();
  assert.equal(r.prompts[1].target.text,'@小助手 你好');
  finish('你好。');await settle();
  assert.equal(r.prompts[2].target.text,'第三条');
  assert.equal(r.prompts[2].context.length,5);
  assert.ok(r.prompts[2].recentReplies.includes('你好。'));
  finish('[SKIP]');await settle();
  assert.equal(r.prompts.length,3);
});

test('游戏与 @聊天并行，不把普通四字聊天或新问题当作答题', async () => {
  const r=room({bot:{enabled:true},ai:{enabled:true,chatEnabled:false}});
  r.engine.bot.startSession('idiom','玩家','player');
  const previous=r.engine.bot.session.word;
  r.chat('@小助手 你好你好'); await settle();
  assert.equal(r.prompts.length,1); assert.equal(r.engine.bot.session.word,previous);
  assert.equal(r.engine.bot.session.totalAttempts,0);
  r.engine.bot.reset();r.engine.bot.startSession('truth','玩家','player');
  Object.assign(r.engine.bot.session,{phase:'answer',prompt:'你的梦想是什么？',currentUserKey:'viewer-id',currentName:'观众'});
  r.chat('@小助手 今天天气怎么样？');await settle();
  assert.equal(r.prompts.length,2);assert.equal(r.engine.bot.session.phase,'answer');
});

test('暂停、关闭模块、失效和调用限额不会让待回复绕过控制', async () => {
  const r=room();let finish;
  r.engine.ai=prompt=>{r.prompts.push(prompt);return new Promise(resolve=>{finish=resolve;});};
  r.chat('@小助手 第一个');r.chat('@小助手 第二个');
  r.engine.stop();r.engine.start();finish('迟到回复');await settle();
  assert.equal(r.prompts.length,1);assert.equal(r.engine.queue.length,0);
  r.chat('@小助手 新请求');r.chat('@小助手 过期请求');r.advance(45001);
  finish('已经过期');await settle();assert.equal(r.prompts.length,2);assert.equal(r.engine.queue.length,0);
  r.chat('@小助手 最后一个');r.chat('@小助手 等待中');
  r.engine.update({...r.engine.config,ai:{...r.engine.config.ai,chatEnabled:false}});
  finish('关闭后不发送');await settle();
  assert.equal(r.engine.queue.length,0);assert.equal(r.engine.chatAIQueue.length,0);

  const limited=room({ai:{enabled:true,chatEnabled:true,maxPerHour:1}});
  limited.chat('普通弹幕');limited.chat('@小助手 你好');await settle();
  assert.equal(limited.prompts.length,1);
  limited.advance(45001);await limited.engine.tick(false);
  assert.equal(limited.engine.chatAIQueue.length,0);
  assert.equal(limited.prompts.length,1);
});
