import {parseGiftCatalog, walletUnits, diamondUnits, validateAutoGift} from '../core/auto-gift.js';

const same = (a,b) => a && b && ['roomId','userId','path','anchorId','scene','episodeId'].every(key=>a[key]===b[key]);
const refused = reason => ({submitted:false,reason});
function responseData(response) {
  if (response?.data?.status_code !== 0) throw new Error(`网页读取失败（${response?.data?.status_code ?? '未知'}）`);
  return response.data.data;
}

// Native gift module owns signing, credentials and form encoding. Only fixed
// catalog, wallet and gift operations are exposed; no captured secrets are used.
export class GiftRequests {
  constructor(sender) {
    this.sender=sender;this.generation=0;
    sender.page.addEventListener('pagehide',()=>this.stop());
  }
  context(sending=true) {
    const page=this.sender.page,base=this.sender.context(),info=page.__STORE__?.roomStore?.roomInfo,room=info?.room;
    const anchorId=info?.anchor?.id_str;
    if (!base || !/^[1-9]\d{0,24}$/.test(base.userId || '') || !/^[1-9]\d{0,24}$/.test(anchorId || '') || page.navigator?.onLine===false) throw new Error('请登录抖音并连接当前直播间');
    if (sending && (base.userId===anchorId || ![2,'2'].includes(room?.status) || ![true,1].includes(room?.room_auth?.Gift)
      || page.__STORE__?.feedStore?.isActive===false || page.__STORE__?.giftStore?.giftStatus===false)) throw new Error('请确认已登录、正在直播且允许送礼；不能送给自己');
    // The tool always targets the anchor, never the currently selected guest.
    const scene=room?.others?.group_live_data?.is_group_live ? 128 : page.__STORE__?.linkmicStore?.useChoosePeopleFunc ? 2 : 1;
    const episodeId=room?.episode_extra?.episode_id_str || '0';
    if (!/^\d+$/.test(episodeId) || typeof episodeId!=='string') throw new Error('直播场次信息不可用');
    return {...base,anchorId,scene,episodeId};
  }
  key(context) { return `douyin-live-assistant:gift-unresolved:${context.userId}`; }
  pendingRecord(context) {
    const raw=this.sender.page.localStorage.getItem(this.key(context));
    if (!raw) return null;
    const value=JSON.parse(raw);
    if (!value || typeof value.id!=='string' || typeof value.giftId!=='string' || !Number.isSafeInteger(value.costUnits)) throw new Error('待核对送礼记录无法读取，请保留记录并核对账户');
    return value;
  }
  async acquire(context) {
    const locks=this.sender.page.navigator?.locks;
    if (!locks) throw new Error('浏览器不支持账号送礼锁，请使用新版 Chrome 或 Edge');
    const lease={};
    const acquired=new Promise((resolve,reject)=>{
      lease.drained=locks.request(`douyin-live-assistant:gift-account:${context.userId}`,{ifAvailable:true},async lock=>{
        if (!lock) {resolve(false);return;}
        const held=new Promise(done=>{lease.release=done;});resolve(true);await held;
      }).catch(reject);
    });
    if (!await acquired) throw new Error('另一个标签页正在为此账号送礼，请先停止');
    return lease;
  }
  async read(context,api,signal) {
    const [catalog,wallet]=await Promise.all([
      api.Xq({room_id:context.roomId,gift_scene:context.scene}),api.sb()
    ]);
    if (signal?.aborted || !same(context,this.context(false))) throw new Error('账号或直播间已变化，已停止');
    const data=responseData(wallet);
    if (data?.user_id != null && String(data.user_id)!==context.userId) throw new Error('余额所属账号已变化');
    const balanceUnits=walletUnits(data);
    let restriction='';try{this.context();}catch(error){restriction=error.message;}
    const gifts=parseGiftCatalog(responseData(catalog),context.scene).map(gift=>restriction?{...gift,available:false,reason:restriction}:gift);
    return {gifts,balanceUnits,accountId:context.userId,roomId:context.roomId,at:Date.now(),pending:this.pendingRecord(context)};
  }
  async snapshot({signal}={}) {
    try {
      const context=this.context(false),api=this.sender.nativeGiftApi();
      if (!api) throw new Error('网页礼物模块尚未加载，请先打开网页礼物面板再刷新');
      return {available:true,...await this.read(context,api,signal)};
    } catch (error) {return {available:false,balanceUnits:null,gifts:[],reason:error.message};}
  }
  async catalog({signal}={}) {
    try {
      if(signal?.aborted)throw new Error('礼物目录读取已取消');
      const context=this.context(false),api=this.sender.nativeGiftApi();
      const params={room_id:context.roomId,gift_scene:context.scene};
      // The catalog is a read operation. It can use the page's signed HTTP
      // client before the lazy gift panel (and its wallet/send APIs) is loaded.
      const client=api ? null : this.sender.client?.();
      if(!api && !client)throw new Error('网页请求模块尚未就绪，请等待直播页加载完成后重试');
      const response=await (api ? api.Xq(params) : client.request({url:'/webcast/gift/list/',method:'get',params,timeout:8000,signal}));
      if(signal?.aborted || !same(context,this.context(false)))throw new Error('账号或直播间已变化，请重新读取目录');
      return {available:true,gifts:parseGiftCatalog(responseData(response),context.scene),at:Date.now()};
    } catch(error) {return {available:false,gifts:[],reason:error.message};}
  }
  async prepare(value,{signal}={}) {
    if (this.preparing || this.pending || this.session) return {available:false,reason:'本页已有送礼任务，请先停止'};
    this.preparing=true;const generation=++this.generation;let lease;
    try {
      const config=validateAutoGift(value),context=this.context(),api=this.sender.nativeGiftApi();
      if(config.accountId && config.accountId!==context.userId || config.roomId && config.roomId!==context.roomId)throw new Error('报价的账号或直播场次已变化，请重新读取礼物与余额');
      if (!api) throw new Error('请先打开网页礼物面板，加载礼物后再开始');
      lease=await this.acquire(context);
      const snapshot=await this.read(context,api,signal);
      if (snapshot.pending) throw new Error('上次送礼结果待核对，请核对余额与记录后解锁');
      const gift=this.selection(snapshot,config);
      const firstCount=Math.min(config.batch,config.target,Math.floor(config.budgetUnits/gift.priceUnits));
      if (firstCount<1 || snapshot.balanceUnits<gift.priceUnits*firstCount) throw new Error('余额或消费上限不足以发送本次礼物');
      if (generation!==this.generation || signal?.aborted || !same(context,this.context())) throw new Error('送礼任务已停止或权限已变化');
      const token=this.sender.page.crypto.randomUUID();
      this.session={token,context,api,config,lease,at:Date.now(),sequence:0,accepted:0,spentUnits:0,lastAt:-Infinity};lease=null;
      return {available:true,token,balanceUnits:snapshot.balanceUnits,gift};
    } catch (error) {return {available:false,reason:error.message};}
    finally {lease?.release();this.preparing=false;}
  }
  selection(snapshot,config) {
    const gift=snapshot.gifts.find(gift=>gift.id===config.giftId);
    if (!gift?.available) throw new Error(gift?.reason || '礼物已从当前目录移除');
    if (gift.priceUnits!==config.priceUnits) throw new Error('礼物价格已变化，请刷新目录并重新确认消费上限');
    return gift;
  }
  stop(token) {
    if (token && this.session?.token!==token) return {stopped:true};
    ++this.generation;
    if (this.session) this.session.stopped=true;
    if (!this.pending) {this.session?.lease.release();this.session=null;}
    return {stopped:true};
  }
  commit(token,count,sequence,{signal}={}) {
    const session=this.session;
    if (!session || session.token!==token) return Promise.resolve(refused('送礼准备已失效'));
    if (sequence===session.sequence && session.result) return session.result;
    if (session.stopped || signal?.aborted) return Promise.resolve(refused('送礼任务已停止'));
    const {config}=session;
    if (this.pending || !Number.isSafeInteger(sequence) || sequence!==session.sequence+1 || !Number.isInteger(count) || count<1 || count>config.batch
      || session.accepted+count>config.target || session.spentUnits+config.priceUnits*count>config.budgetUnits || Date.now()-session.lastAt<config.intervalSec*1000) {
      this.stop(token);return Promise.resolve(refused('批次、数量、消费上限或间隔无效，已停止'));
    }
    session.sequence=sequence;this.pending=true;
    session.result=this.perform(session,count,signal);return session.result;
  }
  async perform(session,count,signal) {
    let dispatched=false,record;
    try {
      if (!same(session.context,this.context()) || Date.now()-session.at>3600000) throw new Error('账号、房间或送礼权限已变化，请重新开始');
      const snapshot=await this.read(session.context,session.api,signal),gift=this.selection(snapshot,session.config);
      const costUnits=gift.priceUnits*count;
      if (snapshot.pending) throw new Error('存在待核对送礼记录，已停止');
      if (snapshot.balanceUnits<costUnits) throw new Error('钻石余额不足，已停止');
      if (session.stopped || signal?.aborted || !same(session.context,this.context())) throw new Error('送礼任务已停止或账号已变化');
      const {context}=session;
      record={id:this.sender.page.crypto.randomUUID(),giftId:gift.id,name:gift.name,count,costUnits,roomId:context.roomId,at:Date.now()};
      this.sender.page.localStorage.setItem(this.key(context),JSON.stringify(record));
      const query=this.sender.page.__INVISIBLE_QUERY__ || {};
      const payload={room_id:context.roomId,to_room_id:context.roomId,to_user_id:context.anchorId,to_user_ids:'',room_anchor_id:context.anchorId,
        to_episode_id:context.episodeId,send_type:4,send_scene:context.scene,gift_source:0,buff_level:0,
        gift_id:gift.id,count,price:gift.priceUnits/10,originPrice:gift.priceUnits/10,extra:JSON.stringify({total_count:count}),
        is_first_combo:true,is_hotkey:0,sort:gift.sort,sortType:'default',combo_position:'gift_panel',
        tags_extra:JSON.stringify({gift_source:'gift_panel',enter_from_merge:String(query.enter_from_merge || ''),enter_method:String(query.enter_method || '')})};
      dispatched=true;session.lastAt=Date.now();
      const response=await session.api.hF(payload,{ignoreToast:true}),body=response?.data;
      if (body?.status_code===0 && String(body.data?.gift_id)===gift.id) {
        const actualUnits=diamondUnits(body.data?.gift_struct?.diamond_count)*count;
        session.accepted+=count;session.spentUnits+=actualUnits;
        this.sender.page.localStorage.removeItem(this.key(context));
        let balanceUnits=null;
        try {
          const wallet=responseData(await session.api.sb());
          if (same(context,this.context()) && (wallet.user_id==null || String(wallet.user_id)===context.userId)) balanceUnits=walletUnits(wallet);
        } catch {}
        if (actualUnits!==costUnits) this.stop(session.token);
        return {submitted:true,count,costUnits:actualUnits,balanceUnits,priceChanged:actualUnits!==costUnits,
          reason:actualUnits!==costUnits ? '平台返回的扣费价格变化，已停止，请核对余额' : ''};
      }
      if (Number.isInteger(body?.status_code) && body.status_code!==0) {
        this.sender.page.localStorage.removeItem(this.key(context));this.stop(session.token);
        return refused(`平台拒绝送礼（${body.status_code}），已停止${body.status_code===40001 ? '：余额不足' : ''}`);
      }
      throw new Error('送礼响应无法确认');
    } catch (error) {
      this.stop(session.token);
      return dispatched ? {submitted:false,unknown:true,pending:record,reason:'送礼结果未知，已停止且不会重发；请核对余额与消费记录'} : refused(error.message);
    } finally {
      this.pending=false;
      if (session.stopped) {session.lease.release();if (this.session===session)this.session=null;}
    }
  }
  async acknowledge(id) {
    let lease;
    try {
      if (this.session || this.preparing || this.pending) throw new Error('请先停止送礼任务');
      const context=this.context(false);lease=await this.acquire(context);
      const snapshot=await this.read(context,this.sender.nativeGiftApi());
      if (!snapshot.pending || snapshot.pending.id!==id) throw new Error('待核对记录已变化，请刷新');
      this.sender.page.localStorage.removeItem(this.key(context));
      return {available:true,balanceUnits:snapshot.balanceUnits};
    } catch(error) {return {available:false,reason:error.message};}
    finally {lease?.release();}
  }
}
