export function failureCode(error) {
  if (error?.code) return error.code;
  const text = String(error?.message || error);
  if (/quota|配额|QUOTA_BYTES/i.test(text)) return 'STORAGE_QUOTA';
  if (/context invalidated|扩展上下文|receiving end does not exist/i.test(text)) return 'CONTEXT_INVALID';
  return 'TRANSIENT';
}

// Storage and export boundaries use JSON, while incoming events arrive through
// structured clone and may contain values JSON cannot represent (for example a
// cycle or BigInt). Keep sizing defensive so malformed events become a
// diagnosable collection gap instead of escaping from dispatch synchronously.
export function serializedBytes(value) {
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? text.length * 2 : null;
  } catch {
    return null;
  }
}

function eventType(event) {
  try { return event?.type; } catch { return undefined; }
}
function journalKey(event) {
  try { return event?._journalKey; } catch { return undefined; }
}

// Memory is bounded by both count and serialized size. Overflow is an explicit
// collection gap; never describe rejected events as safely recorded.
export class EventInbox {
  constructor({ handle, onStatus = () => {}, limit = 4096, maxBytes = 8 * 1024 * 1024, quarantineLimit = 50, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    this.handle = handle; this.onStatus = onStatus; this.limit = limit; this.maxBytes = maxBytes; this.quarantineLimit = quarantineLimit; this.wait = wait;
    this.queue = []; this.head = 0; this.bytes = 0; this.quarantineBytes = 0; this.running = false; this.held = false; this.blocked = false; this.closed = false; this.quarantine = []; this.idleWaiters = [];
    this.health = {state:'healthy',code:'',reason:'',gaps:0,giftGaps:0};
  }
  status() { return {...this.health,pending:this.queue.length-this.head,bytes:this.bytes+this.quarantineBytes,quarantined:this.quarantine.length,blocked:this.blocked}; }
  emit() { this.onStatus(this.status()); }
  admit(event, front = false) {
    if (this.closed) return Promise.resolve(false);
    const bytes = serializedBytes(event);
    if (bytes == null) {
      this.health = {...this.health,state:'degraded',code:'INVALID_EVENT',reason:'事件无法安全序列化，已丢弃'};
      this.health.gaps++; if (eventType(event) === 'gift') this.health.giftGaps++;
      this.emit(); return Promise.resolve(false);
    }
    // Leave one slot for a durable record so recovery can release storage even
    // when unpersisted live events have filled the regular buffer.
    const reserve = !front && this.limit > 256 ? 1 : 0;
    const reserveBytes = reserve ? Math.min(24000, this.maxBytes / 8) : 0;
    if (this.queue.length - this.head >= this.limit-reserve || this.bytes + this.quarantineBytes + bytes > this.maxBytes-reserveBytes) {
      const durable = front && journalKey(event);
      if (!durable) { this.health.gaps++; if (eventType(event) === 'gift') this.health.giftGaps++; }
      this.blocked = true; this.health.state = 'blocked'; this.health.code = durable ? 'BACKPRESSURE' : 'INBOX_LIMIT';
      this.health.reason = durable ? '持久日志仍在存储中，请释放积压后继续恢复' : '事件缓冲已满，新增事件未采集；请导出并恢复'; this.emit();
      return Promise.resolve(false);
    }
    let resolve; const task = new Promise(yes => { resolve = yes; });
    const item = {event,bytes,resolve};
    if (front) this.queue.splice(this.head,0,item); else this.queue.push(item);
    this.bytes += bytes;
    if (this.queue.length-this.head >= this.limit*.75) { this.health.state = 'buffering'; this.emit(); }
    void this.drain(); return task;
  }
  compact() {
    if (this.head === this.queue.length) { this.queue = []; this.head = 0; }
    else if (this.head >= 1024 && this.head * 2 >= this.queue.length) { this.queue = this.queue.slice(this.head); this.head = 0; }
  }
  async drain(maxItems = Infinity) {
    if (this.running || this.held || this.blocked || this.closed) return;
    this.running = true;
    try {
      let processed = 0;
      while (this.head < this.queue.length && !this.held && !this.blocked && !this.closed && processed < maxItems) {
        const item = this.queue[this.head]; let done = false;
        for (let attempt = 1; attempt <= 3 && !this.closed; attempt++) {
          try { await this.handle(item.event); item.resolve(true); done = true; break; }
          catch (error) {
            const code = failureCode(error);
            this.health = {...this.health,state:'retrying',code,reason:String(error?.message || error)}; this.emit();
            if (['STORAGE_QUOTA','STORAGE_PRESSURE','JOURNAL_LIMIT','BACKPRESSURE','CONTEXT_INVALID'].includes(code)) { this.blocked = true; break; }
            if (attempt < 3 && code !== 'INVALID_EVENT') { await this.wait(250 * 2 ** (attempt-1)); continue; }
            if (this.quarantine.length >= this.quarantineLimit) { this.blocked = true; break; }
            this.quarantine.push({event:item.event,code,reason:this.health.reason,bytes:item.bytes}); this.quarantineBytes += item.bytes; item.resolve(false); done = true; break;
          }
        }
        if (!done) { this.blocked = true; this.health.state = 'blocked'; this.emit(); break; }
        this.bytes -= item.bytes; this.queue[this.head++] = null; this.compact(); processed++;
      }
      if (!this.blocked && !this.closed) {
        this.health.state = this.quarantine.length ? 'degraded' : 'healthy';
        if (!this.quarantine.length) { this.health.reason = ''; this.health.code = ''; }
        this.emit();
      }
    } finally { this.running = false; for (const resolve of this.idleWaiters.splice(0)) resolve(); }
  }
  whenIdle() { return this.running ? new Promise(resolve=>this.idleWaiters.push(resolve)) : Promise.resolve(); }
  recover() {
    if (this.closed) return;
    this.blocked = false; this.health.state = 'healthy';
    const failed = this.quarantine.splice(0); this.quarantineBytes = 0;
    // Retain quarantined events when the regular queue has no room yet.
    for (const item of failed) {
      const bytes = serializedBytes(item.event);
      if (bytes == null) {
        this.quarantine.push({...item,code:'INVALID_EVENT',reason:'事件无法安全序列化，暂不能恢复'});
        this.quarantineBytes += Number(item.bytes) || 0;
        continue;
      }
      const reserve = this.limit > 256 ? 1 : 0;
      if (this.queue.length-this.head >= this.limit-reserve || this.bytes+this.quarantineBytes+bytes > this.maxBytes-(reserve ? Math.min(24000,this.maxBytes/8) : 0)) { this.quarantine.push(item); this.quarantineBytes += bytes; }
      else { this.queue.push({event:item.event,bytes,resolve:()=>{}}); this.bytes += bytes; }
    }
    this.emit(); void this.drain();
  }
  export() { return {health:this.status(),events:this.queue.slice(this.head).filter(Boolean).map(item=>item.event),quarantine:this.quarantine}; }
  close() { this.closed = true; for (const item of this.queue.slice(this.head)) item?.resolve(false); }
}
