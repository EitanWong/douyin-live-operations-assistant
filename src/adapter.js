import { decodeFrame } from './protocol.js';

export function isVisible(element) {
  return !!element && element.isConnected && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
}
export function selectorFor(element) {
  if (element.id) return `#${CSS.escape(element.id)}`;
  for (const name of ['data-e2e', 'data-testid']) if (element.hasAttribute(name)) {
    const selector = `[${name}="${CSS.escape(element.getAttribute(name))}"]`;
    if (document.querySelectorAll(selector).length === 1) return selector;
  }
  const path = []; let current = element;
  while (current && current !== document.body && path.length < 8) {
    const siblings = current.parentElement ? [...current.parentElement.children].filter(e => e.tagName === current.tagName) : [current];
    path.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`);
    const selector = path.join(' > '); if (document.querySelectorAll(selector).length === 1) return selector;
    current = current.parentElement;
  }
  return `body > ${path.join(' > ')}`;
}
export function pickElement(kind, onPicked, onLog, excludedHost) {
  onLog('system', `请在直播网页上点击${kind === 'input' ? '公屏输入框' : '公屏发送按钮'}；Esc 取消`);
  function cleanup() { document.removeEventListener('click', click, true); document.removeEventListener('keydown', key, true); }
  function key(e) { if (e.key === 'Escape') { cleanup(); onLog('system', '已取消定位'); } }
  function click(e) {
    if (e.composedPath().includes(excludedHost)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const node = kind === 'input' ? e.target.closest('input, textarea, [contenteditable="true"]') : e.target.closest('[class*="webcast-chatroom___send"], button, [role="button"], [class*="send"]');
    if (!node) { onLog('error', '未选到对应控件，请重新点击或按 Esc 取消'); return; }
    if (kind === 'input' && node.tagName === 'INPUT' && !['text', 'search', ''].includes(node.type)) { onLog('error', '请选择文本输入框'); return; }
    cleanup(); onPicked(selectorFor(node));
  }
  document.addEventListener('click', click, true); document.addEventListener('keydown', key, true);
  return cleanup;
}

export class DouyinAdapter {
  constructor({ page, getConfig, onEvent, onLog, onStatus, shouldReadChat = () => true }) {
    this.page = page; this.getConfig = getConfig; this.shouldReadChat = shouldReadChat; this.onEvent = onEvent; this.onLog = onLog; this.onStatus = onStatus;
    this.status = { hook: false, sockets: 0, frames: 0, events: 0, errors: 0, lastFrame: 0, connected: false };
    this.pending = 0; this.chain = Promise.resolve(); this.roomPath = location.pathname;
    this.activeSockets = new Set(); this.domSeen = new WeakMap(); this.domActive = false; this.lastSocketChat = 0;
  }
  hook() {
    try {
      const Native = this.page.WebSocket, adapter = this;
      if (!Native) throw new Error('没有 WebSocket');
      const Hook = new Proxy(Native, {
        construct(target, args, newTarget) {
          const socket = Reflect.construct(target, args, newTarget === Hook ? target : newTarget);
          let url; try { url = new URL(String(args[0])); } catch { return socket; }
          if (!url.hostname.endsWith('.douyin.com') && url.hostname !== 'douyin.com') return socket;
          if (!/webcast\/im\//.test(url.pathname)) return socket;
          adapter.status.sockets++; adapter.emitStatus();
          socket.addEventListener('open', () => { adapter.activeSockets.add(socket); adapter.status.connected = true; adapter.emitStatus(); });
          socket.addEventListener('close', () => { adapter.activeSockets.delete(socket); adapter.status.connected = adapter.activeSockets.size > 0; adapter.emitStatus(); });
          socket.addEventListener('message', e => {
            if (location.pathname !== adapter.roomPath || adapter.pending >= 100) return;
            adapter.pending++;
            adapter.chain = adapter.chain.then(async () => {
              try {
                const events = await decodeFrame(e.data);
                adapter.status.frames++; adapter.status.lastFrame = Date.now();
                adapter.status.events += events.length;
                for (const event of events) { if (event.type === 'chat') adapter.lastSocketChat = Date.now(); adapter.onEvent(event); }
              } catch (error) {
                adapter.status.errors++;
                if (adapter.status.errors === 1 || adapter.status.errors % 100 === 0) adapter.onLog('error', `直播消息解析失败：${error.message}；请查看诊断`);
              } finally { adapter.pending--; adapter.emitStatus(); }
            });
          });
          return socket;
        }
      });
      this.page.WebSocket = Hook;
      this.status.hook = this.page.WebSocket === Hook;
      if (!this.status.hook) throw new Error('页面未接受 WebSocket 观察器');
    } catch (error) { this.onLog('error', `观察器安装失败：${error.message}；请刷新并检查油猴的页面注入设置`); }
    this.emitStatus();
  }
  emitStatus() { this.onStatus({ ...this.status }); }
  healthy() { return this.status.connected && Date.now() - this.status.lastFrame < 90000; }
  findInput() {
    const configured = this.getConfig().adapter.inputSelector;
    const selector = configured || '#chatroom [contenteditable="true"], .webcast-chatroom [contenteditable="true"], textarea[placeholder*="说点"], textarea[placeholder*="聊"], input[placeholder*="说点"], [contenteditable="true"][data-placeholder*="说点"], [contenteditable="true"][data-placeholder*="聊"], [contenteditable="true"][data-placeholder*="互动"]';
    const list = [...document.querySelectorAll(selector)].filter(isVisible).filter(e => /^(INPUT|TEXTAREA)$/.test(e.tagName) || e.isContentEditable);
    if (list.length !== 1) throw new Error(list.length ? '发现多个输入框，请在诊断页手动定位公屏输入框' : '未找到公屏输入框，请登录并在诊断页手动定位');
    return list[0];
  }
  findSend(input) {
    const configured = this.getConfig().adapter.sendSelector;
    let list;
    if (configured) list = [...document.querySelectorAll(configured)];
    else {
      const area = input.closest('#chatInput, .webcast-chatroom___input-container, form') || input.parentElement?.parentElement || document;
      list = [...area.querySelectorAll('button, [role="button"], [class*="send"]')];
    }
    list = list.filter(isVisible).filter(e => configured || e.classList.contains('webcast-chatroom___send-btn') || e.classList.contains('webcast-chatroom___send-icon') || /^(发送|send)(\s*\([^)]*\))?$/i.test((e.getAttribute('aria-label') || e.textContent || '').trim()));
    // 自定义图标可能在外层和内层同时命中，保留最外层发送控件。
    list = list.filter(e => !list.some(other => other !== e && other.contains(e)));
    if (list.length !== 1) throw new Error('无法唯一确认“发送”按钮，请在诊断页定位公屏发送按钮');
    return list[0];
  }
  diagnose() {
    const result = { ...this.status, anchorId: this.getConfig().anchorId || '未知', input: '', send: '', healthy: this.healthy() };
    try { const input = this.findInput(); result.input = selectorFor(input); try { result.send = selectorFor(this.findSend(input)); } catch (e) { result.send = e.message; } }
    catch (e) { result.input = e.message; }
    return result;
  }
  async send(text, isCurrent) {
    if (!isCurrent()) return { submitted: false, reason: '场控已暂停' };
    if (!this.healthy()) throw new Error('直播数据连接不健康，已停止发送');
    const input = this.findInput(); this.findSend(input);
    const readText = () => ('value' in input ? input.value : input.textContent).replace(/[\u200b\ufeff]/g, '').trim();
    const existing = readText();
    if (existing.trim()) throw new Error('公屏输入框已有手动草稿，已暂停保护草稿');
    if (input.disabled || input.readOnly || input.getAttribute('aria-disabled') === 'true') throw new Error('输入框不可用，请检查登录或禁言状态');
    if (!isCurrent()) return { submitted: false, reason: '场控已暂停' };
    input.focus();
    if ('value' in input) {
      const proto = input.tagName === 'TEXTAREA' ? this.page.HTMLTextAreaElement.prototype : this.page.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, text);
      input.dispatchEvent(new this.page.Event('input', { bubbles: true }));
      input.dispatchEvent(new this.page.Event('change', { bubbles: true }));
    } else {
      // 当前抖音使用有内部文档状态的富文本编辑器，不能只改 textContent。
      // 走编辑器的纯文本粘贴路径，保留原有输入校验、字数限制和 onChange。
      let handled = false;
      if (this.page.DataTransfer && this.page.ClipboardEvent) {
        const clipboard = new this.page.DataTransfer(); clipboard.setData('text/plain', text);
        const paste = new this.page.ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true });
        input.dispatchEvent(paste); handled = paste.defaultPrevented;
      }
      if (!handled && !this.page.document.execCommand?.('insertText', false, text)) throw new Error('富文本编辑器未接受输入，请用人工方式发送并检查页面适配');
    }
    // 等待 React 更新按钮状态；取消时只清理本脚本的文本。
    await new Promise(resolve => setTimeout(resolve, 120));
    const currentValue = readText();
    if (currentValue !== text) throw new Error('输入内容与候选不一致（可能被截断），已暂停供人工检查');
    if (!isCurrent() || !isVisible(input)) {
      if (currentValue === text) {
        if ('value' in input) input.value = '';
        else {
          const selection = this.page.getSelection(), range = this.page.document.createRange();
          range.selectNodeContents(input); selection.removeAllRanges(); selection.addRange(range);
          this.page.document.execCommand?.('delete', false);
        }
        input.dispatchEvent(new this.page.Event('input', { bubbles: true }));
      }
      return { submitted: false, reason: '已取消发送或输入框被手动修改' };
    }
    // 富文本变化会把禁用的图标替换成另一个节点，需再次定位。
    const button = this.findSend(input);
    if (!isVisible(button) || button.disabled || button.classList.contains('disable') || button.getAttribute('aria-disabled') === 'true') throw new Error('发送按钮不可用，候选保留在输入框供人工处理');
    button.click(); return { submitted: true };
  }
  observeDOM() {
    // 只处理变动的弹幕行；视频、面板等无关变化不扫描整个页面。
    const pending = new Set(); let active = false, timer = null, lastError = 0;
    this.status.domRows = 0; this.status.domBatches = 0;
    const selector = () => this.getConfig().adapter.chatSelector || '[data-e2e="chat-message"], [class*="webcast-chatroom___item"]';
    const read = (row, emit) => {
      if (!row.isConnected) return;
      this.status.domRows++;
      const c = this.getConfig().adapter;
      const nameEl = row.querySelector(c.nicknameSelector || '[data-e2e="chat-nickname"], [class*="nickname"]');
      const contentEl = row.querySelector(c.contentSelector || '[data-e2e="chat-content"], [class*="content"]');
      if (!nameEl || !contentEl) return;
      const name = nameEl.textContent.trim().replace(/[:：]$/, ''), text = contentEl.textContent.trim();
      const signature = `${name}\n${text}`;
      if (this.domSeen.get(row) === signature) return;
      this.domSeen.set(row, signature);
      if (emit && name && text) this.onEvent({ type: 'chat', user: { name, id: '', fanClubs: [], wealthLevel: null }, text, source: 'dom' });
    };
    const baseline = () => { for (const row of [...document.querySelectorAll(selector())].slice(-200)) read(row, false); };
    const report = error => { if (Date.now() - lastError > 10000) { lastError = Date.now(); this.onLog('error', `页面选择器错误：${error.message}`); } };
    const flush = () => {
      timer = null; this.status.domBatches++;
      try {
        const emit = this.shouldReadChat() && Date.now() - this.lastSocketChat > 15000;
        for (const row of pending) read(row, emit);
      } catch (e) { report(e); }
      pending.clear();
    };
    this.observer = new MutationObserver(records => {
      try {
        const c = this.getConfig().adapter;
        if (c.endSelector && records.length) { const end = document.querySelector(c.endSelector); if (isVisible(end)) this.onEvent({ type: 'end', source: 'dom' }); }
        const enabled = this.shouldReadChat() && Date.now() - this.lastSocketChat > 15000;
        if (!enabled) { active = false; pending.clear(); return; }
        if (!active) { baseline(); active = true; return; }
        const sel = selector();
        const collect = (node, descendants = false) => {
          const el = node.nodeType === 1 ? node : node.parentElement;
          if (!el || el.id === 'douyin-live-assistant') return;
          const row = el.closest(sel); if (row) pending.add(row);
          else if (descendants && node.nodeType === 1) for (const item of el.querySelectorAll(sel)) { pending.add(item); if (pending.size >= 200) break; }
        };
        for (const record of records) {
          collect(record.target);
          if (record.type === 'childList') for (const node of record.addedNodes) { collect(node,true); if (pending.size >= 200) break; }
          if (pending.size >= 200) break;
        }
        if (pending.size && timer === null) timer = setTimeout(flush, 300);
      } catch (e) { report(e); }
    });
    baseline(); active = this.shouldReadChat() && Date.now() - this.lastSocketChat > 15000;
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    this.stopDOM = () => { this.observer.disconnect(); clearTimeout(timer); pending.clear(); };
  }

}

export class RoomLock {
  constructor({ room, get, set, now = Date.now }) {
    this.room = room; this.get = get; this.set = set; this.now = now; this.owner = crypto.randomUUID(); this.key = `live-assistant:lease:${room}`; this.held = false;
  }
  async acquire() {
    if (navigator.locks) {
      return new Promise(resolve => {
        navigator.locks.request(`douyin-live-assistant:${this.room}`, { ifAvailable: true }, async lock => {
          if (!lock) { resolve(false); return; }
          this.held = true; resolve(true);
          await new Promise(release => { this.releaseNative = release; }); this.held = false;
        }).catch(() => resolve(false));
      });
    }
    const existing = this.get(this.key, null);
    if (existing && existing.owner !== this.owner && existing.until > this.now()) return false;
    this.set(this.key, { owner: this.owner, until: this.now() + 10000 });
    await new Promise(resolve => setTimeout(resolve, 180));
    this.held = this.get(this.key, null)?.owner === this.owner; return this.held;
  }
  renew() {
    if (this.releaseNative) return this.held;
    if (!this.held || this.get(this.key, null)?.owner !== this.owner) { this.held = false; return false; }
    this.set(this.key, { owner: this.owner, until: this.now() + 10000 }); return true;
  }
  release() {
    if (this.releaseNative) { this.releaseNative(); this.releaseNative = null; }
    else if (this.get(this.key, null)?.owner === this.owner) this.set(this.key, null);
    this.held = false;
  }
}
