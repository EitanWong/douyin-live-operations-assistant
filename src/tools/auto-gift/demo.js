export function demoGiftTransport() {
  let balanceUnits=500000,session;
  const gifts=[['463','小心心',1,'推荐'],['791','玫瑰',1,'推荐'],['3773','热气球',520,'特效'],['789','嘉年华',30000,'特效'],['685','粉丝团灯牌',1,'粉丝团'],['5924','荣誉流星',7999,'等级']]
    .map(([id,name,price,category])=>({id,name,priceUnits:price*10,categories:[category],available:id!=='685',reason:id==='685'?'请先点亮粉丝团':''}));
  return {
    giftSnapshot:async()=>({available:true,gifts,balanceUnits,at:Date.now(),pending:null}),
    prepareGift:async config=>{session={token:crypto.randomUUID(),config};return {available:true,token:session.token,balanceUnits};},
    commitGift:async(token,count)=>{
      if(token!==session?.token)return {submitted:false,reason:'模拟任务已停止'};
      const costUnits=count*session.config.priceUnits;
      if(balanceUnits<costUnits)return {submitted:false,reason:'模拟钻石余额不足'};
      balanceUnits-=costUnits;return {submitted:true,count,costUnits,balanceUnits};
    },
    stopGift:async token=>{if(token===session?.token)session=null;return {stopped:true};}
  };
}
