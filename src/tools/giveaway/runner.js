import {createGiveaway,enterGiveaway,drawGiveaway,parseGiveawayState,validateGiveawayConfig} from '../../core/giveaway.js';

// All commands, ticks and event writes use one queue under one room lease.
export class GiveawayRunner {
  constructor({room,storage,lock,guard=()=>'',changed=()=>{},broadcastId=()=>'',now=Date.now,randomInt,pendingEvents}) {
    Object.assign(this,{room,storage,lock,guard,changed,broadcastId,now,randomInt,pendingEvents});
    this.key=`live-assistant:giveaway:${room}`;this.data={version:1,rounds:[]};this.tail=Promise.resolve();this.owned=false;this.closed=false;this.reason='尚未开始抽奖';
  }
  current() { return this.data.rounds.find(round=>round.status==='running'); }
  assertOpen() { if(this.closed)throw new Error('抽奖工具已停用'); }
  run(callback) {
    const task=this.tail.catch(()=>{}).then(()=>{this.assertOpen();return callback();});
    this.tail=task;return task;
  }
  state() {
    const current=this.current();
    return {phase:current ? this.owned ? 'running' : 'readonly' : 'idle',receiving:Boolean(current),reason:this.reason,now:this.now(),rounds:structuredClone(this.data.rounds)};
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
    const next={version:1,rounds};await this.storage.set(this.key,next);this.data=next;
    this.publish(round.reason || '正在接收本轮参与弹幕和礼物');
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
      const config=validateGiveawayConfig(value),reason=this.guard();
      if(reason)throw new Error(reason);
      if(!this.storage)throw new Error('抽奖存储不可用，请重新加载扩展');
      if(!await this.claim())throw new Error('其他页面正在运行本直播间抽奖，请在该页面操作');
      try {
        if(this.current())throw new Error('本轮抽奖尚未结束');
        await this.save(createGiveaway(config,{id:crypto.randomUUID(),room:this.room,broadcastId:this.broadcastId(),now:this.now()}));
      } finally {if(!this.current())this.release();}
    });
  }
  async finish(round) {
    await this.save(round);this.release();this.publish(round.reason);
  }
  async check() {
    let round=this.current();
    if(!round){this.publish();return;}
    if(!this.owned) {
      if(this.guard() || !await this.claim()){this.publish('本轮由其他页面运行，等待同步');return;}
      round=this.current();if(!round){this.release();this.publish();return;}
    }
    const broadcast=this.broadcastId();
    if(round.broadcastId && broadcast && round.broadcastId!==broadcast) {
      await this.finish({...round,status:'cancelled',closedAt:this.now(),reason:'直播场次已切换，本轮已取消'});return;
    }
    const result=drawGiveaway(round,this.now(),this.randomInt);
    if(result!==round)await this.finish(result);
    else this.publish(this.guard() || '正在接收本轮参与弹幕和礼物');
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
