import Dexie from 'dexie';
const DB_NAME='douyin-live-assistant';
// Dexie versions are native IndexedDB versions / 10. Keep the existing native
// v1 database, records and journalOrder compound index; no data copy or upgrade.
const DB_VERSION=.1;
export const isDurableKey=key=>/^(live-assistant:(config|runtime|income|income-calibration|profile|event|rewards|giveaway|api-key|search-key|media-key):|douyin-live-assistant:theme$)/.test(key);
const categoryOf=key=>/^live-assistant:(income|income-calibration|profile):/.test(key) ? 'income' : key.startsWith('live-assistant:event:') ? 'pending' : key.startsWith('live-assistant:runtime:') ? 'runtime' : 'settings';
const encodedSize=(key,value)=>new TextEncoder().encode(key+JSON.stringify(value)).byteLength;
export class DurableStorage {
  constructor({indexedDB=globalThis.indexedDB,keyRange=globalThis.IDBKeyRange,IDBKeyRange=keyRange,local}){
    this.local=local;this.tail=Promise.resolve();
    this.db=new Dexie(DB_NAME,{indexedDB,IDBKeyRange,autoOpen:false});
    this.db.version(DB_VERSION).stores({records:'&key,[room+savedAt+key]',metadata:''});
    this.db.on('populate',tx=>{
      const records=tx.idbtrans.objectStore('records');records.deleteIndex('[room+savedAt+key]');
      records.createIndex('journalOrder',['room','savedAt','key']);
    });
    this.db.on('blocked',()=>{this.db.close();});
  }
  open(){return this.db.isOpen() ? Promise.resolve(this.db) : this.db.open();}
  transaction(mode,work){
    // One worker owns writes. Dexie supplies commit/abort semantics; this tail
    // preserves caller order and the existing worker shutdown barrier.
    const task=this.tail.catch(()=>{}).then(async()=>{await this.open();return this.db.transaction(mode,this.db.records,this.db.metadata,()=>work(this.db.records,this.db.metadata));});
    this.tail=task;return task;
  }
  get(key){return this.transaction('r',async records=>(await records.get(key))?.value);}
  getAll(prefixes=['']){return this.transaction('r',async records=>{
    const rows=await Promise.all(prefixes.map(prefix=>records.where('key').between(prefix,`${prefix}\uffff`,true,true).toArray()));
    return Object.fromEntries(rows.flat().map(entry=>[entry.key,entry.value]));
  });}
  listEvents(room,after,limit=256){return this.transaction('r',async records=>{
    const low=[room,Number(after?.savedAt) || 0,String(after?.key || '')],high=[room,Number.MAX_SAFE_INTEGER,'\uffff'];
    const rows=await records.where('[room+savedAt+key]').between(low,high,!after,true).limit(limit).toArray();
    return rows.map(entry=>({key:entry.key,...entry.value}));
  });}
  putRecords(records,onlyAbsent=false){return this.transaction('rw',async(store,metadata)=>{
    const stats=await metadata.get('usage') || {};
    for(const [key,value] of new Map(records)){
      const previous=await store.get(key);if(onlyAbsent && previous)continue;
      const category=categoryOf(key),bytes=encodedSize(key,value),bucket=stats[category] ||= {bytes:0,count:0};
      bucket.bytes+=bytes-(previous?.bytes || 0);if(!previous)bucket.count++;
      const room=key.match(/^live-assistant:event:(\d+):/)?.[1];
      await store.put({key,value,category,bytes,...(room ? {room,savedAt:Number(value.savedAt) || 0} : {})});
    }
    await metadata.put(stats,'usage');
  });}
  set(key,value){return this.putRecords([[key,value]]);}
  remove(keys){return this.transaction('rw',async(store,metadata)=>{
    const stats=await metadata.get('usage') || {};
    for(const key of new Set(Array.isArray(keys) ? keys : [keys])){
      const previous=await store.get(key);if(!previous)continue;
      const bucket=stats[previous.category];bucket.bytes-=previous.bytes;bucket.count--;await store.delete(key);
    }
    await metadata.put(stats,'usage');
  });}
  usage(){return this.transaction('r',async(_store,metadata)=>({backend:'indexeddb',categories:await metadata.get('usage') || {},measurement:'json-utf8'}));}
  async migrate(){
    const records=Object.entries(await this.local.get(null)).filter(([key])=>isDurableKey(key));if(!records.length)return 0;
    await this.putRecords(records,true);const migrated=await this.getAll();
    if(records.some(([key,value])=>JSON.stringify(migrated[key])!==JSON.stringify(value)))throw new Error('旧数据迁移校验失败，原数据已保留');
    await this.local.remove(records.map(([key])=>key));return records.length;
  }
}
