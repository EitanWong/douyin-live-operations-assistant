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
            if (location.pathname !== adapter.roomPath) return;
            const receivedAt = Date.now();
            adapter.pending++; adapter.status.pendingFrames = adapter.pending;
            adapter.chain = adapter.chain.then(async () => {
              try {
                const events = await decodeFrame(e.data, error => adapter.reportError(error));
                adapter.status.frames++; adapter.status.lastFrame = Date.now();
                adapter.status.events += events.length;
                let processed = 0;
                for (const event of events) {
                  if (event.type === 'chat') adapter.lastSocketChat = Date.now();
                  try { adapter.onEvent({ ...event, receivedAt }); }
                  catch (error) { adapter.reportError(error); }
                  if (++processed % 200 === 0) await new Promise(resolve => setTimeout(resolve, 0));
                }
                // 高峰时保留帧并按顺序处理，每批让出主线程，避免静默丢弃第 101 帧。
                if (adapter.pending > 1 && adapter.status.frames % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
              } catch (error) {
                adapter.reportError(error);
              } finally { adapter.pending--; adapter.status.pendingFrames = adapter.pending; adapter.emitStatus(); }
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
  reportError(error) {
    this.status.errors++;
    if (this.status.errors === 1 || this.status.errors % 100 === 0) this.onLog('error', `直播消息解析失败：${error.message}；请查看诊断`);
  }
  emitStatus() { this.onStatus({ ...this.status }); }
  // 无弹幕不等于断线；连接的 open/close 才决定传输是否可用。
  healthy() { return Boolean(this.status.connected); }
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
    if (list.length !== 1) throw Object.assign(new Error('无法唯一确认“发送”按钮，请在诊断页定位公屏发送按钮'), { retryable: list.length === 0 });
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
    if (!this.healthy()) return { submitted: false, retryable: true, reason: '直播数据重连中，本条未发送' };
    const temporary = reason => Object.assign(new Error(reason), { retryable: true });
    let input;
    try { input = this.findInput(); this.findSend(input); }
    catch (error) {
      // 尚未写入或点击，页面重绘导致的控件缺失可以安全重试；歧义配置仍需检查。
      if (!input && /未找到/.test(error.message)) throw temporary(error.message);
      if (input && !input.isConnected) throw temporary('直播输入框正在重新加载');
      throw error;
    }
    const readText = () => ('value' in input ? input.value : input.textContent).replace(/[\u200b\ufeff]/g, '').trim();
    const existing = readText();
    if (existing.trim()) throw new Error('公屏输入框已有手动草稿，已暂停保护草稿');
    if (input.disabled || input.readOnly || input.getAttribute('aria-disabled') === 'true') throw temporary('输入框暂不可用，等待网页恢复');
    if (!isCurrent()) return { submitted: false, reason: '场控已暂停' };
    const doc = input.ownerDocument;
    const clearOwnText = () => {
      if (readText() !== text) return false;
      if ('value' in input) {
        const proto = input.tagName === 'TEXTAREA' ? this.page.HTMLTextAreaElement.prototype : this.page.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, '');
      } else {
        const selection = this.page.getSelection(), range = doc.createRange();
        range.selectNodeContents(input); selection.removeAllRanges(); selection.addRange(range);
        doc.execCommand?.('delete', false);
      }
      input.dispatchEvent(new this.page.Event('input', { bubbles: true }));
      return !readText();
    };
    let previousFocus = doc.activeElement;
    while (previousFocus?.shadowRoot?.activeElement) previousFocus = previousFocus.shadowRoot.activeElement;
    try {
      input.focus({ preventScroll: true });
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
      if (!isCurrent() || !this.healthy() || !isVisible(input)) {
        const cleared = clearOwnText();
        if (isCurrent() && !cleared) throw new Error('未能清理待发送文本，已暂停供人工检查');
        return { submitted: false, retryable: isCurrent(), reason: '连接或输入框暂不可用，本条未点击发送' };
      }
      // 富文本变化会把禁用的图标替换成另一个节点，需再次定位。
      let button;
      try { button = this.findSend(input); }
      catch (error) {
        if (!clearOwnText()) throw new Error('发送控件已变化且待发送文本未能清理，已暂停供人工检查');
        throw error;
      }
      if (!isVisible(button) || button.disabled || button.hasAttribute('disabled') || button.classList.contains('disable') || button.getAttribute('aria-disabled') === 'true') {
        if (clearOwnText()) throw temporary('发送按钮暂不可用，等待网页恢复');
        throw new Error('发送按钮不可用且待发送文本未能清理，已暂停供人工检查');
      }
      // 抖音的发送控件是 SVGElement，没有 HTMLElement.click()。
      // 对真实控件派发一次冒泡点击，让页面自己的 React 处理发送。
      button.dispatchEvent(new this.page.MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: this.page }));
      const deadline = Date.now() + 1800;
      while (Date.now() < deadline) {
        if (!readText()) return { submitted: true };
        if (readText() !== text || !isCurrent()) return { submitted: false, reason: '发送后输入框已变更或场控已暂停' };
        await new Promise(resolve => setTimeout(resolve, 60));
      }
      throw new Error('点击发送后页面未清空输入框，未确认提交；已暂停，请检查网页提示');
    } finally {
      // 自动化结束后还原面板/网页输入焦点，用户中途主动切换焦点时不争抢。
      if (doc.activeElement === input && previousFocus !== input) {
        if (previousFocus?.isConnected && previousFocus !== doc.body) previousFocus.focus({ preventScroll: true });
        if (doc.activeElement === input) input.blur();
      }
    }
  }
  observeDOM() {
    // 变动时拍下弹幕快照；虚拟列表随即移除/复用节点也不丢掉已读消息。
    const pending = []; let timer = null, lastError = 0, domNeedsBaseline = false;
    this.status.domRows = 0; this.status.domBatches = 0;
    const selector = () => this.getConfig().adapter.chatSelector || '[data-e2e="chat-message"], [class*="webcast-chatroom___item"]';
    const read = (row, emit, receivedAt) => {
      this.status.domRows++;
      const c = this.getConfig().adapter;
      const nameEl = row.querySelector(c.nicknameSelector || '[data-e2e="chat-nickname"], [class*="nickname"]');
      const contentEl = row.querySelector(c.contentSelector || '[data-e2e="chat-content"], [class*="content"]');
      if (!nameEl || !contentEl) return;
      const name = nameEl.textContent.trim().replace(/[:：]$/, ''), text = contentEl.textContent.trim();
      const signature = `${name}\n${text}`;
      if (this.domSeen.get(row) === signature) return;
      this.domSeen.set(row, signature);
      if (emit && name && text) pending.push({ type:'chat', user:{name,id:'',fanClubs:[],wealthLevel:null}, text, source:'dom', receivedAt });
    };
    const report = error => { if (Date.now() - lastError > 10000) { lastError = Date.now(); this.onLog('error', `页面弹幕采集异常：${error.message}`); } };
    const flush = () => {
      timer = null; this.status.domBatches++;
      const enabled = this.shouldReadChat();
      // 每批最多处理 200 条，余下继续处理，不能把超过 200 条的消息截掉。
      for (const event of pending.splice(0, 200)) {
        if (!enabled) continue;
        try { this.onEvent(event); } catch (error) { report(error); }
      }
      if (pending.length) timer = setTimeout(flush, 0);
    };
    this.observer = new MutationObserver(records => {
      try {
        const c = this.getConfig().adapter;
        if (c.endSelector && records.length) { const end = document.querySelector(c.endSelector); if (isVisible(end)) this.onEvent({ type:'end', source:'dom' }); }
        const socketActive = Date.now() - this.lastSocketChat <= 15000;
        const emit = this.shouldReadChat() && !socketActive;
        const sel = selector(), rows = new Set(), receivedAt = Date.now();
        const collect = (node, descendants = false) => {
          const el = node.nodeType === 1 ? node : node.parentElement;
          if (!el || el.id === 'douyin-live-assistant') return;
          const row = el.closest(sel); if (row) rows.add(row);
          else if (descendants && node.nodeType === 1) for (const item of el.querySelectorAll(sel)) rows.add(item);
        };
        for (const record of records) {
          collect(record.target);
          if (record.type === 'childList') for (const node of record.addedNodes) collect(node, true);
        }
        // socket 活跃时仍标记已见；切回 DOM 备用采集时先做一次基线，避免把
        // socket 已经处理过的虚拟列表历史行重新发送。基线只在切换瞬间扫描。
        if (socketActive) domNeedsBaseline = true;
        if (emit && domNeedsBaseline) {
          for (const row of [...document.querySelectorAll(sel)].slice(-200)) {
            try { read(row, false, receivedAt); } catch (error) { report(error); }
          }
          domNeedsBaseline = false;
          return;
        }
        for (const row of rows) { try { read(row, emit, receivedAt); } catch (error) { report(error); } }
        if (pending.length && timer === null) timer = setTimeout(flush, 50);
      } catch (error) { report(error); }
    });
    for (const row of [...document.querySelectorAll(selector())].slice(-200)) read(row, false, Date.now());
    this.observer.observe(document.body, { childList:true, subtree:true, characterData:true });
    this.stopDOM = () => { this.observer.disconnect(); clearTimeout(timer); pending.length = 0; };
  }
}

export class RoomLock {
  constructor({ room, locks = globalThis.navigator?.locks }) {
    this.room = room; this.locks = locks; this.held = false; this.generation = 0;
    this.drained = Promise.resolve(); this.pending = null;
  }
  acquire() {
    if (this.held) return Promise.resolve(true);
    if (this.pending) return this.pending;
    if (!this.locks) return Promise.reject(new Error('浏览器不支持运行锁，请使用新版 Chrome 或 Edge，并在 HTTPS 直播页运行'));
    const generation = ++this.generation, previous = this.drained;
    const attempt = new Promise((resolve, reject) => {
      // 等上一次 callback 完全退出，再申请，避免刚释放的本页被误判为占用者。
      this.drained = (async () => {
        await previous;
        if (generation !== this.generation) { resolve(false); return; }
        await this.locks.request(`douyin-live-assistant:${this.room}`, { ifAvailable: true }, async lock => {
          if (!lock || generation !== this.generation) { resolve(false); return; }
          const released = new Promise(release => { this.releaseNative = release; });
          this.held = true; resolve(true);
          await released;
          if (generation === this.generation) { this.held = false; this.releaseNative = null; }
        });
      })().catch(error => { reject(error); });
    });
    this.pending = attempt;
    const clear = () => { if (this.pending === attempt) this.pending = null; };
    void attempt.then(clear, clear);
    return attempt;
  }
  renew() { return this.held; }
  release() {
    ++this.generation; this.held = false; this.pending = null;
    this.releaseNative?.(); this.releaseNative = null;
  }
}
