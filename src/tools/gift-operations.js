import {validateAutoGift} from '../core/auto-gift.js';

export function giftOperations(transport,selfId) {
  return {
    'gift.read':{lock:false,run:(_,ctx)=>transport.giftSnapshot({signal:ctx.signal})},
    'gift.acknowledge':{lock:false,run:id=>{
      if(typeof id!=='string' || id.length>64)throw new Error('待核对记录标识无效');
      return transport.acknowledgeGift(id);
    }},
    'gift.prepare':{run:async(value,ctx)=>{
      const config=validateAutoGift(value);
      if(ctx.session.gift)throw new Error('已有送礼会话');
      const session={account:selfId(),config,remaining:config.budgetUnits,remainingCount:config.target,sequence:0};
      ctx.session.gift=session;let retained=false;
      try {
        const prepared=await transport.prepareGift(config,{signal:ctx.signal});
        if(prepared?.token){
          session.token=prepared.token;
          if(!ctx.isCurrent() || session.account!==selfId() || ctx.signal.aborted || !prepared.available){
            await transport.stopGift(session.token);return {available:false,reason:'送礼任务已停止或账号已变化'};
          }
          retained=true;
        }
        return prepared;
      }finally{if(!retained && ctx.session.gift===session)delete ctx.session.gift;}
    }},
    'gift.commit':{run:(value,ctx)=>{
      const session=ctx.session.gift;
      if(!session?.token || session.token!==value?.token || session.account!==selfId())throw new Error('送礼会话或账号已变化');
      if(!Number.isInteger(value.count) || value.count<1 || value.count>session.config.batch || value.count>session.remainingCount
        || value.sequence!==session.sequence+1 || value.count*session.config.priceUnits>session.remaining)throw new Error('送礼批次或消费上限无效');
      session.sequence=value.sequence;session.remaining-=value.count*session.config.priceUnits;session.remainingCount-=value.count;
      return transport.commitGift(value.token,value.count,value.sequence,{signal:ctx.signal});
    }},
    'gift.stop':{cleanup:true,run:(token,ctx)=>{
      if(!token || token!==ctx.session.gift?.token)return;
      delete ctx.session.gift;return transport.stopGift(token);
    }}
  };
}
