export const activeTask=job=>['queued','running'].includes(job.status) || job.status==='interrupted' && job.runtime==='langgraph-v1';

// Retention limits apply to completed history, never to unfinished work.
export function retainTaskHistory(rows,now=Date.now()){
 const finished=new Set(rows.filter(row=>!activeTask(row) && now-row.createdAt<86400000).toSorted((a,b)=>a.createdAt-b.createdAt).slice(-100).map(row=>row.id));
 return rows.filter(row=>activeTask(row) || finished.has(row.id));
}
