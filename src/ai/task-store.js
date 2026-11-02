import Dexie from 'dexie';
export function createAgentTaskStore({indexedDB=globalThis.indexedDB,IDBKeyRange=globalThis.IDBKeyRange}={}){
 const db=new Dexie('douyin-live-ai-tasks',{indexedDB,IDBKeyRange});db.version(1).stores({tasks:'&id,scope,createdAt',usage:'&scope'});
 return {async all(){await db.open();return db.tasks.toArray();},async put(job){await db.open();await db.transaction('rw',db.tasks,async()=>{await db.tasks.put(job);const old=await db.tasks.where('createdAt').below(Date.now()-86400000).primaryKeys();await db.tasks.bulkDelete(old);const rows=await db.tasks.orderBy('createdAt').primaryKeys();if(rows.length>100)await db.tasks.bulkDelete(rows.slice(0,rows.length-100));});},
  async reserve(scope,limit=20){await db.open();return db.transaction('rw',db.usage,async()=>{const now=Date.now(),old=await db.usage.get(scope),calls=(old?.calls || []).filter(at=>now-at<3600000);if(calls.length>=limit)throw new Error('后台研究每小时20次模型调用额度已用完');calls.push(now);await db.usage.put({scope,calls});});},close(){db.close();}};
}
