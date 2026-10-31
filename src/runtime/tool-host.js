import {ToolRuntime} from '../tools/runtime.js';
import {bundledTools} from '../tools/bundled.js';
import {toolOperations} from '../tools/gateway.js';
import {RoomLock} from '../browser/adapter.js';
import {demoGiftTransport} from '../tools/auto-gift/demo.js';

// Page policy and transport adapters live here; plugins receive the scoped API.
export function createPageTools({page,room,engine,adapter,demo,current,unavailable,liveStatus,log,rewardStorage,giveawayStorage,giveawayPendingEvents,saveConfig,changed,getRoomId}) {
  const guard=id=>!current() ? '页面或直播间已切换，已停止工具任务'
    : unavailable() ? '扩展连接已失效，请刷新直播页'
    : id==='rewards' && demo ? '模拟器不参与真实活动，请在直播页使用'
    : !demo && (!adapter.healthy() || liveStatus() && liveStatus()!=='live') ? '直播已结束或连接中断，已停止工具任务'
    : id==='rewards' && !engine.config.selfId ? '请先登录抖音并识别当前账号' : '';
  return new ToolRuntime({registry:bundledTools,room,guard,createLock:key=>new RoomLock({room:key}),
    getConfig:id=>engine.config[id],services:{page,log,selfId:()=>engine.config.selfId,rewardStorage,giveawayStorage,giveawayPendingEvents,
      rewardEvents:()=>engine.roomData.activities,roomId:getRoomId || (()=>engine.liveMode?.roomId || '')},
    operations:toolOperations({selfId:()=>engine.config.selfId,saveConfig,getRewardsConfig:()=>engine.config.rewards,
      transport:demo ? {...demoGiftTransport(),prepareLike:async()=>({available:true,token:'demo'}),commitLike:async(token,count)=>({submitted:true,count}),stopLike:async()=>({stopped:true})} : adapter.requestSender,
      click:node=>{
        const style=node?.ownerDocument===page.document && page.getComputedStyle(node);
        if(!engine.config.rewards.enabled || !node?.isConnected || !style || style.display==='none' || style.visibility==='hidden' || !node.getClientRects().length ||
          node.closest('#douyin-live-assistant,[hidden],[aria-hidden="true"],[disabled],[aria-disabled="true"]'))throw Object.assign(new Error('活动操作已失效'),{dispatched:false});
        node.click();
      }
    }),changed,onError:(id,error)=>log('error',`工具 ${bundledTools.get(id)?.label || id}：${error.message}`)
  });
}
