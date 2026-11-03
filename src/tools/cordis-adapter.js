import { Context } from 'cordis';

// Cordis stays behind the project's tool contract. In particular, Fiber disposal
// must not replace synchronous revocation or our stricter request drain checks.
export class CordisToolAdapter {
  constructor({services = {}} = {}) {
    this.root = new Context(); this.handles = new Set(); this.closed = false;
    this.root.provide('toolServices', Object.freeze({...services}));
  }
  mount(definition, context) {
    if (this.closed) throw new Error('工具宿主已关闭');
    const {scope} = context;
    let instance, closing;
    const fiber = this.root.plugin({
      name:`tool:${definition.id}`, inject:['toolServices'],
      apply:async cordis => {
        cordis.effect(() => () => scope.close(), 'tool.scope');
        if (!scope.active) return;
        const mounting = Promise.resolve().then(() => {
          if (scope.active) return definition.mount(Object.freeze({...context, services:cordis.toolServices}));
        }).then(value => {
          instance = value;
          // Also runs immediately for instances returned after revocation.
          if (instance?.dispose) scope.defer(() => instance.dispose());
        });
        scope.defer(() => mounting.catch(() => {}));
        await mounting;
      }
    });
    const handle = {
      ready:(async () => { await fiber; return instance; })(),
      close:() => {
        if (closing) return closing;
        const draining = scope.close(); // revoke before any async Cordis teardown
        const disposing = fiber.dispose();
        closing = (async () => {
          try {
            const results = await Promise.allSettled([draining, disposing]);
            const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
            if (errors.length) throw new AggregateError(errors, '工具资源回收失败，请刷新页面');
          } finally { this.handles.delete(handle); }
        })();
        return closing;
      }
    };
    this.handles.add(handle);
    return handle;
  }
  diagnostics() { return {backend:'cordis', plugins:this.root.registry.size, scopes:this.handles.size}; }
  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      const results = await Promise.allSettled([...this.handles].map(handle => handle.close()));
      await this.root.fiber.dispose();
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, '工具宿主资源回收失败');
    })();
    return this.closing;
  }
}
