import {createGiveaway,enterGiveaway,drawGiveaway,parseGiveawayState,validateGiveawayConfig,GIVEAWAY_VERSION} from '../../core/giveaway.js';
import {prepareGiveawayFeedback} from '../../core/giveaway-feedback.js';

// All commands, ticks and event writes use one queue under one room lease.
export class GiveawayRunner {
  constructor({room,storage,lock,guard=()=>'',changed=()=>{},broadcastId=()=>'',anchorId=()=>'',now=Date.now,randomInt,pendingEvents,feedback,maxLength=()=>50,feedbackMode=()=> 'auto'}) {
    Object.assign(this,{room,storage,lock,guard,changed,broadcastId,anchorId,now,randomInt,pendingEvents,feedback,maxLength,feedbackMode});
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
    return {phase:current ? this.owned ? 'running' : 'readonly' : 'idle',receiving:Boolean(current),reason:this.reason,feedbackError:this.feedbackError || '',feedbackMode:this.feedbackMode(),anchorId:this.anchorId(),now:this.now(),rounds:structuredClone(this.data.rounds)};
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
        if(record.savedAt>=round.startedAt && record.savedAt<round.endsAt) round=enterGiveaway(round,record.event,record.savedAt);
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
        if(['start','entry','countdown'].includes(message.kind) && round.status!=='running')return false;
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
      const config=validateGiveawayConfig({feedbackEnabled:true,...value}),reason=this.guard();
      if(reason)throw new Error(reason);
      if(!this.storage)throw new Error('抽奖存储不可用，请重新加载扩展');
      if(!await this.claim())throw new Error('其他页面正在运行本直播间抽奖，请在该页面操作');
      try {
        if(this.current())throw new Error('本轮抽奖尚未结束');
        const round=createGiveaway(config,{id:crypto.randomUUID(),room:this.room,broadcastId:this.broadcastId(),anchorId:this.anchorId(),now:this.now()});
        await this.save(prepareGiveawayFeedback(round,this.now(),this.maxLength(),{start:true}));
        await this.flushFeedback();
      } finally {if(!this.current())this.release();}
    });
  }
  async finish(round) {
    await this.save(prepareGiveawayFeedback(round,this.now(),this.maxLength()));
    await this.flushFeedback();this.release();this.publish(round.reason);
  }
  async check() {
    let round=this.current();
    if(!round && !this.data.rounds.some(row=>this.pendingFeedback(row).length)){this.publish();return;}
    if(!this.owned) {
      if(this.guard() || !await this.claim()){this.publish('本轮由其他页面运行，等待同步');return;}
      round=this.current();
    }
    if(!round){await this.flushFeedback();this.release();this.publish();return;}
    const broadcast=this.broadcastId();
    if(round.broadcastId && broadcast && round.broadcastId!==broadcast) {
      await this.finish({...round,status:'cancelled',closedAt:this.now(),reason:'直播场次已切换，本轮已取消'});return;
    }
    const result=drawGiveaway(round,this.now(),this.randomInt);
    if(result!==round)await this.finish(result);
    else {
      const next=prepareGiveawayFeedback(round,this.now(),this.maxLength());
      if(next!==round)await this.save(next);
      await this.flushFeedback();this.publish(this.guard() || '正在接收本轮参与弹幕和礼物');
    }
  }
  tick() {
    return this.run(async()=>{
      if(!this.storage)return;
      if(!this.owned && this.now()-(this.lastRead || 0)>=1000){await this.load();this.lastRead=this.now();}
      await this.check();
    });
  }
  event(event) {
    return this.run(async()=>{
      const round=this.current();if(!this.owned || !round)return;
      if(this.now()>=round.endsAt){await this.check();return;}
      if(this.guard())return;
      const next=enterGiveaway(round,event,this.now());
      if(next!==round)await this.save(next);
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
