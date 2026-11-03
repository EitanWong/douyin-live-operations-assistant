import {createActor,fromPromise} from 'xstate';
import {z} from 'zod';
const inputSchema=z.strictObject({id:z.string().regex(/^[a-z\d-]{6,80}$/iu),scope:z.string().regex(/^[\w-]{1,40}:\d{1,30}$/u),question:z.string().trim().min(1).max(1000),input:z.record(z.string(),z.unknown())});
const storedSchema=inputSchema.extend({status:z.enum(['queued','running','succeeded','failed','cancelled','interrupted']),createdAt:z.number().finite(),updatedAt:z.number().finite().optional(),trace:z.array(z.object({step:z.string().max(80),detail:z.string().max(120),at:z.number().finite()})).max(20).default([]),result:z.unknown().optional(),error:z.string().max(300).optional()});
const terminal=new Set(['succeeded','failed','cancelled','interrupted']);
export class AgentHarness {
 constructor({store,execute,now=Date.now,timeoutMs=90000,concurrency=2}){Object.assign(this,{store,execute,now,timeoutMs,concurrency});this.jobs=new Map();this.active=new Map();this.closed=false;this.writes=Promise.resolve();this.operations=Promise.resolve();this.ready=this.restore();}
 save(job){const copy=structuredClone(job);const task=this.writes.catch(()=>{}).then(()=>this.store.put(copy));this.writes=task;return task;}
 async restore(){for(const stored of await this.store.all()){
   const parsed=storedSchema.safeParse(stored);if(!parsed.success)continue;const row=parsed.data;
   if(this.now()-row.createdAt>86400000 || row.createdAt>this.now()+5000)continue;
   if(row.status==='running'){row.status='interrupted';row.error='后台执行被中断，未自动重复模型调用；可重新提交';await this.save(row);}
   this.jobs.set(row.id,row);
  }queueMicrotask(()=>this.drain());}
 submit(input){const task=this.operations.catch(()=>{}).then(()=>this.submitOne(input));this.operations=task;return task;}
 async submitOne(input){await this.ready;if(this.closed)throw new Error('后台任务宿主已关闭');for(const [id,row] of this.jobs)if(terminal.has(row.status) && this.now()-row.createdAt>86400000)this.jobs.delete(id);const value=inputSchema.parse(input);if(JSON.stringify(value).length>80000)throw new Error('后台任务上下文超过容量');
  const old=this.jobs.get(value.id);if(old){if(old.scope!==value.scope)throw new Error('任务范围无效');return this.public(old);}
  if([...this.jobs.values()].filter(j=>!terminal.has(j.status)).length>=8)throw new Error('后台任务队列已满，请等待或取消任务');
  const job={...value,status:'queued',createdAt:this.now(),updatedAt:this.now(),trace:[]};await this.save(job);this.jobs.set(job.id,job);setTimeout(()=>this.drain(),0);return this.public(job);
 }
 public(job){const {input,...record}=job;return structuredClone(record);}
 list(scope){return [...this.jobs.values()].filter(j=>j.scope===scope).slice(-20).reverse().map(j=>this.public(j));}
 async cancel(id,scope){await this.ready;const job=this.jobs.get(id);if(!job || job.scope!==scope)throw new Error('任务范围无效');if(terminal.has(job.status))return this.public(job);
  job.status='cancelled';job.updatedAt=this.now();this.active.get(id)?.actor.stop();this.active.get(id)?.finish('cancelled');await this.save(job);return this.public(job);
 }
 drain(){if(this.closed)return;for(const job of this.jobs.values()){
   if(this.active.size>=this.concurrency)break;if(job.status!=='queued' || this.active.has(job.id))continue;
   if([...this.active.values()].some(item=>item.scope===job.scope))continue;
   void this.run(job);
  }}
 async run(job){
  const checkpoint=async(step,detail='')=>{if(job.status!=='running')return;job.trace.push({step,detail:String(detail).slice(0,120),at:this.now()});job.trace=job.trace.slice(-20);job.updatedAt=this.now();await this.save(job);};
  let timeout;const actor=createActor(fromPromise(async({signal})=>{
   await this.save(job);signal.throwIfAborted();return this.execute(structuredClone(job),{signal,checkpoint});
  }));job.status='running';job.updatedAt=this.now();
  const finish=async(status,value)=>{
   if(job.status==='running'){job.status=status;job.updatedAt=this.now();if(status==='succeeded')job.result=value;else job.error=String(value?.message || value).slice(0,300);try{await this.save(job);}catch{job.status='failed';job.error='任务结果保存失败';}}
   clearTimeout(timeout);this.active.delete(job.id);this.drain();
  };
  while(this.jobs.size>100){const old=[...this.jobs.values()].find(j=>terminal.has(j.status));if(!old)break;this.jobs.delete(old.id);}
  this.active.set(job.id,{actor,scope:job.scope,finish});
  actor.subscribe({next:s=>{if(s.status==='done')void finish('succeeded',s.output);},error:error=>void finish('failed',error)});
  timeout=setTimeout(()=>{actor.stop();void finish('failed',new Error('后台任务超过执行时限，已取消请求'));},this.timeoutMs);actor.start();
 }
 close(){this.closed=true;for(const {actor} of this.active.values())actor.stop();for(const item of this.active.values())item.finish('interrupted');this.active.clear();}
}
