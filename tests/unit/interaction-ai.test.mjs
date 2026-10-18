import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, DEFAULTS, copy } from '../../src/core/engine.js';
import { RoomBot } from '../../src/core/bot.js';
import { TRUTH_QUESTIONS, DARE_QUESTIONS, INTERACTION_TOPICS, INTERACTION_SOURCE } from '../../src/data/interaction-questions.js';

const self={id:'100',name:'Eitan'}, viewer={id:'200',name:'开心'};
const settle=()=>new Promise(setImmediate);
function fixture(change=()=>{}) {
  let now=1800000000000, serial=0;
  const config=copy(DEFAULTS);
  config.mode='preview';config.bot.enabled=true;config.ai.enabled=true;config.ai.chatEnabled=false;config.ai.maxPerHour=300;
  change(config);
  const engine=new Engine({config,now:()=>now,random:()=>5.1/TRUTH_QUESTIONS.length});
  engine.setIdentity({self});engine.start();
  return {engine,advance:ms=>{now+=ms;},chat:(text,user=viewer,id=String(++serial))=>engine.ingest({type:'chat',id,text,user})};
}

// Exercise the real request/queue path: the algorithm owns game state, AI owns expression.
test('AI 服务开启但普通问答关闭时，出题接话和自然回答仍使用 AI，称呼真实回答者', async()=>{
  const {engine,chat}=fixture(); const prompts=[];
  engine.ai=async prompt=>{prompts.push(prompt);return prompt.task.data.mode==='feedback'?'舞台梦很美，愿你一直闪闪发光✨':'分享你的故事吧✨';};
  chat('@Eitan 真心话');
  const question=engine.bot.session.prompt;
  await settle();
  assert.equal(engine.stats.aiCalls,1);
  assert.ok(engine.queue[0].text.includes(question));
  assert.match(engine.queue[0].text,/分享你的故事/u);
  assert.equal(engine.queue[0].aiPending,false);
  chat('梦想成为一个大明星',self);
  assert.equal(engine.bot.session,null);
  await settle();
  assert.equal(engine.stats.aiCalls,2);
  assert.equal(prompts[1].task.data.question,question);
  assert.equal(prompts[1].task.data.answer,'梦想成为一个大明星');
  assert.equal(engine.queue[1].text,'Eitan，舞台梦很美，愿你一直闪闪发光✨');
  assert.ok(engine.queue.every(job=>[...job.text].length<=50));
});

test('AI 反馈保留房间模式下一步提示，不重复提交回合', async()=>{
  const {engine,chat}=fixture(); engine.ai=async()=> '谢谢你的分享✨';
  chat('开始真心话');await settle();
  chat('报名');await settle();
  chat('想当老师');await settle();
  assert.equal(engine.bot.session.rounds,1);
  assert.equal(engine.bot.session.phase,'join');
  assert.match(engine.queue.at(-1).text,/开心，谢谢你的分享✨ 下一位发「报名」。/u);
});

test('大冒险接受其他人表情接话并使用 AI 评价，题目与随机结果不被改写', async()=>{
  const f=fixture(); f.engine.ai=async()=> '这个创意真有趣👏';
  f.chat('@Eitan 大冒险');await settle();
  const prompt=f.engine.bot.session.prompt;
  assert.ok(f.engine.queue[0].text.includes(prompt));
  f.chat('🎉🌈',{id:'300',name:'小雨'});await settle();
  assert.equal(f.engine.bot.session,null);
  assert.equal(f.engine.queue[1].text,'小雨，这个创意真有趣👏');
  const g=fixture();g.engine.ai=async()=> '骰子是6点，你赢了';
  g.chat('@Eitan 骰子');const local=g.engine.queue[0].text;await settle();
  assert.equal(g.engine.queue[0].text,local);
  assert.equal(g.engine.stats.aiCalls,1);
});

test('网络失败、空回复、SKIP、超长或屏蔽词输出均在原位置回退且可继续下一轮', async()=>{
  for(const result of [new Error('service unavailable'),'','[SKIP]','字'.repeat(100),'违禁']) {
    const {engine,chat}=fixture(c=>{c.blockedWords=['违禁'];});
    engine.ai=async()=>{if(result instanceof Error)throw result;return result;};
    chat('@Eitan 真心话');await settle();
    chat('梦想成为一个大明星');
    const local=engine.queue[1].text;await settle();
    assert.equal(engine.queue.length,2);
    assert.equal(engine.queue[1].text,local);
    assert.equal(engine.queue[1].aiPending,false);
    assert.match(local,/舞台梦/u);
    assert.equal(engine.bot.session,null);
    assert.equal(engine.aiBusy,false);
  }
});

test('AI 繁忙、额度用尽、服务关闭时立即用内置反馈', async()=>{
  for(const mode of ['busy','quota','disabled']) {
    const {engine,chat}=fixture(c=>{c.ai.enabled=false;});
    chat('@Eitan 真心话');engine.config.ai.enabled=mode!=='disabled';
    if(mode==='busy')engine.aiBusy=true;
    if(mode==='quota')engine.calls=Array(engine.config.ai.maxPerHour).fill(1800000000000);
    engine.ai=async()=>assert.fail('无法调用时应立即 fallback');
    chat('梦想成为一个大明星');await settle();
    assert.equal(engine.stats.aiCalls,0);
    assert.equal(engine.queue[1].aiPending || false,false);
    assert.match(engine.queue[1].text,/舞台梦/u);
  }
});

test('AI 等待期间不发送，5 秒后本地回复可发送，迟到结果不会追加或覆盖', async()=>{
  const {engine,chat,advance}=fixture();let resolve;
  engine.ai=()=>new Promise(done=>{resolve=done;});
  chat('@Eitan 真心话');const local=engine.queue[0].text;
  await engine.tick();assert.equal(engine.stats.previews,0);
  advance(5001);await engine.tick();assert.equal(engine.stats.previews,1);
  assert.equal(engine.queue.length,0);
  resolve('迟到的回复');await settle();
  assert.equal(engine.queue.length,0);
  assert.equal(engine.aiBusy,false);
  assert.ok(local.includes('小时候的梦想'));
});

test('题目还在等 AI 时收到答案，先发题目再发反馈，避免回复顺序倒置', async()=>{
  const {engine,chat,advance}=fixture();let resolve;
  engine.ai=()=>new Promise(done=>{resolve=done;});
  chat('@Eitan 真心话');
  chat('梦想成为一个大明星');
  assert.equal(engine.queue.length,2);
  assert.equal(engine.queue[1].afterBot,engine.queue[0].id);
  await engine.tick();assert.equal(engine.stats.previews,0);
  advance(5001);await engine.tick();
  assert.equal(engine.stats.previews,1);
  assert.match(engine.queue[0].text,/舞台梦/u);
  await engine.tick();assert.equal(engine.stats.previews,2);
  resolve('来分享吧');await settle();assert.equal(engine.queue.length,0);
});

test('真实请求挂起超过 5 秒也会释放繁忙状态并保留本地回复', async()=>{
  const {engine,chat}=fixture();engine.ai=()=>new Promise(()=>{});
  chat('@Eitan 真心话');
  await new Promise(resolve=>setTimeout(resolve,5100));
  assert.equal(engine.aiBusy,false);
  assert.equal(engine.queue[0].aiPending,false);
  assert.equal(engine.queue[0].readyAt,1800000000000);
});

test('暂停后迟到 AI 不会重新入队；刷新中的 AI 位置直接恢复本地回复', async()=>{
  const f=fixture();let resolve;f.engine.ai=()=>new Promise(done=>{resolve=done;});
  f.chat('@Eitan 真心话');const snapshot=f.engine.snapshot();
  const restored=fixture();assert.equal(restored.engine.restore(snapshot),true);
  assert.equal(restored.engine.queue[0].aiPending,false);
  assert.equal(restored.engine.queue[0].readyAt,1800000000000);
  assert.equal(restored.engine.bot.session.prompt,f.engine.bot.session.prompt);
  f.engine.stop();resolve('不该出现');await settle();
  assert.equal(f.engine.queue.length,0);
});

test('队列满不抽走题目、不推进状态、不调用 AI；重复事件不重复请求', async()=>{
  const {engine,chat}=fixture(c=>{c.sending.queueLimit=1;});engine.ai=async()=> '欢迎分享✨';
  engine.enqueue('gift','谢谢礼物');
  chat('@Eitan 真心话');
  assert.equal(engine.bot.session,null);assert.deepEqual(engine.bot.questionHistory.truth,[]);
  assert.equal(engine.stats.aiCalls,0);
  engine.queue=[];chat('@Eitan 真心话',viewer,'same');chat('@Eitan 真心话',viewer,'same');await settle();
  assert.equal(engine.bot.questionHistory.truth.length,1);
  assert.equal(engine.stats.aiCalls,1);
});

test('题库按题型抽完前不重复，跨轮不连续相同；完整题目适配最短字数限制', ()=>{
  for(const [type,bank] of [['truth',TRUTH_QUESTIONS],['dare',DARE_QUESTIONS]]) {
    const bot=new RoomBot({random:()=>0});const seen=new Set();let last;
    for(let i=0;i<bank.length;i++) {
      const question=bot.pickQuestion(type);assert.ok(!seen.has(question.id));
      seen.add(question.id);last=question;bot.rememberQuestion(type,question);
    }
    assert.notEqual(bot.pickQuestion(type).id,last.id);
    for(const max of [10,15,22,50]) {
      const question=bot.pickQuestion(type,max);
      assert.ok([...question.prompt].length<=max);
      const reply=bot.reply(type==='truth'?'真心话':'大冒险',copy(DEFAULTS.bot),max,'非常非常长的名字','200');
      reply.commit();
      assert.ok(reply.text.includes(bot.session.prompt));
      bot.reset();
    }
  }
});

test('抽题历史随快照恢复；旧版无题目 ID 的会话仍可匹配并反馈', async()=>{
  const f=fixture(c=>{c.ai.enabled=false;});f.chat('@Eitan 真心话');f.chat('医生');
  await f.engine.tick();await f.engine.tick();
  const restored=fixture(c=>{c.ai.enabled=false;});restored.engine.restore(f.engine.snapshot());
  assert.deepEqual(restored.engine.bot.questionHistory,f.engine.bot.questionHistory);
  restored.chat('@Eitan 真心话',viewer,'new-after-restore');assert.equal(restored.engine.bot.questionHistory.truth.length,2);
  assert.notEqual(restored.engine.bot.session.questionId,f.engine.bot.questionHistory.truth[0]);
  delete restored.engine.bot.session.questionId;
  assert.equal(restored.engine.bot.acceptsAnswer('😊','someone'),true);
});

test('是非题的确认与挑战完成口语能参与，开放题的调试确认仍被忽略', ()=>{
  const bot=new RoomBot();
  bot.startSession('truth','开心','200');
  Object.assign(bot.session,{phase:'answer',prompt:'你会偶尔自己和自己说话吗？',currentUserKey:'200'});
  for(const answer of ['是的','嗯','是','没有过']) assert.equal(bot.acceptsAnswer(answer,'300'),true,answer);
  bot.session.prompt='你小时候的梦想是什么？';
  for(const answer of ['是的','嗯','OK了','有延迟']) assert.equal(bot.acceptsAnswer(answer,'200'),false,answer);
  bot.reset();bot.startSession('dare','开心','200');bot.session.phase='answer';
  for(const answer of ['好了','好啦','完成了','已完成','搞定']) assert.equal(bot.acceptsAnswer(answer,'300'),true,answer);
});

test('全部题目 ID 和内容唯一且分类可识别，开源改编保留可追溯元数据', ()=>{
  assert.equal(TRUTH_QUESTIONS.length,114);assert.equal(DARE_QUESTIONS.length,87);
  const all=[...TRUTH_QUESTIONS,...DARE_QUESTIONS];
  assert.equal(new Set(all.map(item=>item.id)).size,all.length);
  assert.equal(new Set(all.map(item=>item.prompt)).size,all.length);
  assert.ok(all.every(item=>INTERACTION_TOPICS[item.category]));
  assert.equal(all.filter(item=>item.source).length,45);
  assert.equal(INTERACTION_SOURCE.license,'MIT');
  assert.match(INTERACTION_SOURCE.revision,/^[\da-f]{40}$/u);
});
