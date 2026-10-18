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

const contributionScore = value => {
  const text = String(value || '').replace(/[\s\u00a0,，]/g, '').trim();
  const match = text.match(/^(\d+(?:\.\d+)?)(万|亿)?(?:分|票)?$/);
  if (!match) return null;
  const multiplier = match[2] === '亿' ? 1e8 : match[2] === '万' ? 1e4 : 1;
  const score = Number(match[1]) * multiplier;
  return Number.isFinite(score) && score <= 1e9 ? score : null;
};
const contributionCell = value => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const score = contributionScore(text);
  if (score !== null) return { name:'', score };
  const match = text.match(/^(.+?)[\s·:：]+([\d,，]+(?:\.\d+)?(?:万|亿)?)(?:分|票)?$/);
  if (!match) return null;
  const name = match[1].trim();
  const combinedScore = contributionScore(match[2]);
  return name && combinedScore !== null ? { name, score:combinedScore } : null;
};
const excludedContributionName = value => /^(?:在线观众|贡献用户|高等级用户|全部|粉丝牌|粉丝团|(?:一千|千|1000)票用户|\d+|1000\s*(?:贡献|票)用户(?:\(\d+\))?)$/.test(String(value || '').trim());

export function readAudienceContributions(doc = document) {
  const chatroom = doc.querySelector('#chatroom');
  if (!chatroom) return [];
  const threshold = [...chatroom.querySelectorAll('p')].find(element => /1000\s*(?:贡献|票)用户/.test(element.textContent || ''));
  if (!threshold) return [];
  const suppliedList = doc.querySelector('#chatroom > div > div.LyAdeVIF.sBRqUw32 > div:nth-child(3) > div > div > div > div:nth-child(1)');
  const thousandVoteList = doc.querySelector('#chatroom > div > div.LyAdeVIF.sBRqUw32 > div:nth-child(3) > div > div > div:nth-child(2) > div.Ypyh0f2S');
  // The supplied selectors may point at one row, so include their immediate
  // sibling container. If they drift, inspect only branches beside the label.
  const roots = new Set();
  for (const node of [suppliedList, thousandVoteList].filter(Boolean)) {
    roots.add(node); if (node.parentElement) roots.add(node.parentElement);
  }
  if (!roots.size) {
    let node = threshold;
    for (let depth = 0; node && node !== chatroom && depth < 6; depth++, node = node.parentElement) {
      for (const sibling of node.parentElement?.children || []) if (sibling !== node) roots.add(sibling);
    }
  }
  const candidates = new Set([...roots].flatMap(root => [root, ...root.querySelectorAll('*')]));
  const rows = new Map();
  for (const row of candidates) {
    if (!row.children?.length) continue;
    const leaves = [...row.querySelectorAll('*')].filter(element => element.children.length === 0).map(element => element.textContent.trim()).filter(Boolean);
    const combined = leaves.map((text,index) => ({...contributionCell(text), index})).filter(cell => cell?.name && cell.name.length <= 60 && !excludedContributionName(cell.name));
    const numeric = leaves.map((text,index) => ({score:contributionScore(text),index})).filter(item => item.score !== null);
    const names = leaves.map((text,index) => ({text,index})).filter(({text}) => contributionScore(text) === null && !contributionCell(text)?.name && !excludedContributionName(text) && text.length <= 60);
    if (combined.length + names.length !== 1) continue;
    const combinedCell = combined[0];
    const nameCell = names[0];
    const score = combinedCell?.score ?? numeric.at(-1)?.score;
    // A lone leading number is usually the row rank, not the contribution score.
    const hasScore = score !== undefined && !(numeric.length === 1 && numeric[0].index === 0 && nameCell);
    const rowName = combinedCell?.name || nameCell?.text;
    const scoreIsFloor = !hasScore && Boolean(thousandVoteList && (row === thousandVoteList || thousandVoteList.contains(row)));
    if (!rowName || (!hasScore && !scoreIsFloor)) continue;
    const rowScore = hasScore ? score : 1000;
    const orderNode = leaves.length ? [...row.querySelectorAll('*')].filter(element => element.children.length === 0)[combinedCell?.index ?? nameCell?.index] : row;
    let userId = '';
    for (let node = row; node && node !== chatroom.parentElement && !userId; node = node.parentElement) {
      for (const attr of ['data-user-id', 'data-uid', 'data-id']) {
        const id = node.getAttribute?.(attr);
        if (id && /^\d{4,30}$/.test(id)) { userId = id; break; }
      }
      const href = node.matches?.('a[href]') ? node.getAttribute('href') : node.querySelector?.('a[href]')?.getAttribute('href');
      const match = href?.match(/\/user\/(\d{4,30})/);
      if (match) userId = match[1];
    }
    const rowKey = userId ? `uid:${userId}` : `name:${rowName}`;
    const previous = rows.get(rowKey);
    if (!previous) rows.set(rowKey, { name:rowName, score:rowScore, scoreIsFloor, userId, orderNode });
    else {
      if (rowScore > previous.score || (rowScore === previous.score && previous.scoreIsFloor && !scoreIsFloor)) {
        previous.score = rowScore; previous.scoreIsFloor = scoreIsFloor;
      }
      if (!previous.userId && userId) previous.userId = userId;
    }
  }
  return [...rows.values()].sort((a,b) => a.orderNode?.compareDocumentPosition(b.orderNode) & 4 ? -1 : 1).map(({orderNode,...row})=>row);
}

export class DouyinAdapter {
  constructor({ page, getConfig, onEvent, onLog, onStatus, onEcho = () => false, shouldReadChat = () => true }) {
    this.page = page; this.getConfig = getConfig; this.shouldReadChat = shouldReadChat; this.onEvent = onEvent; this.onLog = onLog; this.onStatus = onStatus;
    this.onEcho = onEcho;
    this.status = { hook: false, sockets: 0, frames: 0, events: 0, errors: 0, lastFrame: 0, connected: false };
    this.pending = 0; this.pendingBytes = 0; this.chain = Promise.resolve(); this.roomPath = location.pathname;
    this.activeSockets = new Set(); this.domSeen = new WeakMap(); this.domActive = false; this.lastSocketChat = 0;
    this.ownedDraft = null;
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
            if (adapter.pending >= 256 || adapter.pendingBytes + (e.data?.byteLength || e.data?.size || 0) > 16*1024*1024) {
              adapter.status.frameGaps = (adapter.status.frameGaps || 0)+1; adapter.emitStatus(); return;
            }
            const receivedAt = Date.now();
            const frameBytes = e.data?.byteLength || e.data?.size || 0;
            adapter.pendingBytes = (adapter.pendingBytes || 0)+frameBytes;
            adapter.pending++; adapter.status.pendingFrames = adapter.pending;
            const previous = adapter.chain;
            adapter.chain = (async () => {
              try { await previous; } catch (error) { adapter.reportError(error); }
              try {
                const events = await decodeFrame(e.data, error => adapter.reportError(error));
                adapter.status.frames++; adapter.status.lastFrame = Date.now();
                adapter.status.events += events.length;
                let processed = 0;
                for (const event of events) {
                  if (event.type === 'gift') {
                    adapter.status.giftEvents = (adapter.status.giftEvents || 0) + 1;
                    adapter.status.lastGift = {
                      giftName:event.giftName || '礼物', giftId:event.giftId || '',
                      count:Number(event.count) || 1, unitValue:Number.isFinite(event.unitValue) ? event.unitValue : null,
                      eventAt:Number.isFinite(event.at) && event.at > 0 ? event.at : null,
                      receivedAt, timestampSkewMs:Number.isFinite(event.at) && event.at > 0 ? receivedAt-event.at : null
                    };
                  }
                  if (event.type === 'chat') adapter.lastSocketChat = Date.now();
                  try { await adapter.onEvent({ ...event, receivedAt }); }
                  catch (error) { adapter.reportError(error); }
                  if (++processed % 200 === 0) await new Promise(resolve => setTimeout(resolve, 0));
                }
                // 高峰时保留帧并按顺序处理，每批让出主线程，避免静默丢弃第 101 帧。
                if (adapter.pending > 1 && adapter.status.frames % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
              } catch (error) {
                adapter.reportError(error);
              } finally { adapter.pending--; adapter.pendingBytes -= frameBytes; adapter.status.pendingFrames = adapter.pending; adapter.emitStatus(); }
            })();
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
  readAudienceContributions() { return readAudienceContributions(this.page.document || document); }
  findInput() {
    const configured = this.getConfig().adapter.inputSelector;
    if (configured) {
      let list = [];
      try { list = [...document.querySelectorAll(configured)].filter(isVisible); } catch { throw new Error('输入框选择器无效，请在诊断页重新定位'); }
      const input = list.find(e => this.isInputCandidate(e));
      // 抖音会在输入后替换编辑器节点，旧的手动选择器可能短暂失效；
      // 先尝试配置，再回退到当前页面的候选评分，避免一次重绘中断场控。
      if (input) return input;
    }
    const selector = '#chatroom [contenteditable], .webcast-chatroom [contenteditable], [contenteditable], [role="textbox"], textarea, input[type="text"], input:not([type])';
    const list = [...document.querySelectorAll(selector)].filter(isVisible).filter(e => this.isInputCandidate(e));
    if (!list.length) throw new Error('未找到公屏输入框，请登录并在诊断页手动定位');
    const ranked = list.map(element => ({ element, score: this.inputScore(element) })).sort((a, b) => b.score - a.score);
    if (ranked.length > 1 && ranked[0].score === ranked[1].score && ranked[0].score < 5) throw new Error('发现多个输入框，请在诊断页手动定位公屏输入框');
    return ranked[0].element;
  }
  isInputCandidate(element) {
    if (!element || element.id === 'douyin-live-assistant' || element.closest?.('#douyin-live-assistant')) return false;
    const tag = element.tagName, role = (element.getAttribute('role') || '').toLowerCase(), editable = element.getAttribute('contenteditable');
    const native = (tag === 'INPUT' && ['text', 'search', ''].includes((element.type || '').toLowerCase())) || tag === 'TEXTAREA';
    return native || element.isContentEditable || (editable !== null && editable !== 'false') || role === 'textbox';
  }
  inputScore(element) {
    const attrs = [element.getAttribute('placeholder'), element.getAttribute('data-placeholder'), element.getAttribute('aria-label'), element.getAttribute('aria-placeholder'), element.className, element.id].filter(Boolean).join(' ').toLowerCase();
    const parentAttrs = [...(element.parentElement ? [element.parentElement, element.parentElement.parentElement, element.parentElement.parentElement?.parentElement] : [])].map(node => `${node?.id || ''} ${node?.className || ''}`).join(' ').toLowerCase();
    let score = 0;
    if (/(互动|聊天|弹幕|说点|评论|发言|message|comment|chat)/.test(attrs)) score += 8;
    if (/(chatroom|chat-room|comment|message|互动|弹幕)/.test(`${attrs} ${parentAttrs}`)) score += 5;
    if (element.getAttribute('role') === 'textbox' || element.isContentEditable) score += 2;
    if (element.disabled || element.readOnly || element.getAttribute('aria-disabled') === 'true') score -= 10;
    return score;
  }
  findSend(input) {
    const configured = this.getConfig().adapter.sendSelector;
    if (configured) {
      let list = [];
      try { list = [...document.querySelectorAll(configured)].filter(isVisible); } catch { throw new Error('发送按钮选择器无效，请在诊断页重新定位'); }
      if (list.length === 1) return list[0];
      // 发送图标也会随编辑器状态替换；旧选择器不再唯一时交给附近控件评分。
    }
    const area = this.composerArea(input);
    const selector = 'button, [role="button"], [class*="send"], [data-e2e*="send"], [aria-label*="发送"], [title*="发送"], svg, img';
    const list = [...area.querySelectorAll(selector)].filter(isVisible).filter(element => element !== input);
    const ranked = list.map(element => ({ element, score: this.sendScore(element, input, area) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
    if (!ranked.length) throw Object.assign(new Error('无法找到公屏发送按钮，请在诊断页定位公屏发送按钮'), { retryable: true });
    const top = ranked[0];
    if (ranked.length > 1 && top.score === ranked[1].score) throw Object.assign(new Error('无法唯一确认“发送”按钮，请在诊断页定位公屏发送按钮'), { retryable: false });
    // 图标节点本身可能没有 click 方法，但事件会冒泡到抖音真正的 React 控件。
    return top.element;
  }
  composerArea(input) {
    let current = input.parentElement;
    for (let depth = 0; current && depth < 7; depth++, current = current.parentElement) {
      const text = `${current.id || ''} ${current.className || ''}`.toLowerCase();
      if (/(chat|comment|message|input|editor|互动|弹幕|评论)/.test(text)) return current;
    }
    return input.parentElement?.parentElement || input.parentElement || document;
  }
  sendScore(element, input, area) {
    const attrs = [element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('data-e2e'), element.className, element.id, element.textContent].filter(Boolean).join(' ').toLowerCase();
    const areaText = `${area.id || ''} ${area.className || ''}`.toLowerCase();
    let score = 0;
    if (/(发送|send|submit|发布)/.test(attrs)) score += 12;
    if (/(send|发送)/.test(attrs)) score += 4;
    if (element.closest('button,[role="button"], [class*="send"], [data-e2e*="send"]')) score += 3;
    if (/(chat|comment|message|互动|弹幕|评论)/.test(areaText)) score += 2;
    if (element === input.nextElementSibling || element.parentElement === input.parentElement) score += 4;
    if (element.closest('#douyin-live-assistant')) score = -100;
    return score;
  }
  diagnose() {
    const result = { ...this.status, anchorId: this.getConfig().anchorId || '未知', input: '', send: '', healthy: this.healthy() };
    try { const input = this.findInput(); result.input = selectorFor(input); try { result.send = selectorFor(this.findSend(input)); } catch (e) { result.send = e.message; } }
    catch (e) { result.input = e.message; }
    return result;
  }
  findChatModeToggle(input) {
    let current = input?.parentElement;
    for (let depth = 0; current && depth < 5; depth++, current = current.parentElement) {
      if (current.id === 'douyin-live-assistant' || current.closest?.('#douyin-live-assistant')) continue;
      const toggle = [...current.querySelectorAll('input[type="checkbox"][role="switch"], [role="switch"]')]
        .find(element => isVisible(element) && !element.closest?.('#douyin-live-assistant'));
      if (toggle) return toggle;
    }
    return null;
  }
  chatMode(toggle) {
    if (!toggle) return false;
    return toggle.checked === true || toggle.getAttribute('aria-checked') === 'true';
  }
  async setChatMode(input, channel) {
    const desired = channel === 'admin', toggle = this.findChatModeToggle(input), current = this.chatMode(toggle);
    if (!toggle || current === desired) return { toggle, previous: current, changed: false, used: desired && Boolean(toggle) ? 'admin' : 'chat', fallback: desired && !toggle ? '管理员弹幕开关未找到' : '' };
    if (toggle.disabled || toggle.getAttribute('aria-disabled') === 'true') return { toggle, previous: current, changed: false, used: 'chat', fallback: desired ? '管理员弹幕开关不可用' : '' };
    if (typeof toggle.click === 'function') toggle.click();
    else toggle.dispatchEvent(new this.page.MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: this.page }));
    await new Promise(resolve => setTimeout(resolve, 80));
    if (this.chatMode(toggle) !== desired) return { toggle, previous: current, changed: false, used: 'chat', fallback: desired ? '管理员弹幕开关未响应' : '' };
    return { toggle, previous: current, changed: true, used: desired ? 'admin' : 'chat', fallback: '' };
  }
  restoreChatMode(mode) {
    if (!mode?.changed || !mode.toggle?.isConnected) return;
    // 只恢复本次发送切换出的状态；用户若在发送期间手动改过开关，不再争抢控制权。
    if (this.chatMode(mode.toggle) === (mode.previous ? false : true)) {
      if (typeof mode.toggle.click === 'function') mode.toggle.click();
      else mode.toggle.dispatchEvent(new this.page.MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: this.page }));
    }
  }
  async send(text, isCurrent, { beforeClick = async()=>{}, channel = 'chat' } = {}) {
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
    if (existing.trim()) {
      const own = this.ownedDraft;
      if (own && own.text === existing && Date.now() - own.at < 120000) {
        const proto = input.tagName === 'TEXTAREA' ? this.page.HTMLTextAreaElement.prototype : this.page.HTMLInputElement.prototype;
        if ('value' in input) Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, '');
        else { input.textContent = ''; }
        input.dispatchEvent(new this.page.Event('input', { bubbles: true }));
        this.ownedDraft = null;
      } else throw temporary('公屏输入框已有手动草稿，等待手动内容发送后继续');
    }
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
      this.ownedDraft = null;
      return !readText();
    };
    let previousFocus = doc.activeElement;
    while (previousFocus?.shadowRoot?.activeElement) previousFocus = previousFocus.shadowRoot.activeElement;
    let clicked = false;
    const failures = () => [...document.querySelectorAll('[role="alert"], [data-e2e="chat-error"], .webcast-chatroom___error')].filter(isVisible).map(el=>el.textContent.trim()).filter(value=>/^(发送失败|消息发送失败|发言过于频繁|操作过于频繁|你已被禁言|您已被禁言|暂时无法发言|当前无法发言)/.test(value));
    const previousFailures = new Set(failures());
    let mode;
    try {
      input.focus({ preventScroll: true });
      mode = await this.setChatMode(input, channel);
      const withMode = result => mode.used === 'admin' || mode.fallback ? { ...result, channelUsed: mode.used, ...(mode.fallback ? { modeFallback: mode.fallback } : {}) } : result;
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
      // React may replace the editor while applying the pasted message.
      try { input = this.findInput(); } catch {}
      const currentValue = readText();
      if (currentValue !== text) throw temporary('输入内容与候选不一致（可能被截断），稍后重试');
      this.ownedDraft = { text, at: Date.now() };
      if (!isCurrent() || !this.healthy() || !isVisible(input)) {
        const cleared = clearOwnText();
        if (isCurrent() && !cleared) throw temporary('输入框已变化，等待网页稳定后重试');
        return { submitted: false, retryable: isCurrent(), reason: '连接或输入框暂不可用，本条未点击发送' };
      }
      // 富文本变化会把禁用的图标替换成另一个节点，需再次定位。
      let button;
      try { button = this.findSend(input); }
      catch (error) {
        if (!clearOwnText()) throw temporary('发送控件已变化，等待网页稳定后重试');
        throw error;
      }
      if (!isVisible(button) || button.disabled || button.hasAttribute('disabled') || button.classList.contains('disable') || button.getAttribute('aria-disabled') === 'true') {
        if (clearOwnText()) throw temporary('发送按钮暂不可用，等待网页恢复');
        throw temporary('发送按钮暂不可用，等待网页恢复');
      }
      // 抖音的发送控件是 SVGElement，没有 HTMLElement.click()。
      // 对真实控件派发一次冒泡点击，让页面自己的 React 处理发送。
      await beforeClick();
      if (!isCurrent() || !this.healthy()) {
        clearOwnText(); return {submitted:false,reason:'点击前已暂停或断线'};
      }
      clicked = true;
      button.dispatchEvent(new this.page.MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: this.page }));
      const deadline = Date.now() + 1800;
      while (Date.now() < deadline) {
        const rejected = failures().find(value=>!previousFailures.has(value));
        if (rejected) { clearOwnText(); return {submitted:false,clicked:true,failed:true,reason:rejected.slice(0,200)}; }
        if (!readText()) { this.ownedDraft = null; return withMode({ submitted: true, clicked:true }); }
        if (readText() !== text || !isCurrent()) return withMode({ submitted: false, clicked:true, reason: '发送后输入框已变更或场控已暂停' });
        await new Promise(resolve => setTimeout(resolve, 60));
      }
      clearOwnText();
      return withMode({submitted:false,clicked:true,reason:'点击后暂未观察到提交结果，将自动重试'});
    } catch (error) {
      if (clicked) error.clicked = true;
      if (this.ownedDraft?.text === text) clearOwnText();
      throw error;
    } finally {
      this.restoreChatMode(mode);
      // 自动化结束后还原面板/网页输入焦点，用户中途主动切换焦点时不争抢。
      if (doc.activeElement === input && previousFocus !== input) {
        if (previousFocus?.isConnected && previousFocus !== doc.body) previousFocus.focus({ preventScroll: true });
        if (doc.activeElement === input) input.blur();
      }
    }
  }
  observeDOM() {
    // 变动时拍下弹幕快照；虚拟列表随即移除/复用节点也不丢掉已读消息。
    const pending = []; let timer = null, flushing = false, stopped = false, lastError = 0, domNeedsBaseline = false;
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
    const scheduleFlush = delay => {
      if (stopped || flushing || timer !== null || !pending.length) return;
      timer = setTimeout(() => { void flush().catch(report); }, delay);
    };
    const flush = async () => {
      if (stopped || flushing) return;
      timer = null; flushing = true; this.status.domBatches++;
      try {
        const enabled = this.shouldReadChat();
        // 每批最多处理 200 条，余下继续处理，不能把超过 200 条的消息截掉。
        for (const event of pending.splice(0, 200)) {
          if (stopped) break;
          if (!enabled) continue;
          try { await Promise.resolve(this.onEvent(event)); } catch (error) { report(error); }
        }
      } finally {
        flushing = false;
        if (!stopped) scheduleFlush(0);
      }
    };
    this.observer = new MutationObserver(records => {
      try {
        const c = this.getConfig().adapter;
        if (c.endSelector && records.length) {
          const end = document.querySelector(c.endSelector);
          if (isVisible(end)) void Promise.resolve(this.onEvent({ type:'end', source:'dom' })).catch(report);
        }
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
        scheduleFlush(50);
      } catch (error) { report(error); }
    });
    for (const row of [...document.querySelectorAll(selector())].slice(-200)) read(row, false, Date.now());
    this.observer.observe(document.body, { childList:true, subtree:true, characterData:true });
    this.stopDOM = () => {
      stopped = true;
      this.observer.disconnect();
      clearTimeout(timer); timer = null;
      pending.length = 0;
    };
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
    void (async () => {
      try { await attempt; } catch {}
      finally { clear(); }
    })();
    return attempt;
  }
  renew() { return this.held; }
  release() {
    ++this.generation; this.held = false; this.pending = null;
    this.releaseNative?.(); this.releaseNative = null;
  }
}
