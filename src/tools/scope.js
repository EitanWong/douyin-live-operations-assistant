// Registered resources are revoked synchronously, even when async teardown is slow.
export class ToolScope {
  constructor({onError = () => {}, schedule = (fn, ms) => setTimeout(fn, ms), cancel = id => clearTimeout(id)} = {}) {
    this.controller = new AbortController(); this.cleanups = new Set(); this.timers = new Map(); this.pending = new Set(); this.errors = [];
    this.onError = onError; this.schedule = schedule; this.cancel = cancel;
  }
  get active() { return !this.controller.signal.aborted; }
  get signal() { return this.controller.signal; }
  defer(cleanup) {
    if (typeof cleanup !== 'function') throw new Error('工具清理函数无效');
    if (!this.active) { this.cleanup(cleanup); return () => {}; }
    this.cleanups.add(cleanup);
    return () => this.cleanups.delete(cleanup);
  }
  timeout(callback, ms) {
    if (!this.active) throw new Error('工具已停用');
    const id = this.schedule(() => {
      this.timers.delete(id);
      if (!this.active) return;
      try { this.run(callback).catch(this.onError); } catch (error) { this.onError(error); }
    }, ms);
    this.timers.set(id, true); return id;
  }
  clearTimeout(id) { if (this.timers.delete(id)) this.cancel(id); }
  listen(target, name, callback, options) {
    if (!this.active) throw new Error('工具已停用');
    const listener = (...args) => {
      if (!this.active) return;
      try { this.run(() => callback(...args)).catch(this.onError); } catch (error) { this.onError(error); }
    };
    target.addEventListener(name, listener, options);
    const cleanup = () => target.removeEventListener(name, listener, options);
    const forget = this.defer(cleanup);
    return () => { forget(); cleanup(); };
  }
  run(callback) {
    // Register before invoking: a synchronous callback may initiate teardown.
    let resolve, reject;
    const task = new Promise((done, fail) => { resolve = done; reject = fail; });
    this.pending.add(task);
    void task.then(() => this.pending.delete(task), () => this.pending.delete(task));
    try { resolve(callback()); } catch (error) { reject(error); }
    return task;
  }
  close() {
    if (this.active) {
      this.controller.abort();
      for (const id of this.timers.keys()) this.cleanup(() => this.cancel(id));
      this.timers.clear();
      const cleanups = [...this.cleanups].reverse(); this.cleanups.clear();
      for (const cleanup of cleanups) this.cleanup(cleanup);
    }
    return this.drain();
  }
  cleanup(callback) {
    const handled = this.run(callback).catch(error => { this.errors.push(error); });
    this.pending.add(handled);
    void handled.finally(() => this.pending.delete(handled));
  }
  async drain() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    if (this.errors.length) throw new AggregateError(this.errors, '工具资源回收失败，请刷新页面');
  }
}
