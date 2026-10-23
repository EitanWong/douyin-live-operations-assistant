// Keep at most one in-flight write and one latest pending snapshot. Callers sharing
// a pending snapshot resolve only after that snapshot (or its newer replacement) lands.
export class RuntimeWriter {
  constructor(write) { this.write = write; this.pending = null; this.running = false; this.failure = null; }
  save(value) {
    if (this.failure) return Promise.reject(this.failure);
    if (!this.pending) {
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      this.pending = { value, promise, resolve, reject };
    } else this.pending.value = value;
    const promise = this.pending.promise;
    if (!this.running) void this.drain();
    return promise;
  }
  async drain() {
    this.running = true;
    try {
      while (this.pending) {
        const batch = this.pending; this.pending = null;
        try { await this.write(batch.value); batch.resolve(); }
        catch (error) {
          if (failureCode(error) === 'CONTEXT_INVALID') {
            this.failure = error;
            this.pending?.reject(error); this.pending = null;
          }
          batch.reject(error);
        }
      }
    } finally { this.running = false; }
  }
}

// One checkpoint/ack batch at a time, independent of live event ingestion.
// Failed or interrupted batches remain pending; durable journal records are the fallback.
export class JournalCommitter {
  constructor({ checkpoint, ack, active = () => true, onError = () => {}, batchSize = 50, delay = 100, retryDelay = 1000 }) {
    this.checkpoint = checkpoint; this.ack = ack; this.active = active; this.onError = onError;
    this.batchSize = batchSize; this.delay = delay; this.retryDelay = retryDelay;
    this.pending = new Set(); this.timer = null; this.running = null; this.retrying = false; this.failure = null;
  }
  add(key) {
    if (!key) return;
    if (!this.pending.has(key) && this.pending.size >= 4096) throw Object.assign(new Error('待确认日志已达上限，请恢复本地存储后重试'),{code:'BACKPRESSURE'});
    this.pending.add(key);
    if (this.pending.size >= this.batchSize && !this.retrying && !this.running) { this.pause(); this.schedule(0); }
    else this.schedule(this.delay);
  }
  schedule(delay) {
    if (this.failure || this.timer !== null || this.running || !this.pending.size || !this.active()) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, delay);
  }
  pause() { clearTimeout(this.timer); this.timer = null; }
  resume() { this.schedule(0); }
  flush() {
    if (this.running) return this.running;
    this.pause();
    if (this.failure || !this.active() || !this.pending.size) return Promise.resolve();
    this.running = this.drain();
    return this.running;
  }
  async drain() {
    // Start after flush() publishes running, including synchronous checkpoint failures.
    await Promise.resolve();
    this.retrying = false;
    try {
      while (this.active() && this.pending.size) {
        const keys = [];
        for (const key of this.pending) { keys.push(key); if (keys.length >= this.batchSize) break; }
        await this.checkpoint();
        if (!this.active()) break;
        await this.ack(keys);
        for (const key of keys) this.pending.delete(key);
      }
    } catch (error) {
      if (failureCode(error) === 'CONTEXT_INVALID') this.failure = error;
      this.retrying = true; this.onError(error);
    } finally {
      this.running = null; this.schedule(this.retrying ? this.retryDelay : this.delay);
    }
  }
}
import { failureCode } from './inbox.js';
