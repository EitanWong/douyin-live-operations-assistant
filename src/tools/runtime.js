import { ToolScope } from './scope.js';
import { ToolGateway } from './gateway.js';
import { CordisToolAdapter } from './cordis-adapter.js';

export class ToolRuntime {
  constructor({registry, room, guard = () => '', operations = {}, createLock, getConfig = () => ({}), services = {},
    changed = () => {}, onError = () => {}, timeout = 15000, scopeOptions = {}}) {
    Object.assign(this, {registry, room, guard, operations, createLock, getConfig, services, changed, onError, timeout, scopeOptions});
    this.entries = new Map(); this.suspended = false; this.closed = false;
    this.backend = new CordisToolAdapter({services});
    for (const definition of registry.list()) this.entries.set(definition.id, {definition, enabled:true, revision:0, phase:'disabled', state:{}, transition:Promise.resolve()});
  }
  state(id) { const entry = this.entries.get(id); return entry && {...entry.state}; }
  status() { return [...this.entries.values()].map(entry => ({id:entry.definition.id, version:entry.definition.version, phase:entry.phase, error:entry.error || ''})); }
  diagnostics() { return this.backend.diagnostics(); }
  publish(entry, state) {
    entry.state = {...state,hostPhase:entry.phase};
    try { this.changed(entry.definition.id, {...entry.state}); } catch (error) { this.report(entry, error); }
  }
  report(entry, error) {
    entry.error = String(error?.message || error).slice(0, 240);
    try { this.onError(entry.definition.id, error); } catch {}
  }
  bounded(task) {
    let timer;
    return Promise.race([Promise.resolve(task), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('工具操作超时，已停用，请检查后重建')), this.timeout); })])
      .finally(() => clearTimeout(timer));
  }
  fail(entry, error) {
    this.report(entry, error); entry.phase = 'failed';
    const closing = entry.lifecycle?.close() || entry.scope?.close();
    void closing?.catch(error => this.report(entry, error));
    this.publish(entry, {...entry.state,phase:'failed',reason:`工具已停用：${entry.error}`});
  }
  enable(id) {
    const entry = this.entries.get(id);
    if (!entry) return Promise.reject(new Error('工具未注册'));
    entry.enabled = true;
    if (['active','mounting'].includes(entry.phase) && entry.scope?.active) return entry.transition;
    const revision = ++entry.revision;
    entry.transition = entry.transition.catch(() => {}).then(async () => {
      if (this.closed || this.suspended || revision !== entry.revision) return;
      if (entry.phase === 'active') return;
      try {
        // An unresolved old request/teardown blocks replacement, but never core processing.
        if (entry.lifecycle) await this.bounded(entry.lifecycle.close());
        if (this.closed || this.suspended || !entry.enabled || revision !== entry.revision) return;
        entry.lifecycle = null;
        entry.phase = 'mounting'; entry.error = '';
        entry.notifying = new Set();
        const scope = entry.scope = new ToolScope({...this.scopeOptions, onError:error => { if (entry.scope === scope && scope.active) this.fail(entry, error); }});
        const gateway = new ToolGateway({definition:entry.definition, scope, room:this.room,
          guard:() => this.guard(entry.definition.id), operations:this.operations, createLock:this.createLock, timeout:this.timeout});
        scope.defer(() => gateway.close());
        const context = Object.freeze({
          room:this.room, signal:scope.signal, scope, lock:gateway.lock,
          guard:() => !scope.active ? '工具已停用' : this.guard(entry.definition.id),
          operations:Object.freeze({call:(name, value) => gateway.call(name, value)}),
          config:() => structuredClone(this.getConfig(entry.definition.id) || {}),
          previousState:structuredClone(entry.state),
          publish:state => { if (scope.active && revision === entry.revision) this.publish(entry, state); }
        });
        const lifecycle = entry.lifecycle = this.backend.mount(entry.definition, context);
        entry.instance = await this.bounded(lifecycle.ready);
        if (!scope.active || this.closed || this.suspended || revision !== entry.revision) { await this.bounded(lifecycle.close()); return; }
        entry.phase = 'active';
        this.publish(entry, entry.state);
      } catch (error) { this.fail(entry, error); throw error; }
    });
    return entry.transition;
  }
  disable(id, {preserveEnabled = false} = {}) {
    const entry = this.entries.get(id); if (!entry) return Promise.resolve();
    if (!preserveEnabled) entry.enabled = false;
    ++entry.revision;
    entry.phase = 'disabled';
    this.publish(entry, {...entry.state,phase:'stopping',reason:'正在停用工具，等待已提交操作结算'});
    const closing = entry.lifecycle?.close() || entry.scope?.close();
    void closing?.catch(() => {});
    entry.transition = entry.transition.catch(() => {}).then(async () => {
      try {
        if (closing) await this.bounded(closing);
        if (entry.lifecycle) await this.bounded(entry.lifecycle.close());
        entry.instance = null; entry.phase = 'disabled';
        this.publish(entry, {...entry.state,phase:'stopped',reason:'工具已停用'});
      } catch (error) { this.fail(entry, error); throw error; }
    });
    return entry.transition;
  }
  async restart(id) { await this.disable(id); return this.enable(id); }
  async start() { return Promise.allSettled([...this.entries.values()].filter(entry => entry.enabled).map(entry => this.enable(entry.definition.id))); }
  invoke(id, action, value) {
    const entry = this.entries.get(id);
    if (!entry || entry.phase !== 'active' || !entry.scope.active || this.suspended || this.closed) return Promise.reject(new Error('工具尚未就绪或已停用'));
    if (!Object.hasOwn(entry.instance.actions || {}, action)) return Promise.reject(new Error('工具操作未注册'));
    const scope = entry.scope;
    try {
      // Commands may reject invalid input without disabling a healthy plugin.
      return this.bounded(scope.run(() => entry.instance.actions[action](value))).catch(error => {
        if (entry.scope === scope && scope.active && /工具操作超时/.test(error?.message)) this.fail(entry, error);
        throw error;
      });
    } catch (error) { return Promise.reject(error); }
  }
  notify(name, value) {
    if (this.suspended || this.closed) return;
    for (const entry of this.entries.values()) {
      if (entry.phase !== 'active' || !entry.scope.active || !entry.instance?.[name] || entry.notifying?.has(name)) continue;
      entry.notifying ||= new Set(); entry.notifying.add(name);
      const scope = entry.scope, notifying = entry.notifying;
      try {
        const task = scope.run(() => entry.instance[name](value));
        void this.bounded(task).catch(error => { if (entry.scope === scope && scope.active) this.fail(entry, error); }).finally(() => notifying.delete(name));
      } catch (error) { entry.notifying.delete(name); this.fail(entry, error); }
    }
  }
  suspend() {
    this.suspended = true;
    return Promise.allSettled(this.registry.list().map(definition => this.disable(definition.id, {preserveEnabled:true})));
  }
  resume() { if (this.closed) return Promise.resolve(); this.suspended = false; return this.start(); }
  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    // The adapter retains unresolved handles even if the caller's wait times out.
    this.closing = Promise.allSettled([this.suspend(), this.bounded(this.backend.close())]);
    return this.closing;
  }
}
