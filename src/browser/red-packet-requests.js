import {parseRedPacketCatalog,validateRedPacket,redPacketForm,redPacketName} from '../core/red-packet.js';
import {parseIdentityJSON} from './identity.js';

const same=(a,b)=>['roomId','userId','path','anchorId','generation'].every(key=>a[key]===b[key]);
export class RedPacketRequests {
 constructor(sender) {
  this.sender=sender;this.closed=false;this.generation=0;
  sender.page.addEventListener('pagehide',()=>{this.closed=true;++this.generation;});
  sender.page.addEventListener('pageshow',event=>{if(event.persisted)this.closed=false;});
 }
 context() {
  if(this.closed)throw new Error('页面已关闭，红包任务已停止');
  const context=this.sender.gifts.context(false),store=this.sender.page.__STORE__;
  if(![2,'2'].includes(store.roomStore.roomInfo.room?.status) || store.feedStore?.isActive===false)throw new Error('当前直播已结束或不在前台房间');
  return {...context,generation:this.generation};
 }
 assertCurrent(context,signal) {
  if(signal?.aborted || !same(context,this.context()))throw new Error('账号、直播间或任务状态已变化，未发放');
 }
 async read(context,signal) {
  this.assertCurrent(context,signal);
  const client=this.sender.client();
  if(!client)throw new Error('网页请求模块未就绪，请等待直播页加载完成');
  const [response,wallet]=await Promise.all([
   client.request({url:'/webcast/luckybox/box/new_meta/',method:'get',params:{room_id:context.roomId,anchor_id:context.anchorId},timeout:8000,signal}),
   this.sender.gifts.balance({signal})
  ]);
  this.assertCurrent(context,signal);
  if(response?.data?.status_code!==0)throw new Error('平台未返回红包套餐，请稍后刷新');
  if(!wallet.available || wallet.accountId!==context.userId || wallet.roomId!==context.roomId)throw new Error(wallet.reason || '余额所属账号或直播间已变化');
  return {...parseRedPacketCatalog(response.data.data),balanceUnits:wallet.balanceUnits,accountId:context.userId,roomId:context.roomId,anchorId:context.anchorId};
 }
 async catalog({signal}={}) {
  try {
   const context=this.context(),snapshot=await this.read(context,signal),pending=this.sender.gifts.pendingRecord(context);
   return {available:true,...snapshot,pending,at:Date.now()};
  }catch(error){return {available:false,packages:[],balanceUnits:null,reason:error.message};}
 }
 async send(value,{signal}={}) {
  let lease,dispatched=false,record,context;
  try {
   const packet=validateRedPacket(value?.packet);context=this.context();
   if(packet.accountId!==context.userId || packet.roomId!==context.roomId || packet.anchorId!==context.anchorId)throw new Error('红包绑定的账号或直播间已变化，请重新选择');
   this.assertCurrent(context,signal);
   // Share the paid-gift account lease and unresolved ledger. A packet and an
   // ordinary gift must not independently reserve the same wallet balance.
   lease=await this.sender.gifts.acquire(context);
   if(this.sender.gifts.pendingRecord(context))throw new Error('有待核对的付费记录，请先在自动送礼中核对');
   const snapshot=await this.read(context,signal),data=redPacketForm(packet,snapshot),costUnits=packet.diamondCount*10;
   if(snapshot.balanceUnits<costUnits)throw new Error('钻石余额不足，红包未发放');
   this.assertCurrent(context,signal);
   const client=this.sender.client();if(!client)throw new Error('网页请求模块已变化，未发放');
   record={id:this.sender.page.crypto.randomUUID(),giftId:`red-packet:${packet.metaId}`,name:redPacketName(packet),count:1,costUnits,roomId:context.roomId,at:Date.now()};
   this.sender.page.localStorage.setItem(this.sender.gifts.key(context),JSON.stringify(record));
   dispatched=true;
   const response=await client.request({url:'/webcast/luckybox/send/',method:'post',data,headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:8000,signal,
    responseType:'text',transformResponse:[value=>value]});
   const body=typeof response?.data==='string' ? parseIdentityJSON(response.data) : response?.data;
   const boxId=typeof body?.data?.box_id==='string' ? body.data.box_id : Number.isSafeInteger(body?.data?.box_id) ? String(body.data.box_id) : '';
   if(body?.status_code===0 && body.data?.succeed===true && /^[1-9]\d{0,24}$/.test(boxId)) {
    this.sender.page.localStorage.removeItem(this.sender.gifts.key(context));
    return {submitted:true,boxId,costUnits,reason:'红包已发放，全直播间可领取'};
   }
   if(Number.isInteger(body?.status_code) && body.status_code!==0) {
    this.sender.page.localStorage.removeItem(this.sender.gifts.key(context));
    return {submitted:false,reason:`平台拒绝红包（${body.status_code}），未发放`};
   }
   throw new Error('红包响应无法确认');
  }catch(error){return dispatched ? {submitted:false,unknown:true,reason:'红包结果未知，不自动重发；请在自动送礼中核对余额及付费记录'} : {submitted:false,reason:error.message};}
  finally{lease?.release();}
 }
}
