import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine,mergeConfig,validateConfig} from '../../src/core/engine.js';

const flush=()=>new Promise(setImmediate);
function fixture(ai={}){
  let time=1800000000000,media=null,finish;
  const prompts=[],sent=[];
  const engine=new Engine({config:mergeConfig({mode:'preview',ai:{enabled:true,proactiveEnabled:true,proactiveIntervalSec:90,...ai}}),now:()=>time,
    mediaContext:()=>media,ai:prompt=>{prompts.push(prompt);return new Promise(resolve=>finish=resolve);},send:async text=>{sent.push(text);return {submitted:true};}});
  engine.start();
  return {engine,prompts,sent,advance:ms=>time+=ms,scene:(text='主播正在手绘蓝色杯子的花纹。',extra={})=>media={observations:[{id:String(time),kind:'omni',at:time,endedAt:time,text,isFinal:true,...extra}]},
    stopMedia:()=>media=null,answer:async(text='这朵蓝色的花是现场画的吗')=>{finish(text);await flush();}};
}

test('新鲜音画可在冷场阈值前触发与主播互动，弹幕问答开关独立，共享上下文且允许沉默',async()=>{
  const f=fixture({chatEnabled:false,idleEnabled:false});f.advance(16000);f.scene();await f.engine.tick(false);
  assert.equal(f.prompts.length,1);assert.match(f.prompts[0].task.instruction,/主播/);assert.equal(f.prompts[0].mediaContext.observations[0].kind,'omni');
  await f.answer('[SKIP]');assert.equal(f.engine.queue.length,0);
  f.advance(91000);f.scene();await f.engine.tick(false);assert.equal(f.prompts.length,1,'相同内容即使重复识别也不重复付费起话题');
  f.scene('主播把烧制前后的杯子并排展示。');await f.engine.tick(false);assert.equal(f.prompts.length,2);await f.answer();assert.equal(f.engine.queue.length,1);f.engine.stop();
});

for(const [name,ai,extra] of [['未启用',{proactiveEnabled:false},{}],['只有半句识别',{}, {isFinal:false}],['空识别',{}, {text:''}],['未来观察',{}, {endedAt:1800000100000}],['没有额度',{maxPerHour:1},{}]])test(`主动互动保持沉默：${name}`,async()=>{
  const f=fixture(ai);f.advance(16000);f.scene(undefined,extra);if(name==='没有额度')f.engine.calls.push(1800000000000);
  await f.engine.tick(false);await flush();assert.equal(f.prompts.length,0);f.engine.stop();
});

test('观众发言和待处理消息优先，主动互动按独立间隔限流',async()=>{
  const f=fixture();f.advance(16000);f.engine.ingest({type:'chat',id:'c1',user:{id:'1',name:'观众'},text:'图案好看'});f.scene();await f.engine.tick(false);assert.equal(f.prompts.length,0);
  f.advance(16000);f.scene();f.engine.enqueue('gift','谢谢礼物');await f.engine.tick(false);assert.equal(f.prompts.length,0);
  f.engine.queue=[];await f.engine.tick(false);assert.equal(f.prompts.length,1);await f.answer('[SKIP]');
  f.advance(16000);f.scene('主播改用绿色的笔。');await f.engine.tick(false);assert.equal(f.prompts.length,1);
  f.advance(75000);f.scene('主播换成红色的笔。');await f.engine.tick(false);assert.equal(f.prompts.length,2);await f.answer('[SKIP]');f.engine.stop();
});

const invalidations={
  '关闭主动开关':f=>f.engine.config.ai.proactiveEnabled=false,
  '停止感知':f=>f.stopMedia(),
  '观察过期':f=>f.advance(31000),
  '观众新发言':f=>{f.engine.ingest({type:'chat',id:'c2',user:{id:'2',name:'观众'},text:'这个怎么卖'});},
  '切换主播':f=>f.engine.config.anchorId='999'
};
for(const [name,invalidate] of Object.entries(invalidations))for(const queued of [false,true])test(`${queued?'已排队':'生成中'}主动回复遇到${name}不再发送`,async()=>{
  const f=fixture();f.engine.config.mode='auto';f.advance(16000);f.scene();await f.engine.tick(false);assert.equal(f.prompts.length,1);
  if(queued){await f.answer();assert.equal(f.engine.queue.length,1);}
  invalidate(f);assert.equal(f.prompts[0].isCurrent(),false);assert.equal(f.prompts[0].reserveFollowup(),false);
  if(!queued)await f.answer();await f.engine.tick(true);assert.equal(f.engine.queue.filter(q=>q.aiProactive).length,0);assert.equal(f.sent.length,0);f.engine.stop();
});

test('主动互动配置在边界校验',()=>{
  assert.throws(()=>validateConfig(mergeConfig({ai:{proactiveEnabled:'yes'}})),/主动|类型/);
  assert.throws(()=>validateConfig(mergeConfig({ai:{proactiveIntervalSec:5}})),/主动/);
  assert.throws(()=>validateConfig(mergeConfig({ai:{media:{autoStart:'yes'}}})),/感知|类型/);
});

test('有效内容回复按既有自动发送流程提交，点击前的新发言使发送凭证失效',async()=>{
  let current,finishSend;
  const f=fixture();f.engine.config.mode='auto';
  f.engine.send=async(_text,isCurrent)=>{current=isCurrent;return new Promise(resolve=>finishSend=resolve);};
  f.advance(16000);f.scene();await f.engine.tick(false);await f.answer();
  const sending=f.engine.tick(true);await flush();assert.equal(current(),true);
  f.engine.ingest({type:'chat',id:'later-chat',user:{id:'3',name:'新观众'},text:'等等，想问个问题'});
  assert.equal(current(),false);finishSend({submitted:false});await sending;f.engine.stop();
});
