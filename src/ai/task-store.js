import Dexie from 'dexie';
import {BrowserCheckpointSaver} from './checkpoint-store.js';
import {activeTask,retainTaskHistory} from './task-history.js';
export function createAgentTaskStore({indexedDB=globalThis.indexedDB,IDBKeyRange=globalThis.IDBKeyRange}={}){
 const db=new Dexie('douyin-live-ai-tasks',{indexedDB,IDBKeyRange});db.version(1).stores({tasks:'&id,scope,createdAt',usage:'&scope'});
 db.version(2).stores({checkpoints:'[thread+ns+id],[thread+ns],thread,at',checkpointWrites:'[thread+ns+checkpointId+task+index],[thread+ns+checkpointId],thread',loops:'&scope,updatedAt'});
 const checkpointer=new BrowserCheckpointSaver(db);
 return {checkpointer,async readLoop(scope){await db.open();return db.loops.get(scope);},async writeLoop(row){await db.open();await db.loops.put(row);},async all(){
  await db.open();const before=Date.now()-86400000,rows=await db.tasks.toArray(),unfinished=rows.filter(activeTask);
  const threads=new Set(unfinished.map(row=>`research-v1:${row.scope}:${row.id}`)),usage=new Set(unfinished.flatMap(row=>[`task:${row.scope}:${row.id}`,`task-search:${row.scope}:${row.id}`]));
  await checkpointer.prune(before,threads);
  await db.usage.filter(row=>!usage.has(row.scope) && (row.updatedAt ?? Math.max(0,...(row.calls || [])))<before).delete();return rows;
 },async put(job){await db.open();await db.transaction('rw',db.tasks,async()=>{
  await db.tasks.put(job);const rows=await db.tasks.toArray(),retained=new Set(retainTaskHistory(rows).map(row=>row.id));await db.tasks.bulkDelete(rows.filter(row=>!retained.has(row.id)).map(row=>row.id));
 });},
  async reserve(scope,limit=0,{lifetime=false}={}){if(!limit)return;await db.open();return db.transaction('rw',db.usage,async()=>{const now=Date.now(),old=await db.usage.get(scope),calls=(old?.calls || []).filter(at=>lifetime || now-at<3600000);if(calls.length>=limit)throw new Error(`后台研究${lifetime ? '单任务' : '每小时'}${limit}次调用额度已用完`);calls.push(now);await db.usage.put({scope,calls,updatedAt:now});});},close(){db.close();}};
}
