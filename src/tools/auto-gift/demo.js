export function demoGiftTransport() {
  let balanceUnits=500000,session;
  const gifts=[['463','小心心',1,'推荐'],['791','玫瑰',1,'推荐'],['3773','热气球',520,'特效'],['789','嘉年华',30000,'特效'],['685','粉丝团灯牌',1,'粉丝团'],['5924','荣誉流星',7999,'等级']]
    .map(([id,name,price,category])=>({id,name,priceUnits:price*10,categories:[category],available:id!=='685',reason:id==='685'?'请先点亮粉丝团':''}));
  return {
    redPacketCatalog:async()=>({available:true,accountId:'987654321',roomId:'123',anchorId:'1234567890',balanceUnits,activity:null,
      packages:[[1008,20,5],[1009,20,15],[1010,100,10],[1012,200,20],[1014,520,20]].map(([id,diamondCount,packNum])=>({metaId:String(id),diamondCount,packNum,delays:[0,300],available:true,reason:''}))}),
    sendRedPacket:async({packet})=>{
      if(balanceUnits<packet.diamondCount*10)return {submitted:false,reason:'模拟钻石余额不足'};
      balanceUnits-=packet.diamondCount*10;return {submitted:true,boxId:String(Date.now()),reason:'模拟红包已发放，全直播间可领取'};
    },
    giftBalance:async()=>({available:true,balanceUnits,at:Date.now()}),
    giftCatalog:async()=>({available:true,gifts,at:Date.now()}),
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
