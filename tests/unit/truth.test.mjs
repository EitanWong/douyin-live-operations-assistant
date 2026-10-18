import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRUTH_QUESTIONS } from '../../src/data/interaction-questions.js';
import { Engine, DEFAULTS, copy } from '../../src/core/engine.js';

const self = {id:'100',name:'Eitan'};
const anchor = {id:'200',name:'一只开心🎀'};
function fixture(change = () => {}) {
  let now = 1800000000000, serial = 0;
  const config = copy(DEFAULTS);
  config.mode = 'preview'; config.bot.enabled = true; config.anchorId = anchor.id;
  change(config);
  const engine = new Engine({config,now:()=>now,random:()=>5.1/TRUTH_QUESTIONS.length});
  engine.setIdentity({self}); engine.start();
  return {engine,advance:ms=>{now+=ms;},chat:(text,user=anchor,extra={})=>engine.ingest({type:'chat',id:String(++serial),text,user,...extra})};
}

test('AI 未启用时，快捷真心话忽略调试消息并用内置反馈回应主播', () => {
  const {engine,chat} = fixture();
  engine.ai = async () => assert.fail('本地互动无需等待 AI');
  chat('@Eitan 真心话');
  assert.equal(engine.bot.session?.phase,'answer');
  assert.match(engine.queue[0].text,/小时候的梦想/u);
  for (const text of ['是的','再试一下/','OK了','有延迟']) chat(text,self);
  assert.equal(engine.queue.length,1);
  assert.equal(engine.bot.session?.phase,'answer');
  chat('梦想成为一个大明星');
  assert.equal(engine.queue.length,2);
  assert.match(engine.queue[1].text,/一只开心🎀.*舞台梦.*闪闪发光/u);
  assert.equal(engine.bot.session,null);
  assert.equal(engine.stats.aiCalls,0);
});

test('被提问者可用简短、口语、表情或带 @ 的任意自然答案作答', () => {
  for (const answer of ['医生','想当老师呀！','小时候就想开一家小店','🌟','@Eitan 我想去太空看看']) {
    const {engine,chat} = fixture();
    chat('@Eitan 真心话');
    chat(answer);
    assert.equal(engine.bot.session,null,answer);
    assert.equal(engine.queue.length,2,answer);
    assert.match(engine.queue[1].text,/谢谢你分享儿时的梦想/u);
    assert.ok([...engine.queue[1].text].length<=50);
  }
});

test('其他观众和登录账号也可自然接话，反馈称呼实际回答者', () => {
  for (const user of [self,{id:'300',name:'热心观众'}]) {
    for (const answer of ['想当医生','梦想成为一个大明星','我也想开家店','我的答案是环游世界','@Eitan 开一家小店']) {
      const {engine,chat} = fixture();
      chat('@Eitan 真心话');
      chat(answer,user);
      assert.equal(engine.bot.session,null,answer);
      assert.equal(engine.queue.length,2,answer);
      assert.ok(engine.queue[1].text.startsWith(`${user.name}，`));
    }
  }
});

test('自然接话适用于全部真心话题目，昵称相同也按实际用户回应', () => {
  const answers = ['今天收到朋友的花很开心','想学吉他','我喜欢周杰伦的夜曲','我想去阿勒泰','平静、期待、开心','想当科学家'];
  answers.forEach((answer,index)=>{
    const {engine,chat} = fixture(); engine.bot.random = () => (index+0.1)/TRUTH_QUESTIONS.length;
    chat('@Eitan 真心话');
    chat(answer,{id:'300',name:anchor.name});
    assert.equal(engine.bot.session,null,answer);
    assert.match(engine.queue[1].text,/收到|舞台梦/u);
  });
});

test('无关观众聊天、空消息和标点不抢答，普通消息仍可命中关键词', () => {
  const {engine,chat} = fixture(c=>{c.keyword.enabled=true;c.keyword.rules=[{keywords:['几点开播'],reply:'开播时间请看主页',exact:true}];});
  chat('@Eitan 真心话');
  for (const text of ['你好','今天几点下播','几点开播','！！！','   ','@别人 想当医生']) chat(text,{id:'300',name:'其他观众'});
  assert.equal(engine.bot.session?.phase,'answer');
  assert.equal(engine.queue.filter(job=>job.kind==='bot').length,1);
  assert.ok(engine.queue.some(job=>job.kind==='keyword'));
});

test('自然跳过有反馈，其他人不能代替当前答题者跳过', () => {
  for (const answer of ['跳过','不想说','保密','换一题吧！','跳过这一题','回答：不想回答']) {
    const {engine,chat} = fixture(); chat('@Eitan 真心话');
    chat(answer,{id:'300',name:'其他观众'});
    assert.equal(engine.bot.session?.phase,'answer');
    chat(answer);
    assert.equal(engine.bot.session,null);
    assert.match(engine.queue[1].text,/跳过/u);
  }
});

test('房间模式报名和答题兼容口语，带 @ 回答后回到报名阶段', () => {
  const {engine,chat} = fixture();
  chat('开始真心话');
  chat('我来吧！',{id:'300',name:'报名观众'});
  assert.equal(engine.bot.session?.phase,'answer');
  chat('@Eitan 想当医生',{id:'300',name:'报名观众'});
  assert.equal(engine.bot.session?.phase,'join');
  assert.equal(engine.bot.session?.rounds,1);
  assert.match(engine.queue.at(-1).text,/报名观众.*儿时的梦想.*下一位/u);
});

test('大冒险也等待直接回答并反馈，不因快捷出题漏掉后续消息', () => {
  const {engine,chat} = fixture();
  chat('@Eitan 大冒险');
  chat('@Eitan 吃葡萄不吐葡萄皮');
  assert.equal(engine.bot.session,null);
  assert.match(engine.queue[1].text,/吃葡萄不吐葡萄皮.*参与挑战/u);
});

test('反馈入队失败继续等待，重试回答和重复帧只产生一次反馈', () => {
  const {engine,chat} = fixture(c=>{c.sending.queueLimit=1;});
  chat('@Eitan 真心话');
  const session = engine.bot.session;
  chat('想当医生',anchor,{id:'full'});
  assert.equal(engine.bot.session,session);
  engine.queue=[];
  chat('想当医生',anchor,{id:'answer'});
  chat('想当医生',anchor,{id:'answer'});
  assert.equal(engine.bot.session,null);
  assert.equal(engine.queue.length,1);
  const blocked = fixture(c=>{c.sending.queueLimit=1;});
  blocked.engine.enqueue('gift','谢谢礼物');
  blocked.chat('@Eitan 真心话');
  assert.equal(blocked.engine.bot.session,null);
});

test('忽略用户、关闭玩法、超时和机器人回显不会完成答题', async () => {
  for (const change of [e=>{e.config.ignored=['uid:200'];},e=>{e.config.bot.truthEnabled=false;},e=>{e.selfTexts.set('想当医生',Infinity);}]) {
    const {engine,chat} = fixture(); chat('@Eitan 真心话'); change(engine);
    chat('想当医生');
    assert.equal(engine.bot.session?.phase,'answer');
    assert.equal(engine.queue.length,1);
  }
  const {engine,chat,advance} = fixture(); chat('@Eitan 真心话');
  advance(60001); await engine.tick(); chat('想当医生');
  assert.equal(engine.bot.session,null);
  assert.ok(!engine.queue.some(job=>/儿时的梦想/u.test(job.text)));
});

test('刷新恢复快捷题上下文后仍能识别回答并只反馈一次', () => {
  const first = fixture(); first.chat('@Eitan 真心话');
  const restored = fixture(); restored.engine.restore(first.engine.snapshot());
  restored.chat('梦想成为一个大明星',anchor,{id:'after-restore'});
  assert.equal(restored.engine.bot.session,null);
  assert.match(restored.engine.queue.at(-1).text,/闪闪发光/u);
});
