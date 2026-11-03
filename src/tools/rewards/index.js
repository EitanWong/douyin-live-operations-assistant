import { RewardAutomation } from '../../browser/rewards.js';
import { rewardsView } from './view.js';

export const rewardsTool = {
  id:'rewards', label:'福袋红包', icon:'gift', version:'1.0.0', apiVersion:1, timeoutMs:30000,
  capabilities:['rewards.click','rewards.prepare','rewards.commit','rewards.stop','rewards.configure'], view:rewardsView,
  mount(ctx) {
    const runner = new RewardAutomation({
      page:ctx.services.page, room:ctx.room, getConfig:ctx.config, lock:ctx.lock,
      guard:ctx.guard, changed:ctx.publish, log:ctx.services.log,
      storage:ctx.services.rewardStorage, getAccount:ctx.services.selfId,getEvents:ctx.services.rewardEvents,getRoomId:ctx.services.roomId,
      click:node => ctx.operations.call('rewards.click', node),
      lotteryRequests:{
        prepare:(lotteryId,options) => ctx.operations.call('rewards.prepare',{lotteryId,...options}),
        commit:(token,options) => ctx.operations.call('rewards.commit',{token,...options}),
        stop:token => ctx.operations.call('rewards.stop',token)
      }
    });
    runner.state = {...runner.state,submitted:ctx.previousState.submitted || 0,confirmed:ctx.previousState.confirmed || 0,serverConfirmed:ctx.previousState.serverConfirmed || 0};
    ctx.publish(runner.state);
    return {
      actions:{stop:async () => { runner.stop('已停止自动参与'); await ctx.operations.call('rewards.configure', {...ctx.config(),enabled:false}); }},
      tick:() => runner.tick(), stop:reason => runner.stop(reason),
      resume:() => runner.resume(),
      dispose:() => runner.stop('工具已停用，已停止自动参与')
    };
  }
};
