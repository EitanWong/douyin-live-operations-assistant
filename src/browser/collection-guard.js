import { RoomContext, roomMatchesStore } from './room-context.js';
// Douyin's PausePop listens for document mousemove and pauses BOTH playback
// and live IM after background inactivity. See docs/research/idle-collection.zh-CN.md.
export class CollectionGuard {
  constructor({page, onStatus = () => {}, now = () => Date.now()}) {
    this.page = page; this.doc = page.document; this.onStatus = onStatus; this.now = now;
    this.roomContext = new RoomContext(page);
    this.room = this.roomContext.room;
    this.status = {active:false, state:'waiting', pulses:0, recoveries:0, lastPulse:0, maxDelayMs:0, errors:0};
    this.suspended = false; this.closed = false; this.lastAttempt = null; this.lastRecovery = null;
  }
  context() {
    if (!this.room || !this.roomContext.current()) return 'left';
    const store = this.page.__STORE__, info = store?.roomStore?.roomInfo;
    if (!roomMatchesStore(info,this.page.location) || !/^\d+$/.test(String(info?.roomId || info?.room?.id_str || ''))) return 'waiting';
    if (Number(info.room?.status) === 4) return 'ended';
    if (Number(info.room?.status) !== 2 || store.roomStore.isAppOnly || store.feedStore?.isActive === false) return 'waiting';
    if (this.page.navigator?.onLine === false) return 'offline';
    return 'protecting';
  }
  emit() { this.onStatus({...this.status}); }
  tick() {
    if (this.closed || this.suspended) return;
    const now = this.now(), state = this.context();
    this.status.active = state === 'protecting'; this.status.state = state;
    if (state !== 'protecting') { this.emit(); return; }
    if (this.lastAttempt !== null && now - this.lastAttempt < 15000) return;
    this.lastAttempt = now;
    try {
      if (this.status.lastPulse) this.status.maxDelayMs = Math.max(this.status.maxDelayMs, now - this.status.lastPulse);
      // Dispatch only to document: no input, focus, scrolling, or public messages.
      this.doc.dispatchEvent(new this.page.MouseEvent('mousemove', {view:this.page, bubbles:false}));
      this.status.pulses++; this.status.lastPulse = now;
      this.recoverIdlePopup(now);
    } catch { this.status.errors++; this.status.state = 'error'; }
    this.emit();
  }
  recoverIdlePopup(now) {
    if (this.lastRecovery !== null && now - this.lastRecovery < 30000) return;
    // Use the native resume handler, which restores its timer, player and IM.
    // Never treat a generic play button, login dialog or verification as idle.
    const titles = [...this.doc.querySelectorAll('div,span,p')].filter(node =>
      !node.children.length && /^长时间无操作[，,]\s*已暂停播放$/.test(node.textContent.trim()) && !node.closest('#douyin-live-assistant'));
    if (titles.length !== 1) return;
    const root = titles[0].parentElement?.parentElement;
    if (!root || root.textContent.length > 300) return;
    const buttons = [...root.querySelectorAll('button,div,span')].filter(node =>
      !node.children.length && node.textContent.trim() === '继续播放' && !node.disabled);
    if (buttons.length !== 1) return;
    this.lastRecovery = now; buttons[0].click(); this.status.recoveries++;
  }
  schedule() {
    if (this.timer != null || this.closed || this.suspended) return;
    this.timer = this.page.setInterval(() => this.tick(), 20000);
  }
  start() {
    if (this.started) return;
    this.started = true;
    this.wake = () => { this.lastAttempt = null; this.tick(); };
    this.hide = event => {
      this.suspended = true; this.page.clearInterval(this.timer); this.timer = null;
      this.status.active = false; this.status.state = 'suspended'; this.emit();
      if (!event.persisted) this.stop();
    };
    this.show = () => { if (this.closed) return; this.suspended = false; this.schedule(); this.wake(); };
    this.page.addEventListener('pagehide', this.hide);
    this.page.addEventListener('pageshow', this.show);
    this.page.addEventListener('online', this.wake);
    this.doc.addEventListener('visibilitychange', this.wake);
    this.doc.addEventListener('resume', this.wake);
    this.schedule(); this.tick();
  }
  stop() {
    this.closed = true; this.page.clearInterval(this.timer); this.timer = null;
    this.page.removeEventListener('pagehide', this.hide); this.page.removeEventListener('pageshow', this.show);
    this.page.removeEventListener('online', this.wake); this.doc.removeEventListener('visibilitychange', this.wake); this.doc.removeEventListener('resume', this.wake);
    this.status.active = false; this.status.state = 'stopped'; this.emit();
  }
}
