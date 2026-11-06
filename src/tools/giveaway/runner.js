import {createGiveaway,enterGiveaway,drawGiveaway,parseGiveawayState,validateGiveawayConfig,GIVEAWAY_VERSION,matchesGiveawayChat,giveawayUserId} from '../../core/giveaway.js';
import {prepareGiveawayFeedback,prepareGiveawayDuplicate} from '../../core/giveaway-feedback.js';
import {isRedPacketGiveaway,selectRedPacket} from '../../core/red-packet.js';

// All commands, ticks and event writes use one queue under one room lease.
export class GiveawayRunner {
  constructor({room,storage,lock,guard=()=>'',changed=()=>{},broadcastId=()=>'',anchorId=()=>'',identity=()=>({}),now=Date.now,randomInt,pendingEvents,feedback,packetCatalog,packetSend,maxLength=()=>50,feedbackMode=()=> 'auto'}) {
    Object.assign(this,{room,storage,lock,guard,changed,broadcastId,anchorId,identity,now,randomInt,pendingEvents,feedback,packetCatalog,packetSend,maxLength,feedbackMode});
    this.key=`live-assistant:giveaway:${room}`;this.data={version:GIVEAWAY_VERSION,rounds:[]};this.tail=Promise.resolve();this.owned=false;this.closed=false;this.reason='尚未开始抽奖';
    this.handedOff=new Set();
  }
  current() { return this.data.rounds.find(round=>round.status==='running'); }
  assertOpen() { if(this.closed)throw new Error('抽奖工具已停用'); }
  run(callback) {
    const task=this.tail.catch(()=>{}).then(()=>{this.assertOpen();return callback();});
    this.tail=task;return task;
  }
  state() {
    const current=this.current();
    return {phase:current ? this.owned ? 'running' : 'readonly' : 'idle',receiving:Boolean(current),reason:this.reason,entryError:this.entryError || '',feedbackError:this.feedbackError || '',feedbackMode:this.feedbackMode(),anchorId:this.anchorId(),now:this.now(),rounds:structuredClone(this.data.rounds)};
  }
  publish(reason=this.reason) { this.reason=reason;if(!this.closed)this.changed(this.state()); }
  async load() {
    const data=await this.storage.get(this.key);this.assertOpen();this.data=parseGiveawayState(data,this.room);
  }
  async claim() {
    if(this.owned)return true;
    this.owned=await this.lock.acquire();this.assertOpen();
    if(this.owned){await this.load();await this.recover();}
    return this.owned;
  }
  async recover() {
    if(!this.pendingEvents || !this.current())return;
    let after,records;
    do {
      records=await this.pendingEvents(after);this.assertOpen();
      let round=this.current();const previous=round;
      for(const record of records) {
        if(record.savedAt>=round.startedAt && record.savedAt<round.endsAt) round=this.applyEvent(round,record.event,record.savedAt);
      }
      if(round!==previous)await this.save(round);
      const last=records.at(-1);if(last)after={savedAt:last.savedAt,key:last.key};
    } while(records.length===256);
  }
  release() { if(this.owned){this.lock.release();this.owned=false;} }
  async save(round) {
    this.assertOpen();
    const rounds=this.data.rounds.some(row=>row.id===round.id) ? this.data.rounds.map(row=>row.id===round.id ? round : row) : [...this.data.rounds,round];
    const next={version:GIVEAWAY_VERSION,rounds};await this.storage.set(this.key,next);this.data=next;
    this.publish(round.reason || '正在接收本轮参与弹幕和礼物');
  }
  pendingFeedback(round) {
    const broadcast=this.broadcastId();
    if(round.broadcastId && broadcast && round.broadcastId!==broadcast)return [];
    return (round.feedback || []).filter(row=>!row.attemptedBy && (!row.queued || !this.handedOff.has(`${round.id}:${row.id}`)) && row.expiresAt>this.now() &&
      (['result','cancelled'].includes(row.kind) || round.status==='running'));
  }
  async flushFeedback() {
    if(!this.feedback || !this.owned || this.guard())return;
    try {
      for(const round of this.data.rounds) {
        const accepted=new Set();
        try {
          for(const message of this.pendingFeedback(round)) {
            this.assertOpen();
            await this.feedback({...message,key:`${round.id}:${message.id}`,roundId:round.id,endsAt:round.endsAt});
            this.handedOff.add(`${round.id}:${message.id}`);
            accepted.add(message.id);
          }
        } finally {
          if(accepted.size)await this.save({...round,feedback:round.feedback.map(row=>accepted.has(row.id) ? {...row,queued:true} : row)});
        }
      }
      this.feedbackError='';
    } catch(error) {this.feedbackError=error.message;}
    this.publish();
  }
  claimFeedback({key,owner}) {
    return this.run(async()=>{
      if(typeof key!=='string' || typeof owner!=='string' || !owner || owner.length>100)throw new Error('抽奖弹幕认领参数无效');
      if(this.guard())throw new Error(this.guard());
      if(!await this.claim())throw Object.assign(new Error('等待抽奖运行页提交弹幕'),{retryable:true});
      try {
        const round=this.data.rounds.find(row=>row.feedback?.some(message=>`${row.id}:${message.id}`===key));
        const message=round?.feedback.find(row=>`${round.id}:${row.id}`===key);
        if(!message || message.expiresAt<=this.now() || message.attemptedBy && message.attemptedBy!==owner)return false;
        if(['start','entry','duplicate','countdown','reminder'].includes(message.kind) && round.status!=='running')return false;
        if(round.broadcastId && this.broadcastId() && round.broadcastId!==this.broadcastId())return false;
        if(message.attemptedBy===owner)return true;
        await this.save({...round,feedback:round.feedback.map(row=>row.id===message.id ? {...row,attemptedBy:owner} : row)});
        return true;
      } finally {if(!this.current())this.release();}
    });
  }
  ready() {
    return this.run(async()=>{
      if(!this.storage){this.publish('抽奖存储尚未就绪');return;}
      await this.load();
      await this.check();
      this.publish(this.current() ? this.owned ? '已恢复本轮抽奖' : this.guard() || '本轮由其他页面运行，可查看记录' : this.data.rounds.at(-1)?.reason || '尚未开始抽奖');
    });
  }
  start(value) {
    return this.run(async()=>{
      const config=validateGiveawayConfig({...value,presenceBias:value.presenceBias ?? true,feedbackEnabled:true}),reason=this.guard();
      if(reason)throw new Error(reason);
      if(!this.storage)throw new Error('抽奖存储不可用，请重新加载扩展');
      if(!await this.claim())throw new Error('其他页面正在运行本直播间抽奖，请在该页面操作');
      try {
        if(this.current())throw new Error('本轮抽奖尚未结束');
        if(isRedPacketGiveaway(config))await this.checkPacket(config);
        const round=createGiveaway(config,{id:crypto.randomUUID(),room:this.room,broadcastId:this.broadcastId(),anchorId:this.anchorId(),now:this.now()});
        await this.save(prepareGiveawayFeedback(round,this.now(),this.maxLength(),{start:true}));
        this.entryError='';
        await this.flushFeedback();
      } finally {if(!this.current())this.release();}
    });
  }
  async finish(round) {
    await this.save(prepareGiveawayFeedback(round,this.now(),this.maxLength()));
    await this.flushPackets();
    await this.flushFeedback();this.release();this.publish(round.reason);
  }
  async checkPacket(config) {
    const snapshot=await this.packetCatalog?.();this.assertOpen();
    if(!snapshot?.available)throw new Error(snapshot?.reason || '红包套餐读取失败，请刷新后重试');
    if(snapshot.pending)throw new Error('有待核对的付费记录，请先在自动送礼中核对');
    const packet=config.prizes[0].redPacket;
    if(!['accountId','roomId','anchorId'].every(key=>packet[key]===snapshot[key]))throw new Error('账号或直播间已变化，请重新选择红包');
    selectRedPacket(snapshot,packet);
    if(!Number.isSafeInteger(snapshot.balanceUnits) || snapshot.balanceUnits<packet.diamondCount*10)throw new Error('钻石余额不足，请选择其他额度的红包');
  }
  hasPendingPacket() {
    return this.data.rounds.some(round=>round.redPacketDeliveries?.some(row=>['pending','dispatching'].includes(row.status)));
  }
  async flushPackets() {
    for(const round of this.data.rounds.filter(round=>round.redPacketDeliveries?.some(row=>['pending','dispatching'].includes(row.status)))) {
      const delivery=round.redPacketDeliveries[0];
      if(delivery.status==='dispatching') {
        await this.save({...round,redPacketDeliveries:[{status:'unknown',reason:'上次已开始发放，结果待核对，不自动重发'}]});continue;
      }
      const reason=this.guard() || (round.broadcastId!==this.broadcastId() ? '直播场次已变化，未发放' : this.now()-round.endsAt>60000 ? '已错过发放时间，未补发' : '');
      if(reason) {await this.save({...round,redPacketDeliveries:[{status:'failed',reason}]});continue;}
      // Persist the attempt before crossing the paid request boundary. A crash
      // or failed receipt write leaves dispatching, which is never retried.
      await this.save({...round,redPacketDeliveries:[{status:'dispatching',reason:'正在核对余额并发放'}]});
      let result;
      try {this.assertOpen();result=await this.packetSend({packet:round.config.prizes[0].redPacket});}
      catch {result={unknown:true,reason:'发放结果未知，请核对消费记录，不自动重发'};}
      const receipt={status:result?.submitted ? 'sent' : result?.unknown ? 'unknown' : 'failed',reason:String(result?.reason || (result?.submitted ? '红包已发放' : '红包未发放')),...(result?.boxId ? {boxId:result.boxId} : {})};
      // flushFeedback may have replaced the round, so keep the latest outbox.
      await this.save({...this.data.rounds.find(row=>row.id===round.id),redPacketDeliveries:[receipt]});
    }
  }
  async check() {
    let round=this.current();
    if(!round && !this.hasPendingPacket() && !this.data.rounds.some(row=>this.pendingFeedback(row).length)){this.publish();return;}
    if(!this.owned) {
      if(this.guard() || !await this.claim()){this.publish('本轮由其他页面运行，等待同步');return;}
      round=this.current();
    }
    if(!round){await this.flushPackets();await this.flushFeedback();this.release();this.publish();return;}
    const broadcast=this.broadcastId();
    if(round.broadcastId && broadcast && round.broadcastId!==broadcast) {
      await this.finish({...round,status:'cancelled',closedAt:this.now(),reason:'直播场次已切换，本轮已取消'});return;
    }
    const result=drawGiveaway(round,this.now(),this.randomInt);
    if(result!==round)await this.finish(result);
    else {
      const next=prepareGiveawayFeedback(round,this.now(),this.maxLength());
      if(next!==round)await this.save(next);
      await this.flushFeedback();this.publish(this.guard() || (isRedPacketGiveaway(round.config) ? '等待设定时间发放红包' : '正在接收本轮参与弹幕和礼物'));
    }
  }
  tick() {
    return this.run(async()=>{
      if(!this.storage)return;
      if(!this.owned && this.now()-(this.lastRead || 0)>=1000){await this.load();this.lastRead=this.now();}
      await this.check();
    });
  }
  applyEvent(round,event,now) {
    const identity=this.identity(),matching=matchesGiveawayChat(round,event,now,identity),already=matching && round.entrants.some(row=>row.userId===giveawayUserId(event.user));
    const next=enterGiveaway(round,event,now,identity);
    return already ? prepareGiveawayDuplicate(next,event,now,this.maxLength()) : next;
  }
  event(event) {
    return this.run(async()=>{
      const round=this.current();if(!this.owned || !round)return;
      if(this.now()>=round.endsAt){await this.check();return;}
      if(this.guard())return;
      if(matchesGiveawayChat(round,event,this.now(),this.identity()) && !giveawayUserId(event.user)) {
        this.entryError=`${String(event.user?.name || '观众').slice(0,100)} 的参与弹幕未报名：未采集到稳定用户 ID，请检查直播连接后重发口令`;
        this.publish();return;
      }
      const next=this.applyEvent(round,event,this.now());
      if(next!==round) {
        await this.save(prepareGiveawayFeedback(next,this.now(),this.maxLength()));
        this.entryError='';
        await this.flushFeedback();
      }
    });
  }
  cancel(reason='已取消本轮抽奖') {
    return this.run(async()=>{
      if(!this.current())return;
      if(!await this.claim())throw new Error('其他页面正在运行本直播间抽奖，请在该页面取消');
      const round=this.current();if(round)await this.finish({...round,status:'cancelled',closedAt:this.now(),reason});
    });
  }
  export() { return this.run(async()=>{if(this.storage)await this.load();return structuredClone(this.data);}); }
  dispose() {
    this.closed=true;
    return this.tail.catch(()=>{}).finally(()=>this.release());
  }
}
