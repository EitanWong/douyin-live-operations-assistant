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
 return {engine,pending,spoken,advance:ms=>now+=ms,chat:async(text,user)=>{engine.ingest({type:'chat',id:`q${++id}`,user:user || {id:`v${id}`,name:`观众${id}`},text});await flush();}};
}
test('查询等待、截短昵称答复及刷新中断反馈都携带实际提问者UID',async()=>{
 const f=fixture(),g=fixture(),sent=[];const user={id:'9007199254740993123',name:'名字很长的观众🐑还有后缀'};
 for(const {engine} of [f,g]){engine.config.mode='auto';engine.send=async(text,current,options)=>{sent.push({text,mentions:options.mentions});return {submitted:true};};}
 try {
  await f.chat('@助手 查询天气',user);f.advance(1000);await f.engine.tick();
  const expected={id:user.id,start:0,length:sent[0].text.indexOf(' ')};
  assert.deepEqual(sent[0].mentions,[expected]);
  const snapshot=f.engine.snapshot();g.advance(1000);assert.equal(g.engine.restore(snapshot),true);
  g.advance(10000);await g.engine.tick();assert.match(sent.at(-1).text,/查询已中断/);assert.deepEqual(sent.at(-1).mentions,[expected]);
  f.pending[0].resolve('尚未知。');await flush();f.advance(10000);await f.engine.tick();
  assert.match(sent.at(-1).text,/尚未知/);assert.deepEqual(sent.at(-1).mentions,[expected]);
 }finally{f.engine.stop();g.engine.stop();}
});
test('查询接受后一秒内发出带实际提问者@的自然反馈，最终答复保留@且不重复提示',async()=>{
 const f=fixture();try{
  await f.chat('@助手 查询PK规则');f.advance(1000);await f.engine.tick();
  assert.deepEqual(f.spoken,['@观众1 我查一下，稍等。']);
  assert.ok(f.pending[0].p.searchMaxLength<50);
  f.pending[0].resolve('时长看本局设置，按PK分结算。');await flush();f.advance(8000);await f.engine.tick();
  assert.equal(f.spoken.at(-1),'@观众1 时长看本局设置，按PK分结算。');assert.equal(f.spoken.length,2);
 }finally{f.engine.stop();}
});
test('十字公屏上限仍能给出@等待提示与短答，不截断回答事实',async()=>{
 const f=fixture();f.engine.config.sending.maxLength=10;
 try{
  await f.chat('@助手 查询天气');f.advance(1000);await f.engine.tick();
  assert.equal(f.spoken.length,1);assert.match(f.spoken[0],/^@观众1 /);assert.ok([...f.spoken[0]].length<=10);
  assert.equal(f.pending[0].p.searchMaxLength,5);
  f.pending[0].resolve('尚未知。');await flush();f.advance(8000);await f.engine.tick();
  assert.equal(f.spoken.at(-1),'@观众1 尚未知。');
 }finally{f.engine.stop();}
});
test('快速完成不多发等待提示；停止后未发送的等待提示与最终答案都清除',async()=>{
 const f=fixture();try{
  await f.chat('@助手 查询天气');f.pending[0].resolve('尚未知。');await flush();await f.engine.tick();
  assert.deepEqual(f.spoken,['@观众1 尚未知。']);
  await f.chat('@助手 查询新闻');f.advance(1000);await f.engine.tick();f.engine.stop();
  f.pending[1].resolve('迟到新闻');await flush();assert.equal(f.engine.queue.some(r=>/我查|迟到/u.test(r.text)),false);
 }finally{f.engine.stop();}
});
test('长查询不阻塞后续@，超过45秒完成仍主动回复且只发送一次',async()=>{
 const f=fixture();try{
  await f.chat('@助手 查询上海天气');assert.equal(f.pending.length,1);
  await f.chat('@助手 你好');await f.engine.tick();assert.ok(f.spoken.includes('你好。'));
  f.advance(8000);await f.engine.tick();assert.ok(f.spoken.some(text=>text.includes('我查一下')));
  f.advance(52000);f.pending[0].resolve('上海明天晴。[1]');await flush();
  await f.engine.tick();assert.ok(f.spoken.includes('@观众1 上海明天晴。[1]'));
  f.advance(8000);await f.engine.tick();assert.equal(f.spoken.filter(t=>t==='@观众1 上海明天晴。[1]').length,1);
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
  f.advance(5000);await f.engine.tick();assert.ok(f.engine.queue.some(q=>q.text.includes('我查一下')));
  f.pending[0].resolve('北京晴。[1]');await flush();f.advance(3000);await f.engine.tick();
  assert.ok(f.spoken.includes('@观众2 北京晴。[1]'));f.advance(8000);await f.engine.tick();
  assert.equal(f.spoken.some(text=>text.includes('我查一下')),false);
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
  assert.ok(f.spoken.includes('@观众1 上海晴。[1]'));
 }finally{f.engine.stop();}
});

test('刷新恢复不重发仍在查询的旧进度',async()=>{
 const f=fixture(),g=fixture();try{
  await f.chat('@助手 你好');await f.engine.tick();await f.chat('@助手 查询天气');
  f.advance(5000);await f.engine.tick();const snapshot=f.engine.snapshot();
  g.advance(8000);g.engine.restore(snapshot);await g.engine.tick();
  assert.equal(g.spoken.some(text=>text.includes('我查一下')),false);assert.ok(g.spoken.some(text=>text.includes('查询已中断')));
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
