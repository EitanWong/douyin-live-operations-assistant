import { AutoLike, validateAutoLike } from '../../core/auto-like.js';
import { autoLikeView } from './view.js';

export const autoLikeTool = {
  id:'auto-like', label:'自动点赞', icon:'heart', version:'1.0.0', apiVersion:1,
  capabilities:['like.prepare','like.commit','like.stop'], view:autoLikeView,
  mount(ctx) {
    const runner = new AutoLike({
      transport:{
        prepareLike:() => ctx.operations.call('like.prepare', runner.config.target),
        commitLike:(token, count, sequence) => ctx.operations.call('like.commit', {token,count,sequence}),
        stopLike:token => ctx.operations.call('like.stop', token)
      },
      lock:ctx.lock, guard:ctx.guard, changed:ctx.publish,
      schedule:(callback, ms) => ctx.scope.timeout(callback, ms), cancel:id => ctx.scope.clearTimeout(id)
    });
    ctx.publish(runner.state);
    return {
      actions:{start:value => runner.start(validateAutoLike(value)), stop:() => runner.stop()},
      tick:() => runner.check(), stop:reason => runner.stop(reason),
      dispose:() => { runner.stop('工具已停用，已停止点赞'); return runner.whenIdle(); }
    };
  }
};
