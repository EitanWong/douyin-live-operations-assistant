import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { Panel } from '../src/ui.js';
import { copy, DEFAULTS, Engine } from '../src/core.js';
import { DouyinAdapter, RoomLock } from '../src/adapter.js';
import { gzipSync } from 'node:zlib';

function setup(body = '') {
  const dom = new JSDOM(`<body>${body}</body>`, { url: 'https://live.douyin.com/1234567890?anchor_id=1234567890', pretendToBeVisual: true });
  for (const name of ['document', 'window', 'location', 'MutationObserver', 'HTMLElement']) globalThis[name] = dom.window[name];
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.CSS = { escape: s => s.replace(/["\\]/g, '\\$&') };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: undefined } });
  for (const el of dom.window.document.querySelectorAll('*')) el.getClientRects = () => [{ width: 100, height: 30 }];
  return dom;
}
test('面板可完整读写配置、切换选项、保存不会丢失隐藏字段', () => {
  const dom = setup(); const c = copy(DEFAULTS); c.anchorId = '1234567890';
  const panel = new Panel({ config: c, room: '1234567890', callbacks: {} });
  assert.deepEqual(panel.read(), c);
  panel.root.querySelector('[data-field="welcome.minWealth"]').value = '40';
  panel.root.querySelector('[data-field="gift.minValue"]').value = '200';
  const next = panel.read(); assert.equal(next.welcome.minWealth, 40); assert.equal(next.gift.minValue, 200); assert.equal(next.sending.queueLimit, 30);
  panel.tab('gift'); assert.equal(panel.root.querySelector('[data-page="gift"]').hidden, false); assert.equal(panel.root.querySelector('[data-page="runtime"]').hidden, true);
  panel.tab('likes'); panel.root.querySelector('[data-field="like.cooldownSec"]').value = '90';
  assert.equal(panel.read().like.cooldownSec, 90); assert.equal(panel.root.querySelector('[data-page="likes"]').hidden, false);
  dom.window.close();
});
test('昵称、回复和日志不会注入 HTML；刷新不会覆盖正在编辑的审核候选', () => {
  const dom = setup(); const c = copy(DEFAULTS); c.mode = 'review';
  const panel = new Panel({ config: c, room: '1', callbacks: {} }); const e = new Engine({ config: c }); e.start(); e.enqueue('welcome', '<img src=x onerror=alert(1)>'); panel.refresh(e);
  assert.equal(panel.root.querySelectorAll('img').length, 0);
  const textarea = panel.root.querySelector('[data-candidate] textarea'); textarea.value = '人工修改'; panel.refresh(e); assert.equal(panel.root.querySelector('[data-candidate] textarea').value, '人工修改');
  e.approve(e.queue[0].id, '人工修改'); panel.refresh(e); assert.equal(panel.root.querySelector('[data-candidate] textarea'), null);
  panel.log('error', '<script>alert(1)</script>'); assert.equal(panel.root.querySelectorAll('script').length, 0); dom.window.close();
});
test('页面发送通过 native setter 驱动 input，并保留已有草稿', async () => {
  const dom = setup('<div><textarea id="chat" placeholder="说点什么"></textarea><button id="send">发送</button></div>'); const c = copy(DEFAULTS);
  const a = new DouyinAdapter({ page: dom.window, getConfig: () => c, onEvent: () => {}, onLog: () => {}, onStatus: () => {} });
  a.status.connected = true; a.status.lastFrame = Date.now();
  let inputEvent = 0, clicks = 0; dom.window.document.querySelector('#chat').addEventListener('input', () => inputEvent++); dom.window.document.querySelector('#send').addEventListener('click', () => clicks++);
  const result = await a.send('测试候选', () => true); assert.equal(result.submitted, true); assert.equal(inputEvent, 1); assert.equal(clicks, 1);
  await assert.rejects(a.send('另一条', () => true), /草稿/); assert.equal(dom.window.document.querySelector('#chat').value, '测试候选'); dom.window.close();
});
test('页面发送等待期间暂停会取消，禁用按钮不会点击', async () => {
  const dom = setup('<div><textarea id="chat" placeholder="说点什么"></textarea><button id="send">发送</button></div>'); const c = copy(DEFAULTS);
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
    const replacement = dom.window.document.createElement('div'); replacement.className = 'webcast-chatroom___send-btn'; replacement.getClientRects = () => [{ width: 30, height: 30 }]; replacement.addEventListener('click', () => clicks++);
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
test('租约阻止多标签页同时运行，释放后允许接管', async () => {
  setup(); const values = new Map(); const options = { room: '1', get: (k, fallback) => values.get(k) ?? fallback, set: (k, value) => values.set(k, value) };
  const a = new RoomLock(options), b = new RoomLock(options); assert.equal(await a.acquire(), true); assert.equal(await b.acquire(), false);
  a.release(); assert.equal(await b.acquire(), true); b.release();
});
test('生成的单文件油猴脚本在加载前可启动，无外部依赖且默认暂停', async () => {
  const source = await readFile(new URL('../dist/douyin-live-assistant.user.js', import.meta.url), 'utf8');
  const values = new Map();
  const dom = new JSDOM('<body></body>', { url: 'https://live.douyin.com/1234567890?anchor_id=1234567890', runScripts: 'outside-only', pretendToBeVisual: true });
  Object.assign(dom.window, { unsafeWindow: dom.window, TextDecoder, TextEncoder, GM_getValue: (k, fallback) => values.get(k) ?? fallback, GM_setValue: (k, v) => values.set(k, v), GM_deleteValue: k => values.delete(k), GM_xmlhttpRequest: () => assert.fail('默认不应请求 AI'), GM_registerMenuCommand: () => {} });
  dom.window.eval(source); const host = dom.window.document.getElementById('douyin-live-assistant'); assert.ok(host); assert.equal(host.shadowRoot.querySelector('[data-state]').textContent, '已暂停');
  assert.equal(host.shadowRoot.querySelector('[data-field="anchorId"]').value, '1234567890'); assert.equal(source.includes('@require'), false); dom.window.close();
});

test('价格、关键词、名单、多个定时组用表单完整读写；规则可排序删除', () => {
  const dom=setup();const c=copy(DEFAULTS);c.gift.prices={'玫瑰':1};c.welcome.listed=['123','name:青山'];c.keyword.rules=[{keywords:['几点','时间'],reply:'晚上八点',exact:false},{keywords:['地址'],reply:'看置顶',exact:true}];c.timers=[{id:'one',enabled:true,responseMode:'rules',messages:['欢迎','点个关注'],intervalSec:300,start:'22:00',end:'02:00',quietSec:15},{id:'two',enabled:false,responseMode:'rules',messages:['喝水'],intervalSec:600,start:'',end:'',quietSec:30}];
  const p=new Panel({config:c,room:'1',callbacks:{}});assert.deepEqual(p.read(),c);
  p.root.querySelector('[data-move="down"]').click();assert.equal(p.read().keyword.rules[0].reply,'看置顶');
  p.root.querySelector('[data-list="prices"] [data-remove]').click();assert.deepEqual(p.read().gift.prices,{});
  p.updateViewers([{key:'uid:999',id:'999',name:'新观众',wealthLevel:40}]);p.node('[data-viewer-picker]').value='uid:999';p.node('[data-action="add-viewer"]').click();assert.ok(p.read().welcome.listed.includes('uid:999'));
  const row=p.addRow('prices');assert.throws(()=>p.read(),/礼物名称/);assert.equal(p.activeTab,'gift');assert.equal(row.querySelector('[data-item="key"]').getAttribute('aria-invalid'),'true');
  p.destroy();dom.window.close();
});
test('空定时话术会展开折叠区并定位错误，启用组不能静默空跑',()=>{
  const dom=setup(),c=copy(DEFAULTS);c.timers=[{id:'blank',enabled:true,messages:[],intervalSec:300,start:'',end:'',quietSec:15}];const p=new Panel({config:c,room:'1',callbacks:{}});
  const timing=p.root.querySelector('[data-list="timers"] details');assert.equal(timing.open,false);assert.throws(()=>p.read(),/至少一条定时话术/);assert.equal(p.activeTab,'timers');assert.equal(p.root.querySelector('[data-item="messages"]').getAttribute('aria-invalid'),'true');p.root.querySelector('[data-item="messages"]').value='欢迎';p.root.querySelector('[data-item="quietSec"]').value='-1';assert.throws(()=>p.read(),/互动避让/);assert.equal(timing.open,true);p.destroy();dom.window.close();
});
test('未保存设置开始时先保存，等待期间刷新不会允许重复开始',async()=>{
  const dom=setup();let release,starts=0,saves=0;const c=copy(DEFAULTS),e=new Engine({config:c});
  const p=new Panel({config:c,room:'1',callbacks:{save:async()=>{saves++;await new Promise(r=>release=r);},start:()=>{starts++;e.start();}}});p.refresh(e);
  const input=p.root.querySelector('[data-field="gift.minValue"]');input.value='200';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  p.node('[data-action="start"]').click();p.refresh(e);p.node('[data-action="start"]').click();assert.equal(saves,1);assert.equal(p.node('[data-action="start"]').disabled,true);
  release();await new Promise(r=>setTimeout(r,10));assert.equal(starts,1);assert.equal(p.dirty,false);assert.equal(p.node('[data-action="start"]').disabled,true);
  p.destroy();dom.window.close();
});
test('稳定刷新不重建节点，收起后日志不渲染，记录限制200条',async()=>{
  const dom=setup();const p=new Panel({config:copy(DEFAULTS),room:'1',callbacks:{}}),e=new Engine({config:copy(DEFAULTS)});e.start();p.refresh(e);
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
  const dom=setup(),c=copy(DEFAULTS),e=new Engine({config:c}); let rejectSave,starts=0;
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
  const dom=setup(),p=new Panel({config:copy(DEFAULTS),room:'1',callbacks:{}});
  try {
    for(let i=0;i<1000;i++)p.log('system',String(i));
    assert.equal(p.entries.length,200);assert.equal(p.node('[data-logs]').innerHTML,'');assert.equal(p.logTimer,undefined);
    p.log('preview','<img src=x onerror=alert(1)>');assert.equal(p.node('[data-last-reply]').textContent,'<img src=x onerror=alert(1)>');assert.equal(p.root.querySelector('img'),null);
    p.tab('diagnostics');p.node('[data-log-details]').open=true;await new Promise(r=>setTimeout(r,10));assert.equal(p.node('[data-logs]').children.length,100);
    p.node('[data-log-details]').open=false;p.log('system','展开后的新记录');await new Promise(r=>setTimeout(r,10));assert.equal(p.logDirty,true);assert.equal(p.node('[data-logs]').textContent.includes('展开后的新记录'),false);
  } finally {p.destroy();dom.window.close();}
});

test('名单模式隐藏无关条件且保留配置；模式提示跟随草稿，预设与实际接口一致', () => {
  const dom=setup(),c=copy(DEFAULTS),p=new Panel({config:c,room:'1',callbacks:{}}),e=new Engine({config:c});
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
  const dom=setup(),c=copy(DEFAULTS);c.keyword.rules=[];const p=new Panel({config:c,room:'1',callbacks:{}});
  try {
    assert.deepEqual([...p.root.querySelectorAll('[data-category]')].map(node=>node.textContent),['回复','互动','设置']);
    assert.equal(p.activeTab,'runtime'); assert.equal(p.node('[data-page="runtime"]').hidden,false);
    for (const key of ['gift','welcome','like','keyword']) {
      const enabled=p.root.querySelectorAll(`[data-field="${key}.enabled"]`);
      assert.equal(enabled.length,1); assert.equal(enabled[0].closest('[data-page]').dataset.page,'runtime');
    }
    assert.equal(p.node('[data-field="gift.enabled"]').checked,true);
    assert.equal(p.node('[data-tab="replies"]').textContent,'回复记录');
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
    p.node('[data-field="keyword.enabled"]').click();
    const rule=p.addRow('keywords');rule.querySelector('[data-item=keywords]').value='几点开播';rule.querySelector('[data-item=reply]').value='请看直播预告';p.syncControls();
    assert.match(p.node('[data-summary=keyword]').textContent,/1 条规则/);
    assert.equal(p.read().keyword.rules[0].reply,'请看直播预告');

    p.node('[data-field="ai.enabled"]').checked=true;p.syncControls();assert.match(p.node('[data-summary=ai]').textContent,/当前仅预览/);
    const timer=p.addRow('timers');timer.querySelector('[data-item=enabled]').checked=true;p.syncControls();assert.match(p.node('[data-summary=timers]').textContent,/已开启 1 组/);
  } finally {p.destroy();dom.window.close();}
});
test('主分类导航收敛二级页面；悬浮按钮可拖动吸附并记住位置', () => {
  const dom=setup(),p=new Panel({config:copy(DEFAULTS),room:'1',callbacks:{}});
  try {
    p.node('[data-category="interaction"]').click();
    assert.equal(p.activeTab,'gift'); assert.equal(p.node('[data-subnav="interaction"]').hidden,false); assert.equal(p.node('[data-subnav="reply"]').hidden,true);
    p.node('[data-tab="welcome"]').click(); assert.equal(p.activeTab,'welcome');
    const launcher=p.node('.launcher');
    launcher.getBoundingClientRect=()=>{const left=parseFloat(launcher.style.left)||0,top=parseFloat(launcher.style.top)||0;return {left,top,right:left+100,bottom:top+30,width:100,height:30};};
    const pointer=(type,x,y)=>{const e=new dom.window.Event(type,{bubbles:true,cancelable:true});Object.assign(e,{clientX:x,clientY:y,pointerId:1,button:0});return e;};
    const start=launcher.getBoundingClientRect(); launcher.dispatchEvent(pointer('pointerdown',start.left+10,start.top+10));
    dom.window.dispatchEvent(pointer('pointermove',start.left+310,start.top+120)); dom.window.dispatchEvent(pointer('pointerup',start.left+310,start.top+120)); launcher.dispatchEvent(new dom.window.Event('click',{bubbles:true}));
    assert.equal(p.open,true); assert.ok(parseFloat(launcher.style.left)>dom.window.innerWidth/2); assert.equal(dom.window.localStorage.getItem('douyin-live-assistant:launcher')!==null,true);
    Object.defineProperty(dom.window,'innerWidth',{configurable:true,value:320}); dom.window.dispatchEvent(new dom.window.Event('resize'));
    assert.ok(parseFloat(launcher.style.left)+100<=320);
  } finally {p.destroy();dom.window.close();}
});
test('近期送礼列表显示已知字段并安全转义昵称与礼物名', () => {
  const dom=setup(),p=new Panel({config:copy(DEFAULTS),room:'1',callbacks:{}});
  p.updateGifts([{key:'gift-1',user:{name:'<b>观众</b>'},giftName:'<img src=x>',count:2,unitValue:null}]);
  assert.match(p.node('[data-recent-gifts]').textContent,/观众/);
  assert.match(p.node('[data-recent-gifts]').textContent,/价值未知/);
  assert.equal(p.node('[data-recent-gifts]').querySelector('img'),null);
  p.destroy();dom.window.close();
});
