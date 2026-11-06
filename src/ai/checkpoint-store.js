import {BaseCheckpointSaver,WRITES_IDX_MAP,compareWritesSortKeys} from '@langchain/langgraph-checkpoint';

const keys=config=>{const c=config.configurable || {};if(typeof c.thread_id!=='string' || !c.thread_id || c.thread_id.length>200)throw Error('研究检查点范围无效');return [c.thread_id,c.checkpoint_ns || '',c.checkpoint_id];};
const configFor=(thread,ns,id)=>({configurable:{thread_id:thread,checkpoint_ns:ns,checkpoint_id:id}});

// All graph channels are structured-cloneable domain records. IndexedDB stores
// full checkpoints plus native LangGraph pending writes, without provider keys.
export class BrowserCheckpointSaver extends BaseCheckpointSaver {
 constructor(db){super();this.db=db;}
 async getTuple(config){
  await this.db.open();const [thread,ns,id]=keys(config);
  const rows=id ? [await this.db.checkpoints.get([thread,ns,id])] : await this.db.checkpoints.where('[thread+ns]').equals([thread,ns]).toArray();
  const row=rows.filter(Boolean).sort((a,b)=>b.id.localeCompare(a.id))[0];if(!row)return undefined;
  const writes=await this.db.checkpointWrites.where('[thread+ns+checkpointId]').equals([thread,ns,row.id]).toArray();
  writes.sort((a,b)=>compareWritesSortKeys([a.path,a.task,a.index],[b.path,b.task,b.index]));
  return {config:configFor(thread,ns,row.id),checkpoint:row.checkpoint,metadata:row.metadata,
   ...(row.parent ? {parentConfig:configFor(thread,ns,row.parent)} : {}),pendingWrites:writes.map(r=>[r.task,r.channel,r.value])};
 }
 async *list(config,options={}){
  await this.db.open();const [thread,ns]=keys(config);
  let rows=(await this.db.checkpoints.where('[thread+ns]').equals([thread,ns]).toArray()).sort((a,b)=>b.id.localeCompare(a.id));
  if(options.before?.configurable?.checkpoint_id)rows=rows.filter(r=>r.id<options.before.configurable.checkpoint_id);
  if(options.filter)rows=rows.filter(r=>Object.entries(options.filter).every(([key,value])=>r.metadata[key]===value));
  for(const row of rows.slice(0,options.limit ?? rows.length))yield await this.getTuple(configFor(thread,ns,row.id));
 }
 async put(config,checkpoint,metadata){
  await this.db.open();const [thread,ns,parent]=keys(config);
  await this.db.checkpoints.put({thread,ns,id:checkpoint.id,parent,checkpoint:structuredClone(checkpoint),metadata:structuredClone(metadata),at:Date.now()});
  return configFor(thread,ns,checkpoint.id);
 }
 async putWrites(config,writes,task,path=''){
  await this.db.open();const [thread,ns,checkpointId]=keys(config);
  if(!checkpointId)throw Error('研究检查点编号缺失');
  await this.db.transaction('rw',this.db.checkpointWrites,async()=>{
   for(let i=0;i<writes.length;i++){
    const [channel,value]=writes[i],index=WRITES_IDX_MAP[channel] ?? i,key=[thread,ns,checkpointId,task,index];
    if(index>=0 && await this.db.checkpointWrites.get(key))continue;
    await this.db.checkpointWrites.put({thread,ns,checkpointId,task,index,path,channel,value:structuredClone(value)});
   }
  });
 }
 async deleteThread(thread){
  await this.db.open();await this.db.transaction('rw',this.db.checkpoints,this.db.checkpointWrites,async()=>{
   await this.db.checkpoints.where('thread').equals(thread).delete();await this.db.checkpointWrites.where('thread').equals(thread).delete();
  });
 }
 async prune(before){
  await this.db.open();const expired=await this.db.checkpoints.where('at').below(before).toArray();
  for(const thread of new Set(expired.map(r=>r.thread)))await this.deleteThread(thread);
 }
}
