import { decodeFrame } from './protocol.js';
import { recognizeMilestone } from '../core/milestones.js';
import { PageRequestSender } from './request-sender.js';
import { AnchorDataCollector } from './anchor-data.js';

const MAX_CAPTURE_FRAME_BYTES = 512 * 1024;
function base64(bytes, page) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return page.btoa(binary);
}

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

function parseDisplayCount(value) {
  const match = String(value || '').replace(/[\s\u00a0,，]/g, '').match(/^(\d+(?:\.\d+)?)(万|亿)?$/);
  if (!match) return null;
  const count = Number(match[1]) * (match[2] === '亿' ? 1e8 : match[2] === '万' ? 1e4 : 1);
  return Number.isSafeInteger(count) && count <= 1e12 ? count : null;
}

function readLabeledCount(root, label, before = false) {
  const labels = [...root.querySelectorAll('*')].filter(node => node.children.length === 0 && node.textContent.trim() === label);
  if (labels.length !== 1) return null;
  let node = labels[0];
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const leaves = [...node.querySelectorAll('*')].filter(item => item.children.length === 0);
    const index = leaves.indexOf(labels[0]);
    if (index < 0 || leaves.length > 8) continue;
    const values = (before ? leaves.slice(0, index).reverse() : leaves.slice(index + 1))
      .map(item => parseDisplayCount(item.textContent));
    const count = values.find(value => value !== null);
    if (count !== undefined) return count;
  }
  return null;
}

export function readRoomSnapshot(doc = document) {
  const chatroom = doc.querySelector('#chatroom');
  if (!chatroom) return null;
  const likeMatches = [...doc.querySelectorAll('*')]
    .filter(node => node.children.length === 0)
    .map(node => node.textContent.trim().match(/^(\d[\d,，]*(?:\.\d+)?(?:万|亿)?)\s*本场点赞$/)?.[1])
    .filter(Boolean).map(parseDisplayCount).filter(value => value !== null);
  const likeTotal = likeMatches.length && likeMatches.every(value => value === likeMatches[0]) ? likeMatches[0] : null;
  return {
    capturedAt: Date.now(), source: 'dom',
    onlineCount: readLabeledCount(chatroom, '在线观众'),
    likeTotal,
    visibleContributionRows: readAudienceContributions(doc).length
  };
}

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
  constructor({ page, getConfig, onEvent, onLog, onStatus, onCapture = () => {}, onPK = null, onEcho = () => false, shouldReadChat = () => true, shouldReadMilestones = shouldReadChat }) {
    this.page = page; this.getConfig = getConfig; this.shouldReadChat = shouldReadChat; this.shouldReadMilestones = shouldReadMilestones; this.onEvent = onEvent; this.onLog = onLog; this.onStatus = onStatus;
    this.onEcho = onEcho; this.onPK = onPK; this.onCapture = onCapture;
    this.status = { hook: false, sockets: 0, frames: 0, events: 0, errors: 0, lastFrame: 0, connected: false };
    this.pending = 0; this.pendingBytes = 0; this.decodedCacheBytes = 0; this.chain = Promise.resolve(); this.decodeChain = Promise.resolve(); this.roomPath = location.pathname;
    this.activeSockets = new Set(); this.domSeen = new WeakMap(); this.domActive = false; this.lastSocketChat = 0;
    this.seenProtocolEvents = new Map();
    this.ownedDraft = null;
    this.requestSender = new PageRequestSender(page);
    this.anchorData = new AnchorDataCollector({page,sender:this.requestSender,onEvent:event=>this.onEvent(event),onStatus:(kind,result)=>{
      this.status.exhibition = {...this.status.exhibition,[kind]:result}; this.emitStatus();
    }});
  }
  hook() {
    this.anchorData.start();
    try {
      const Native = this.page.WebSocket, adapter = this;
      if (!Native) throw new Error('没有 WebSocket');
      const enqueueFrame = (data, transport) => adapter.acceptFrame(data, transport);
      const Hook = new Proxy(Native, {
        construct(target, args, newTarget) {
          const socket = Reflect.construct(target, args, newTarget === Hook ? target : newTarget);
          let url; try { url = new URL(String(args[0])); } catch { return socket; }
          if (!url.hostname.endsWith('.douyin.com') && url.hostname !== 'douyin.com') return socket;
          if (!/webcast\/im\//.test(url.pathname)) return socket;
          adapter.status.sockets++; adapter.emitStatus();
          socket.addEventListener('open', () => { adapter.activeSockets.add(socket); adapter.status.connected = true; adapter.emitStatus(); });
          socket.addEventListener('close', () => { adapter.activeSockets.delete(socket); adapter.status.connected = adapter.activeSockets.size > 0; adapter.emitStatus(); });
          socket.addEventListener('message', e => enqueueFrame(e.data, 'socket'));
          return socket;
        }
      });
      this.page.WebSocket = Hook;
      this.status.hook = this.page.WebSocket === Hook;
      if (!this.status.hook) throw new Error('页面未接受 WebSocket 观察器');
      this.hookLongPoll(enqueueFrame);
    } catch (error) { this.onLog('error', `观察器安装失败：${error.message}；请刷新并检查油猴的页面注入设置`); }
    this.emitStatus();
  }
  hookLongPoll(enqueueFrame) {
    const XHR = this.page.XMLHttpRequest, proto = XHR?.prototype;
    if (!proto || proto.__liveAssistantPollHook) return;
    const nativeOpen = proto.open, nativeSend = proto.send, adapter = this;
    Object.defineProperty(proto, '__liveAssistantPollHook', { value:true, configurable:true });
    proto.open = function(method, input, ...rest) {
      let url = null;
      try { url = new URL(String(input), adapter.page.location.href); } catch {}
      this.__liveAssistantPoll = url?.origin === adapter.page.location.origin && url.pathname === '/webcast/im/fetch/'
        ? { method:String(method || 'GET').toUpperCase(), pathname:url.pathname } : null;
      return nativeOpen.call(this, method, input, ...rest);
    };
    proto.send = function(...args) {
      const request = this.__liveAssistantPoll;
      if (request?.method === 'GET' && location.pathname === adapter.roomPath) {
        const xhr = this;
        adapter.status.pollRequests = (adapter.status.pollRequests || 0) + 1;
        xhr.addEventListener('load', () => {
          if (location.pathname !== adapter.roomPath) return;
          if (xhr.status < 200 || xhr.status >= 300) { adapter.status.pollFailed = (adapter.status.pollFailed || 0) + 1; adapter.emitStatus(); return; }
          let response, responseType = '';
          try { response = xhr.response; responseType = xhr.responseType || ''; }
          catch { adapter.status.pollUnsupported = (adapter.status.pollUnsupported || 0) + 1; adapter.emitStatus(); return; }
          if (response instanceof ArrayBuffer || ArrayBuffer.isView(response) || (response && typeof response.arrayBuffer === 'function')) {
            adapter.status.pollResponses = (adapter.status.pollResponses || 0) + 1;
            enqueueFrame(response, 'http-poll');
          } else {
            let text = null;
            if (responseType === '' || responseType === 'text') try { text = xhr.responseText; } catch {}
            if (typeof text === 'string' && !text.includes('\ufffd') && [...text].every(char => char.charCodeAt(0) <= 255)) {
              adapter.status.pollResponses = (adapter.status.pollResponses || 0) + 1;
              enqueueFrame(Uint8Array.from(text, char => char.charCodeAt(0)), 'http-poll');
            } else { adapter.status.pollUnsupported = (adapter.status.pollUnsupported || 0) + 1; adapter.emitStatus(); }
          }
        }, { once:true });
      }
      return nativeSend.apply(this, args);
    };
    this.status.pollHook = true;
  }
  acceptFrame(data, transport = 'socket') {
    if (location.pathname !== this.roomPath) return;
    const frameBytes = typeof data === 'string' ? data.length * 2 : data?.byteLength || data?.size || 0;
    if (this.pending >= 256 || this.pendingBytes + frameBytes > 16 * 1024 * 1024) {
      this.status.frameGaps = (this.status.frameGaps || 0) + 1; this.emitStatus(); return;
    }
    const receivedAt = Date.now();
    this.pendingBytes += frameBytes; this.pending++; this.status.pendingFrames = this.pending;
    const previousDecode = this.decodeChain;
    // Socket 与长轮询共用有序队列，解析只读内容，不触碰页面发送路径。
    const decoded = this.decodeChain = (async () => {
      try { await previousDecode; } catch (error) { this.reportError(error); }
      try {
        const messages = []; let decodedEvents = [], parseError = '';
        try {
          decodedEvents = (await decodeFrame(data, error => this.reportError(error), method => this.reportUnknownMethod(method), message => messages.push(message))).map(event => ({ ...event, receivedAt }));
        } catch (error) { parseError = String(error?.message || error).slice(0, 240); this.reportError(error); }
        try {
          const textFrame = typeof data === 'string';
          const raw = textFrame ? new TextEncoder().encode(data) : data && typeof data.arrayBuffer === 'function' ? new Uint8Array(await data.arrayBuffer())
            : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
          const safeMessages = messages.filter(message => /^[A-Za-z0-9_]{1,120}$/.test(message.method)).slice(0, 500);
          const capture = { protocolVersion:1, transport, receivedAt, rawBytes:raw.byteLength, ...(textFrame ? {rawEncoding:'utf8-text'} : {}),
            messages:safeMessages, ...(messages.length > safeMessages.length ? {messagesOmitted:messages.length-safeMessages.length} : {}), ...(parseError ? { parseError } : {}), ...(raw.byteLength <= MAX_CAPTURE_FRAME_BYTES
              ? { rawBase64:base64(raw, this.page) }
              : { captureError:'FRAME_TOO_LARGE' }) };
          if (typeof this.onCapture === 'function') this.onCapture(capture);
        } catch (error) { this.status.captureErrors = (this.status.captureErrors || 0) + 1; this.reportError(error); }
        const events = decodedEvents.filter(event => {
          if (!this.isDuplicateProtocolEvent(event, transport)) return true;
          this.status.duplicateEvents = (this.status.duplicateEvents || 0) + 1; return false;
        });
        this.status.frames++; this.status.lastFrame = Date.now(); this.status.events += events.length;
        if (transport === 'http-poll') { this.status.pollFrames = (this.status.pollFrames || 0) + 1; this.status.pollEvents = (this.status.pollEvents || 0) + events.length; }
        for (const event of events) if (event.type.startsWith('pk-')) {
          this.status.pkEvents = (this.status.pkEvents || 0) + 1;
          this.status.lastPK = { type:event.type, receivedAt, decodedAt:Date.now(), method:event.protocolMethod || '',
            eventAt:event.at > 0 ? event.at : null, timestampSkewMs:event.at > 0 ? receivedAt-event.at : null };
          if (event.type === 'pk-score' && event.scores?.length) { this.status.pkScoreEvents = (this.status.pkScoreEvents || 0) + 1; this.status.lastPKScore = receivedAt; }
          if (this.onPK) try { await this.onPK(event); } catch (error) { this.reportError(error); }
        }
        const cacheBytes = JSON.stringify(events).length * 2, cache = this.decodedCacheBytes + cacheBytes <= 16 * 1024 * 1024;
        if (cache) this.decodedCacheBytes += cacheBytes; else this.status.uncachedFrames = (this.status.uncachedFrames || 0) + 1;
        this.status.decodedCacheBytes = this.decodedCacheBytes; this.emitStatus();
        return { events:cache ? events : null, cacheBytes:cache ? cacheBytes : 0 };
      } catch (error) { this.reportError(error); return {events:[],cacheBytes:0}; }
    })();
    const previous = this.chain;
    this.chain = (async () => {
      try { await previous; } catch (error) { this.reportError(error); }
      let cacheBytes = 0, result;
      try {
        result = await decoded; cacheBytes = result.cacheBytes;
        const events = result.events || (await decodeFrame(data)).map(event => ({ ...event, receivedAt }));
        let processed = 0;
        for (const event of events) {
          if (event.type === 'gift') {
            this.status.giftEvents = (this.status.giftEvents || 0) + 1;
            this.status.lastGift = { giftName:event.giftName || '礼物', giftId:event.giftId || '', count:Number(event.count) || 1,
              unitValue:Number.isFinite(event.unitValue) ? event.unitValue : null, eventAt:Number.isFinite(event.at) && event.at > 0 ? event.at : null,
              receivedAt, timestampSkewMs:Number.isFinite(event.at) && event.at > 0 ? receivedAt-event.at : null };
          }
          if (event.type === 'chat') this.lastSocketChat = Date.now();
          try { await this.onEvent(event); } catch (error) { this.reportError(error); }
          if (++processed % 200 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (this.pending > 1 && this.status.frames % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      } catch (error) { this.reportError(error); }
      finally { if (result) result.events = null; this.pending--; this.pendingBytes -= frameBytes; this.decodedCacheBytes -= cacheBytes; this.status.decodedCacheBytes = this.decodedCacheBytes; this.status.pendingFrames = this.pending; this.emitStatus(); }
    })();
  }
  isDuplicateProtocolEvent(event, transport) {
    if (!event?.id) return false;
    const now = Date.now(), key = `${event.type}:${event.id}`;
    for (const [id, record] of this.seenProtocolEvents) if (now - record.at > 120000) this.seenProtocolEvents.delete(id);
    const previous = this.seenProtocolEvents.get(key);
    if (previous && previous.transport !== transport) return true;
    this.seenProtocolEvents.set(key, { at:now, transport });
    while (this.seenProtocolEvents.size > 20000) this.seenProtocolEvents.delete(this.seenProtocolEvents.keys().next().value);
    return false;
  }
  reportError(error) {
    this.status.errors++;
    if (this.status.errors === 1 || this.status.errors % 100 === 0) this.onLog('error', `直播消息解析失败：${error.message}；请查看诊断`);
  }
  reportUnknownMethod(method) {
    if (!/^[A-Za-z0-9_]{1,120}$/.test(method)) return;
    const counts = this.status.unknownMethods || (this.status.unknownMethods = {});
    if (!Object.hasOwn(counts, method) && Object.keys(counts).length >= 50) return;
    counts[method] = (counts[method] || 0) + 1;
  }
  emitStatus() { this.onStatus({ ...this.status }); }
  // 无弹幕不等于断线；连接的 open/close 才决定传输是否可用。
  healthy() { return Boolean(this.status.connected); }
  readAudienceContributions() { return readAudienceContributions(this.page.document || document); }
  readRoomSnapshot() { return readRoomSnapshot(this.page.document || document); }
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
    const result = { ...this.status, anchorId: this.getConfig().anchorId || '未知', input: '', send: '', healthy: this.healthy(), domSnapshot:this.readRoomSnapshot() };
    try { const input = this.findInput(); result.input = selectorFor(input); try { result.send = selectorFor(this.findSend(input)); } catch (e) { result.send = e.message; } }
    catch (e) { result.input = e.message; }
    return result;
  }
  requestAvailable(channel = 'chat') {
    return typeof this.requestSender?.available === 'function' && this.requestSender.available(channel) === true;
  }
  findChatModeToggle(input) {
    let current = input?.parentElement;
    for (let depth = 0; current && depth < 5; depth++, current = current.parentElement) {
      if (current.id === 'douyin-live-assistant' || current.closest?.('#douyin-live-assistant')) continue;
      const toggle = [...current.querySelectorAll('input[type="checkbox"], [role="switch"]')]
        .find(element => {
          if (!isVisible(element) || element.closest?.('#douyin-live-assistant')) return false;
          // 真实页面的 switch 是付费/特权弹幕总开关，并不代表管理员类型。
          const native = element.matches('#chatInput [data-e2e="live-chatting"] .semi-switch [role="switch"]');
          const label = [element.getAttribute('aria-label'), element.getAttribute('title'), element.closest('label')?.textContent].filter(Boolean).join(' ');
          return native || /管理员弹幕/.test(label);
        });
      if (toggle) return toggle;
    }
    return null;
  }
  chatMode(toggle) {
    if (!toggle) return false;
    return toggle.checked === true || toggle.getAttribute('aria-checked') === 'true';
  }
  isAdminChatMode(input, toggle = this.findChatModeToggle(input)) {
    if (!this.chatMode(toggle)) return false;
    const hint = input.getAttribute('data-placeholder') || input.getAttribute('placeholder') || '';
    if (toggle?.matches('#chatInput [data-e2e="live-chatting"] .semi-switch [role="switch"]')) {
      if (hint) return hint === '发送管理员弹幕';
      // 富文本输入后 placeholder 会消失，按当前选中类型继续核对。
      return Boolean(input.closest('.webcast-chatroom')?.querySelector('.cw6Usapi img[src*="/privilege_screen_chat_admin_"]'));
    }
    return Boolean(toggle); // 此路径只接受明确标注“管理员弹幕”的控件。
  }
  clickChatControl(element) {
    if (typeof element.click === 'function') element.click();
    else element.dispatchEvent(new this.page.MouseEvent('click', { bubbles: true, cancelable: true, composed: true, view: this.page }));
  }
  async setChatMode(input, channel) {
    const desired = channel === 'admin';
    let toggle = this.findChatModeToggle(input);
    const previous = this.isAdminChatMode(input, toggle);
    const native = toggle?.matches('#chatInput [data-e2e="live-chatting"] .semi-switch [role="switch"]');
    let fallback = desired && !toggle ? '管理员弹幕开关未找到' : '';
    const disabled = el => el?.disabled || el?.getAttribute('aria-disabled') === 'true' || el?.closest('[disabled], [aria-disabled="true"]');
    const refresh = () => { input = this.findInput(); toggle = this.findChatModeToggle(input); };
    const settle = async () => { await new Promise(resolve => setTimeout(resolve, 80)); refresh(); };
    if (desired && toggle && !previous) {
      if (disabled(toggle)) fallback = '管理员弹幕开关不可用';
      else {
        if (native) {
          // 点击“弹”开关后页面请求类型列表；菜单由 showPanel 控制，并非 hover。
          // 此时即使默认选中付费类型，也只展开列表，绝不写入或点击发送。
          if (!this.chatMode(toggle)) { this.clickChatControl(toggle); await settle(); }
          let options = [];
          const deadline = Date.now() + 2400;
          do {
            await settle();
            const room = input.closest('.webcast-chatroom');
            options = [...(room?.querySelectorAll('img[src*="/privilege_screen_chat_admin_"]') || [])]
              .map(img => img.closest('.RfKNBPEF')).filter(el => el && isVisible(el));
          } while (!options.length && Date.now() < deadline);
          if (options.length !== 1 || disabled(options[0])) fallback = '管理员弹幕选项不可用';
          else { this.clickChatControl(options[0]); await settle(); }
        }
        if (!fallback && toggle && !this.chatMode(toggle)) { this.clickChatControl(toggle); await settle(); }
        if (!fallback && !this.isAdminChatMode(input, toggle)) fallback = '管理员弹幕类型未确认';
      }
    }
    if ((!desired || fallback) && this.chatMode(toggle)) {
      if (disabled(toggle)) throw new Error('无法关闭特权弹幕模式，本条未发送');
      this.clickChatControl(toggle); await settle();
      if (this.chatMode(toggle)) throw new Error('特权弹幕开关未关闭，本条未发送');
    }
    const used = desired && !fallback && this.isAdminChatMode(input, toggle) ? 'admin' : 'chat';
    return { toggle, previous, changed: previous !== (used === 'admin'), used, fallback };
  }
  restoreChatMode(mode) {
    if (!mode?.changed || !mode.toggle?.isConnected) return;
    if (mode.previous && mode.toggle.matches('#chatInput [data-e2e="live-chatting"] .semi-switch [role="switch"]')) {
      // 恢复前也确认类型；发送期间用户若改选付费类型，不能重新开启总开关。
      const selected = mode.toggle.closest('.webcast-chatroom')?.querySelector('.cw6Usapi img[src*="/privilege_screen_chat_admin_"]');
      if (!selected) return;
    }
    // 只恢复本次发送切换出的状态；用户若在发送期间手动改过开关，不再争抢控制权。
    if (this.chatMode(mode.toggle) === (mode.previous ? false : true)) {
      this.clickChatControl(mode.toggle);
    }
  }
  async send(text, isCurrent, { beforeClick = async()=>{}, channel = 'chat' } = {}) {
    if (!isCurrent()) return { submitted: false, reason: '场控已暂停' };
    if (!this.healthy()) return { submitted: false, retryable: true, reason: '直播数据重连中，本条未发送' };
    const temporary = reason => Object.assign(new Error(reason), { retryable: true });
    const prepared = await this.requestSender.prepare(channel);
    if (prepared?.available) {
      const guard = () => {
        if (!isCurrent() || !this.healthy()) return false;
        // 请求发送不会读写编辑器，但仍让人工草稿优先。
        const editors = [...this.page.document.querySelectorAll('#chatInput [contenteditable="true"], #chatInput textarea')];
        if (editors.some(el => ('value' in el ? el.value : el.textContent).replace(/[\u200b\ufeff]/g,'').trim())) throw temporary('公屏输入框已有手动草稿，等待手动内容发送后继续');
        return true;
      };
      if (!guard()) return {submitted:false,reason:'请求前已暂停或断线'};
      await beforeClick();
      if (!guard()) return {submitted:false,reason:'请求前已暂停或断线'};
      // 从这里开始请求可能已经送达，未知结果不能转 UI 再发一次。
      return this.requestSender.commit(prepared.token,text);
    }
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
      const current = normalize(value), expected = normalize(candidate);
      if (!current || !expected || current.length <= expected.length || current.length > expected.length * 6) return false;
      const count = current.length / expected.length;
      if (Number.isInteger(count) && current === expected.repeat(count)) return true;
      const remainder = current.slice(expected.length);
      return current.startsWith(expected) && remainder.length >= Math.min(8, Math.ceil(expected.length * 0.2)) && expected.startsWith(remainder);
    };
    const existing = readText();
    if (existing && this.ownedDraft?.text !== existing) {
      if (repeatedDraft(existing, text)) this.ownedDraft = {text:existing,at:Date.now()};
      else throw temporary('公屏输入框已有手动草稿，等待手动内容发送后继续');
    }
    if (input.disabled || input.readOnly || input.getAttribute('aria-disabled') === 'true') throw temporary('输入框暂不可用，等待网页恢复');
    if (!isCurrent()) return { submitted: false, reason: '场控已暂停' };
    const doc = input.ownerDocument;
    const clearOwnText = (expected = text) => {
      // 清理也必须作用于当前编辑器，不能误把已经脱离页面的旧节点清空当作成功。
      try { input = this.findInput(); } catch { return false; }
      if (!input.isConnected || readText() !== expected) return false;
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
      let draft = readText();
      // 每次回复都从空白输入框开始。只清理由本脚本确认写入的草稿，
      // 人工输入仍保留并暂停自动发送，避免覆盖观众/主播正在编辑的内容。
      if (draft && draft === this.ownedDraft?.text) {
        if (!clearOwnText(draft)) {
          // 同一回复可能由旧版脚本重复写入；清理仍须成功后才能发送。
          throw temporary('上条回复仍留在输入框，清理失败后稍后重试');
        }
        input = this.findInput(); draft = readText();
      }
      if (draft) throw temporary('公屏输入框已有手动草稿，等待手动内容发送后继续');
      if (input.disabled || input.readOnly || input.getAttribute('aria-disabled') === 'true') throw temporary('输入框暂不可用，等待网页恢复');
      if (doc.activeElement === focusedInput || (!focusedInput.isConnected && doc.activeElement === doc.body)) input.focus({ preventScroll: true });
      if ('value' in input) {
        const proto = input.tagName === 'TEXTAREA' ? this.page.HTMLTextAreaElement.prototype : this.page.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, text);
        input.dispatchEvent(new this.page.Event('input', { bubbles: true }));
        input.dispatchEvent(new this.page.Event('change', { bubbles: true }));
      } else {
        if (doc.activeElement !== input && doc.activeElement !== doc.body) throw temporary('输入焦点已变更，稍后重试');
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
      const toggle = this.findChatModeToggle(input);
      const hint = input.getAttribute('data-placeholder') || input.getAttribute('placeholder') || '';
      if (mode.used === 'admin' ? !this.isAdminChatMode(input, toggle) : this.chatMode(toggle) || /发送.*(?:至尊|高级|付费|钻)/.test(hint)) {
        throw temporary('弹幕类型在发送前发生变化，本条未发送');
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
    const pending = []; let timer = null, flushing = false, stopped = false, lastError = 0, domNeedsBaseline = false, startVisible = false, endVisible = false;
    this.status.domRows = 0; this.status.domBatches = 0;
    const selector = () => this.getConfig().adapter.chatSelector || '[data-e2e="chat-message"], [class*="webcast-chatroom___item"]';
    const read = (row, emit, receivedAt, allowMilestone = true) => {
      this.status.domRows++;
      const signature = row.textContent.trim();
      if (this.domSeen.get(row) === signature) return;
      this.domSeen.set(row, signature);
      const c = this.getConfig().adapter;
      const nameEl = row.querySelector(c.nicknameSelector || '[data-e2e="chat-nickname"], [class*="nickname"]');
      const contentEl = row.querySelector(c.contentSelector || '[data-e2e="chat-content"], [class*="content"]');
      // 昵称、灯牌和正文在 textContent 中会连在一起，不能把发送者拼成被感谢的人。
      const text = contentEl ? contentEl.textContent.trim() : signature;
      const milestone = recognizeMilestone(text);
      if (allowMilestone && milestone && this.shouldReadMilestones()) pending.push({ type:'milestone', milestone, text, source:'dom', receivedAt });
      if (!nameEl || !contentEl) return;
      const name = nameEl.textContent.trim().replace(/[:：]$/, '');
      if (emit && name && text && !milestone) pending.push({ type:'chat', user:{name,id:'',fanClubs:[],wealthLevel:null}, text, source:'dom', receivedAt });
    };
    const report = error => { if (Date.now() - lastError > 10000) { lastError = Date.now(); this.onLog('error', `页面弹幕采集异常：${error.message}`); } };
    const detectLiveBoundary = () => {
      const c = this.getConfig().adapter;
      const start = c.startSelector ? isVisible(document.querySelector(c.startSelector)) : false;
      const end = c.endSelector ? isVisible(document.querySelector(c.endSelector)) : false;
      if (start && !end && !startVisible) void Promise.resolve(this.onEvent({ type:'start', source:'dom-observed', at:Date.now() })).catch(report);
      if (end && !endVisible) void Promise.resolve(this.onEvent({ type:'end', source:'dom', at:Date.now() })).catch(report);
      startVisible = start; endVisible = end;
    };
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
        if (records.length) detectLiveBoundary();
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
    this.observer.observe(document.body, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['class','style','hidden','aria-hidden'] });
    detectLiveBoundary();
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
