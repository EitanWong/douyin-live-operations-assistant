const frameKey = /^live-assistant:protocol:\d+:[a-z\d-]+$/i;
const order = (a,b) => a.savedAt-b.savedAt || a.key.localeCompare(b.key);

// Rebuild disposable metadata once per worker; never retain raw frames in memory.
// This queue owns only diagnostic cache writes, independently of the gift ledger.
export class ProtocolCache {
  constructor({local,usage,now=Date.now}) {
    Object.assign(this,{local,usage,now});this.entries=new Map();this.tail=Promise.resolve();
  }
  async ready() {
    if (!this.loading) this.loading=(async()=>{
      for(const [key,value] of Object.entries(await this.local.get(null))) if(frameKey.test(key)) this.entries.set(key,{key,savedAt:Number(value?.savedAt)||0});
    })().catch(error=>{this.loading=null;throw error;});
    await this.loading;
  }
  run(work) {
    const task=this.tail.catch(()=>{}).then(async()=>{await this.ready();return work();});
    this.tail=task;return task;
  }
  async prune(reserve=0,force=false) {
    const before=await this.usage(),candidates=[...this.entries.values()].sort(order),cutoff=this.now()-86400000;
    if(!force && candidates.length<=1000 && !candidates.some(row=>row.savedAt<cutoff) && (before.used==null || before.used+reserve<before.quota*.8))return {...before,pruned:this.lastPruned||null};
    const target=Math.max(0,before.quota*.65-reserve);let after=before,deleted=0,remaining=candidates.length;
    for(let offset=0;offset<candidates.length;offset+=50) {
      const keys=candidates.slice(offset,offset+50).filter(row=>row.savedAt<cutoff || after.used!=null && after.used>target || remaining>800).map(row=>row.key);
      if(!keys.length)break;
      await this.local.remove(keys);for(const key of keys)this.entries.delete(key);
      deleted+=keys.length;remaining-=keys.length;after=await this.usage();
    }
    if(deleted)this.lastPruned={deleted,bytes:Math.max(0,(before.used||0)-(after.used||0)),at:this.now()};
    return {...after,pruned:this.lastPruned||null};
  }
  maintain(reserve=0,force=false) {return this.run(()=>this.prune(reserve,force));}
  append(key,record) {
    return this.run(async()=>{
      if(this.entries.has(key))return {key};
      const reserve=(key.length+JSON.stringify(record).length)*3,usage=await this.prune(reserve);
      if(usage.ratio!=null && usage.ratio>=.8)throw Object.assign(new Error('本地存储已达80%，已停止新增协议帧；请先导出恢复数据并释放空间'),{code:'STORAGE_PRESSURE'});
      const savedAt=this.now();
      try {await this.local.set({[key]:{record,savedAt}});}
      catch(error) {
        if(!/quota|配额|QUOTA_BYTES/i.test(error.message))throw error;
        await this.prune(reserve,true);await this.local.set({[key]:{record,savedAt}});
      }
      this.entries.set(key,{key,savedAt});return {key};
    });
  }
  list(room,after,limit=100) {
    return this.run(async()=>{
      const prefix=`live-assistant:protocol:${room}:`;
      const selected=[...this.entries.values()].filter(row=>row.key.startsWith(prefix) && (!after || order(row,{savedAt:Number(after.savedAt)||0,key:String(after.key||'')})>0)).sort(order).slice(0,limit);
      if(!selected.length)return [];
      const records=await this.local.get(selected.map(row=>row.key));
      return selected.filter(row=>records[row.key]).map(row=>({key:row.key,...records[row.key]}));
    });
  }
  clear() {return this.run(async()=>{await this.local.remove([...this.entries.keys()]);this.entries.clear();});}
}
