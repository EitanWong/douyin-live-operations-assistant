// Ten minutes of page observations. Gift combo counts are cumulative, so only
// their increment belongs in the activity chart. No diamonds → PK conversion.
export class LiveMetrics {
  constructor({now=Date.now}={}) {this.now=now;this.buckets=new Map();this.combos=new Map();}
  ingest(event) {
    if(!['chat','enter','like','gift'].includes(event?.type))return;
    const now=this.now(), at=Number.isFinite(event.receivedAt) ? event.receivedAt : now;
    if(at<now-600000 || at>now+1000)return;
    const minute=Math.floor(at/10000)*10000;
    const bucket=this.buckets.get(minute) || {at:minute,chat:0,enter:0,like:0,gift:0,diamonds:0,unknownGifts:0};
    if(event.type==='gift') {
      const key=JSON.stringify([event.roomId,event.user?.id || event.user?.secUid || event.user?.name,event.giftId || event.giftName,event.groupId || event.id || at]);
      const count=Math.max(1,Number(event.count) || 1), old=this.combos.get(key)?.count || 0, delta=Math.max(0,count-old);
      this.combos.set(key,{count:Math.max(count,old),at});
      bucket.gift+=delta;
      if(Number.isFinite(event.unitValue)&&event.unitValue>=0)bucket.diamonds+=delta*event.unitValue;
      else bucket.unknownGifts+=delta;
    } else bucket[event.type]+=event.type==='like' ? Math.max(1,Number(event.count)||1) : 1;
    this.buckets.set(minute,bucket);
    this.prune();
  }
  prune() {
    for(const [at] of this.buckets)if(at<this.now()-600000)this.buckets.delete(at);
    for(const [key,value] of this.combos)if(value.at<this.now()-600000)this.combos.delete(key);
    while(this.combos.size>5000)this.combos.delete(this.combos.keys().next().value);
  }
  snapshot() {this.prune();return {buckets:[...this.buckets.values()].sort((a,b)=>a.at-b.at).map(item=>({...item})),combos:[...this.combos]};}
  restore(saved) {this.buckets=new Map((saved?.buckets || []).map(item=>[item.at,{...item}]));this.combos=new Map(saved?.combos || []);this.prune();}
}
