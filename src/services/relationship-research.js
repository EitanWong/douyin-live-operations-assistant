import {resolveAITaskConfig} from './ai-task-config.js';
import {snapshotResearchContext} from '../ai/research-context.js';
const cancelled=()=>Object.assign(Error('后台研究已取消'),{name:'AbortError'});
function pause(signal){
 return new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(cancelled());};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},1000);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 });
}
// Reuse the host's durable LangGraph queue; the page only observes one receipt.
export function createRelationshipResearch({tasks,getConfig,getContext,isCurrent=()=>true}){
 return {async run({question,relationshipContext,context={},subject,subjectEpoch,sources=[],signal,onProgress=()=>{}}){
  const config=getConfig(),version=JSON.stringify([config.anchorId,config.ai]);
  if(!config.ai.enabled)throw Error('请先启用并保存 AI 设置。');
  const current=()=>!signal?.aborted && isCurrent() && version===JSON.stringify([getConfig().anchorId,getConfig().ai]);
  const transport=await tasks();if(!current())throw cancelled();
  const prompt=question,focus=relationshipContext?.focus;
  let id;
  const abort=()=>{if(id)void transport.cancel(id).catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try{
   const receipt=await transport.submit({id:crypto.randomUUID(),question:prompt,input:{anchor:config.anchorId,ai:resolveAITaskConfig(config.ai,'research'),...(subject ? {subject,subjectEpoch} : {}),context:snapshotResearchContext({...getContext(),...context,...(focus ? {relationshipContext:{focus}} : {})}),sources}});id=receipt.id;
   if(!current()){await transport.cancel(id);throw cancelled();}
   for(;;){
    const rows=await transport.list();if(!current())throw cancelled();
    const job=rows.find(row=>row.id===id);if(!job)throw Error('后台研究任务已不可用，请重新提交。');
    onProgress({trace:job.trace || [],status:job.status});
    if(job.status==='succeeded')return {...job.result,status:'succeeded',trace:job.trace || []};
    if(!['queued','running'].includes(job.status))throw Error(job.error || '后台研究未完成，请重新提交。');
    await pause(signal);if(!current())throw cancelled();
   }
  }catch(error){if(id && !current())await transport.cancel(id).catch(()=>{});throw error;}
  finally{signal?.removeEventListener('abort',abort);}
 }};
}
export const createBackgroundResearch=createRelationshipResearch;
