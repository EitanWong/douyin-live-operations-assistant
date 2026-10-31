import {AutoGift} from '../../core/auto-gift.js';
import {autoGiftView} from './view.js';

export const autoGiftTool={
  id:'auto-gift',label:'自动送礼',icon:'gift',version:'1.0.0',apiVersion:1,timeoutMs:60000,
  capabilities:['gift.read','gift.acknowledge','gift.prepare','gift.commit','gift.stop'],view:autoGiftView,
  mount(ctx) {
    const runner=new AutoGift({transport:{
      giftSnapshot:()=>ctx.operations.call('gift.read'),acknowledgeGift:id=>ctx.operations.call('gift.acknowledge',id),
      prepareGift:config=>ctx.operations.call('gift.prepare',config),
      commitGift:(token,count,sequence)=>ctx.operations.call('gift.commit',{token,count,sequence}),stopGift:token=>ctx.operations.call('gift.stop',token)
    },lock:ctx.lock,guard:ctx.guard,changed:ctx.publish,
    schedule:(callback,ms)=>ctx.scope.timeout(callback,ms),cancel:id=>ctx.scope.clearTimeout(id)});
    ctx.publish(runner.state);
    return {actions:{refresh:()=>runner.refresh(),acknowledge:()=>runner.acknowledge(),start:value=>runner.start(value),stop:()=>runner.stop()},
      tick:()=>runner.check(),stop:reason=>runner.stop(reason),dispose:()=>{runner.stop('工具已停用，已停止送礼');return runner.whenIdle();}};
  }
};
