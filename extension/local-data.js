import Dexie from 'dexie';

export const DATA_HOST='com.douyin_live_assistant.data';
const MAX_PENDING_BYTES=256*1024*1024;
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;

export function nativeDataRequest(chrome,timeoutMs=15000){
 return async(action,value)=>{
  let timer;
  try{
   const message={id:crypto.randomUUID(),action,...(action==='append'?{records:value}:value || {})};
   const result=await Promise.race([chrome.runtime.sendNativeMessage(DATA_HOST,message),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('本地数据库响应超时，待写数据已保留')),timeoutMs);})]);
   if(result?.id!==message.id || result.error || !result.value)throw Error(result?.error || '请先安装本地数据组件');
   return result.value;
  }finally{clearTimeout(timer);}
 };
}

// A durable outbox, separate from the replay journal and rolling analytics DB.
// Native acknowledgement is emitted only after SQLite commits the whole batch.
export class LocalDataEngine{
 constructor({indexedDB=globalThis.indexedDB,IDBKeyRange=globalThis.IDBKeyRange,request}={}){
  this.db=new Dexie('douyin-live-data-outbox',{indexedDB,IDBKeyRange});
  this.db.version(1).stores({queue:'&id,[receivedAt+id],room',meta:'&id'});
  this.request=request;this.flushing=null;this.lastError='';
 }
 async configure(enabled,{probe=true}={}){
  if(typeof enabled!=='boolean')throw Error('本地归档设置无效');
  if(enabled && probe){try{await this.request('status');}catch{throw Error('本地数据组件不可用，请先安装后重试');}}
  await this.db.meta.put({id:'settings',enabled});return this.status();
 }
 async enabled(){return (await this.db.meta.get('settings'))?.enabled===true;}
 async enqueue(record){
  if(!await this.enabled())return false;
  if(!record || !/^\d{1,30}$/.test(record.room) || !['event','protocol','forecast','coverage','account','pk-state'].includes(record.kind) || typeof record.id!=='string' || record.id.length>240 || !record.id.length || !Number.isFinite(record.receivedAt) || record.receivedAt<=0 || !record.payload || typeof record.payload!=='object')throw Error('本地归档记录无效');
  const size=bytes(record);if(size>500000)throw Error('本地归档记录过大');
  await this.db.transaction('rw',this.db.queue,this.db.meta,async()=>{
   const previous=await this.db.queue.get(record.id);
   if(previous){if(JSON.stringify(previous.record)!==JSON.stringify(record))throw Error('本地归档记录标识冲突');return;}
   const usage=await this.db.meta.get('usage') || {id:'usage',bytes:0};
   if(usage.bytes+size>MAX_PENDING_BYTES)throw Error('本地归档缓冲已满，请恢复本地数据组件后重试；未确认记录仍保留');
   await this.db.queue.add({id:record.id,room:record.room,receivedAt:record.receivedAt,size,record});
   await this.db.meta.put({...usage,bytes:usage.bytes+size});
  });return true;
 }
 flush(){
  if(this.flushing)return this.flushing;
  this.flushing=this.drain().catch(error=>{this.lastError=error.message;return false;}).finally(()=>{this.flushing=null;});return this.flushing;
 }
 async drain(){
  while(await this.enabled()){
   const rows=await this.db.queue.orderBy('[receivedAt+id]').limit(32).toArray();if(!rows.length)return true;
   let size=0;const batch=[];
   for(const row of rows){if(size+row.size>600000 && batch.length)break;size+=row.size;batch.push(row);}
   const result=await this.request('append',batch.map(r=>r.record));
   if(!Array.isArray(result?.acknowledged) || result.acknowledged.length!==batch.length || result.acknowledged.some((id,i)=>id!==batch[i].id))throw Error('本地数据库未确认完整批次，待写数据已保留');
   await this.db.transaction('rw',this.db.queue,this.db.meta,async()=>{
    const usage=await this.db.meta.get('usage');await this.db.queue.bulkDelete(batch.map(r=>r.id));
    await this.db.meta.put({...usage,bytes:Math.max(0,usage.bytes-batch.reduce((n,r)=>n+r.size,0))});
   });this.lastError='';
  }return true;
 }
 async status(){return {enabled:await this.enabled(),pending:await this.db.queue.count(),pendingBytes:(await this.db.meta.get('usage'))?.bytes || 0,error:this.lastError};}
 async summary(room){return this.request('summary',{room});}
 async enrich(room,anchor,report){
  if(!await this.enabled() || report.simulated)return report;
  const rows=[{...report.flow,target:'diamonds',horizonMinutes:5},...(report.online || []).map(r=>({...r,target:'online'}))]
   .filter(r=>r.status==='ready').map(({target,horizonMinutes,point,low,high})=>({target,horizonMinutes,point,low,high}));
  try{
   const [warehouse,localModel]=await Promise.all([this.summary(room),this.request('predict',{room,anchor,asOf:report.asOf,rows})]);
   return {...report,warehouse,localModel};
  }catch(error){return {...report,warehouse:{status:'unavailable',reason:error.message}};}
 }
 close(){this.db.close();}
}
