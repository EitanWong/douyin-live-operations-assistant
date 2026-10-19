import { decodeFrame } from './protocol.js';
import { recognizeMilestone } from '../core/milestones.js';

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
  constructor({ page, getConfig, onEvent, onLog, onStatus, onPK = null, onEcho = () => false, shouldReadChat = () => true, shouldReadMilestones = shouldReadChat }) {
    this.page = page; this.getConfig = getConfig; this.shouldReadChat = shouldReadChat; this.shouldReadMilestones = shouldReadMilestones; this.onEvent = onEvent; this.onLog = onLog; this.onStatus = onStatus;
    this.onEcho = onEcho; this.onPK = onPK;
    this.status = { hook: false, sockets: 0, frames: 0, events: 0, errors: 0, lastFrame: 0, connected: false };
    this.pending = 0; this.pendingBytes = 0; this.decodedCacheBytes = 0; this.chain = Promise.resolve(); this.decodeChain = Promise.resolve(); this.roomPath = location.pathname;
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
            const previousDecode = adapter.decodeChain;
            // 解析按 socket 到达顺序串行；只读 PK 观察不等待前帧的普通事件存储。
            const decoded = adapter.decodeChain = (async () => {
              try { await previousDecode; } catch (error) { adapter.reportError(error); }
              try {
                const events = (await decodeFrame(e.data, error => adapter.reportError(error))).map(event => ({ ...event, receivedAt }));
                adapter.status.frames++; adapter.status.lastFrame = Date.now();
                adapter.status.events += events.length;
                for (const event of events) if (event.type.startsWith('pk-')) {
                  adapter.status.pkEvents = (adapter.status.pkEvents || 0) + 1;
                  adapter.status.lastPK = { type:event.type, receivedAt, decodedAt:Date.now(), method:event.protocolMethod || '',
                    eventAt:event.at > 0 ? event.at : null, timestampSkewMs:event.at > 0 ? receivedAt-event.at : null };
                  if (event.type === 'pk-score' && event.scores?.length) {
                    adapter.status.pkScoreEvents = (adapter.status.pkScoreEvents || 0) + 1;
                    adapter.status.lastPKScore = receivedAt;
                  }
                  if (adapter.onPK) try { await adapter.onPK(event); } catch (error) { adapter.reportError(error); }
                }
                // 只保留有限已解码缓存；超额帧在普通交付时重解码，PK 观察仍及时完成。
                const cacheBytes = JSON.stringify(events).length * 2;
                const cache = adapter.decodedCacheBytes + cacheBytes <= 16 * 1024 * 1024;
                if (cache) adapter.decodedCacheBytes += cacheBytes;
                else adapter.status.uncachedFrames = (adapter.status.uncachedFrames || 0) + 1;
                adapter.status.decodedCacheBytes = adapter.decodedCacheBytes;
                adapter.emitStatus();
                return { events: cache ? events : null, cacheBytes: cache ? cacheBytes : 0 };
              } catch (error) { adapter.reportError(error); return {events:[],cacheBytes:0}; }
            })();
            const previous = adapter.chain;
            adapter.chain = (async () => {
              try { await previous; } catch (error) { adapter.reportError(error); }
              let cacheBytes = 0, result;
              try {
                result = await decoded; cacheBytes = result.cacheBytes;
                // 错误已在快速解码报告；重解码不重复累计同一损坏消息的错误。
                const events = result.events || (await decodeFrame(e.data)).map(event => ({ ...event, receivedAt }));
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
                  try { await adapter.onEvent(event); }
                  catch (error) { adapter.reportError(error); }
                  if (++processed % 200 === 0) await new Promise(resolve => setTimeout(resolve, 0));
                }
                // 高峰时保留帧并按顺序处理，每批让出主线程。
                if (adapter.pending > 1 && adapter.status.frames % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
              } catch (error) { adapter.reportError(error); }
              finally { if (result) result.events = null; adapter.pending--; adapter.pendingBytes -= frameBytes; adapter.decodedCacheBytes -= cacheBytes; adapter.status.decodedCacheBytes = adapter.decodedCacheBytes; adapter.status.pendingFrames = adapter.pending; adapter.emitStatus(); }
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
    const repeatedDraft = (value, candidate) => {
      const normalize = text => String(text || '').replace(/[\u200b\ufeff]/g, '').replace(/\s+/g, '').trim();
      const normalizedValue = normalize(value);
      const normalizedCandidate = normalize(candidate);
      if (!normalizedValue || !normalizedCandidate || normalizedValue === normalizedCandidate || normalizedValue.length > normalizedCandidate.length * 6) return false;
      const count = normalizedValue.length / normalizedCandidate.length;
      if (Number.isInteger(count) && count >= 2 && normalizedValue === normalizedCandidate.repeat(count)) return true;
      // A prior submit may leave one complete reply followed by a partial duplicate.
      const remainder = normalizedValue.slice(normalizedCandidate.length);
      return normalizedValue.startsWith(normalizedCandidate)
        && remainder.length >= Math.min(8, Math.ceil(normalizedCandidate.length * 0.2))
        && normalizedCandidate.startsWith(remainder);
    };
    const existing = readText();
    if (existing && this.ownedDraft?.text !== existing && !repeatedDraft(existing, text)) throw temporary('公屏输入框已有手动草稿，等待手动内容发送后继续');
    if (input.disabled || input.readOnly || input.getAttribute('aria-disabled') === 'true') throw temporary('输入框暂不可用，等待网页恢复');
    if (!isCurrent()) return { submitted: false, reason: '场控已暂停' };
    const doc = input.ownerDocument;
    const clearOwnText = () => {
      // 清理也必须作用于当前编辑器，不能误把已经脱离页面的旧节点清空当作成功。
      try { input = this.findInput(); } catch { return false; }
      if (!input.isConnected || readText() !== text) return false;
      if ('value' in input) {
        const proto = input.tagName === 'TEXTAREA' ? this.page.HTMLTextAreaElement.prototype : this.page.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, '');
      } else {
        if (doc.activeElement !== input && doc.activeElement !== doc.body) return false;
        input.focus({ preventScroll: true });
        const selection = this.page.getSelection(), range = doc.createRange();
        range.selectNodeContents(input); selection.removeAllRanges(); selection.addRange(range);
        doc.execCommand?.('delete', false);
      }
      input.dispatchEvent(new this.page.Event('input', { bubbles: true }));
      const cleared = !readText();
      // 编辑器可能拒绝 delete；保留归属，重试时复用原文，避免永远等待“人工草稿”。
      if (cleared) this.ownedDraft = null;
      return cleared;
    };
    let previousFocus = doc.activeElement;
    while (previousFocus?.shadowRoot?.activeElement) previousFocus = previousFocus.shadowRoot.activeElement;
    let clicked = false;
    const failures = () => [...document.querySelectorAll('[role="alert"], [data-e2e="chat-error"], .webcast-chatroom___error')].filter(isVisible).map(el=>el.textContent.trim()).filter(value=>/^(发送失败|消息发送失败|发言过于频繁|操作过于频繁|你已被禁言|您已被禁言|暂时无法发言|当前无法发言)/.test(value));
    const previousFailures = new Set(failures());
    let mode;
    try {
      input.focus({ preventScroll: true });
      const focusedInput = input;
      mode = await this.setChatMode(input, channel);
      const withMode = result => mode.used === 'admin' || mode.fallback ? { ...result, channelUsed: mode.used, ...(mode.fallback ? { modeFallback: mode.fallback } : {}) } : result;
      // 切换弹幕模式也可能重建输入框；写入前重新确认，保留用户中途输入的草稿。
      input = this.findInput();
      const draft = readText();
      if (draft && draft !== this.ownedDraft?.text && !repeatedDraft(draft, text)) throw temporary('公屏输入框已有手动草稿，等待手动内容发送后继续');
      if (input.disabled || input.readOnly || input.getAttribute('aria-disabled') === 'true') throw temporary('输入框暂不可用，等待网页恢复');
      if (doc.activeElement === focusedInput || (!focusedInput.isConnected && doc.activeElement === doc.body)) input.focus({ preventScroll: true });
      // 上次点击未提交或清理失败时复用原文；改发另一条时通过编辑器选区替换。
      if (draft !== text) {
        if ('value' in input) {
          const proto = input.tagName === 'TEXTAREA' ? this.page.HTMLTextAreaElement.prototype : this.page.HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, text);
          input.dispatchEvent(new this.page.Event('input', { bubbles: true }));
          input.dispatchEvent(new this.page.Event('change', { bubbles: true }));
        } else {
          if (doc.activeElement !== input && doc.activeElement !== doc.body) throw temporary('输入焦点已变更，稍后重试');
          // 当前抖音使用有内部文档状态的富文本编辑器，不能只改 textContent。
          // 走编辑器的纯文本粘贴路径，保留原有输入校验、字数限制和 onChange。
          if (draft) {
            const selection = this.page.getSelection(), range = doc.createRange();
            range.selectNodeContents(input); selection.removeAllRanges(); selection.addRange(range);
          }
          let handled = false;
          if (this.page.DataTransfer && this.page.ClipboardEvent) {
            const clipboard = new this.page.DataTransfer(); clipboard.setData('text/plain', text);
            const paste = new this.page.ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true });
            input.dispatchEvent(paste); handled = paste.defaultPrevented;
          }
          if (!handled && !this.page.document.execCommand?.('insertText', false, text)) throw new Error('富文本编辑器未接受输入，请用人工方式发送并检查页面适配');
        }
      }
      if (readText() === text) this.ownedDraft = { text, at: Date.now() };
      // 等待 React 更新按钮状态；取消时只清理本脚本的文本。
      await new Promise(resolve => setTimeout(resolve, 120));
      // 输入后的状态更新不保证在 120ms 内完成。等待当前控件真正就绪，
      // 避免每次都在按钮启用前清空重填，并在重绘时重新定位。
      const waitForSend = async () => {
        const deadline = Date.now() + 1800;
        while (true) {
          if (!isCurrent() || !this.healthy()) return null;
          let button, unavailable;
          try { input = this.findInput(); }
          catch (error) { unavailable = error; }
          if (!unavailable) {
            const value = readText();
            // 粘贴处理器也可能异步提交文档；空编辑器继续等待，其他内容不冒险发送。
            if (value && value !== text) throw temporary('输入内容已变更或与候选不一致（可能被截断），稍后重试');
            if (value === text) this.ownedDraft = { text, at: Date.now() };
            try { button = this.findSend(input); }
            catch (error) { if (!error.retryable) throw error; unavailable = error; }
            const disabled = element => element.disabled || element.readOnly || element.hasAttribute('disabled') || element.classList.contains('disable') || element.getAttribute('aria-disabled') === 'true';
            if (value === text && button && isVisible(input) && !disabled(input) && isVisible(button) && !disabled(button) && !button.closest('[disabled], [aria-disabled="true"], .disable')) return button;
          }
          if (Date.now() >= deadline) throw unavailable || temporary('发送按钮暂不可用，等待网页恢复');
          await new Promise(resolve => setTimeout(resolve, 60));
        }
      };
      let button = await waitForSend();
      if (!button) { clearOwnText(); return {submitted:false,reason:'点击前已暂停或断线'}; }
      // 抖音的发送控件是 SVGElement，没有 HTMLElement.click()。
      // 对真实控件派发一次冒泡点击，让页面自己的 React 处理发送。
      await beforeClick();
      // 异步钩子期间控件与草稿仍可能变化，点击前再次校验并获取当前节点。
      button = await waitForSend();
      if (!button) {
        clearOwnText(); return {submitted:false,reason:'点击前已暂停或断线'};
      }
      clicked = true;
      button.dispatchEvent(new this.page.MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: this.page }));
      const deadline = Date.now() + 1800;
      while (Date.now() < deadline) {
        const rejected = failures().find(value=>!previousFailures.has(value));
        if (rejected) { clearOwnText(); return {submitted:false,clicked:true,failed:true,reason:rejected.slice(0,200)}; }
        let currentInput = false;
        try { input = this.findInput(); currentInput = input.isConnected; } catch {}
        if (currentInput && !readText()) { this.ownedDraft = null; return withMode({ submitted: true, clicked:true }); }
        if ((currentInput && readText() !== text) || !isCurrent()) return withMode({ submitted: false, clicked:true, reason: '发送后输入框已变更或场控已暂停' });
        await new Promise(resolve => setTimeout(resolve, 60));
      }
      clearOwnText();
      return withMode({submitted:false,clicked:true,reason:'点击后暂未观察到提交结果，为避免重复发送，不自动重发'});
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
    const read = (row, emit, receivedAt, allowMilestone = true) => {
      this.status.domRows++;
      const signature = row.textContent.trim();
      if (this.domSeen.get(row) === signature) return;
      this.domSeen.set(row, signature);
      const milestone = recognizeMilestone(signature);
      if (allowMilestone && milestone && this.shouldReadMilestones()) pending.push({ type:'milestone', milestone, source:'dom', receivedAt });
      const c = this.getConfig().adapter;
      const nameEl = row.querySelector(c.nicknameSelector || '[data-e2e="chat-nickname"], [class*="nickname"]');
      const contentEl = row.querySelector(c.contentSelector || '[data-e2e="chat-content"], [class*="content"]');
      if (!nameEl || !contentEl) return;
      const name = nameEl.textContent.trim().replace(/[:：]$/, ''), text = contentEl.textContent.trim();
      if (emit && name && text && !milestone) pending.push({ type:'chat', user:{name,id:'',fanClubs:[],wealthLevel:null}, text, source:'dom', receivedAt });
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
        const enabled = this.shouldReadChat(), milestonesEnabled = this.shouldReadMilestones();
        // 每批最多处理 200 条，余下继续处理，不能把超过 200 条的消息截掉。
        for (const event of pending.splice(0, 200)) {
          if (stopped) break;
          if (event.type === 'milestone' ? !milestonesEnabled : !enabled) continue;
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
            try { read(row, false, receivedAt, false); } catch (error) { report(error); }
          }
          domNeedsBaseline = false;
          return;
        }
        for (const row of rows) { try { read(row, emit, receivedAt); } catch (error) { report(error); } }
        scheduleFlush(50);
      } catch (error) { report(error); }
    });
    for (const row of [...document.querySelectorAll(selector())].slice(-200)) read(row, false, Date.now(), false);
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
