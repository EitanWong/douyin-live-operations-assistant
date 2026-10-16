import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { Panel } from '../../src/ui/panel.js';
import { copy, DEFAULTS, Engine } from '../../src/core/engine.js';
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
test('面板可完整读写配置、切换选项、保存不会丢失隐藏字段', () => {
  const dom = setup(); const c = copy(DEFAULTS); c.mode = 'preview'; c.anchorId = '1234567890'; c.like.enabled = true;
  const panel = new Panel({ config: c, room: '1234567890', callbacks: {} });
  assert.deepEqual(panel.read(), c);
  panel.root.querySelector('[data-field="welcome.minWealth"]').value = '40';
  panel.root.querySelector('[data-field="gift.minValue"]').value = '200';
  const next = panel.read(); assert.equal(next.welcome.minWealth, 40); assert.equal(next.gift.minValue, 200); assert.equal(next.sending.queueLimit, 200);
  panel.tab('gift'); assert.equal(panel.root.querySelector('[data-page="gift"]').hidden, false); assert.equal(panel.root.querySelector('[data-page="runtime"]').hidden, true);
  panel.tab('likes'); panel.root.querySelector('[data-field="like.cooldownSec"]').value = '90';
  assert.equal(panel.read().like.cooldownSec, 90); assert.equal(panel.root.querySelector('[data-page="likes"]').hidden, false);
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
test('未保存设置开始时先保存，等待期间刷新不会允许重复开始',async()=>{
  const dom=setup();let release,starts=0,saves=0;const c={...copy(DEFAULTS),mode:'preview'},e=new Engine({config:c});
  const p=new Panel({config:c,room:'1',callbacks:{save:async()=>{saves++;await new Promise(r=>release=r);},start:()=>{starts++;e.start();}}});p.refresh(e);
  const input=p.root.querySelector('[data-field="gift.minValue"]');input.value='200';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  p.node('[data-action="start"]').click();p.refresh(e);p.node('[data-action="start"]').click();assert.equal(saves,1);assert.equal(p.node('[data-action="start"]').disabled,true);
  release();await new Promise(r=>setTimeout(r,10));assert.equal(starts,1);assert.equal(p.dirty,false);assert.equal(p.node('[data-action="start"]').disabled,true);
  p.destroy();dom.window.close();
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

test('保存和开始互斥；运行时保存明确暂停，失败保留修改且可重试', async () => {
  const dom=setup(),c={...copy(DEFAULTS),mode:'preview'},e=new Engine({config:c}); let rejectSave,starts=0;
  const p=new Panel({config:c,room:'1',callbacks:{save:()=>new Promise((_,reject)=>rejectSave=reject),start:()=>starts++}});
  try {
    p.refresh(e); p.markDirty(); p.node('[data-action=save]').click(); p.refresh(e);
    assert.equal(p.node('[data-action=start]').disabled,true); assert.equal(p.node('form').inert,true);
    p.node('[data-action=start]').click(); assert.equal(starts,0);
    rejectSave(new Error('暂时无法保存')); await new Promise(r=>setTimeout(r,10));
    assert.equal(p.dirty,true); assert.equal(p.node('form').inert,false); assert.equal(p.node('[data-action=start]').disabled,false);
    assert.match(p.node('.toast').textContent,/无法保存/);
    e.start();p.refresh(e);assert.equal(p.node('[data-action=start]').hidden,true);assert.equal(p.node('[data-action=stop]').hidden,false);assert.equal(p.node('[data-action=save]').textContent,'保存并暂停');
    p.tab('gift');assert.equal(p.node('[data-action=stop]').closest('[data-page]'),null);
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
    assert.deepEqual([...p.root.querySelectorAll('[data-category]')].map(node=>node.textContent),['直播互动','设置']);
    p.tab('runtime');
    assert.equal(p.activeTab,'runtime'); assert.equal(p.node('[data-page="runtime"]').hidden,false);
    for (const key of ['gift','welcome','like','keyword']) assert.equal(p.node(`[data-field="${key}.enabled"]`).closest('[data-page]').dataset.page,'features');
    assert.equal(p.node('[data-field="timersEnabled"]').closest('[data-page]').dataset.page,'features');
    assert.equal(p.node('[data-field="ai.enabled"]').closest('[data-page]').dataset.page,'features');
    assert.equal(p.node('[data-field="ai.chatEnabled"]').closest('[data-page]').dataset.page,'features');
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
    assert.match(p.node('[data-summary=gift]').textContent,/连击总价 ≥ 100 钻/);
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
    assert.equal(p.node('.primary-nav').style.gridTemplateColumns,'repeat(2, minmax(0, 1fr))');

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
    launcher.getBoundingClientRect=()=>{const left=parseFloat(launcher.style.left)||0,top=parseFloat(launcher.style.top)||0;return {left,top,right:left+100,bottom:top+30,width:100,height:30};};
    const pointer=(type,x,y)=>{const e=new dom.window.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{clientX:x,clientY:y,pointerId:1,button:0});return e;};
    const start=launcher.getBoundingClientRect(); launcher.dispatchEvent(pointer('pointerdown',start.left+10,start.top+10));
    dom.window.dispatchEvent(pointer('pointermove',start.left+310,start.top+120));
    assert.equal(launcher.classList.contains('dragging'),true);
    dom.window.dispatchEvent(pointer('pointerup',start.left+310,start.top+120)); launcher.dispatchEvent(new dom.window.Event('click',{bubbles:true}));
    assert.equal(launcher.classList.contains('dragging'),false);
    assert.equal(p.open,true); assert.ok(parseFloat(launcher.style.left)>dom.window.innerWidth/2); assert.equal(dom.window.localStorage.getItem('douyin-live-assistant:launcher')!==null,true);
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
    assert.ok(parseFloat(launcher.style.left)+100<=320);
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
    assert.deepEqual(await adapter.send('感谢支持',()=>true),{submitted:true});
    assert.equal(clicks,1);
    assert.deepEqual(await adapter.send('欢迎新朋友',()=>true),{submitted:true});assert.equal(clicks,2);
  } finally {dom.window.close();}
});

test('点击无效不会误报已提交，也不重复点击发送按钮', async () => {
  const dom=setup('<div><textarea placeholder="说点什么"></textarea><svg class="webcast-chatroom___send-btn"></svg></div>');
  const adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent:()=>{},onLog:()=>{},onStatus:()=>{}});
  adapter.status={connected:true,lastFrame:Date.now()};let clicks=0;dom.window.document.querySelector('svg').addEventListener('click',()=>clicks++);
  try {await assert.rejects(adapter.send('感谢支持',()=>true),/未确认提交/);assert.equal(clicks,1);assert.equal(dom.window.document.querySelector('textarea').value,'感谢支持');}
  finally {dom.window.close();}
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
    assert.deepEqual(await adapter.send('感谢支持',()=>true),{submitted:true});
  } finally {dom.window.close();}
});

test('月报可选多个主播月份，按日展示；账本开关隐藏统计而保留主播管理', () => {
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
    panel.tab('income');assert.equal(panel.node('[data-page=income]').hidden,false);
    panel.node('[data-field=incomeEnabled]').checked=false;panel.syncControls();
    assert.equal(panel.node('[data-tab=income]').hidden,true);assert.equal(panel.node('[data-tab=profiles]').hidden,false);
    assert.equal(panel.activeTab,'features');assert.equal(panel.read().incomeEnabled,false);
    assert.equal(panel.node('[data-profiles] a').href,'https://live.douyin.com/1?anchor_id=101');
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
test('应用所有内部暂停都释放本页锁；重连不中止，页面缓存返回后可重新开始', async () => {
  const dom=setup(),values=new Map([['live-assistant:config:1234567890',{mode:'auto'}]]);
  let api;let connected=true;const lock=new RoomLock({room:'1234567890'});
  const adapter={status:{},hook(){},observeDOM(){},stopDOM(){},healthy:()=>connected,findInput:()=>({}),findSend(){},sync(){},send:async()=>{throw new Error('模拟失败');}};
  const engine=boot({page:dom.window,lock,get:(k,f)=>values.get(k)??f,set:(k,v)=>values.set(k,v),del:k=>values.delete(k),request:()=>{},adapterFactory:()=>adapter,identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>api=value});
  const clickStart=async()=>{api.panel.refresh(engine);api.panel.node('[data-action=start]').click();await new Promise(r=>setTimeout(r,20));assert.equal(engine.running,true);assert.equal(lock.held,true);};
  try {
    await clickStart();engine.enqueue('gift','谢谢支持');await engine.tick();assert.equal(engine.running,false);assert.equal(lock.held,false);
    await clickStart();engine.ingest({type:'end'});assert.equal(lock.held,false);
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
    order.length=0;await onEvent({type:'chat',id:'live-chat',user:{id:'viewer-1',name:'实时观众'},text:'你好'});
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
