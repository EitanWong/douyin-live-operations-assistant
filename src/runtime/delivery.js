const cloneDelivery = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
// Unknown deliveries are retained as recent history, never as sendable work.
const unresolved = record => ['prepared', 'clicked', 'failed'].includes(record.state);

export class DeliveryTracker {
  constructor({ now = Date.now, timeout = 8000 } = {}) {
    this.now = now; this.timeout = timeout; this.records = []; this.serial = 0;
  }
  pending() { return this.records.filter(unresolved); }
  create(text, jobs, account) {
    this.prune();
    const record = { id:`${this.now()}-${++this.serial}`, text:normalize(text), jobs:cloneDelivery(jobs), attempts:Math.max(0,...jobs.map(job=>job.attempts || 0)), account:{id:account?.id || '',secUid:account?.secUid || ''}, requiresClickCheckpoint:true, state:'prepared', createdAt:this.now() };
    this.records.push(record); return record;
  }
  clicked(record) { if (record.state === 'prepared') { record.state = 'clicked'; record.clickedAt = this.now(); } }
  finish(record, state, reason = '') {
    if (record.state === 'echoed') return;
    record.state = state; record.reason = reason; record.updatedAt = this.now();
  }
  observe(event) {
    if (event?.type !== 'chat' || event.source !== 'socket' || !event.user) return null;
    const received = Number.isFinite(event.receivedAt) ? event.receivedAt : this.now();
    const matches = this.records.filter(record => ['clicked','unknown','failed','retrying'].includes(record.state) && record.clickedAt != null &&
      ((record.account.id && String(event.user.id) === String(record.account.id)) || (record.account.secUid && event.user.secUid === record.account.secUid)) &&
      normalize(event.text) === record.text && received >= record.clickedAt && received - record.clickedAt <= 60000 &&
      (!event.at || event.at >= record.clickedAt - 2000 && event.at <= this.now() + 1000));
    if (!matches.length) return null;
    // Prefer the most recent click. A retry can overlap a late echo from the
    // previous attempt; either way, observing the text means no more retry is needed.
    const record = matches.sort((a,b) => b.clickedAt-a.clickedAt)[0]; record.state = 'echoed'; record.echoedAt = this.now(); record.messageId = String(event.id || '');
    record.latencyMs = Math.max(0, received - record.clickedAt); record.jobs = [];
    this.prune(); return record;
  }
  expire() {
    const expired = [];
    for (const record of this.records) if (record.state === 'clicked' && this.now() - record.clickedAt >= this.timeout) {
      this.finish(record, 'unknown', '等待公屏回显超时；为避免重复发送，不自动重发'); expired.push(record);
    }
    return expired;
  }
  prune() {
    const terminal = this.records.filter(record => !unresolved(record)).slice(-50);
    this.records = this.records.filter(unresolved).concat(terminal);
  }
  snapshot() { return cloneDelivery(this.records); }
  restore(records = []) {
    this.records = cloneDelivery(records.filter(record => record && typeof record.text === 'string' && Array.isArray(record.jobs)));
    for (const record of this.records) if (record.state === 'clicked') this.finish(record, 'unknown', '页面重建前已点击发送；为避免重复发送，不自动重发');
    // Older versions could click before persisting the intent, so even their
    // prepared snapshots cannot prove that no click occurred.
    for (const record of this.records) if (record.state === 'prepared' && !record.requiresClickCheckpoint) this.finish(record, 'unknown', '旧版点击意图未可靠保存；不自动重发');
    this.serial = Math.max(0,...this.records.map(record=>Number(String(record.id).split('-').at(-1)) || 0)); this.prune();
  }
}
