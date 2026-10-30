// This is a capability boundary for maintained plugins, not a sandbox for hostile code.
export class ToolGateway {
  constructor({definition, scope, room, guard, operations, createLock, timeout = 15000}) {
    Object.assign(this, {definition, scope, room, guard, operations, timeout});
    this.pending = new Set(); this.session = {}; this.roomLock = createLock(`${definition.id}:${room}`);
    this.lock = Object.freeze({
      acquire: () => this.track(async () => {
        this.assertCurrent();
        const acquired = await this.roomLock.acquire();
        if (!this.scope.active || this.guard()) { this.roomLock.release(); return false; }
        return acquired;
      }),
      release: () => this.roomLock.release()
    });
  }
  assertCurrent(local = false) {
    if (!this.scope.active) throw new Error('工具已停用，旧任务不能继续操作');
    const reason = !local && this.guard(); if (reason) throw new Error(reason);
  }
  track(callback) {
    // Operations can synchronously initiate teardown. Register ownership first.
    let resolve, reject;
    const result = new Promise((done, fail) => { resolve = done; reject = fail; });
    this.pending.add(result);
    void result.finally(() => this.pending.delete(result)).catch(() => {});
    try { resolve(callback()); } catch (error) { reject(error); }
    return result;
  }
  call(name, payload) {
    const pending = this.track(async () => {
      if (!this.definition.capabilities.includes(name)) throw new Error(`工具未声明操作能力：${name}`);
      const operation = this.operations[name];
      if (!operation) throw new Error(`工具操作能力不可用：${name}`);
      if (!operation.cleanup) {
        try {
          this.assertCurrent(Boolean(operation.local));
          if (operation.lock !== false && !this.roomLock.held) throw new Error('工具尚未取得当前直播间运行锁');
        } catch(error) { if(name==='rewards.click')error.dispatched=false;throw error; }
      }
      operation.validate?.(payload);
      return operation.run(payload, {
        room:this.room, session:this.session, signal:this.scope.signal,
        isCurrent:() => this.scope.active && !this.guard(), assertCurrent:() => this.assertCurrent()
      });
    });
    // A timeout revokes future work but cannot recall an already submitted
    // platform request. Keep the actual request in pending until it settles.
    let timer;
    return Promise.race([pending, new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = Object.assign(new Error('工具请求超时，结果未知，已停用'), {code:'TOOL_OPERATION_TIMEOUT'});
        this.scope.onError(error); reject(error);
      }, this.timeout);
    })]).finally(() => clearTimeout(timer));
  }
  async close() {
    // Keep ownership until submitted operations settle. An old instance cannot
    // release a replacement's lock because the runtime waits for this drain.
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    this.roomLock.release();
  }
}

export function toolOperations({transport, click, saveConfig, selfId = () => ''}) {
  return {
    'like.prepare': {run:async (budget, ctx) => {
      if (!Number.isInteger(budget) || budget < 1 || budget > 1000000) throw new Error('点赞目标无效');
      if (ctx.session.token) throw new Error('已有点赞会话');
      const account = selfId();
      const prepared = await transport.prepareLike({signal:ctx.signal});
      if (prepared?.token) {
        ctx.session.token = prepared.token; ctx.session.remaining = budget; ctx.session.sequence = 0; ctx.session.selfId = account;
        if (!ctx.isCurrent() || account !== selfId()) { await transport.stopLike(prepared.token); delete ctx.session.token; return {available:false,reason:'工具已停止或登录账号已变化'}; }
      }
      return prepared;
    }},
    'like.commit': {run:async (value, ctx) => {
      const session = ctx.session;
      if (!session.token || value?.token !== session.token || session.selfId !== selfId()) throw new Error('点赞会话或登录账号已变化，请重新开始');
      if (!Number.isInteger(value.count) || value.count < 1 || value.count > 100 || value.count > session.remaining || value.sequence !== session.sequence + 1) throw new Error('点赞批次或额度无效');
      session.remaining -= value.count; session.sequence = value.sequence;
      return transport.commitLike(value.token, value.count, value.sequence, {signal:ctx.signal});
    }},
    'like.stop': {cleanup:true, run:async (token, ctx) => {
      if (!token || token !== ctx.session.token) return;
      delete ctx.session.token;
      return transport.stopLike(token);
    }},
    'rewards.click': {run:(node, ctx) => { ctx.assertCurrent(); return click(node); }},
    'rewards.configure': {lock:false, local:true, run:value => saveConfig('rewards', value)}
  };
}
