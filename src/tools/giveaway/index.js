import {GiveawayRunner} from './runner.js';
import {giveawayView} from './view.js';

export const giveawayTool = {
  id:'giveaway',label:'互动抽奖',icon:'gift',version:'1.2.0',apiVersion:1,capabilities:['gift.catalog','giveaway.announce'],view:giveawayView,
  async mount(ctx) {
    const runner=new GiveawayRunner({room:ctx.room,storage:ctx.services.giveawayStorage,lock:ctx.lock,
      guard:ctx.guard,changed:ctx.publish,broadcastId:ctx.services.roomId,anchorId:ctx.services.anchorId,pendingEvents:ctx.services.giveawayPendingEvents,
      feedback:message=>ctx.operations.call('giveaway.announce',message),maxLength:ctx.services.messageLength,feedbackMode:ctx.services.feedbackMode});
    ctx.scope.defer(()=>runner.dispose());await runner.ready();
    return {actions:{start:value=>runner.start(value),cancel:()=>runner.cancel(),export:()=>runner.export(),gifts:()=>ctx.operations.call('gift.catalog'),claimFeedback:value=>runner.claimFeedback(value)},
      event:event=>runner.event(event),tick:()=>runner.tick(),stop:reason=>runner.cancel(reason)};
  }
};
