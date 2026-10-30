import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { Panel } from '../../src/ui/panel.js';
import { AnchorStats } from '../../src/core/anchor-stats.js';
import { copy, DEFAULTS, Engine, mergeConfig } from '../../src/core/engine.js';
import { DEFAULT_TIMER_PHRASES } from '../../src/core/phrases.js';
import { DouyinAdapter, RoomLock } from '../../src/browser/adapter.js';
import { gzipSync } from 'node:zlib';
import { webLocks } from '../helpers/web-locks.mjs';
import { boot } from '../../src/app.js';
import { buildFixture } from '../helpers/build.mjs';
import { join } from 'node:path';
const fixture = await buildFixture();
after(fixture.cleanup);

function setup(body = '') {
  const dom = new JSDOM(`<body>${body}</body>`, { url: 'https://live.douyin.com/1234567890?anchor_id=1234567890', pretendToBeVisual: true });
  for (const name of ['document', 'window', 'location', 'MutationObserver', 'HTMLElement']) globalThis[name] = dom.window[name];
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.CSS = { escape: s => s.replace(/["\\]/g, '\\$&') };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: webLocks() } });
  for (const el of dom.window.document.querySelectorAll('*')) el.getClientRects = () => [{ width: 100, height: 30 }];
  return dom;
}
test('福袋红包工具可导航、独立保存配置，立即停止同步关闭开关并显示确认进度',async()=>{
  const dom=setup();let saved,stops=0;
  const panel=new Panel({config:copy(DEFAULTS),room:'1',callbacks:{save:async c=>{saved=c;},toolAction:async(id,action)=>{assert.equal(id,'rewards');assert.equal(action,'stop');stops++;}}});
  try {
    panel.tab('rewards');assert.equal(panel.activeCategory,'tools');assert.equal(panel.node('[data-page=rewards]').hidden,false);
    const enabled=panel.node('[data-field="rewards.enabled"]'),bag=panel.node('[data-field="rewards.luckyBag"]');
    assert.equal(enabled.checked,false);assert.equal(bag.checked,true);enabled.click();bag.click();
    panel.node('[data-action=save]').click();await new Promise(setImmediate);
    assert.equal(saved.rewards.enabled,true);assert.equal(saved.rewards.luckyBag,false);assert.equal(saved.rewards.redPacket,true);
    assert.equal(saved.rewards.entryXPath,DEFAULTS.rewards.entryXPath);
    panel.updateToolState('rewards',{reason:'福袋参与结果未确认，本轮不会重复点击',submitted:1,confirmed:0});
    assert.match(panel.node('[data-rewards-progress]').textContent,/点击参与 1 次 · 页面确认 0 次/);
    panel.node('[data-action=rewards-stop]').click();await new Promise(setImmediate);
    assert.equal(stops,1);assert.equal(enabled.checked,false);assert.equal(panel.read().rewards.enabled,false);
  } finally {panel.destroy();dom.window.close();}
});
test('扩展工具自动点赞独立于回复模式：输入不会污染配置，状态和停止按钮可用',async()=>{
  const dom=setup(),config=copy(DEFAULTS),calls=[];
  const panel=new Panel({config,room:'1',callbacks:{toolAction:(id,action,value)=>{assert.equal(id,'auto-like');calls.push(action==='start'?value:action);}}});
  try {
    panel.node('[data-category=tools]').click();
    assert.equal(panel.activeTab,'auto-like');assert.equal(panel.node('[data-page=auto-like]').hidden,false);
    assert.equal(panel.node('[data-auto-like=intervalSec]').value,'2');
    assert.equal(panel.node('[data-auto-like=intervalSec]').min,'0.001');
    assert.equal(panel.node('[data-auto-like=intervalSec]').step,'0.001');
    panel.node('[data-auto-like=batch]').value='30';
    panel.node('[data-auto-like=intervalSec]').value='0.001';
    assert.equal(panel.node('[data-auto-like=intervalSec]').checkValidity(),true);
    panel.node('[data-auto-like=target]').value='65';
    panel.node('[data-action=auto-like-start]').click();await new Promise(setImmediate);
    assert.deepEqual(calls[0],{batch:30,intervalSec:0.001,target:65});assert.deepEqual(panel.read(),config);assert.equal(panel.dirty,false);
    panel.updateToolState('auto-like',{phase:'running',accepted:30,batches:1,reason:'正在自动点赞'});
    assert.equal(panel.node('[data-action=auto-like-start]').disabled,true);
    assert.equal(panel.node('[data-auto-like=batch]').disabled,true);
    assert.match(panel.node('[data-auto-like-progress]').textContent,/30 次 · 1 批/);
    panel.node('[data-action=auto-like-stop]').click();assert.equal(calls.at(-1),'stop');
    panel.updateToolState('auto-like',{phase:'stopped',accepted:30,batches:1,reason:'已停止'});
    assert.equal(panel.node('[data-action=auto-like-start]').disabled,false);
    assert.equal(panel.node('[data-action=auto-like-stop]').disabled,true);
  } finally {panel.destroy();dom.window.close();}
});
test('PK 播报设置通过内联摘要展开，开关联动、零点预览与表单草稿保持一致',()=>{
  const dom=setup(),config=copy(DEFAULTS),panel=new Panel({config,room:'1',callbacks:{}});
  try{
    assert.equal(panel.root.querySelector('[data-tab=pk-settings]'),null);
    assert.equal(panel.root.querySelector('[data-pk-settings-open],[data-pk-settings-close]'),null);
    const settings=panel.node('[data-pk-settings]');assert.equal(settings.closest('[data-page]').dataset.page,'pk');assert.equal(settings.open,false);
    const summary=settings.querySelector('summary');summary.click();
    assert.equal(panel.activeTab,'pk');assert.equal(settings.open,true);assert.equal(panel.dirty,false);
    assert.equal(panel.root.querySelectorAll('[data-field="pkOperations.enabled"]').length,1);
    assert.equal(panel.node('[data-field="pkOperations.aiEnabled"]').closest('details'),settings);
    assert.equal(panel.node('[data-field="pkOperations.reportEnabled"]').matches(':disabled'),true);
    assert.equal(panel.node('[data-pk-midnight-settings]').hidden,true);
    panel.node('[data-field="pkOperations.enabled"]').click();
    assert.match(panel.node('[data-summary=pk-broadcast]').textContent,/固定格式/);
    assert.equal(panel.node('[data-pk-settings-state]').textContent,'已开启');
    assert.equal(panel.node('[data-field="pkOperations.reportEnabled"]').matches(':disabled'),false);
    const report=panel.node('[data-field="pkOperations.reportEnabled"]'),interval=panel.node('[data-field="pkOperations.reportSec"]');
    if(report.checked)report.click();
    assert.equal(interval.disabled,true);report.click();assert.equal(interval.disabled,false);
    interval.value='90';interval.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    assert.match(panel.node('[data-pk-settings-summary]').textContent,/任务每 90 秒/);
    const midnight=panel.node('[data-field="pkOperations.midnightEnabled"]');
    if(midnight.checked)midnight.click();
    assert.equal(panel.node('[data-pk-midnight-settings]').hidden,true);midnight.click();
    assert.equal(panel.node('[data-pk-midnight-settings]').hidden,false);
    const duration=panel.node('[data-field="pkOperations.durationSec"]'),grace=panel.node('[data-field="pkOperations.crossMidnightSec"]');
    duration.value='600';grace.value='10';duration.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    assert.match(panel.node('[data-pk-plan-preview]').textContent,/23:50:10 开局 → 次日 00:00:10 结束/);
    grace.value='600';grace.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    assert.match(panel.node('[data-pk-plan-preview]').textContent,/结束余量需小于 PK 时长/);
    grace.value='10';grace.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    const read=panel.read();assert.equal(read.pkOperations.enabled,true);assert.equal(read.ai.enabled,false);
    assert.match(settings.textContent,/固定格式示例/);
    summary.click();assert.equal(panel.activeTab,'pk');assert.equal(settings.open,false);
    summary.click();assert.equal(panel.node('[data-field="pkOperations.enabled"]').checked,true);assert.equal(interval.value,'90');
    panel.node('[data-field="pkOperations.enabled"]').click();assert.equal(interval.matches(':disabled'),true);assert.equal(panel.node('[data-pk-midnight-settings]').hidden,true);
    panel.node('[data-field="pkOperations.enabled"]').click();assert.equal(interval.value,'90');assert.equal(report.checked,true);
    for(const key of ['gift','welcome','like','keyword','bot'])panel.node(`[data-field="${key}.enabled"]`).checked=false;
    panel.node('[data-field="timersEnabled"]').checked=false;panel.applyFeatureVisibility();
    panel.tab('ai');panel.node('[data-category=interaction]').click();assert.equal(panel.activeTab,'anchor');
    panel.node('[data-tab=pk]').click();assert.equal(panel.activeTab,'pk');assert.equal(settings.open,true);assert.equal(interval.value,'90');
    panel.tab('ai');
    const contextInfo=[...panel.root.querySelectorAll('h3')].find(node=>node.textContent==='所有 AI 功能共用直播上下文');
    assert.equal(contextInfo.closest('[data-chat-controls]'),null);
  }finally{panel.destroy();dom.window.close();}
});
test('面板可完整读写配置、切换选项、保存不会丢失隐藏字段', () => {
  const dom = setup(); const c = copy(DEFAULTS); c.mode = 'preview'; c.anchorId = '1234567890'; c.like.enabled = true;
  const panel = new Panel({ config: c, room: '1234567890', callbacks: {} });
  assert.deepEqual(panel.read(), c);
  panel.root.querySelector('[data-field="welcome.minWealth"]').value = '40';
  panel.root.querySelector('[data-field="gift.minValue"]').value = '200';
  const next = panel.read(); assert.equal(next.welcome.minWealth, 40); assert.equal(next.gift.minValue, 200); assert.equal(next.sending.queueLimit, 200);
  panel.tab('gift'); assert.equal(panel.root.querySelector('[data-page="gift"]').hidden, false); assert.equal(panel.root.querySelector('[data-page="runtime"]').hidden, true);
  panel.tab('likes');
  assert.equal(panel.root.querySelector('[data-field="like.cooldownSec"]'), null); assert.equal(panel.root.querySelector('[data-page="likes"]').hidden, false);
  dom.window.close();
});
test('旧配置升级后只展示四种房间游戏，开关同步菜单并只导出保留的玩法', () => {
  const dom=setup(), config=mergeConfig({bot:{enabled:true,diceEnabled:true,coinEnabled:true,rpsEnabled:true,choiceEnabled:true}});
  const panel=new Panel({config,room:'1',callbacks:{}});
  try {
    panel.tab('bot');
    const page=panel.node('[data-page="bot"]');
    assert.deepEqual([...page.querySelectorAll('[role="switch"]')].map(node=>node.getAttribute('aria-label')),['成语接龙','猜数字','真心话','大冒险']);
    assert.match(page.textContent,/开始接龙.*开始猜数字.*开始真心话.*开始大冒险/su);
    assert.doesNotMatch(page.textContent,/骰子|硬币|猜拳|帮我选择/u);
    assert.match(panel.node('[data-bot-menu]').textContent,/接龙.*猜数字.*真心话.*大冒险/u);
    panel.node('[data-field="bot.guessEnabled"]').checked=false; panel.syncControls();
    assert.doesNotMatch(panel.node('[data-bot-menu]').textContent,/猜数字/u);
    const saved=panel.read();
    assert.equal(saved.bot.guessEnabled,false);
    for (const key of ['diceEnabled','coinEnabled','rpsEnabled','choiceEnabled']) assert.equal(Object.hasOwn(saved.bot,key),false);
  } finally { panel.destroy(); dom.window.close(); }
});
test('接龙局数、计分、读音和提示规则可配置，个人积分榜显示答错次数并保留结果', () => {
  const dom=setup(), config=copy(DEFAULTS); config.bot.enabled=true;
  const panel=new Panel({config,room:'1',callbacks:{}});
  const engine=new Engine({config,random:()=>0});
  try {
    panel.node('[data-field="bot.idiomMaxAttempts"]').value='3';
    panel.node('[data-field="bot.idiomPoints"]').value='7';
    panel.node('[data-field="bot.idiomGames"]').value='2';
    panel.node('[data-field="bot.idiomPenalty"]').value='3';
    panel.node('[data-field="bot.idiomHintIntervalSec"]').value='15';
    panel.node('[data-field="bot.idiomNasalRelaxed"]').checked=false;
    panel.node('[data-field="bot.idiomCountCorrectOnly"]').checked=true;
    panel.node('[data-field="bot.idiomHintsEnabled"]').checked=false;
    const next=panel.read();
    assert.equal(next.bot.idiomMaxAttempts,3);
    assert.equal(next.bot.idiomPoints,7);
    assert.equal(next.bot.idiomGames,2);
    assert.equal(next.bot.idiomPenalty,3);
    assert.equal(next.bot.idiomHintIntervalSec,15);
    assert.equal(next.bot.idiomNasalRelaxed,false);
    assert.equal(next.bot.idiomCountCorrectOnly,true);
    assert.equal(next.bot.idiomHintsEnabled,false);
    engine.bot.startSession('idiom','','','一心一意',next.bot);
    engine.bot.participate('意气风发',{id:'a',name:'<img src=x onerror=alert(1)>'},next.bot,50).commit();
    engine.bot.participate('接龙 你好世界',{id:'a',name:'<img src=x onerror=alert(1)>'},next.bot,50).commit();
    panel.open=true; panel.tab('bot'); panel.refresh(engine);
    assert.match(panel.node('[data-bot-session]').textContent,/剩2次/);
    assert.match(panel.node('[data-bot-scores]').textContent,/4 分.*答对 1 次.*答错 1 次/);
    assert.equal(panel.node('[data-bot-scores]').querySelector('img'),null);
    assert.equal(panel.node('[data-bot-score-empty]').hidden,true);
    const observer=new dom.window.MutationObserver(()=>{});
    observer.observe(panel.node('[data-bot-scores]'),{subtree:true,childList:true,characterData:true});
    panel.refresh(engine); assert.equal(observer.takeRecords().length,0); observer.disconnect();
    engine.bot.reply('结束游戏',next.bot,50,'主持','h').commit();
    panel.refresh(engine);
    assert.match(panel.node('[data-bot-session]').textContent,/已结束/);
    assert.match(panel.node('[data-bot-scores]').textContent,/4 分/);
    engine.bot.reply('开始接龙',next.bot,50,'主持','h').commit();
    panel.refresh(engine);
    assert.equal(panel.node('[data-bot-scores]').hidden,true);
    assert.equal(panel.node('[data-bot-score-empty]').hidden,false);
  } finally { panel.destroy(); dom.window.close(); }
});
test('最近观众列表展示可确认的性别和具体年龄，不显示缺失项',()=>{
  const dom=setup();const panel=new Panel({config:copy(DEFAULTS),room:'1',callbacks:{}});
  panel.updateViewers([
    {key:'uid:1',id:'1',name:'青山',gender:2,age:25},
    {key:'uid:2',id:'2',name:'匿名',gender:null,age:null}
  ]);
  const labels=[...panel.node('[data-viewer-picker]').options].map(option=>option.textContent);
  assert.ok(labels.some(label=>label.includes('青山 · 女 · 25岁')));
  assert.ok(labels.some(label=>label.includes('匿名')));
  assert.ok(!labels.some(label=>label.includes('匿名 · 男') || label.includes('匿名 · 女') || label.includes('匿名 · NaN岁')));
  dom.window.close();
});
test('昵称、回复和日志不会注入 HTML；界面不再提供人工审核队列', () => {
  const dom = setup(); const c = copy(DEFAULTS); c.mode = 'preview';
  const panel = new Panel({ config: c, room: '1', callbacks: {} }); const e = new Engine({ config: c }); e.start(); e.enqueue('welcome', '<img src=x onerror=alert(1)>'); panel.refresh(e);
  assert.equal(panel.root.querySelectorAll('img').length, 0);
  assert.equal(panel.root.querySelector('[data-queue]'), null);
  assert.equal(panel.root.querySelector('[data-sending-details]'), null);
  assert.equal(panel.root.querySelector('[data-field="sending.intervalSec"]'), null);
  assert.equal(panel.root.querySelector('[data-field="sending.perMinute"]'), null);
  assert.deepEqual([...panel.node('[data-field=mode]').options].map(option => option.value), ['auto','preview']);
  panel.log('preview', '<script>alert(1)</script>'); assert.equal(panel.node('[data-last-reply]').textContent, '<script>alert(1)</script>');
  panel.log('error', '<script>alert(1)</script>'); assert.equal(panel.root.querySelectorAll('script').length, 0); dom.window.close();
});
test('只显示已启用的模块；AI 服务启用后才开放 AI 生成选项', () => {
  const dom=setup(),c={...copy(DEFAULTS),mode:'preview'};c.gift.responseMode='ai';const p=new Panel({config:c,room:'1',callbacks:{}});
  try {
    assert.equal(p.node('[data-page=overview]').hidden,true);
    assert.equal(p.node('[data-page=runtime]').hidden,true);
    assert.equal(p.node('[data-tab=likes]').hidden,true);
    assert.equal(p.node('[data-tab=keywords]').hidden,true);
    assert.equal(p.node('[data-tab=timers]').hidden,true);
    assert.equal(p.node('[data-field="gift.responseMode"]').value,'rules');
    assert.equal(p.node('[data-field="gift.responseMode"] [value=ai]').hidden,true);
    p.node('[data-field="ai.enabled"]').checked=true;p.syncControls();
    assert.equal(p.node('[data-field="gift.responseMode"] [value=ai]').hidden,false);
    p.node('[data-field="ai.enabled"]').checked=false;p.syncControls();
    assert.equal(p.node('[data-field="gift.responseMode"]').value,'rules');
  } finally {p.destroy();dom.window.close();}
});
test('页面发送通过 native setter 驱动 input，并保留已有草稿', async () => {
  const dom = setup('<div><textarea id="chat" placeholder="说点什么"></textarea><button id="send">发送</button></div>'); const c = copy(DEFAULTS); c.mode = 'preview';
  const a = new DouyinAdapter({ page: dom.window, getConfig: () => c, onEvent: () => {}, onLog: () => {}, onStatus: () => {} });
  a.status.connected = true; a.status.lastFrame = Date.now();
  let inputEvent = 0, clicks = 0; dom.window.document.querySelector('#chat').addEventListener('input', () => inputEvent++); dom.window.document.querySelector('#send').addEventListener('click', () => { clicks++; dom.window.document.querySelector('#chat').value = ''; });
  const result = await a.send('测试候选', () => true); assert.equal(result.submitted, true); assert.equal(inputEvent, 1); assert.equal(clicks, 1);
  dom.window.document.querySelector('#chat').value = '手动草稿';
  await assert.rejects(a.send('另一条', () => true), /草稿/); assert.equal(dom.window.document.querySelector('#chat').value, '手动草稿'); dom.window.close();
});
test('页面发送等待期间暂停会取消，禁用按钮不会点击', async () => {
  const dom = setup('<div><textarea id="chat" placeholder="说点什么"></textarea><button id="send">发送</button></div>'); const c = copy(DEFAULTS); c.mode = 'preview';
  const a = new DouyinAdapter({ page: dom.window, getConfig: () => c, onEvent: () => {}, onLog: () => {}, onStatus: () => {} }); a.status.connected = true; a.status.lastFrame = Date.now();
  let current = true, clicks = 0; dom.window.document.querySelector('#send').addEventListener('click', () => clicks++);
  const task = a.send('测试候选', () => current); current = false; const result = await task;
  assert.equal(result.submitted, false); assert.equal(clicks, 0); assert.equal(dom.window.document.querySelector('#chat').value, '');
  dom.window.document.querySelector('#send').disabled = true; await assert.rejects(a.send('测试候选', () => true), /不可用/); assert.equal(clicks, 0); dom.window.close();
});
test('富文本使用编辑器粘贴处理器，并重新定位 React 替换后的发送图标', async () => {
  const dom = setup('<div class="webcast-chatroom"><div id="chatInput"><div id="editor" contenteditable="true"></div><div class="webcast-chatroom___send-icon disable"></div></div></div>');
  const input = dom.window.document.querySelector('#editor'); Object.defineProperty(input, 'isContentEditable', { value: true });
  dom.window.DataTransfer = class { constructor() { this.data = {}; } setData(k, v) { this.data[k] = v; } getData(k) { return this.data[k]; } };
  dom.window.ClipboardEvent = class extends dom.window.Event { constructor(type, options) { super(type, options); this.clipboardData = options.clipboardData; } };
  let pasteCount = 0, clicks = 0;
  dom.window.document.execCommand = () => assert.fail('已处理粘贴，不应走 fallback');
  input.addEventListener('paste', e => {
    e.preventDefault(); pasteCount++; input.textContent = '\u200b' + e.clipboardData.getData('text/plain');
    const replacement = dom.window.document.createElement('div'); replacement.className = 'webcast-chatroom___send-btn'; replacement.getClientRects = () => [{ width: 30, height: 30 }]; replacement.addEventListener('click', () => { clicks++; input.textContent = ''; });
    dom.window.document.querySelector('.webcast-chatroom___send-icon').replaceWith(replacement);
  });
  const a = new DouyinAdapter({ page: dom.window, getConfig: () => copy(DEFAULTS), onEvent: () => {}, onLog: () => {}, onStatus: () => {} }); a.status.connected = true; a.status.lastFrame = Date.now();
  assert.equal((await a.send('感谢支持', () => true)).submitted, true); assert.equal(pasteCount, 1); assert.equal(clicks, 1); dom.window.close();
});
test('富文本无粘贴处理器时使用原生插入；截断内容不提交', async () => {
  const dom = setup('<div class="webcast-chatroom"><div id="chatInput"><div id="editor" contenteditable="true"></div><button>发送</button></div></div>');
  const input = dom.window.document.querySelector('#editor'); Object.defineProperty(input, 'isContentEditable', { value: true });
  let clicks = 0; dom.window.document.querySelector('button').addEventListener('click', () => clicks++);
  dom.window.document.execCommand = (command, _, text) => { assert.equal(command, 'insertText'); input.textContent = text.slice(0, 2); return true; };
  const a = new DouyinAdapter({ page: dom.window, getConfig: () => copy(DEFAULTS), onEvent: () => {}, onLog: () => {}, onStatus: () => {} }); a.status.connected = true; a.status.lastFrame = Date.now();
  await assert.rejects(a.send('感谢支持', () => true), /不一致/); assert.equal(clicks, 0); assert.equal(input.textContent, '感谢'); dom.window.close();
});
test('WebSocket hook 保留原型、常量和页面帧，只观察抖音直播路径', async () => {
  const dom = setup();
  class FakeSocket extends dom.window.EventTarget { static OPEN = 1; constructor(url) { super(); this.url = url; this.binaryType = 'blob'; } send(data) { this.last = data; } }
  dom.window.WebSocket = FakeSocket;
  const events = []; const a = new DouyinAdapter({ page: dom.window, getConfig: () => copy(DEFAULTS), onEvent: e => events.push(e), onLog: () => {}, onStatus: () => {} }); a.hook();
  const socket = new dom.window.WebSocket('wss://webcast5-ws-web-lf.douyin.com/webcast/im/push/v2/');
  assert.ok(socket instanceof FakeSocket); assert.equal(dom.window.WebSocket.OPEN, 1); assert.equal(socket.binaryType, 'blob'); socket.send('native'); assert.equal(socket.last, 'native');
  socket.dispatchEvent(new dom.window.Event('open')); assert.equal(a.status.connected, true);
  new dom.window.WebSocket('wss://other.example.com/webcast/im/push/v2/'); assert.equal(a.status.sockets, 1);
  // gzip frame: Response.messages -> WebcastControlMessage(status=3)
  const pb = Buffer.from([10, 27, 10, 21, ...Buffer.from('WebcastControlMessage'), 18, 2, 16, 3]);
  const compressed = gzipSync(pb), frame = Buffer.concat([Buffer.from([58, 3, ...Buffer.from('msg'), 66, compressed.length]), compressed]);
  socket.dispatchEvent(new dom.window.MessageEvent('message', { data: frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) }));
  await a.chain; assert.equal(a.status.frames, 1); assert.equal(events[0].type, 'end'); socket.dispatchEvent(new dom.window.Event('close')); assert.equal(a.status.connected, false); dom.window.close();
});
test('仅观察同源直播 IM 长轮询，解码二进制响应并抑制跨传输重复事件', async () => {
  const dom = setup();
  class FakeSocket extends dom.window.EventTarget { static OPEN = 1; }
  class FakeXHR extends dom.window.EventTarget {
    open(method, url) { this.method = method; this.url = url; }
    send() { this.status = 200; this.responseType = this.forceUnsupported ? 'json' : 'arraybuffer'; const body = this.forceUnsupported ? null : this.body || (this.forceUnknown ? unknownResponse : frame); this.response = this.forceUnsupported ? {ok:true} : body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength); this.dispatchEvent(new dom.window.Event('load')); }
  }
  const v = value => { let n = BigInt(value), out = []; while (n > 127n) { out.push(Number(n & 127n) | 128); n >>= 7n; } out.push(Number(n)); return Buffer.from(out); };
  const bytes = (field, value) => { const data = Buffer.from(value); return Buffer.concat([v(field * 8 + 2), v(data.length), data]); };
  const integer = (field, value) => Buffer.concat([v(field * 8), v(value)]);
  const common = integer(2, 987654), control = Buffer.concat([bytes(1, common), integer(2, 3)]);
  const message = Buffer.concat([bytes(1, 'WebcastControlMessage'), bytes(2, control), integer(3, 123)]);
  const response = bytes(1, message), frame = Buffer.concat([bytes(7, 'msg'), bytes(8, response)]);
  const unknownMessage = Buffer.concat([bytes(1, 'WebcastMysteryMessage'), bytes(2, Buffer.from([0]))]);
  const unknownResponse = bytes(1, unknownMessage);
  dom.window.WebSocket = FakeSocket; dom.window.XMLHttpRequest = FakeXHR;
  const events = [], captures = [], a = new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:event=>events.push(event),onCapture:record=>captures.push(record),onLog:()=>{},onStatus:()=>{}});
  try {
    a.hook();
    const ignored = new dom.window.XMLHttpRequest(); ignored.open('GET', '/webcast/user/'); ignored.send();
    const socket = new dom.window.WebSocket('wss://webcast5-ws-web-lf.douyin.com/webcast/im/push/v2/');
    socket.dispatchEvent(new dom.window.MessageEvent('message', {data:frame}));
    const poll = new dom.window.XMLHttpRequest(); poll.body = response; poll.open('GET', '/webcast/im/fetch/?resp_content_type=protobuf&cursor=redacted'); poll.send();
    const unknown = new dom.window.XMLHttpRequest(); unknown.body = unknownResponse; unknown.open('GET', '/webcast/im/fetch/'); unknown.send();
    const unsupported = new dom.window.XMLHttpRequest(); unsupported.forceUnsupported = true; unsupported.open('GET', '/webcast/im/fetch/'); unsupported.send();
    await a.chain;
    assert.equal(a.status.pollHook, true); assert.equal(a.status.pollRequests, 3); assert.equal(a.status.pollResponses, 2); assert.equal(a.status.pollUnsupported, 1);
    assert.equal(a.status.pollFrames, 2); assert.equal(a.status.duplicateEvents, 1);
    assert.equal(a.status.connected,false);assert.equal(a.healthy(),true,'成功的长轮询不需要 WebSocket 在线');
    const lastPoll=a.status.lastPoll;a.status.lastPoll=Date.now()-90001;assert.equal(a.healthy(),false);a.status.lastPoll=lastPoll;
    assert.equal(a.status.unknownMethods.WebcastMysteryMessage, 1);
    assert.deepEqual(events.map(event=>event.type), ['end']); assert.equal(events[0].source, 'socket');
    assert.equal(captures.length,3,'帧日志包含重复业务帧和未知 method 帧');
    assert.equal(captures[0].transport,'socket');
    assert.equal(captures[0].messages[0].decodedTypes[0],'end');
    assert.deepEqual(captures[2].messages[0],{method:'WebcastMysteryMessage',messageId:'',decodedTypes:[]});
    assert.equal(Buffer.from(captures[0].rawBase64,'base64').toString('hex'),frame.toString('hex'));
  } finally { dom.window.close(); }
});
test('浏览器锁阻止多标签页同时运行，释放后允许接管', async () => {
  setup(); const options = { room: '1' };
  const a = new RoomLock(options), b = new RoomLock(options); assert.equal(await a.acquire(), true); assert.equal(await b.acquire(), false);
  a.release(); assert.equal(await b.acquire(), true); b.release();
});

test('突发超过 100 帧全部按序交付，事件订阅异常不截断后续消息', async () => {
  const dom = setup();
  class Socket extends dom.window.EventTarget { constructor() { super(); } }
  dom.window.WebSocket = Socket;
  let delivered = 0;
  const adapter = new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{ delivered++; if(delivered===1)throw new Error('订阅异常'); },onLog:()=>{},onStatus:()=>{}});
  try {
    adapter.hook(); const socket = new dom.window.WebSocket('wss://webcast5-ws-web-lf.douyin.com/webcast/im/push/v2/');
    const message = Buffer.from([10,27,10,21,...Buffer.from('WebcastControlMessage'),18,2,16,3]);
    const frame = Buffer.concat([Buffer.from([66,message.length]),message]);
    for(let n=0;n<160;n++)socket.dispatchEvent(new dom.window.MessageEvent('message',{data:frame}));
    assert.equal(adapter.pending,160); await adapter.chain;
    assert.equal(delivered,160); assert.equal(adapter.status.frames,160); assert.equal(adapter.status.errors,1); assert.equal(adapter.pending,0);
  } finally {dom.window.close();}
});

test('异步事件处理失败会被收敛为诊断错误，并保持后续帧可交付', async () => {
  const dom = setup();
  class Socket extends dom.window.EventTarget { constructor() { super(); } }
  dom.window.WebSocket = Socket;
  let delivered = 0;
  const adapter = new DouyinAdapter({
    page: dom.window,
    getConfig: () => copy(DEFAULTS),
    onEvent: async () => {
      delivered++;
      await Promise.resolve();
      if (delivered === 1) throw new Error('异步订阅异常');
    },
    onLog: () => {}, onStatus: () => {}
  });
  try {
    adapter.hook();
    const socket = new dom.window.WebSocket('wss://webcast5-ws-web-lf.douyin.com/webcast/im/push/v2/');
    const message = Buffer.from([10,27,10,21,...Buffer.from('WebcastControlMessage'),18,2,16,3]);
    const frame = Buffer.concat([Buffer.from([66,message.length]),message]);
    for (let n = 0; n < 8; n++) socket.dispatchEvent(new dom.window.MessageEvent('message', {data:frame}));
    await adapter.chain;
    assert.equal(delivered, 8);
    assert.equal(adapter.status.errors, 1);
    assert.equal(adapter.pending, 0);
  } finally { dom.window.close(); }
});
test('生成的单文件油猴脚本在加载前可启动，无外部依赖且默认暂停', async () => {
  const source = await readFile(join(fixture.dist, 'douyin-live-assistant.user.js'), 'utf8');
  const values = new Map();
  const dom = new JSDOM('<body></body>', { url: 'https://live.douyin.com/1234567890?anchor_id=1234567890', runScripts: 'outside-only', pretendToBeVisual: true });
  Object.assign(dom.window, { unsafeWindow: dom.window, TextDecoder, TextEncoder, GM_getValue: (k, fallback) => values.get(k) ?? fallback, GM_setValue: (k, v) => values.set(k, v), GM_deleteValue: k => values.delete(k), GM_xmlhttpRequest: () => assert.fail('默认不应请求 AI'), GM_registerMenuCommand: () => {} });
  dom.window.eval(source); const host = dom.window.document.getElementById('douyin-live-assistant'); assert.ok(host); assert.equal(host.shadowRoot.querySelector('[data-state]').textContent, '已暂停');
  assert.equal(host.shadowRoot.querySelector('[data-field="anchorId"]').value, '1234567890'); assert.equal(source.includes('@require'), false); dom.window.close();
});

test('价格、关键词、名单、多个定时组用表单完整读写；规则可排序删除', () => {
  const dom=setup();const c={...copy(DEFAULTS),mode:'preview'};c.gift.prices={'玫瑰':1};c.welcome.listed=['123','name:青山'];c.keyword.rules=[{keywords:['几点','时间'],reply:'晚上八点',exact:false},{keywords:['地址'],reply:'看置顶',exact:true}];c.timers=[{id:'one',enabled:true,responseMode:'rules',messages:['欢迎','点个关注'],intervalSec:300,start:'22:00',end:'02:00',quietSec:15},{id:'two',enabled:false,responseMode:'rules',messages:['喝水'],intervalSec:600,start:'',end:'',quietSec:30}];
  const p=new Panel({config:c,room:'1',callbacks:{}});assert.deepEqual(p.read(),c);
  p.root.querySelector('[data-move="down"]').click();assert.equal(p.read().keyword.rules[0].reply,'看置顶');
  p.root.querySelector('[data-list="prices"] [data-remove]').click();assert.deepEqual(p.read().gift.prices,{});
  p.updateViewers([{key:'uid:999',id:'999',name:'新观众',wealthLevel:40}]);p.node('[data-viewer-picker]').value='uid:999';p.node('[data-action="add-viewer"]').click();assert.ok(p.read().welcome.listed.includes('uid:999'));
  const row=p.addRow('prices');assert.throws(()=>p.read(),/礼物名称/);assert.equal(p.activeTab,'gift');assert.equal(row.querySelector('[data-item="key"]').getAttribute('aria-invalid'),'true');
  p.destroy();dom.window.close();
});
test('空定时话术会展开折叠区并定位错误，启用组不能静默空跑',()=>{
  const dom=setup(),c={...copy(DEFAULTS),mode:'preview'};c.timersEnabled=true;c.timers=[{id:'blank',enabled:true,messages:[],intervalSec:300,start:'',end:'',quietSec:15}];const p=new Panel({config:c,room:'1',callbacks:{}});
  const timing=p.root.querySelector('[data-list="timers"] details');assert.equal(timing.open,false);assert.throws(()=>p.read(),/至少一条定时话术/);assert.equal(p.activeTab,'timers');assert.equal(p.root.querySelector('[data-item="messages"]').getAttribute('aria-invalid'),'true');p.root.querySelector('[data-item="messages"]').value='欢迎';p.root.querySelector('[data-item="quietSec"]').value='-1';assert.throws(()=>p.read(),/互动避让/);assert.equal(timing.open,true);p.destroy();dom.window.close();
});
test('默认欢迎关注话术直接显示，设置中没有补充预设按钮', () => {
  const dom=setup(), config=copy(DEFAULTS);
  const panel=new Panel({config,room:'1',callbacks:{}});
  try {
    assert.equal(panel.root.querySelector('[data-phrase-library], [data-phrase-group], [data-keyword-presets]'),null);
    assert.deepEqual(panel.node('[data-list="timers"] [data-item="messages"]').value.split('\n'),DEFAULT_TIMER_PHRASES);
    assert.deepEqual(panel.read().timers,config.timers);
  } finally { panel.destroy(); dom.window.close(); }
});
test('直接编辑话术保留草稿、自定义规则及各定时组启停和间隔', () => {
  const dom=setup(), config=copy(DEFAULTS);
  config.gift.templates=['自己的感谢'];
  config.keyword.rules=[{keywords:['几点开播'],reply:'今晚八点',exact:false}];
  config.timers=[{...config.timers[0],messages:['自己的定时内容'],enabled:false,intervalSec:720}, {...config.timers[0],id:'second',messages:['第二组']}];
  const panel=new Panel({config,room:'1',callbacks:{}});
  try {
    const field=panel.node('[data-list="timers"] [data-item="messages"]');
    field.value+='\n欢迎来玩，喜欢就关注一下。';
    field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    const result=panel.read();
    assert.deepEqual(result.gift.templates,config.gift.templates);
    assert.deepEqual(result.keyword.rules,config.keyword.rules);
    assert.deepEqual(result.timers[0],{...config.timers[0],messages:['自己的定时内容','欢迎来玩，喜欢就关注一下。']});
    assert.deepEqual(result.timers[1],config.timers[1]);
    assert.equal(result.timersEnabled,false); assert.equal(panel.dirty,true);
  } finally { panel.destroy(); dom.window.close(); }
});
test('未保存设置开始时先保存，等待期间刷新不会允许重复开始',async()=>{
  const dom=setup();let release,starts=0,saves=0;const c={...copy(DEFAULTS),mode:'preview'},e=new Engine({config:c});
  const p=new Panel({config:c,room:'1',callbacks:{save:async()=>{saves++;await new Promise(r=>release=r);},start:()=>{starts++;e.start();}}});p.refresh(e);
  const input=p.root.querySelector('[data-field="gift.minValue"]');input.value='200';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  p.node('[data-action="start"]').click();p.refresh(e);p.node('[data-action="start"]').click();assert.equal(saves,1);assert.equal(p.node('[data-action="start"]').disabled,true);
  release();await new Promise(r=>setTimeout(r,10));assert.equal(starts,1);assert.equal(p.dirty,false);assert.equal(p.node('[data-action="start"]').disabled,true);
  p.destroy();dom.window.close();
});

test('两种调试弹幕只在自动发送运行时启用，并分别传递普通和管理员通道',async()=>{
  const dom=setup(),channels=[];const c={...copy(DEFAULTS),mode:'auto'},e=new Engine({config:c});
  const p=new Panel({config:c,room:'1',callbacks:{debugSend:channel=>{channels.push(channel);}}});
  const buttons=['debug-send','debug-send-admin'].map(action=>p.node(`[data-action=${action}]`));
  try {
    p.refresh(e);assert.ok(buttons.every(button=>button.disabled));
    e.start();p.refresh(e);assert.ok(buttons.every(button=>!button.disabled));
    for (const button of buttons) {button.click();await new Promise(r=>setTimeout(r,0));}
    assert.deepEqual(channels,['chat','admin']);assert.match(p.node('.toast').textContent,/管理员弹幕测试消息已加入发送队列/);
    p.refresh(e,{contextInvalidated:true});assert.ok(buttons.every(button=>button.disabled));
    e.config.mode='preview';p.refresh(e);assert.ok(buttons.every(button=>button.disabled));
  } finally {p.destroy();dom.window.close();}
});

test('调试发送经应用队列保留两种通道，管理员测试不依赖欢迎规则',async()=>{
  const dom=setup(),values=new Map([['live-assistant:config:1234567890',{mode:'auto',welcome:{enabled:false,admin:{enabled:false}}}]]),sent=[];
  let api,connected=true;
  const adapter={status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>connected,requestAvailable:()=>true,
    send:async(text,isCurrent,{channel})=>{assert.equal(isCurrent(),true);sent.push({text,channel});return {submitted:true,channelUsed:channel};}};
  const engine=boot({page:dom.window,get:(key,fallback)=>values.get(key)??fallback,set:(key,value)=>values.set(key,value),del:key=>values.delete(key),request:()=>{},adapterFactory:()=>adapter,identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>{api=value;}});
  try {
    assert.throws(()=>api.panel.callbacks.debugSend('admin'),/开始场控/);
    await api.panel.callbacks.start();
    connected=false;assert.throws(()=>api.panel.callbacks.debugSend('admin'),/未连接/);connected=true;
    api.panel.callbacks.debugSend('chat');api.panel.callbacks.debugSend('admin');
    await new Promise(setImmediate);
    assert.deepEqual(sent,[{text:'调试消息发送测试',channel:'chat'},{text:'管理员弹幕调试消息发送测试',channel:'admin'}]);
    assert.equal(engine.queue.length,0);
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});
test('稳定刷新不重建节点，收起后日志不渲染，记录限制200条',async()=>{
  const dom=setup();const p=new Panel({config:{...copy(DEFAULTS), mode:'preview'},room:'1',callbacks:{}}),e=new Engine({config:{...copy(DEFAULTS), mode:'preview'}});e.start();p.refresh(e);
  const observer=new dom.window.MutationObserver(()=>{});observer.observe(p.root,{subtree:true,childList:true,attributes:true,characterData:true});
  for(let i=0;i<100;i++)p.refresh(e);assert.equal(observer.takeRecords().length,0);
  p.toggleOpen();const logs=p.node('[data-logs]').innerHTML;for(let i=0;i<1000;i++)p.log('system',String(i));assert.equal(p.entries.length,200);assert.equal(p.node('[data-logs]').innerHTML,logs);assert.equal(p.logTimer,undefined);
  observer.disconnect();p.destroy();dom.window.close();
});
test('DOM备用只读新增弹幕，无关变化不全页扫描；socket活跃时抑制',async()=>{
  const dom=setup('<div id="video"><span id="counter">0</span></div><div id="chat"><div data-e2e="chat-message"><b data-e2e="chat-nickname">旧用户</b><span data-e2e="chat-content">历史</span></div></div>');let enabled=true;const events=[];
  const a=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:e=>events.push(e),onLog:()=>{},onStatus:()=>{},shouldReadChat:()=>enabled});a.observeDOM();
  let scans=0;const query=dom.window.document.querySelectorAll.bind(dom.window.document);dom.window.document.querySelectorAll=(s)=>{scans++;return query(s);};
  for(let i=0;i<100;i++)document.querySelector('#counter').firstChild.data=String(i);await new Promise(r=>setTimeout(r,10));assert.equal(scans,0);assert.equal(events.length,0);
  const insert=text=>{const row=document.createElement('div');row.dataset.e2e='chat-message';row.innerHTML=`<b data-e2e="chat-nickname">观众</b><span data-e2e="chat-content">${text}</span>`;document.querySelector('#chat').append(row);};
  insert('新弹幕');await new Promise(r=>setTimeout(r,330));assert.equal(events.length,1);assert.equal(a.status.domBatches,1);assert.equal(a.status.domRows,2);
  a.lastSocketChat=Date.now();insert('socket已处理');await new Promise(r=>setTimeout(r,10));assert.equal(events.length,1);
  a.lastSocketChat=0;insert('恢复时历史');await new Promise(r=>setTimeout(r,10));assert.equal(events.length,1);
  insert('恢复后新增');await new Promise(r=>setTimeout(r,330));assert.equal(events.length,2);
  enabled=false;a.stopDOM();dom.window.close();
});

test('WebSocket 活跃且普通弹幕采集关闭时仍读取新增守护和贡献榜播报', async () => {
  const dom=setup('<div id="chat"></div>'),events=[];
  const a=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:e=>events.push(e),onLog:()=>{},onStatus:()=>{},shouldReadChat:()=>false,shouldReadMilestones:()=>true});a.observeDOM();
  a.lastSocketChat=Date.now();
  for(const text of ['恭喜 孤独患者 成为星守护','恭喜 孤独患者成为No.2本场1000贡献用户']){
    const row=document.createElement('div');row.dataset.e2e='chat-message';row.textContent=text;document.querySelector('#chat').append(row);
  }
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.deepEqual(events.map(event=>event.milestone),[
    {kind:'guardian',name:'孤独患者'},
    {kind:'contribution',name:'孤独患者',rank:2}
  ]);
  a.stopDOM();dom.window.close();
});

test('贡献播报只解析正文，自发感谢的 DOM 回显不会拼入发送者昵称再触发回复', async () => {
  const dom=setup('<div id="chat"></div>'), events=[], sent=[];
  const config=copy(DEFAULTS); config.selfId='10';
  let now=1800000000000;
  const engine=new Engine({config,now:()=>now,send:async(text,isCurrent,hooks)=>{
    await hooks.beforeClick(); sent.push(text); return {submitted:true};
  }});
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>config,onEvent:event=>{events.push(event);engine.ingest(event);},onLog:()=>{},onStatus:()=>{},shouldReadChat:()=>false,shouldReadMilestones:()=>true});
  const insert=(name,text)=>{
    const row=document.createElement('div'); row.dataset.e2e='chat-message';
    const nickname=document.createElement('b'); nickname.dataset.e2e='chat-nickname'; nickname.textContent=name;
    const content=document.createElement('span'); content.dataset.e2e='chat-content'; content.textContent=text;
    row.append(nickname,content); document.querySelector('#chat').append(row);
  };
  try {
    engine.start(); adapter.observeDOM();
    engine.ingest({type:'chat',source:'socket',roomId:'live-1',user:{name:'系统'},text:'恭喜 青山成为本场No.1、1000票贡献用户！'});
    await engine.tick(); assert.equal(sent.length,1);
    insert('感谢小助手',sent[0]);
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(events.length,1);
    assert.deepEqual(events[0].milestone,{kind:'contribution',name:'青山',rank:1});
    assert.equal(events[0].text,sent[0]);
    assert.equal(engine.queue.length,0);
    now+=600001; await engine.tick();
    insert('系统','恭喜 青山成为本场No.2、1000票贡献用户！');
    insert('系统','恭喜 绿水成为本场No.2、1000票贡献用户！');
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.deepEqual(engine.queue.map(job=>job.text),['感谢绿水成为本场No.2、1000票贡献用户！']);
  } finally {adapter.stopDOM?.();dom.window.close();}
});

test('DOM备用异步订阅异常和下播回调 rejection 会被收敛，后续事件仍可处理', async () => {
  const dom = setup('<div id="chat"></div>');
  const c = copy(DEFAULTS); c.adapter.endSelector = '#end';
  const events = [], calls = [], logs = [];
  const a = new DouyinAdapter({
    page: dom.window,
    getConfig: () => c,
    onEvent: async event => {
      calls.push(event.type);
      if (event.type === 'end') throw new Error('异步下播订阅异常');
      events.push(event);
      await Promise.resolve();
      if (event.text === '第一次') throw new Error('异步弹幕订阅异常');
    },
    onLog: (_, message) => logs.push(message), onStatus: () => {}
  });
  a.observeDOM();
  const insert = text => {
    const row = dom.window.document.createElement('div'); row.dataset.e2e = 'chat-message';
    row.innerHTML = `<b data-e2e="chat-nickname">观众</b><span data-e2e="chat-content">${text}</span>`;
    dom.window.document.querySelector('#chat').append(row);
  };
  try {
    const end = dom.window.document.createElement('div'); end.id = 'end'; end.getClientRects = () => [{ width: 1, height: 1 }];
    dom.window.document.body.append(end);
    insert('第一次'); insert('第二次');
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.deepEqual(events.map(event => event.text), ['第一次', '第二次']);
    assert.deepEqual(calls, ['end', 'chat', 'chat']);
    assert.equal(logs.length, 1); // report() 对短时间内的重复异常做限流
    a.stopDOM();
  } finally { dom.window.close(); }
});

test('DOM场次识别只在直播状态与下播提示的可见边沿发送一次', async () => {
  const dom=setup('<div id="chat"></div>'), c=copy(DEFAULTS), events=[];
  c.adapter.startSelector='#live'; c.adapter.endSelector='#end';
  const a=new DouyinAdapter({page:dom.window,getConfig:()=>c,onEvent:event=>events.push(event),onLog:()=>{},onStatus:()=>{}});
  a.observeDOM();
  const show=id=>{const node=dom.window.document.createElement('div');node.id=id;node.getClientRects=()=>[{width:1,height:1}];dom.window.document.body.append(node);return node;};
  const live=show('live'); await new Promise(resolve=>setTimeout(resolve,0));
  dom.window.document.querySelector('#chat').append(dom.window.document.createElement('span'));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(events.map(event=>event.type),['start']);
  live.remove(); await new Promise(resolve=>setTimeout(resolve,0)); show('end'); await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(events.map(event=>event.type),['start','end']);
  a.stopDOM();dom.window.close();
});

test('DOM备用停止时会取消挂起批次的剩余事件，不与异步 flush 并发', async () => {
  const dom = setup('<div id="chat"></div>');
  const calls = []; let release;
  const a = new DouyinAdapter({
    page: dom.window,
    getConfig: () => copy(DEFAULTS),
    onEvent: async event => {
      calls.push(event.text);
      if (calls.length === 1) await new Promise(resolve => { release = resolve; });
    },
    onLog: () => {}, onStatus: () => {}
  });
  const insert = text => {
    const row = dom.window.document.createElement('div'); row.dataset.e2e = 'chat-message';
    row.innerHTML = `<b data-e2e="chat-nickname">观众</b><span data-e2e="chat-content">${text}</span>`;
    dom.window.document.querySelector('#chat').append(row);
  };
  a.observeDOM();
  try {
    insert('正在处理');
    await new Promise(resolve => setTimeout(resolve, 80));
    insert('停止后不应投递');
    a.stopDOM(); release?.();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(calls, ['正在处理']);
    assert.equal(a.status.domBatches, 1);
  } finally { release?.(); dom.window.close(); }
});

test('保存和开始互斥；运行时保存不暂停，失败保留修改且可重试', async () => {
  const dom=setup(),c={...copy(DEFAULTS),mode:'preview'},e=new Engine({config:c}); let rejectSave,starts=0;
  const p=new Panel({config:c,room:'1',callbacks:{save:()=>new Promise((_,reject)=>rejectSave=reject),start:()=>starts++}});
  try {
    p.refresh(e); p.markDirty(); p.node('[data-action=save]').click(); p.refresh(e);
    assert.equal(p.node('[data-action=start]').disabled,true); assert.equal(p.node('form').inert,true);
    p.node('[data-action=start]').click(); assert.equal(starts,0);
    rejectSave(new Error('暂时无法保存')); await new Promise(r=>setTimeout(r,10));
    assert.equal(p.dirty,true); assert.equal(p.node('form').inert,false); assert.equal(p.node('[data-action=start]').disabled,false);
    assert.match(p.node('.toast').textContent,/无法保存/);
    e.start();p.refresh(e);assert.equal(p.node('[data-action=start]').hidden,true);assert.equal(p.node('[data-action=stop]').hidden,false);assert.equal(p.node('[data-action=save]').textContent,'保存设置');
    p.tab('gift');assert.equal(p.node('[data-action=stop]').closest('[data-page]'),null);
  } finally {p.destroy();dom.window.close();}
});

test('查看并处理会确认当前采集告警，旧缺口不再提示而新增缺口会提示', async () => {
  const dom=setup(),c={...copy(DEFAULTS),mode:'preview'},p=new Panel({config:c,room:'1',callbacks:{}}),e=new Engine({config:c});
  let acknowledged;
  p.callbacks.acknowledgeRuntimeAlert=async()=>{acknowledged={contextInvalidated:false,blocked:false,quarantined:0,gaps:{events:2,bridge:1,frames:0,capture:0},storageHigh:false};};
  const status={ingestion:{gaps:2},bridgeGaps:1,frameGaps:0,capture:{gaps:0}};
  try {
    p.refresh(e,status);assert.equal(p.node('[data-runtime-alert]').hidden,false);
    p.node('[data-runtime-alert] [data-ack-runtime-alert]').click();
    await new Promise(resolve=>setTimeout(resolve,0));
    p.refresh(e,{...status,acknowledgedRuntimeAlert:acknowledged});
    assert.equal(p.activeTab,'diagnostics');assert.equal(p.node('[data-runtime-alert]').hidden,true);
    p.refresh(e,{...status,ingestion:{gaps:3},acknowledgedRuntimeAlert:acknowledged});
    assert.equal(p.node('[data-runtime-alert]').hidden,false);
  } finally {p.destroy();dom.window.close();}
});

test('运行记录折叠时不重绘；展开可见记录，最近回复仍更新且不执行HTML', async () => {
  const dom=setup(),p=new Panel({config:{...copy(DEFAULTS), mode:'preview'},room:'1',callbacks:{}});
  try {
    for(let i=0;i<1000;i++)p.log('system',String(i));
    assert.equal(p.entries.length,200);assert.equal(p.node('[data-logs]').innerHTML,'');assert.equal(p.logTimer,undefined);
    p.log('preview','<img src=x onerror=alert(1)>');assert.equal(p.node('[data-last-reply]').textContent,'<img src=x onerror=alert(1)>');assert.equal(p.root.querySelector('img'),null);
    p.tab('diagnostics');p.node('[data-log-details]').open=true;await new Promise(r=>setTimeout(r,10));assert.equal(p.node('[data-logs]').children.length,100);
    p.node('[data-log-details]').open=false;p.log('system','展开后的新记录');await new Promise(r=>setTimeout(r,10));assert.equal(p.logDirty,true);assert.equal(p.node('[data-logs]').textContent.includes('展开后的新记录'),false);
  } finally {p.destroy();dom.window.close();}
});

test('名单模式隐藏无关条件且保留配置；模式提示跟随草稿，预设与实际接口一致', () => {
  const dom=setup(),c={...copy(DEFAULTS),mode:'preview'},p=new Panel({config:c,room:'1',callbacks:{}}),e=new Engine({config:c});
  try {
    assert.equal(p.node('[data-preset]').value,'deepseek');assert.equal(p.node('[data-ai-connection]').open,false);
    const mode=p.root.querySelector('[data-field="welcome.mode"]');mode.value='listed';mode.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.equal(p.node('[data-qualified]').hidden,true);assert.equal(p.node('[data-welcome-list]').open,true);assert.equal(p.read().welcome.minWealth,c.welcome.minWealth);
    const sendMode=p.root.querySelector('[data-field=mode]');sendMode.value='auto';sendMode.dispatchEvent(new dom.window.Event('change',{bubbles:true}));p.refresh(e);
    assert.match(p.node('[data-mode-note]').textContent,/自动发送/);assert.equal(e.config.mode,'preview');
    p.node('[data-preset]').value='local';p.node('[data-preset]').dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(p.node('[data-ai-connection]').open,true);assert.equal(p.read().ai.endpoint,'http://localhost:11434/v1/chat/completions');
  } finally {p.destroy();dom.window.close();}
});

test('各模块摘要跟随草稿；礼物快捷阈值和独立关键词页可用', () => {
  const dom=setup(),c={...copy(DEFAULTS),mode:'preview'};c.keyword.enabled=true;c.keyword.rules=[];c.timersEnabled=true;const p=new Panel({config:c,room:'1',callbacks:{}});
  try {
    assert.deepEqual([...p.root.querySelectorAll('[data-category]')].map(node=>node.textContent),['直播互动','扩展工具','设置']);
    p.tab('runtime');
    assert.equal(p.activeTab,'runtime'); assert.equal(p.node('[data-page="runtime"]').hidden,false);
    for (const key of ['gift','welcome','like','keyword']) assert.equal(p.node(`[data-field="${key}.enabled"]`).closest('[data-page]').dataset.page,'features');
    assert.equal(p.node('[data-field="timersEnabled"]').closest('[data-page]').dataset.page,'features');
    assert.equal(p.node('[data-field="ai.enabled"]').closest('[data-page]').dataset.page,'features');
    assert.equal(p.node('[data-field="ai.chatEnabled"]').closest('[data-page]').dataset.page,'features');
    assert.equal(p.node('[data-field="ai.trigger"]'),null);
    assert.equal(p.node('[data-field="ai.mentions"]'),null);
    assert.equal(p.node('[data-field="ai.idleEnabled"]').closest('[data-page]').dataset.page,'features');
    assert.equal(p.node('[data-field="moderation.enabled"]').closest('[data-page]').dataset.page,'features');
    assert.equal(p.node('[data-field="gift.enabled"]').checked,true);
    assert.equal(p.node('[data-tab="replies"]'),null);
    assert.equal(p.node('[data-tab="ai"]').textContent,'AI 设置');
    assert.equal(p.node('[data-tab="ai"]').closest('[data-subnav]').dataset.subnav,'settings');
    assert.equal(p.node('[data-tab="ai"]').hidden,false);
    assert.equal(p.node('[data-page="ai"]').hidden,true);
    assert.equal(p.node('[data-idle-controls]').hidden,true);
    assert.equal(p.node('[data-chat-controls]').hidden,true);
    p.tab('ai');assert.equal(p.node('[data-page="ai"]').hidden,false);
    assert.equal(p.node('[data-api-key]').hidden,false);
    p.tab('features');
    assert.equal(p.root.querySelectorAll('[data-gift-totals]').length,1);
    assert.equal(p.node('[data-recent-gifts]').closest('[data-page]').dataset.page,'gift');
    assert.equal(p.node('[data-field="gift.responseMode"]').value,'rules');
    assert.equal(p.node('[data-field="welcome.responseMode"]').value,'rules');
    assert.equal(p.node('[data-field="keyword.responseMode"]').value,'rules');
    assert.match(p.node('[data-summary=gift]').textContent,/连击总价 ≥ 1 钻/);
    p.node('[data-gift-value="500"]').click();
    assert.equal(p.node('[data-field="gift.minValue"]').value,'500');
    assert.match(p.node('[data-summary=gift]').textContent,/≥ 500 钻/);

    const welcomeMode=p.node('[data-field="welcome.mode"]');welcomeMode.value='listed';welcomeMode.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.match(p.node('[data-summary=welcome]').textContent,/仅欢迎指定名单/);
    assert.equal(p.node('[data-qualified]').hidden,true);

    assert.ok(p.node('[data-tab=keywords]'));
    p.tab('keywords');assert.equal(p.node('[data-page=keywords]').hidden,false);
    const rule=p.addRow('keywords');rule.querySelector('[data-item=keywords]').value='几点开播';rule.querySelector('[data-item=reply]').value='请看直播预告';p.syncControls();
    assert.match(p.node('[data-summary=keyword]').textContent,/1 条规则/);
    assert.equal(p.read().keyword.rules[0].reply,'请看直播预告');

    assert.equal(p.node('[data-field="gift.responseMode"]').querySelector('[value=ai]').hidden,true);
    p.node('[data-field="ai.enabled"]').checked=true;p.syncControls();assert.match(p.node('[data-summary=ai]').textContent,/当前仅预览/);
    assert.equal(p.node('[data-tab="ai"]').hidden,false);
    p.node('[data-field="ai.idleEnabled"]').checked=true;p.syncControls();
    assert.equal(p.node('[data-idle-controls]').hidden,false);
    assert.equal(p.node('[data-field="gift.responseMode"]').querySelector('[value=ai]').hidden,false);
    p.tab('ai');assert.equal(p.node('[data-page="ai"]').hidden,false);
    p.node('[data-field="moderation.enabled"]').checked=false;p.syncControls();
    assert.equal(p.node('[data-moderation-settings]').hidden,true);
    p.node('[data-field="ai.enabled"]').checked=false;p.syncControls();
    assert.equal(p.node('[data-tab="ai"]').hidden,false);
    assert.equal(p.node('[data-page="ai"]').hidden,false);
    assert.equal(p.node('[data-idle-controls]').hidden,false);
    assert.equal(p.activeTab,'ai');
    const timer=p.addRow('timers');timer.querySelector('[data-item=enabled]').checked=true;p.syncControls();assert.match(p.node('[data-summary=timers]').textContent,/已开启 1 组/);
  } finally {p.destroy();dom.window.close();}
});
test('所有互动模块在设置中集中启停，禁用后互动页面入口隐藏', () => {
  const dom=setup(),c={...copy(DEFAULTS),mode:'preview'},p=new Panel({config:c,room:'1',callbacks:{}});
  try {
    p.node('[data-category="settings"]').click();
    assert.equal(p.activeTab,'features');
    assert.equal(p.node('[data-tab="timers"]').hidden,true);
    p.node('[data-field="timersEnabled"]').checked=true;p.syncControls();
    p.tab('timers');
    assert.equal(p.activeTab,'timers');
    assert.equal(p.node('[data-page="timers"]').hidden,false);
    assert.equal(p.node('[data-tab="keywords"]').hidden,true);
    p.tab('keywords');
    assert.equal(p.activeTab,'timers');
    assert.equal(p.node('[data-page="keywords"]').hidden,true);

    p.tab('features');
    const giftSwitch=p.node('[data-field="gift.enabled"]');
    giftSwitch.click();
    assert.equal(p.node('[data-tab="gift"]').hidden,true);
    assert.equal(p.node('[data-page="gift"]').hidden,true);
    assert.equal(p.activeTab,'features');
    assert.equal(p.node('[data-category="interaction"]').hidden,false);

    p.node('[data-field="welcome.enabled"]').click();
    assert.equal(p.node('[data-tab="welcome"]').hidden,true);
    assert.equal(p.node('[data-category="interaction"]').hidden,false);
    assert.equal(p.node('.primary-nav').style.gridTemplateColumns,'repeat(3, minmax(0, 1fr))');

    giftSwitch.click();
    assert.equal(p.node('[data-tab="gift"]').hidden,false);
    assert.equal(p.node('[data-category="interaction"]').hidden,false);
    p.tab('gift');
    assert.equal(p.node('[data-page="gift"]').hidden,false);
  } finally {p.destroy();dom.window.close();}
});
test('主分类导航收敛二级页面；悬浮按钮可拖动吸附并记住位置', () => {
  const dom=setup(),p=new Panel({config:{...copy(DEFAULTS), mode:'preview'},room:'1',callbacks:{}});
  try {
    p.node('[data-category="interaction"]').click();
    assert.equal(p.activeTab,'gift'); assert.equal(p.node('[data-subnav="interaction"]').hidden,false); assert.equal(p.node('[data-subnav="settings"]').hidden,true);
    p.node('[data-tab="welcome"]').click(); assert.equal(p.activeTab,'welcome');
    const launcher=p.node('.launcher');
    const pointer=(type,x,y)=>{const e=new dom.window.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{clientX:x,clientY:y,pointerId:1,button:0});return e;};
    const start={left:p.floating.x.value,top:p.floating.y.value}; launcher.dispatchEvent(pointer('pointerdown',start.left+10,start.top+10));
    dom.window.dispatchEvent(pointer('pointermove',start.left+310,start.top+120));
    p.floating.flushGesture(); assert.equal(launcher.classList.contains('dragging'),true);
    dom.window.dispatchEvent(pointer('pointerup',start.left+310,start.top+120)); launcher.dispatchEvent(new dom.window.Event('click',{bubbles:true}));
    assert.equal(launcher.classList.contains('dragging'),false);
    assert.equal(p.open,true); assert.ok(p.floating.x.target>dom.window.innerWidth/2); assert.equal(dom.window.localStorage.getItem('douyin-live-assistant:launcher')!==null,true);
    p.toggleOpen();
    assert.equal(launcher.getAttribute('aria-expanded'),'false');
    assert.match(launcher.getAttribute('aria-label'),/展开场控面板/);
    assert.match(launcher.title,/点击展开.*拖动/);
    const engine=new Engine({config:copy(DEFAULTS)}); engine.start(); p.refresh(engine);
    assert.equal(launcher.classList.contains('running'),true);
    assert.equal(p.node('.launcher span').textContent,'自动发送');
    engine.stop(); p.refresh(engine);
    assert.equal(launcher.classList.contains('running'),false);
    assert.equal(p.node('.launcher span').textContent,'已暂停');
    Object.defineProperty(dom.window,'innerWidth',{configurable:true,value:320}); dom.window.dispatchEvent(new dom.window.Event('resize'));
    assert.ok(p.floating.x.value+p.floating.launcherWidth<=320);
  } finally {p.destroy();dom.window.close();}
});
test('近期送礼列表显示已知字段并安全转义昵称与礼物名', () => {
  const dom=setup(),p=new Panel({config:{...copy(DEFAULTS), mode:'preview'},room:'1',callbacks:{}});
  p.updateGifts([{key:'gift-1',user:{name:'<b>观众</b>'},giftName:'<img src=x>',count:2,unitValue:null}]);
  assert.match(p.node('[data-recent-gifts]').textContent,/观众/);
  assert.match(p.node('[data-recent-gifts]').textContent,/价值未知/);
  assert.equal(p.node('[data-recent-gifts]').querySelector('img'),null);
  p.destroy();dom.window.close();
});

test('总览收入按可配置比例估算，未知礼物单列并保留结算说明', () => {
  const dom=setup(),p=new Panel({config:{...copy(DEFAULTS), mode:'preview'},room:'1',callbacks:{}});
  try {
    assert.equal(p.node('[data-field="gift.yuanPerDiamond"]').value,'0.05');
    p.updateGiftSummary({totalDiamonds:100,unknownCount:2,giftCount:5},0.05);
    assert.match(p.node('[data-gift-income]').textContent,/5\.00/);
    assert.match(p.node('[data-gift-estimate-note]').textContent,/2 个礼物单价未知/);
    assert.match(p.node('[data-gift-estimate-note]').textContent,/不代表平台结算/);
    p.updateGiftSummary({totalDiamonds:100,unknownCount:0,giftCount:5},0);
    assert.equal(p.node('[data-gift-income]').textContent,'未设置');
    const rate=p.node('[data-field="gift.yuanPerDiamond"]');rate.value='-1';assert.throws(()=>p.read(),/元\/钻估算比例/);
  } finally {p.destroy();dom.window.close();}
});

test('真实抖音 SVG 发送按钮无 click 方法时仍提交一次，并等待编辑器清空', async () => {
  const dom=setup('<div class="webcast-chatroom"><div id="chatInput"><div contenteditable="true" data-placeholder="与大家互动一下...">\u200b</div><svg class="webcast-chatroom___send-btn disable" type="button" disabled=""></svg></div></div>');
  const input=dom.window.document.querySelector('[contenteditable]'),button=dom.window.document.querySelector('svg');
  Object.defineProperty(input,'isContentEditable',{value:true});
  let clicks=0;
  dom.window.document.execCommand=(command,unused,text)=>{assert.equal(command,'insertText');input.textContent=text+'\u200b';button.removeAttribute('disabled');button.classList.remove('disable');return true;};
  button.addEventListener('click',()=>{clicks++;setTimeout(()=>{input.textContent='\u200b';button.setAttribute('disabled','');},80);});
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});
  adapter.status={connected:true,lastFrame:Date.now()};
  try {
    assert.equal(typeof button.click,'undefined');
    assert.deepEqual(await adapter.send('感谢支持',()=>true),{submitted:true,clicked:true});
    assert.equal(clicks,1);
    assert.deepEqual(await adapter.send('欢迎新朋友',()=>true),{submitted:true,clicked:true});assert.equal(clicks,2);
  } finally {dom.window.close();}
});

test('ARIA 角色型抖音编辑器和相邻图标也能被准确定位', async () => {
  const dom=setup('<div class="webcast-chatroom___input-container"><div id="editor" role="textbox" aria-label="与大家互动一下..."></div><div class="toolbar"><img class="webcast-chatroom___send-icon" alt=""></div></div>');
  const input=dom.window.document.querySelector('#editor'), icon=dom.window.document.querySelector('img');
  let clicks=0; icon.addEventListener('click',()=>{ clicks++; input.textContent=''; });
  dom.window.document.execCommand=(command,unused,text)=>{ assert.equal(command,'insertText'); input.textContent=text; return true; };
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});
  adapter.status={connected:true,lastFrame:Date.now()};
  try { assert.equal(adapter.findInput(),input); assert.equal(adapter.findSend(input),icon); assert.deepEqual(await adapter.send('感谢支持',()=>true),{submitted:true,clicked:true}); assert.equal(clicks,1); }
  finally { dom.window.close(); }
});

test('高价值欢迎发送时临时启用管理员弹幕并恢复用户原状态', async () => {
  const dom=setup('<div id="chatInput"><label><input id="admin-mode" type="checkbox" role="switch" aria-label="管理员弹幕"></label><textarea placeholder="与大家互动一下"></textarea><button>发送</button></div>');
  const input=dom.window.document.querySelector('textarea'), toggle=dom.window.document.querySelector('#admin-mode'), button=dom.window.document.querySelector('button');
  let modeAtSend;
  button.addEventListener('click',()=>{modeAtSend=toggle.checked;input.value='';});
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});adapter.status.connected=true;
  try {
    const result=await adapter.send('欢迎贵宾',()=>true,{channel:'admin'});
    assert.equal(result.submitted,true);assert.equal(result.channelUsed,'admin');assert.equal(modeAtSend,true);assert.equal(toggle.checked,false);
    toggle.checked=true;
    await adapter.send('普通互动',()=>true,{channel:'chat'});
    assert.equal(modeAtSend,false);assert.equal(toggle.checked,true);
  } finally {dom.window.close();}
});

test('管理员弹幕开关不可用时安全回退普通弹幕', async () => {
  const dom=setup('<div id="chatInput"><input type="checkbox" role="switch" aria-label="管理员弹幕" disabled><textarea placeholder="与大家互动一下"></textarea><button>发送</button></div>');
  const input=dom.window.document.querySelector('textarea'),button=dom.window.document.querySelector('button');let clicks=0;
  button.addEventListener('click',()=>{clicks++;input.value='';});
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});adapter.status.connected=true;
  try { const result=await adapter.send('欢迎贵宾',()=>true,{channel:'admin'});assert.equal(result.submitted,true);assert.equal(result.channelUsed,'chat');assert.match(result.modeFallback,/不可用/);assert.equal(clicks,1); }
  finally {dom.window.close();}
});

function privilegeComposer({admin = true} = {}) {
  const dom = setup(`<pace-island id="island_random"><div class="webcast-chatroom"><div id="chatInput"><div data-e2e="live-chatting"><div class="semi-switch"><input type="checkbox" role="switch" aria-checked="false"></div><textarea placeholder="与大家互动一下"></textarea></div><button>发送</button></div><div class="FJl3IMTf" style="display:none"><div><div class="RfKNBPEF cw6Usapi"><img src="https://cdn/privilege_screen_chat_supreme_v2.png"></div>${admin ? '<div class="RfKNBPEF"><img src="https://cdn/privilege_screen_chat_admin_v2.png"></div>' : ''}</div></div></div></pace-island>`);
  const doc = dom.window.document, input = doc.querySelector('textarea'), toggle = doc.querySelector('[role=switch]'), menu = doc.querySelector('.FJl3IMTf');
  for (const option of menu.querySelectorAll('.RfKNBPEF')) option.getClientRects = () => menu.style.display === 'none' ? [] : [{width:100,height:30}];
  let selected = 'supreme', paidClicks = 0, sentMode = null, sends = 0;
  const sync = () => { toggle.setAttribute('aria-checked', String(toggle.checked)); input.placeholder = toggle.checked ? selected === 'admin' ? '发送管理员弹幕' : '发送至尊弹幕（366钻/条）' : '与大家互动一下'; };
  toggle.addEventListener('click',()=>{
    sync();
    if (toggle.checked) dom.window.setTimeout(()=>{menu.style.display=toggle.checked?'block':'none';},150);
    else menu.style.display='none';
  });
  doc.querySelectorAll('.RfKNBPEF').forEach(option=>option.addEventListener('click',()=>{
    selected = option.querySelector('img').src.includes('_admin_') ? 'admin' : 'supreme';
    if (selected === 'supreme') paidClicks++;
    doc.querySelectorAll('.RfKNBPEF').forEach(el=>el.classList.toggle('cw6Usapi',el===option));
    toggle.checked=true; sync();
  }));
  doc.querySelector('button').addEventListener('click',()=>{sentMode = toggle.checked ? selected : 'chat'; sends++; input.value='';});
  const adapter = new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}}); adapter.status.connected=true;
  return {dom,adapter,input,toggle,sync,state:()=>({paidClicks,sentMode,sends})};
}
test('真实抖音结构按管理员图片定位，选中至尊样式不会被误认为管理员', async () => {
  const f = privilegeComposer();
  try {
    const result = await f.adapter.send('欢迎新朋友',()=>true,{channel:'admin'});
    assert.equal(result.channelUsed,'admin'); assert.deepEqual(f.state(),{paidClicks:0,sentMode:'admin',sends:1});
    assert.equal(f.toggle.checked,false); assert.equal(f.input.placeholder,'与大家互动一下');
  } finally { f.dom.window.close(); }
});
test('管理员富文本写入后占位提示消失，仍校验当前选中的管理员类型', async () => {
  const f = privilegeComposer();
  try {
    const result=await f.adapter.send('欢迎贵宾',()=>true,{channel:'admin',beforeClick:async()=>f.input.removeAttribute('placeholder')});
    assert.equal(result.channelUsed,'admin'); assert.equal(f.state().sentMode,'admin');
  } finally { f.dom.window.close(); }
});
test('请求发送不依赖UI控件，暂停和人工草稿仍阻止提交；未知结果不走UI重发',async()=>{
  const dom=setup('<div id="chatInput"><textarea></textarea></div>'); let commits=0,active=true;
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});adapter.status.connected=true;
  adapter.requestSender={prepare:async()=>({available:true,token:'ticket'}),commit:async()=>{commits++;return {submitted:false,clicked:true,transport:'request',reason:'未知'};}};
  try {
    const cancelled=await adapter.send('欢迎',()=>active,{beforeClick:async()=>{active=false;}}); assert.equal(cancelled.clicked,undefined); assert.equal(commits,0);
    active=true; dom.window.document.querySelector('textarea').value='人工草稿';
    await assert.rejects(adapter.send('欢迎',()=>true),/手动草稿/); assert.equal(commits,0);
    dom.window.document.querySelector('textarea').value='';
    const unknown=await adapter.send('欢迎',()=>true); assert.equal(unknown.transport,'request'); assert.equal(unknown.clicked,true); assert.equal(commits,1);
  } finally {dom.window.close();}
});
test('旧版请求发送器没有能力探测方法时安全回退页面控件',()=>{
  const adapter=Object.create(DouyinAdapter.prototype);
  adapter.requestSender={prepare:async()=>({available:false})};
  assert.equal(adapter.requestAvailable('chat'),false);
});
test('管理员选项缺失时只发普通弹幕，不开启默认至尊弹幕', async () => {
  const f = privilegeComposer({admin:false});
  try {
    const result = await f.adapter.send('欢迎新朋友',()=>true,{channel:'admin'});
    assert.equal(result.channelUsed,'chat'); assert.match(result.modeFallback,/选项不可用/);
    assert.deepEqual(f.state(),{paidClicks:0,sentMode:'chat',sends:1}); assert.equal(f.toggle.checked,false);
  } finally { f.dom.window.close(); }
});
test('发送期间模式变为至尊弹幕时阻止点击发送', async () => {
  const f = privilegeComposer();
  try {
    await assert.rejects(f.adapter.send('欢迎新朋友',()=>true,{beforeClick:async()=>{f.toggle.checked=true;f.sync();}}),/弹幕类型在发送前发生变化/);
    assert.equal(f.state().sends,0);
  } finally { f.dom.window.close(); }
});
test('面板灯牌门槛可保存，低于基础欢迎时定位错误字段并保留输入', () => {
  const dom=setup(), c=copy(DEFAULTS); c.welcome.admin.enabled=true;
  const p=new Panel({config:c,room:'1',callbacks:{}});
  try {
    const field=key=>p.node(`[data-field="welcome.${key}"]`);
    field('minFanLevel').value='8'; field('admin.minFanLevel').value='7'; p.syncControls();
    assert.equal(field('admin.minFanLevel').min,'8');
    assert.throws(()=>p.read(),/灯牌.*不能低于基础欢迎/);
    assert.equal(field('admin.minFanLevel').getAttribute('aria-invalid'),'true'); assert.equal(field('admin.minFanLevel').value,'7');
    field('admin.minFanLevel').value='9'; assert.equal(p.read().welcome.admin.minFanLevel,9);
    field('minWealth').value='61'; assert.throws(()=>p.read(),/荣誉.*不能低于基础欢迎/);
  } finally { dom.window.close(); }
});

test('抖音重绘后旧的手动选择器失效时回退到当前控件', () => {
  const dom=setup('<div id="chatInput" class="webcast-chatroom___input-container"><div contenteditable="true" data-placeholder="与大家互动一下...">​</div><svg class="webcast-chatroom___send-btn"></svg></div>');
  const c=copy(DEFAULTS); c.adapter.inputSelector='#removed-editor'; c.adapter.sendSelector='#removed-send';
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>c,onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});
  const input=dom.window.document.querySelector('[contenteditable]'),send=dom.window.document.querySelector('svg');
  try { assert.equal(adapter.findInput(),input); assert.equal(adapter.findSend(input),send); }
  finally { dom.window.close(); }
});

test('点击无效不会误报已提交，也不重复点击发送按钮', async () => {
  const dom=setup('<div><textarea placeholder="说点什么"></textarea><svg class="webcast-chatroom___send-btn"></svg></div>');
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});
  adapter.status={connected:true,lastFrame:Date.now()};let clicks=0;const input=dom.window.document.querySelector('textarea');dom.window.document.querySelector('svg').addEventListener('click',()=>{clicks++;if(clicks===2)input.value='';});
  try {
    const first=await adapter.send('感谢支持',()=>true);assert.equal(first.submitted,false);assert.equal(first.clicked,true);assert.match(first.reason,/不自动重发/);assert.equal(clicks,1);assert.equal(input.value,'');
    assert.deepEqual(await adapter.send('感谢支持',()=>true),{submitted:true,clicked:true});assert.equal(clicks,2);
  }
  finally {dom.window.close();}
});

test('输入框已有重复候选文案时发送前收敛为一份', async () => {
  const dom=setup('<div><textarea placeholder="说点什么"></textarea><button>发送</button></div>');
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});
  adapter.status.connected=true;
  const input=document.querySelector('textarea'),button=document.querySelector('button');
  input.value='谢谢 @A 哥的 小心心，心意收到啦～谢谢 @A 哥的 小心心，心意收到啦～';
  let clicks=0;
  button.addEventListener('click',()=>{clicks++;input.value='';});
  try {
    assert.deepEqual(await adapter.send('谢谢 @A 哥的 小心心，心意收到啦～',()=>true),{submitted:true,clicked:true});
    assert.equal(clicks,1); assert.equal(input.value,'');
  } finally {dom.window.close();}
});

test('输入框已有完整话术加部分重复时只提交一份并保留灯牌名称', async () => {
  const dom=setup('<div><textarea placeholder="说点什么"></textarea><button>发送</button></div>');
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});
  adapter.status.connected=true;
  const input=document.querySelector('textarea'),button=document.querySelector('button');
  const message='感谢岁小孩LILAC成为本场No.1、1000票贡献用户！';
  input.value=message + '感谢岁小孩LILAC成为本场No.1、10';
  let clicks=0;
  button.addEventListener('click',()=>{clicks++;assert.equal(input.value,message);input.value='';});
  try {
    assert.deepEqual(await adapter.send(message,()=>true),{submitted:true,clicked:true});
    assert.equal(clicks,1);assert.equal(input.value,'');
  } finally {dom.window.close();}
});

test('页面延迟启用发送按钮时等待就绪，不反复清空重填回复', async () => {
  const dom=setup('<div id="chatInput"><textarea placeholder="说点什么"></textarea><button disabled>发送</button></div>');
  const input=document.querySelector('textarea'),button=document.querySelector('button');
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});
  adapter.status.connected=true;let writes=0,clicks=0,timer;
  input.addEventListener('input',()=>{writes++;timer=setTimeout(()=>{button.disabled=false;},350);});
  button.addEventListener('click',()=>{clicks++;input.value='';});
  try {
    assert.deepEqual(await adapter.send('感谢支持',()=>true),{submitted:true,clicked:true});
    assert.equal(writes,1);assert.equal(clicks,1);
  } finally {clearTimeout(timer);dom.window.close();}
});

test('点击前异步钩子触发重绘后只点击当前发送按钮', async () => {
  const dom=setup('<div id="chatInput"><textarea placeholder="说点什么"></textarea><button>发送</button></div>');
  const input=document.querySelector('textarea'),button=document.querySelector('button');let oldClicks=0,newClicks=0;
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});
  adapter.status.connected=true;button.addEventListener('click',()=>{oldClicks++;});
  try {
    const result=await adapter.send('感谢支持',()=>true,{beforeClick:async()=>{
      const replacement=button.cloneNode(true);replacement.getClientRects=button.getClientRects;
      replacement.addEventListener('click',()=>{newClicks++;input.value='';});button.replaceWith(replacement);
      await Promise.resolve();
    }});
    assert.deepEqual(result,{submitted:true,clicked:true});assert.equal(oldClicks,0);assert.equal(newClicks,1);
  } finally {dom.window.close();}
});

test('富文本异步粘贴晚于初始等待时仍提交一次', async () => {
  const dom=setup('<div id="chatInput"><div contenteditable="true" data-placeholder="说点什么"></div><button disabled>发送</button></div>');
  const input=document.querySelector('[contenteditable]'),button=document.querySelector('button');let pastes=0,clicks=0,timer;
  dom.window.DataTransfer=class {setData(key,value){this.value=value;} getData(){return this.value;}};
  dom.window.ClipboardEvent=class extends dom.window.Event {constructor(type,options){super(type,options);this.clipboardData=options.clipboardData;}};
  input.addEventListener('paste',event=>{event.preventDefault();pastes++;timer=setTimeout(()=>{input.textContent=event.clipboardData.getData('text/plain');button.disabled=false;},350);});
  button.addEventListener('click',()=>{clicks++;input.textContent='';});
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});adapter.status.connected=true;
  try {
    assert.deepEqual(await adapter.send('感谢支持',()=>true),{submitted:true,clicked:true});assert.equal(pastes,1);assert.equal(clicks,1);
  } finally {clearTimeout(timer);dom.window.close();}
});

test('发送后编辑器被替换时读取新编辑器的提交结果', async () => {
  const dom=setup('<div id="chatInput"><textarea placeholder="说点什么"></textarea><button>发送</button></div>');
  const input=document.querySelector('textarea'),button=document.querySelector('button');let clicks=0;
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});
  adapter.status.connected=true;
  button.addEventListener('click',()=>{clicks++;const replacement=input.cloneNode();replacement.value='';replacement.getClientRects=input.getClientRects;input.replaceWith(replacement);});
  try {
    assert.deepEqual(await adapter.send('感谢支持',()=>true),{submitted:true,clicked:true});assert.equal(clicks,1);
    assert.equal(adapter.ownedDraft,null);
  } finally {dom.window.close();}
});

test('富文本清理失败时不发送；恢复清空后重新写入再提交', async () => {
  const dom=setup('<div id="chatInput"><div contenteditable="true" data-placeholder="说点什么"></div><button>发送</button></div>');
  const input=document.querySelector('[contenteditable]'),button=document.querySelector('button');let inserts=0,clicks=0;
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});
  adapter.status.connected=true;
  let deletes=0;
  document.execCommand=(command,unused,text)=>{if(command==='delete'){if(++deletes===1)return false;input.textContent='';return true;}inserts++;input.textContent+=text;return true;};
  button.addEventListener('click',()=>{if(++clicks===2)input.textContent='';});
  try {
    assert.equal((await adapter.send('感谢支持',()=>true)).submitted,false);
    assert.equal(input.textContent,'感谢支持');assert.equal(adapter.ownedDraft?.text,'感谢支持');
    adapter.ownedDraft.at=Date.now()-180000;
    assert.deepEqual(await adapter.send('感谢支持',()=>true),{submitted:true,clicked:true});
    assert.equal(inserts,2);assert.equal(clicks,2);
  } finally {dom.window.close();}
});

test('残留脚本草稿改发另一条回复时通过编辑器选区替换', async () => {
  const dom=setup('<div id="chatInput"><div contenteditable="true" data-placeholder="说点什么">旧回复</div><button>发送</button></div>');
  const input=document.querySelector('[contenteditable]'),button=document.querySelector('button');let inserts=0,clicks=0;
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});
  adapter.status.connected=true;adapter.ownedDraft={text:'旧回复',at:Date.now()-180000};
  document.execCommand=(command,unused,text)=>{if(command==='delete'){input.textContent='';return true;}assert.equal(command,'insertText');inserts++;input.textContent=text;return true;};
  button.addEventListener('click',()=>{clicks++;assert.equal(input.textContent,'新回复');input.textContent='';});
  try {
    assert.deepEqual(await adapter.send('新回复',()=>true),{submitted:true,clicked:true});assert.equal(inserts,1);assert.equal(clicks,1);
  } finally {dom.window.close();}
});

test('点击前用户改写草稿时不提交或清除人工内容', async () => {
  const dom=setup('<div id="chatInput"><textarea placeholder="说点什么"></textarea><button>发送</button></div>');
  const input=document.querySelector('textarea'),button=document.querySelector('button');let clicks=0;
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});
  adapter.status.connected=true;button.addEventListener('click',()=>{clicks++;input.value='';});
  try {
    await assert.rejects(adapter.send('感谢支持',()=>true,{beforeClick:async()=>{input.value='人工修改';}}),/不一致|变更/);
    assert.equal(clicks,0);assert.equal(input.value,'人工修改');
  } finally {dom.window.close();}
});

test('发送控件短暂缺失或输入禁用可以重试，多个发送候选仍停止', async () => {
  const dom=setup('<div><textarea placeholder="说点什么"></textarea><button>发送</button></div>');
  const input=document.querySelector('textarea'),button=document.querySelector('button');
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});
  adapter.status.connected=true;
  const retryable=error=>error.retryable===true;
  try {
    button.remove(); await assert.rejects(adapter.send('感谢支持',()=>true),retryable); assert.equal(input.value,'');
    input.parentElement.append(button); input.disabled=true;
    await assert.rejects(adapter.send('感谢支持',()=>true),error=>retryable(error)&&/不可用/.test(error.message)); input.disabled=false;
    const duplicate=button.cloneNode(true);duplicate.getClientRects=button.getClientRects;input.parentElement.append(duplicate);
    await assert.rejects(adapter.send('感谢支持',()=>true),error=>!error.retryable);duplicate.remove();
    const pending=adapter.send('感谢支持',()=>true);button.remove();
    await assert.rejects(pending,retryable);assert.equal(input.value,'');
    input.parentElement.append(button);button.addEventListener('click',()=>{input.value='';});
    assert.deepEqual(await adapter.send('感谢支持',()=>true),{submitted:true,clicked:true});
  } finally {dom.window.close();}
});

test('月报可选多个主播月份，关闭采集后仍可从主播数据查看历史账本', () => {
  const dom=setup(),panel=new Panel({config:copy(DEFAULTS),room:'1',callbacks:{}});
  try {
    panel.updateProfiles([{room:'1',name:'主播甲',anchorId:'101'},{room:'2',name:'<img src=x>',anchorId:'202'}]);
    assert.equal(panel.node('[data-income-room]').options.length,2);
    assert.equal(panel.root.querySelector('img'),null);
    panel.node('[data-income-room]').value='2';panel.node('[data-income-month]').value='2026-09';
    assert.deepEqual(panel.incomeSelection(),{room:'2',month:'2026-09'});
    panel.updateIncome({room:'2',month:'2026-09',summary:{estimatedIncome:5,totalDiamonds:100,giftCount:3,unknownCount:1},days:[{date:'2026-09-18',estimatedIncome:5,totalDiamonds:100,giftCount:3,unknownCount:1}]});
    assert.match(panel.node('[data-income-total]').textContent,/5\.00/);
    assert.match(panel.node('[data-income-daily]').textContent,/2026-09-18/);
    assert.match(panel.node('[data-income-coverage]').textContent,/1.*未知/);
    assert.equal(panel.node('[data-tab=income]'),null);panel.tab('anchor');assert.equal(panel.node('[data-page=anchor]').hidden,false);
    panel.node('[data-field=incomeEnabled]').checked=false;panel.syncControls();
    assert.equal(panel.node('[data-tab=anchor]').hidden,false);assert.equal(panel.node('[data-tab=profiles]').hidden,false);
    assert.equal(panel.activeTab,'anchor');assert.equal(panel.read().incomeEnabled,false);
    panel.node('[data-income-link]').click();
    assert.equal(panel.node('[data-anchor-content=income]').hidden,false);
    assert.equal(panel.node('[data-anchor-content=overview]').hidden,true);
    assert.equal(panel.node('[data-income-paused]').hidden,false);
    assert.match(panel.node('[data-income-total]').textContent,/5\.00/);
    panel.toggleOpen();panel.toggleOpen();
    assert.equal(panel.node('[data-anchor-content=income]').hidden,false);
    panel.node('[data-anchor-view=overview]').click();
    assert.equal(panel.node('[data-anchor-content=overview]').hidden,false);
    assert.equal(panel.node('[data-page=anchor] [data-income-room]') !== null,true);
    assert.equal(panel.node('[data-profiles] a').href,'https://live.douyin.com/1?anchor_id=101');
  } finally {panel.destroy();dom.window.close();}
});

test('主播看板按所选直播场次汇总并分页，不跨 UID 显示收入，稳定数据不重绘', () => {
  const dom=setup(),config=copy(DEFAULTS);config.anchorId='101';
  const panel=new Panel({config,room:'1',callbacks:{}}),now=Date.now();
  const stats=new AnchorStats({now:()=>now});
  stats.restore({version:1,records:Array.from({length:25},(_,i)=>({battleKey:`b${i}`,anchorId:'101',name:'主播甲',roomId:'1',opponents:[{anchorId:'202',name:'主播乙'}],startedAt:now-(i===24?2*86400000:1000),endedAt:now-(i===24?2*86400000:0),phase:'ended',score:100,scoreFinal:true,outcome:'win'}))});
  const engine=new Engine({config});engine.anchorStats=stats;
  try {
    panel.updateAnchorIncome({anchorId:'101',currentSession:{id:'current',startAt:now-3600000,endAt:0,startSource:'platform',estimatedIncome:12},allSessions:[{id:'older',startAt:now-3*86400000,endAt:now-86400000,startSource:'platform',endSource:'platform',estimatedIncome:3}]});
    panel.refresh(engine,{connected:true,frames:1});panel.tab('anchor');
    assert.equal(panel.node('[data-anchor-stat=battles]').textContent,'24');
    assert.match(panel.node('[data-anchor-stat=income]').textContent,/12\.00/);
    panel.node('[data-anchor-period="7"]').click();
    assert.equal(panel.node('[data-anchor-stat=battles]').textContent,'25');
    assert.equal(panel.node('[data-anchor-stat=score]').textContent,'2,500');
    assert.equal(panel.node('[data-anchor-battles]').rows.length,20);
    panel.node('[data-anchor-page="1"]').click();
    assert.equal(panel.node('[data-anchor-battles]').rows.length,5);
    assert.equal(panel.anchorDashboard.exportReport().battles.length,25);
    const observer=new dom.window.MutationObserver(()=>{});observer.observe(panel.node('[data-page=anchor]'),{subtree:true,attributes:true,childList:true,characterData:true});
    panel.renderAnchor(engine);assert.equal(observer.takeRecords().length,0);observer.disconnect();
    stats.ingestRank({id:'rank-202',anchorId:'202',receivedAt:now,afterRank:{level:2}},{});
    panel.renderAnchor(engine);const picker=panel.node('[data-anchor-picker]');picker.value='202';picker.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.equal(panel.node('[data-anchor-stat=income]').textContent,'未知');
    assert.match(panel.node('[data-anchor-report-name]').textContent,/202/);
    assert.equal(panel.node('[data-shell-network]').textContent,'直播数据已连接');
  } finally {panel.destroy();dom.window.close();}
});

test('运行锁重复申请幂等，连续释放重取不被旧回调清掉', async () => {
  const locks=webLocks(),a=new RoomLock({room:'1',locks}),b=new RoomLock({room:'1',locks});
  try {
    for(let i=0;i<20;i++) {
      const pending=a.acquire(); assert.equal(a.acquire(),pending);
      assert.equal(await pending,true); assert.equal(await a.acquire(),true);
      assert.equal(await b.acquire(),false);
      a.release(); assert.equal(a.held,false);
      assert.equal(await a.acquire(),true); assert.equal(a.renew(),true);
      a.release();
    }
    assert.equal(await b.acquire(),true);
  } finally {a.release();b.release();await Promise.all([a.drained,b.drained]);}
});
test('取消尚未完成的运行锁申请，不会迟到持锁；新申请可正常开始', async () => {
  const locks=webLocks(),a=new RoomLock({room:'1',locks}),b=new RoomLock({room:'1',locks});
  const old=a.acquire(); a.release(); const next=a.acquire();
  assert.equal(await old,false); assert.equal(await next,true); assert.equal(a.held,true);
  a.release(); assert.equal(await b.acquire(),true);b.release();await b.drained;
  await assert.rejects(new RoomLock({room:'1',locks:null}).acquire(),/不支持运行锁/);
});
test('浏览器锁不受过期存储和不同房间影响', async () => {
  const locks=webLocks(); const get=()=>({owner:'stale-tab',until:Infinity});
  const a=new RoomLock({room:'1',locks,get}),b=new RoomLock({room:'2',locks,get});
  assert.equal(await a.acquire(),true);assert.equal(await b.acquire(),true);
  a.release();b.release();await Promise.all([a.drained,b.drained]);
});
test('安静直播间仍健康，真实 close 才断线；多个连接中一个关闭不影响其他连接', () => {
  const dom=setup();class Socket extends dom.window.EventTarget {constructor(){super();}}
  dom.window.WebSocket=Socket;
  const a=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});a.hook();
  const first=new dom.window.WebSocket('wss://webcast.douyin.com/webcast/im/push/');
  const second=new dom.window.WebSocket('wss://webcast.douyin.com/webcast/im/push/');
  first.dispatchEvent(new dom.window.Event('open'));second.dispatchEvent(new dom.window.Event('open'));
  a.status.lastFrame=Date.now()-3600000;assert.equal(a.healthy(),true);
  first.dispatchEvent(new dom.window.Event('close'));assert.equal(a.healthy(),true);
  second.dispatchEvent(new dom.window.Event('close'));assert.equal(a.healthy(),false);dom.window.close();
});
test('面板键盘事件不冒泡到直播页，输入法/修饰键/长按不导航或启停，正常键盘导航保留', () => {
  const dom=setup(),p=new Panel({config:copy(DEFAULTS),room:'1',callbacks:{}});let hostKeys=0;
  dom.window.document.addEventListener('keydown',()=>hostKeys++);
  const key=(node,name,options={})=>{const event=new dom.window.KeyboardEvent('keydown',{key:name,bubbles:true,composed:true,cancelable:true,...options});node.dispatchEvent(event);return event;};
  try {
    p.tab('gift');const tab=p.node('[data-tab=gift]');tab.focus();
    for(const options of [{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true},{isComposing:true},{repeat:true},{keyCode:229}]) {key(tab,'ArrowRight',options);assert.equal(p.activeTab,'gift');}
    key(tab,'ArrowRight');assert.equal(p.activeTab,'welcome');
    const input=p.node('[data-field="gift.minValue"]');input.focus();assert.equal(key(input,'Enter').defaultPrevented,false);
    for(const type of ['keyup','keypress'])input.dispatchEvent(new dom.window.KeyboardEvent(type,{key:' ',bubbles:true,composed:true}));
    assert.equal(hostKeys,0);
    for(const action of ['start','stop']) for(const options of [{repeat:true},{isComposing:true},{ctrlKey:true}]) assert.equal(key(p.node(`[data-action=${action}]`),'Enter',options).defaultPrevented,true);
    assert.equal(key(p.node('[data-action=start]'),'Enter').defaultPrevented,false);
    key(dom.window.document.body,' ');assert.equal(hostKeys,1);
  } finally {p.destroy();dom.window.close();}
});
test('消息入队和上一条发送完成立即唤醒发送器，不依赖轮询且保持串行', async () => {
  const dom = setup(), values = new Map([['live-assistant:config:1234567890',{mode:'auto'}]]);
  let api, finishFirst, active = 0, maximum = 0; const sent = [];
  const adapter = {status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>true,
    send:async text => {
      active++; maximum = Math.max(maximum,active); sent.push(text);
      if (sent.length === 1) await new Promise(resolve => { finishFirst = resolve; });
      active--; return {submitted:true};
    }};
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = callback => savedInterval(callback,60000);
  let engine;
  try {
    engine = boot({page:dom.window,get:(key,fallback)=>values.get(key)??fallback,set:(key,value)=>values.set(key,value),del:key=>values.delete(key),request:()=>{},adapterFactory:()=>adapter,identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>{api=value;}});
  } finally { globalThis.setInterval = savedInterval; }
  try {
    engine.start(); engine.enqueue('gift','第一条礼物'); engine.enqueue('gift','第二条礼物');
    await new Promise(setImmediate);
    assert.deepEqual(sent,['第一条礼物']); assert.equal(engine.busy,true);
    finishFirst(); await new Promise(setImmediate);
    assert.deepEqual(sent,['第一条礼物','第二条礼物']); assert.equal(maximum,1); assert.equal(engine.queue.length,0);
    engine.config.blockedWords = ['被屏蔽'];
    let checks = 0; const tick = engine.tick.bind(engine);
    engine.tick = async (...args) => { checks++; return tick(...args); };
    engine.queue.push({id:999,kind:'gift',text:'被屏蔽',priority:100,created:Date.now(),expires:Infinity,giftReply:{userKey:'uid:block'}});
    engine.changed(); await new Promise(setImmediate);
    assert.equal(checks,1,'格式错误应保留任务且不能触发无进展的微任务循环');
    assert.equal(engine.queue.length,1); assert.equal(sent.length,2);
  } finally {finishFirst?.();dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});

test('发送异常和重连不主动暂停；页面缓存返回后仍可继续运行', async () => {
  const dom=setup(),values=new Map([['live-assistant:config:1234567890',{mode:'auto'}]]);
  let api;let connected=true;const lock=new RoomLock({room:'1234567890'});
  const adapter={status:{},hook(){},observeDOM(){},stopDOM(){},healthy:()=>connected,findInput:()=>({}),findSend(){},sync(){},send:async()=>{throw new Error('模拟失败');}};
  const engine=boot({page:dom.window,lock,get:(k,f)=>values.get(k)??f,set:(k,v)=>values.set(k,v),del:k=>values.delete(k),request:()=>{},adapterFactory:()=>adapter,identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>api=value});
  const clickStart=async()=>{api.panel.refresh(engine);api.panel.node('[data-action=start]').click();await new Promise(r=>setTimeout(r,20));assert.equal(engine.running,true);assert.equal(lock.held,true);};
  try {
    await clickStart();engine.enqueue('gift','谢谢支持');await engine.tick();assert.equal(engine.running,true);assert.equal(lock.held,true);
    engine.ingest({type:'end'});assert.equal(engine.running,true);assert.equal(lock.held,true);
    await clickStart();connected=false;await new Promise(r=>setTimeout(r,310));assert.equal(engine.running,true);assert.equal(lock.held,true);
    connected=true;await new Promise(r=>setTimeout(r,310));assert.equal(engine.running,true);
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide',{persisted:true}));assert.equal(engine.running,false);assert.equal(lock.held,false);
    dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pageshow',{persisted:true}));await new Promise(r=>setTimeout(r,120));await clickStart();
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));api.panel.destroy();dom.window.close();await lock.drained;}
});

test('运行中事件先写入日志；状态快照成功后确认日志，重启记录按序回放', async () => {
  const dom=setup(),values=new Map([['live-assistant:config:1234567890',{mode:'preview'}]]),order=[];
  let api,onEvent,allowReplay=false,failSnapshot=false,newEventId=0;const pending=[{key:'live-assistant:event:1234567890:replay-000000000000',event:{type:'chat',id:'replay-chat',user:{id:'viewer-r',name:'回放观众'},text:'接龙'}}];
  const journal={
    append:async event=>{order.push('append');const key=`live-assistant:event:1234567890:new-${++newEventId}00000000000`;pending.push({key,event});return {key};},
    pending:async()=>pending,
    ack:async key=>{order.push('ack');const index=pending.findIndex(record=>record.key===key);if(index>=0)pending.splice(index,1);},
    ackMany:async keys=>{order.push('ack');for(const key of keys){const index=pending.findIndex(record=>record.key===key);if(index>=0)pending.splice(index,1);}}
  };
  const engine=boot({page:dom.window,get:(key,fallback)=>values.get(key)??fallback,set:async(key,value)=>{if(key.includes(':runtime:')){order.push('snapshot');if(failSnapshot)throw new Error('测试快照失败');}values.set(key,value);},del:key=>values.delete(key),journal,request:()=>{},adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},healthy:()=>true,sync(){},replayJournal:async()=>{if(allowReplay)for(const record of [...pending])await onEvent({...record.event,_journalKey:record.key});}};},identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>{api=value;}});
  try {
    api.panel.node('[data-action=start]').click();await new Promise(resolve=>setTimeout(resolve,30));
    order.length=0;await onEvent(Object.freeze({type:'chat',id:'live-chat',user:{id:'viewer-1',name:'实时观众'},text:'你好'}));
    await onEvent({type:'chat',id:'live-chat-2',user:{id:'viewer-2',name:'实时观众2'},text:'你好2'});
    const liveDeadline=Date.now()+1000;while(Date.now()<liveDeadline&&!order.includes('ack'))await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(order.filter(item=>item==='snapshot').length,1,'相邻事件应合并为一次运行快照');
    assert.equal(order.filter(item=>item==='ack').length,1,'相邻事件应合并为一次批量确认');
    assert.deepEqual(order,['append','append','snapshot','ack']);assert.equal(engine.history.at(-1).text,'你好2');
    order.length=0;failSnapshot=true;await onEvent({type:'chat',id:'live-fail',user:{id:'viewer-3',name:'仍保留'},text:'失败也要保留'});
    const failureDeadline=Date.now()+1000;while(Date.now()<failureDeadline&&!order.some(item=>item==='snapshot'))await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(pending.length,2,'运行快照失败时事件日志不得删除');
    failSnapshot=false;
    const retryDeadline=Date.now()+2500;while(Date.now()<retryDeadline&&pending.length>1)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(pending.length,1,'重试成功后只确认已持久化的事件');
    order.length=0;allowReplay=true;await api.adapter.replayJournal();
    const replayDeadline=Date.now()+1000;while(Date.now()<replayDeadline&&pending.length)await new Promise(resolve=>setTimeout(resolve,5));
    assert.ok(order.indexOf('snapshot')<order.lastIndexOf('ack'));
    assert.equal(pending.length,0);
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});

test('礼物入账失败时待写记录随快照恢复，重建后继续入账', async () => {
  const values = new Map([['live-assistant:config:1234567890',{mode:'preview'}]]);
  let fail = true, api, onEvent; const records = [];
  const launch = () => {
    const dom = setup();
    const engine = boot({page:dom.window,get:(key,fallback)=>values.get(key)??fallback,set:async(key,value)=>values.set(key,structuredClone(value)),del:key=>values.delete(key),request:()=>{},
      repository:{profile:async()=>{},profiles:async()=>[],report:async()=>({days:[],summary:{}}),record:async item=>{if(fail)throw new Error('disk');records.push(item);}},
      adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},healthy:()=>true,sync(){}};},
      identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>{api=value;}
    });
    return {dom,engine};
  };
  let current = launch();
  try {
    current.engine.start();
    await onEvent({type:'gift',id:'pending-income',giftId:'rose',giftName:'玫瑰',groupId:'combo',count:3,unitValue:100,final:true,user:{id:'viewer',name:'观众'}});
    await new Promise(resolve=>setTimeout(resolve,10));
    current.dom.window.dispatchEvent(new current.dom.window.Event('pagehide'));
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(values.get('live-assistant:runtime:1234567890').incomePending.length,1);
    api.panel.destroy();current.dom.window.close();
    fail = false;current = launch();
    const deadline=Date.now()+1800;while(Date.now()<deadline&&!records.length)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(records.length,1);assert.equal(records[0].event.count,3);
    const savedDeadline=Date.now()+1000;while(Date.now()<savedDeadline&&values.get('live-assistant:runtime:1234567890').incomePending.length)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(values.get('live-assistant:runtime:1234567890').incomePending.length,0);
  } finally {current.dom.window.dispatchEvent(new current.dom.window.Event('pagehide'));api.panel.destroy();current.dom.window.close();}
});

test('按主播配置自动开始场控；手动暂停后不会被定时器偷偷重启', async () => {
  const dom = setup();
  const values = new Map([['live-assistant:config:1234567890', { mode: 'auto', automation: { autoStart: true } }]]);
  let api;
  let connected = false;
  const lock = new RoomLock({ room: '1234567890' });
  const adapter = {
    status: {}, hook() {}, observeDOM() {}, stopDOM() {}, sync() {},
    healthy: () => connected, findInput: () => ({}), findSend() {},
    send: async () => ({ submitted: true })
  };
  const engine = boot({
    page: dom.window, lock,
    get: (key, fallback) => values.get(key) ?? fallback,
    set: (key, value) => values.set(key, value), del: key => values.delete(key),
    request: () => {}, adapterFactory: () => adapter,
    identityFactory: () => ({ refresh: async () => {}, close() {} }),
    onReady: value => { api = value; }
  });
  try {
    await new Promise(resolve => setTimeout(resolve, 320));
    assert.equal(engine.running, false);
    connected = true;
    await new Promise(resolve => setTimeout(resolve, 420));
    assert.equal(engine.running, true);
    assert.equal(lock.held, true);
    api.panel.node('[data-action=stop]').click();
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.equal(engine.running, false);
    assert.equal(lock.held, false);
  } finally {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    api?.panel.destroy();
    dom.window.close();
    await lock.drained;
  }
});

test('请求发送可用时开始场控不要求定位页面输入框', async()=>{
  const dom=setup(),values=new Map([['live-assistant:config:1234567890',{mode:'auto'}]]);let api;
  const lock=new RoomLock({room:'1234567890'});
  const adapter={status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>true,requestAvailable:()=>true,findInput(){throw Error('should not locate input');},findSend(){throw Error('should not locate send');},send:async()=>({submitted:true})};
  boot({page:dom.window,lock,get:(k,f)=>values.get(k)??f,set:(k,v)=>values.set(k,v),del:k=>values.delete(k),request:()=>{},adapterFactory:()=>adapter,identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>api=value});
  try { api.panel.node('[data-action=start]').click();await new Promise(r=>setTimeout(r,30));assert.equal(api.engine.running,true); }
  finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));api.panel.destroy();dom.window.close();await lock.drained;}
});

test('自动发送恢复原有面板焦点，用户中途切换焦点时不夺回；断线发生在输入后也不点击', async () => {
  const dom=setup('<textarea id="chat"></textarea><button id="send">发送</button><input id="other"><div id="host"></div>');
  const shadow=document.querySelector('#host').attachShadow({mode:'open'});shadow.innerHTML='<input id="setting">';const setting=shadow.querySelector('input');
  const input=document.querySelector('#chat'),other=document.querySelector('#other');let clicks=0;
  document.querySelector('#send').addEventListener('click',()=>{clicks++;input.value='';});
  const c=copy(DEFAULTS);c.adapter.inputSelector='#chat';c.adapter.sendSelector='#send';
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>c,onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});adapter.status.connected=true;
  try {
    setting.focus();assert.equal((await adapter.send('感谢支持',()=>true)).submitted,true);assert.equal(shadow.activeElement,setting);
    setting.focus();const sending=adapter.send('谢谢礼物',()=>true);other.focus();await sending;assert.equal(document.activeElement,other);
    setting.focus();const cancelled=adapter.send('断线不提交',()=>true);adapter.status.connected=false;assert.equal((await cancelled).submitted,false);
    assert.equal(clicks,2);assert.equal(input.value,'');assert.equal(shadow.activeElement,setting);
  } finally {dom.window.close();}
});

test('运行锁请求已发出后取消，迟到授权不持有；原生申请错误可重试', async () => {
  let grant;const locks={request:async(name,options,callback)=>{await new Promise(r=>grant=r);return callback({name});}};
  const a=new RoomLock({room:'1',locks});const request=a.acquire();await Promise.resolve();a.release();grant();
  assert.equal(await request,false);assert.equal(a.held,false);await a.drained;
  let fail=true;a.locks={request:async(name,options,callback)=>{if(fail)throw new Error('浏览器拒绝请求');return callback({name});}};
  await assert.rejects(a.acquire(),/浏览器拒绝请求/);fail=false;assert.equal(await a.acquire(),true);a.release();await a.drained;
});

test('场次面板显示整场金额和边界来源，旧日账不计作直播场次', () => {
  const dom=setup(),p=new Panel({config:copy(DEFAULTS),room:'1',callbacks:{}});
  const startAt=Date.parse('2026-10-22T15:00:00Z'),endAt=startAt+7200000;
  const session={id:'A',startAt,endAt,startSource:'platform',endSource:'room-changed',totalDiamonds:200,giftCount:2,unknownCount:0,estimatedIncome:10};
  try {
    p.updateGiftSummary(session,0.05,true);
    assert.equal(p.node('[data-gift-total-title]').textContent,'最近一场礼物价值');
    assert.equal(p.node('[data-gift-diamonds]').textContent,'200');
    assert.match(p.node('[data-gift-estimate-note]').textContent,/结束边界推定/);
    p.updateIncome({room:'1',month:'2026-10',summary:session,sessions:[session],days:[],legacyDays:[]});
    assert.equal(p.node('[data-income-sessions]').textContent,'1');
    assert.match(p.node('[data-income-daily]').textContent,/推定边界/);
    assert.match(p.node('[data-income-daily]').textContent,/开播时间.*下播时间.*直播时长/);
    assert.match(p.node('[data-income-daily]').textContent,/2 小时/);
    p.updateIncome({room:'1',month:'2026-09',summary:{},sessions:[],days:[{date:'2026-09-01'}],legacyDays:[]});
    assert.equal(p.node('[data-income-sessions]').textContent,'0');
  } finally {p.destroy();dom.window.close();}
});

test('房间状态进入真实账本并驱动本场概览，接口失效不制造下播', async () => {
  const dom=setup(),values=new Map(),room='1234567890';let api,onIdentity,onEvent;
  const at=Date.now(),startAt=at-3600000;
  const engine=boot({page:dom.window,get:(k,f)=>values.get(k)??f,set:async(k,v)=>values.set(k,structuredClone(v)),del:k=>values.delete(k),all:()=>Object.fromEntries(values),request:()=>{},
    adapterFactory:options=>{onEvent=options.onEvent;return {status:{},onEvent,hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>false};},
    identityFactory:callback=>{onIdentity=callback;return {refresh:async()=>{},close(){}};},onReady:value=>api=value});
  try {
    onIdentity({live:{roomId:'broadcast-A',status:'live',startAt,endAt:0,observedAt:at}});
    await new Promise(setImmediate);
    await onEvent({type:'gift',id:'a',groupId:'a',roomId:'broadcast-A',giftId:'rose',count:2,unitValue:100,receivedAt:at,user:{id:'9',name:'观众'},final:true});
    await new Promise(resolve=>setTimeout(resolve,650));
    assert.equal(api.panel.node('[data-gift-diamonds]').textContent,'200');
    assert.equal(api.panel.node('[data-gift-total-title]').textContent,'本场礼物价值');
    onIdentity({warning:'接口暂不可用'});await new Promise(setImmediate);
    const saved=()=>values.get(`live-assistant:income:${room}`);
    assert.equal(saved().sessions.length,1);assert.equal(saved().sessions[0][1].endAt,0);
    onIdentity({live:{roomId:'broadcast-A',status:'ended',startAt,endAt:at+1,observedAt:at+2}});
    await new Promise(resolve=>setTimeout(resolve,650));
    assert.equal(saved().sessions[0][1].endAt,at+1);
    assert.equal(api.panel.node('[data-gift-total-title]').textContent,'最近一场礼物价值');
    assert.equal(engine.running,false);
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});

test('暂停采集时本人送出的真实礼物仍计入本场收入，重复事件只计一次且不触发感谢',async()=>{
  const dom=setup(),values=new Map();let api,onEvent;
  const config=copy(DEFAULTS);config.selfId='12345';
  values.set('live-assistant:config:1234567890',config);
  const engine=boot({page:dom.window,get:(k,f)=>values.get(k)??f,set:async(k,v)=>values.set(k,structuredClone(v)),del:k=>values.delete(k),all:()=>Object.fromEntries(values),request:()=>{},
    adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>false};},
    identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>api=value});
  try {
    const gift={type:'gift',id:'self-gift-1',groupId:'self-combo-1',roomId:'live-1',giftId:'rose',giftName:'玫瑰',count:2,unitValue:100,receivedAt:Date.now(),user:{id:'12345',name:'本人'},final:true};
    await onEvent(gift);await onEvent(gift);await new Promise(resolve=>setTimeout(resolve,650));
    assert.equal(api.panel.node('[data-gift-diamonds]').textContent,'200');
    assert.equal(engine.queue.length,0);assert.equal(engine.running,false);
    const saved=values.get('live-assistant:income:1234567890');assert.ok(saved.sessions.length);
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});

test('主播管理合并UID别名不重复插入当前主播，各地址账本仍可选择',()=>{
  const dom=setup(),panel=new Panel({config:copy(DEFAULTS),room:'1',callbacks:{}});
  try {
    panel.updateProfiles([{room:'2',rooms:['2','1'],name:'同名主播',anchorId:'101'},{room:'3',name:'同名主播',anchorId:'202'}]);
    assert.equal(panel.root.querySelectorAll('[data-profiles] .profile-card').length,2);
    assert.equal(panel.node('[data-profiles] a').href,'https://live.douyin.com/1?anchor_id=101');
    assert.deepEqual([...panel.node('[data-income-room]').options].map(option=>option.value).sort(),['1','2','3']);
    panel.node('[data-income-room]').value='2';
    panel.updateProfiles([{room:'1',rooms:['1','2'],name:'同名主播',anchorId:'101'},{room:'3',name:'同名主播',anchorId:'202'}]);
    assert.equal(panel.incomeSelection().room,'2');
    assert.equal(panel.root.querySelectorAll('[data-profiles] .profile-card').length,2);
  } finally {panel.destroy();dom.window.close();}
});

test('配置 AI 后可一键填充指定定时组，生成期间防重复，其他设置保持不变',async()=>{
  const dom=setup(),config=copy(DEFAULTS);config.timersEnabled=true;
  config.timers=[{...config.timers[0],enabled:true,messages:[],intervalSec:720},{...config.timers[0],id:'other',messages:['第二组自定义']}];
  let calls=0,release,options;
  const panel=new Panel({config,room:'1',callbacks:{generatePhrases:async(c,key,remember,value)=>{calls++;options=value;assert.equal(key,'draft-key');return new Promise(resolve=>release=resolve);}}});
  try {
    const button=panel.root.querySelector('[data-generate-phrases="timer"]');
    assert.equal(button.parentElement.hidden,true);
    panel.node('[data-api-key]').value='draft-key';panel.syncControls();
    assert.equal(button.parentElement.hidden,false);
    const pending=panel.fillPhrases(button);
    assert.equal(button.disabled,true);assert.equal(button.textContent,'正在生成…');
    await panel.fillPhrases(button);assert.equal(calls,1);
    release(['欢迎来坐坐，喜欢就点个关注。','欢迎新来的朋友，关注一下下次好找。']);await pending;
    const result=panel.read();
    assert.deepEqual(result.timers[0],{...config.timers[0],messages:['欢迎来坐坐，喜欢就点个关注。','欢迎新来的朋友，关注一下下次好找。']});
    assert.deepEqual(result.timers[1],config.timers[1]);
    assert.deepEqual(result.gift,config.gift);assert.equal(panel.dirty,true);
    assert.equal(button.disabled,false);assert.equal(options.kind,'timer');
    assert.deepEqual(config.timers[0].messages,[]);
  } finally {panel.destroy();dom.window.close();}
});

test('AI 生成失败或等待期间编辑内容时保留草稿；支持新增定时组和关键词',async()=>{
  const dom=setup(),config=copy(DEFAULTS);let release;
  const panel=new Panel({config,room:'1',callbacks:{hasAIKey:()=>true,generatePhrases:()=>new Promise(resolve=>release=resolve)}});
  try {
    const button=panel.root.querySelector('[data-generate-phrases="welcome"]'),field=panel.node('[data-field="welcome.templates"]');
    assert.equal(button.parentElement.hidden,false);
    const pending=panel.fillPhrases(button);field.value='我自己写的欢迎';release(['AI 欢迎']);await pending;
    assert.equal(field.value,'我自己写的欢迎');
    panel.callbacks.generatePhrases=async()=>{throw new Error('服务繁忙');};await panel.fillPhrases(button);
    assert.equal(field.value,'我自己写的欢迎');assert.equal(button.disabled,false);
    const row=panel.addRow('timers');assert.equal(row.querySelector('[data-phrase-generator]').hidden,false);
    let calls=0;
    panel.callbacks.generatePhrases=async(c,key,remember,options)=>{calls++;assert.equal(options.kind,'keyword');assert.deepEqual(options.keywords,['你好']);return ['{user} 你好呀'];};
    const keyword=panel.addRow('keywords'),keyButton=keyword.querySelector('[data-generate-phrases]');
    await panel.fillPhrases(keyButton);assert.equal(calls,0);
    keyword.querySelector('[data-item="keywords"]').value='你好';await panel.fillPhrases(keyButton);
    assert.equal(keyword.querySelector('[data-item="reply"]').value,'{user} 你好呀');assert.equal(calls,1);
    panel.node('[data-field="ai.endpoint"]').value='https://different.test/v1/chat/completions';
    panel.callbacks.hasAIKey=()=>false;panel.syncControls();assert.equal(button.parentElement.hidden,true);
    panel.node('[data-field="ai.endpoint"]').value='http://localhost:11434/v1/chat/completions';panel.syncControls();assert.equal(button.parentElement.hidden,false);
  } finally {panel.destroy();dom.window.close();}
});

test('应用 AI 话术生成复用当前服务已存密钥，填充草稿不保存设置或发送弹幕',async()=>{
  const dom=setup(),values=new Map([['live-assistant:api-key:https://api.deepseek.com','saved-key']]);let api,details,sends=0;
  const adapter={status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>false,send:async()=>{sends++;}};
  boot({page:dom.window,get:(key,fallback)=>values.get(key)??fallback,set:(key,value)=>values.set(key,value),del:key=>values.delete(key),
    request:value=>{details=value;value.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:'["欢迎 {user}，随便坐。","{user} 你好，欢迎来玩。"]'}}]})});},
    adapterFactory:()=>adapter,identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>{api=value;}});
  try {
    const button=api.panel.root.querySelector('[data-generate-phrases="welcome"]');
    assert.equal(button.parentElement.hidden,false);
    button.click();await new Promise(setImmediate);
    assert.equal(details.headers.Authorization,'Bearer saved-key');
    assert.equal(api.panel.node('[data-field="welcome.templates"]').value,'欢迎 {user}，随便坐。\n{user} 你好，欢迎来玩。');
    assert.equal(api.panel.dirty,true);assert.equal(sends,0);
    assert.equal(values.has('live-assistant:config:1234567890'),false);
    assert.deepEqual(JSON.parse(details.data).messages.map(message=>message.role),['system','user']);
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});

test('内容治理独立设置页可读写 AI 与分级处置，检测记录安全显示并保留配置',()=>{
  const dom=setup(),c=copy(DEFAULTS);c.moderation.enabled=true;
  const p=new Panel({config:c,room:'1',callbacks:{}}),e=new Engine({config:c});
  try{
    p.tab('moderation');assert.equal(p.node('[data-page="moderation"]').hidden,false);
    p.node('[data-field="moderation.threshold"]').value='4';p.node('[data-field="moderation.banThreshold"]').value='8';
    p.node('[data-field="moderation.severeAction"]').value='mute';p.node('[data-field="moderation.sensitiveTerms"]').value='自定义话题\n隐私曝光';
    p.syncControls();const saved=p.read();assert.equal(saved.moderation.threshold,4);assert.equal(saved.moderation.banThreshold,8);
    assert.equal(saved.moderation.severeAction,'mute');assert.deepEqual(saved.moderation.sensitiveTerms,['自定义话题','隐私曝光']);
    assert.match(p.node('[data-moderation-summary]').textContent,/4 次/);
    e.moderation.records=[{id:1,at:Date.now(),user:{name:'<img src=x onerror=alert(1)>'},category:'abuse',text:'<script>alert(1)</script>',confidence:0.98,source:'ai',action:'ban',status:'unknown',reason:'<b>判定</b>',detail:'结果未知，不自动重试'}];
    p.refresh(e);assert.match(p.node('[data-moderation-records]').textContent,/结果未知/);
    assert.equal(p.node('[data-moderation-records]').querySelector('img,script,b'),null);
    p.node('[data-field="moderation.enabled"]').checked=false;p.syncControls();assert.equal(p.node('[data-moderation-settings]').hidden,true);
    assert.deepEqual(p.read().moderation.sensitiveTerms,['自定义话题','隐私曝光']);
  }finally{p.destroy();dom.window.close();}
});
