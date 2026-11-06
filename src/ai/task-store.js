import Dexie from 'dexie';
import {BrowserCheckpointSaver} from './checkpoint-store.js';
export function createAgentTaskStore({indexedDB=globalThis.indexedDB,IDBKeyRange=globalThis.IDBKeyRange}={}){
 const db=new Dexie('douyin-live-ai-tasks',{indexedDB,IDBKeyRange});db.version(1).stores({tasks:'&id,scope,createdAt',usage:'&scope'});
 db.version(2).stores({checkpoints:'[thread+ns+id],[thread+ns],thread,at',checkpointWrites:'[thread+ns+checkpointId+task+index],[thread+ns+checkpointId],thread',loops:'&scope,updatedAt'});
 const checkpointer=new BrowserCheckpointSaver(db);
 return {checkpointer,async readLoop(scope){await db.open();return db.loops.get(scope);},async writeLoop(row){await db.open();await db.loops.put(row);},async all(){await db.open();const before=Date.now()-86400000;await checkpointer.prune(before);await db.loops.where('updatedAt').below(before).delete();await db.usage.filter(row=>(row.updatedAt ?? Math.max(0,...(row.calls || [])))<before).delete();return db.tasks.toArray();},async put(job){await db.open();await db.transaction('rw',db.tasks,async()=>{await db.tasks.put(job);const old=await db.tasks.where('createdAt').below(Date.now()-86400000).primaryKeys();await db.tasks.bulkDelete(old);const rows=await db.tasks.orderBy('createdAt').primaryKeys();if(rows.length>100)await db.tasks.bulkDelete(rows.slice(0,rows.length-100));});},
  async reserve(scope,limit=20,{lifetime=false}={}){await db.open();return db.transaction('rw',db.usage,async()=>{const now=Date.now(),old=await db.usage.get(scope),calls=(old?.calls || []).filter(at=>lifetime || now-at<3600000);if(calls.length>=limit)throw new Error(`后台研究${lifetime ? '单任务' : '每小时'}${limit}次调用额度已用完`);calls.push(now);await db.usage.put({scope,calls,updatedAt:now});});},close(){db.close();}};
}
