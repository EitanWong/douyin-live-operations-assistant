import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine,mergeConfig} from '../../src/core/engine.js';
const flush=()=>new Promise(setImmediate);
function fixture(){
 let now=1800000000000,id=0;const spoken=[],pending=[];
 const engine=new Engine({now:()=>now,config:mergeConfig({mode:'preview',ai:{enabled:true,chatEnabled:true,search:{enabled:true}}}),
  log:(kind,text)=>{if(kind==='preview')spoken.push(text);},ai:p=>{
   if(p.target.text.includes('查询')){p.onLookup({query:'上海天气'});return new Promise((resolve,reject)=>pending.push({p,resolve,reject}));}
   return Promise.resolve('你好。');
  }});
 engine.setIdentity({self:{id:'self',name:'助手'}});engine.start();
 return {engine,pending,spoken,advance:ms=>now+=ms,chat:async text=>{engine.ingest({type:'chat',id:`q${++id}`,user:{id:`v${id}`,name:`观众${id}`},text});await flush();}};
}
test('长查询不阻塞后续@，超过45秒完成仍主动回复且只发送一次',async()=>{
 const f=fixture();try{
  await f.chat('@助手 查询上海天气');assert.equal(f.pending.length,1);
  await f.chat('@助手 你好');await f.engine.tick();assert.ok(f.spoken.includes('你好。'));
  f.advance(8000);await f.engine.tick();assert.ok(f.spoken.some(text=>text.includes('查询中')));
  f.advance(52000);f.pending[0].resolve('上海明天晴。[1]');await flush();
  await f.engine.tick();assert.ok(f.spoken.includes('上海明天晴。[1]'));
  f.advance(8000);await f.engine.tick();assert.equal(f.spoken.filter(t=>t==='上海明天晴。[1]').length,1);
 }finally{f.engine.stop();}
});
test('查询失败明确反馈，暂停或关掉AI后迟到结果不会发送',async()=>{
 const f=fixture();try{
  await f.chat('@助手 查询新闻');f.pending[0].reject(Error('offline'));await flush();await f.engine.tick();
  assert.ok(f.spoken.some(text=>text.includes('查询未成功')));
  await f.chat('@助手 查询赛事');f.engine.stop();f.pending[1].resolve('迟到结果');await flush();
  assert.equal(f.engine.queue.some(q=>q.text==='迟到结果'),false);
 }finally{f.engine.stop();}
});

test('尚未发送的查询中提示在结果完成后移除，不补发过时进度',async()=>{
 const f=fixture();try{
  await f.chat('@助手 你好');await f.engine.tick();await f.chat('@助手 查询天气');
  f.advance(5000);await f.engine.tick();assert.ok(f.engine.queue.some(q=>q.text.includes('查询中')));
  f.pending[0].resolve('北京晴。[1]');await flush();f.advance(3000);await f.engine.tick();
  assert.ok(f.spoken.includes('北京晴。[1]'));f.advance(8000);await f.engine.tick();
  assert.equal(f.spoken.some(text=>text.includes('查询中')),false);
 }finally{f.engine.stop();}
});

test('刷新中断未完成查询时保留明确反馈，不静默遗忘或重复付费查询',async()=>{
 const f=fixture(),g=fixture();try{
  await f.chat('@助手 查询天气');const snapshot=f.engine.snapshot();f.engine.stop();
  assert.equal(g.engine.restore(snapshot),true);await g.engine.tick();
  assert.ok(g.spoken.some(text=>text.includes('查询已中断')));assert.equal(g.pending.length,0);
  await g.engine.tick();assert.equal(g.spoken.filter(text=>text.includes('查询已中断')).length,1);
 }finally{f.engine.stop();g.engine.stop();}
});

test('长查询到期会反馈失败并清理任务，不永久等待',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});const f=fixture();try{
  await f.chat('@助手 查询天气');f.advance(120001);t.mock.timers.tick(120001);await flush();await f.engine.tick();
  assert.ok(f.spoken.some(text=>text.includes('查询未成功')));assert.equal(f.engine.researchAI.size,0);
 }finally{f.engine.stop();}
});

test('已接受的普通提问查询完成后也必须回复，不再受普通接话条数限制',async()=>{
 const f=fixture();try{
  await f.chat('查询上海天气');assert.equal(f.pending.length,1);
  for(let i=0;i<10;i++)f.engine.turnTaking.record({kind:'ai',text:'其他回复',aiChat:{replyMode:'direct'}},f.engine.chatContextKey(),1800000000000);
  f.advance(60000);f.pending[0].resolve('上海晴。[1]');await flush();await f.engine.tick();
  assert.ok(f.spoken.includes('上海晴。[1]'));
 }finally{f.engine.stop();}
});

test('刷新恢复不重发仍在查询的旧进度',async()=>{
 const f=fixture(),g=fixture();try{
  await f.chat('@助手 你好');await f.engine.tick();await f.chat('@助手 查询天气');
  f.advance(5000);await f.engine.tick();const snapshot=f.engine.snapshot();
  g.advance(8000);g.engine.restore(snapshot);await g.engine.tick();
  assert.equal(g.spoken.some(text=>text.includes('查询中')),false);assert.ok(g.spoken.some(text=>text.includes('查询已中断')));
 }finally{f.engine.stop();g.engine.stop();}
});

test('查询结果被格式规则拦截也有结束反馈',async()=>{
 const f=fixture();try{
  await f.chat('@助手 查询天气');f.pending[0].resolve('大家有想聊的话题可以发在公屏，我来转达。');await flush();await f.engine.tick();
  assert.ok(f.spoken.some(text=>text.includes('查询结果暂时无法发送')));
 }finally{f.engine.stop();}
});

test('两项查询同时进行仍可回复新的@，超过查询容量时明确反馈忙碌',async()=>{
 const f=fixture();try{
  await f.chat('@助手 查询天气');await f.chat('@助手 查询新闻');assert.equal(f.pending.length,2);
  await f.chat('@助手 你好');await f.engine.tick();assert.ok(f.spoken.includes('你好。'));
  await f.chat('@助手 查询赛事');f.advance(8000);await f.engine.tick();
  assert.equal(f.pending.length,2);assert.ok(f.spoken.some(text=>text.includes('查询较多')));
 }finally{f.engine.stop();}
});
