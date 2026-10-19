import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { decodeFrame } from '../../src/browser/protocol.js';
import { Engine, DEFAULTS, copy } from '../../src/core/engine.js';

const cat = (...parts) => Buffer.concat(parts.map(part => Buffer.from(part)));
const varint = value => { let remaining = BigInt(value); const bytes = []; while (remaining > 127n) { bytes.push(Number(remaining & 127n) | 128); remaining >>= 7n; } bytes.push(Number(remaining)); return Buffer.from(bytes); };
const i = (field, value) => cat(varint(field * 8), varint(value));
const b = (field, value) => { const bytes = Buffer.from(value); return cat(varint(field * 8 + 2), varint(bytes.length), bytes); };
const self = '9007199254740993123', rival = '9007199254740993124', room = '7777777777777777777';
const score = (id, value) => b(17, cat(i(1, value), b(21, id), b(7, String(value))));

test('gzip PK 推送到暂停的引擎仍更新正确比分和倒计时，重复推送只记一次', async () => {
  const now = 1800000000000, config = copy(DEFAULTS); config.anchorId = self;
  const engine = new Engine({config,now:()=>now,send:()=>assert.fail('PK 统计不得发送弹幕')});
  const common = cat(i(3, room), i(4, now / 1000));
  const message = (method, body, id) => b(1, cat(b(1, method), b(2, cat(b(1, common), body)), i(3, id)));
  const start = message('WebcastLinkMicBattleMethod', b(2, cat(i(2, 42), i(3, now-60000), i(4, 300))), 101);
  const update = message('WebcastLinkMicMethod', cat(i(104, 42), score(rival, 600), score(self, 1200)), 102);
  const events = await decodeFrame(cat(b(6, 'gzip'), b(7, 'msg'), b(8, gzipSync(cat(start, update, update)))));
  for (const event of events) engine.ingest(event);
  const current = engine.pk.current();
  assert.equal(engine.running, false);
  assert.equal(current.phase, 'active'); assert.equal(current.key, '42');
  assert.equal(current.selfScore, 1200); assert.equal(current.opponentScore, 600);
  assert.equal(current.remainingMs, 240000);
  assert.equal(current.history.length, 1); assert.equal(current.dataQuality.events, 2);
  assert.notEqual(current.prediction.selfWin, null);
  assert.equal(engine.queue.length, 0);
});

test('PK 快速观察不等待普通事件持久化，同时保留完整事件按序交付和队列上限', async () => {
  const { JSDOM } = await import('jsdom');
  const { DouyinAdapter } = await import('../../src/browser/adapter.js');
  const dom = new JSDOM('<body></body>', { url:'https://live.douyin.com/1234567890' });
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {value:dom.window.location,configurable:true});
  class Socket extends dom.window.EventTarget {}
  dom.window.WebSocket = Socket;
  let unblock; const blocked = new Promise(resolve => { unblock = resolve; });
  const observed = [], delivered = [];
  const adapter = new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onPK:event=>observed.push(event),onEvent:async event=>{
    delivered.push(event); if (delivered.length === 1) await blocked;
  },onLog:()=>{},onStatus:()=>{}});
  try {
    adapter.hook(); const socket = new dom.window.WebSocket('wss://webcast5-ws-web-lf.douyin.com/webcast/im/push/v2/');
    const message = (method, body, id) => b(1, cat(b(1, method), b(2, body), i(3, id)));
    const ordinary = b(8, message('WebcastControlMessage', i(2, 3), 100));
    socket.dispatchEvent(new dom.window.MessageEvent('message', {data:ordinary}));
    await adapter.decodeChain; await Promise.resolve();
    const updates = b(8, cat(message('WebcastLinkMicMethod', score(self, 1000), 101), message('WebcastLinkMicMethod', score(self, 1100), 102)));
    socket.dispatchEvent(new dom.window.MessageEvent('message', {data:updates}));
    await adapter.decodeChain;
    assert.deepEqual(observed.map(event=>event.scores[0].score), [1000,1100]); assert.equal(delivered.length, 1);
    assert.equal(adapter.status.pkScoreEvents, 2); assert.equal(adapter.status.lastPK.method, 'WebcastLinkMicMethod');
    for (let count=0; count<255; count++) socket.dispatchEvent(new dom.window.MessageEvent('message', {data:ordinary}));
    assert.equal(adapter.pending, 256); assert.equal(adapter.status.frameGaps, 1);
    unblock(); await adapter.chain;
    assert.deepEqual(delivered.slice(0,3).map(event=>event.type), ['end','pk-score','pk-score']); assert.equal(adapter.pending, 0);
  } finally {
    unblock(); await adapter.chain; dom.window.close();
    if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation); else delete globalThis.location;
  }
});

test('扩展 MAIN 桥接在普通背压期间只发布一份 PK，普通消息继续等待恢复', async () => {
  const { readFile } = await import('node:fs/promises');
  const { JSDOM } = await import('jsdom');
  const source = await readFile(new URL('../../extension/page.js', import.meta.url), 'utf8');
  const dom = new JSDOM('<body></body>', {url:'https://live.douyin.com/1234567890',runScripts:'outside-only'});
  const published = []; let options;
  dom.window.DouyinAdapter = class { constructor(input) {options=input;} hook() {} emitStatus() {} };
  dom.window.DEFAULTS = {}; dom.window.copy = value => ({...value});
  dom.window.postMessage = value => published.push(value);
  try {
    dom.window.eval(source);
    const control = data => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {source:dom.window,origin:dom.window.location.origin,data:{source:'live-assistant-content-v1',room:'1234567890',...data}}));
    control({type:'hello'}); control({type:'flow',paused:true});
    options.onEvent({id:'chat-1',type:'chat'});
    const pk = {id:'pk-1',type:'pk-score',scores:[{anchorId:self,score:1000}]};
    options.onPK(pk); options.onEvent(pk);
    assert.deepEqual(published.filter(item=>item.type==='event').map(item=>item.event.id), ['pk-1']);
    control({type:'flow',paused:false});
    assert.deepEqual(published.filter(item=>item.type==='event').map(item=>item.event.id), ['pk-1','chat-1']);
  } finally { dom.window.close(); }
});

test('压缩高峰只缓存预算内的解码事件，超限重解码保留交付且错误只累计一次', async () => {
  const { JSDOM } = await import('jsdom');
  const { DouyinAdapter } = await import('../../src/browser/adapter.js');
  const dom = new JSDOM('<body></body>', {url:'https://live.douyin.com/1234567890'});
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {value:dom.window.location,configurable:true});
  class Socket extends dom.window.EventTarget {}
  dom.window.WebSocket = Socket;
  let unblock; const blocked = new Promise(resolve=>{unblock=resolve;});
  const delivered = [], observed = [];
  const adapter = new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onPK:event=>observed.push(event.id),onEvent:async event=>{delivered.push(event.id);if(delivered.length===1)await blocked;},onLog:()=>{},onStatus:()=>{}});
  try {
    adapter.hook(); const socket = new dom.window.WebSocket('wss://webcast5-ws-web-lf.douyin.com/webcast/im/push/v2/');
    const msg = (method,body,id) => b(1,cat(b(1,method),b(2,body),i(3,id)));
    socket.dispatchEvent(new dom.window.MessageEvent('message',{data:b(8,msg('WebcastControlMessage',i(2,3),100))}));
    await adapter.decodeChain;
    const largeText = 'x'.repeat(4_300_000);
    for (const id of [101,103]) {
      const response = cat(msg('WebcastChatMessage',b(3,largeText),id),msg('WebcastLinkMicMethod',score(self,id),id+1),
        ...(id===103?[msg('WebcastChatMessage',Buffer.from([10,5,1]),105)]:[]));
      socket.dispatchEvent(new dom.window.MessageEvent('message',{data:cat(b(6,'gzip'),b(8,gzipSync(response)))}));
    }
    await adapter.decodeChain;
    assert.deepEqual(observed,['102','104']); assert.equal(delivered.length,1);
    assert.equal(adapter.status.uncachedFrames,1); assert.ok(adapter.status.decodedCacheBytes<=16*1024*1024);
    unblock(); await adapter.chain;
    assert.deepEqual(delivered,['100','101','102','103','104']); assert.equal(adapter.status.errors,1);
    assert.equal(adapter.status.decodedCacheBytes,0); assert.equal(adapter.pendingBytes,0);
  } finally {unblock();await adapter.chain;dom.window.close();if(previousLocation)Object.defineProperty(globalThis,'location',previousLocation);else delete globalThis.location;}
});

test('MAIN 初始化积压的旧 PK 开始被新结束超越后，迟到事件不会复活战局', async () => {
  const { readFile } = await import('node:fs/promises'); const { JSDOM } = await import('jsdom');
  const source = await readFile(new URL('../../extension/page.js',import.meta.url),'utf8');
  const dom = new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890',runScripts:'outside-only'});
  const now=1800000000000, config=copy(DEFAULTS);config.anchorId=self;
  const engine=new Engine({config,now:()=>now,send:()=>assert.fail('初始化只读PK不得发送')});
  let options; const published=[];
  dom.window.DouyinAdapter=class {constructor(input){options=input;}hook(){}emitStatus(){}};
  dom.window.DEFAULTS={};dom.window.copy=value=>({...value});
  dom.window.postMessage=value=>{if(value.type==='event'){published.push(value.event);engine.ingest(value.event);}};
  try {
    dom.window.eval(source);
    for(let index=0;index<130;index++)options.onEvent({id:`chat-${index}`,type:'chat',text:'积压',user:{id:`u-${index}`}});
    options.onPK({id:'old-start',type:'pk-start',battleId:'42',roomId:room,at:now-30000,startedAt:now-30000,durationMs:300000});
    dom.window.dispatchEvent(new dom.window.MessageEvent('message',{source:dom.window,origin:dom.window.location.origin,data:{source:'live-assistant-content-v1',type:'hello'}}));
    options.onPK({id:'new-end',type:'pk-end',battleId:'42',roomId:room,at:now,scores:[{anchorId:self,score:100},{anchorId:rival,score:50}]});
    for(let attempt=0;published.length<132&&attempt<10;attempt++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.ok(published.findIndex(event=>event.id==='new-end')<published.findIndex(event=>event.id==='old-start'));
    assert.equal(engine.pk.current().phase,'ended');assert.equal(engine.pk.current().remainingMs,0);
    assert.equal(engine.pk.current().selfScore,100);assert.equal(engine.pk.results.length,1);
  } finally {dom.window.close();}
});
