import {resolveAITaskConfig} from '../services/ai-task-config.js';
import {AgentHarness} from './harness.js';
import {createResearchAgent} from './agent.js';
import {readPublicPage} from './public-sources.js';
import {relationshipResearchOptions,scopedRelationshipContext} from '../services/relationship-query.js';
import {researchSettings,budgetReached} from './research-settings.js';
import {retainTaskHistory} from './task-history.js';
export function createLocalAgentTasks({room,anchor,request,getKey,get,set,publicReader,relationships,knowledge,saveSupplement}){
 const key=`live-assistant:ai-tasks:${room}`;let rows=get(key,[]) || [];const calls={model:[],search:[]};
 const store={all:async()=>rows,put:async job=>{rows=retainTaskHistory(rows.filter(r=>r.id!==job.id).concat(job));await set(key,rows);}};
 const reserve=(kind,field)=>async()=>{const limit=researchSettings(get(`live-assistant:config:${room}`,null)?.ai)[field];calls[kind]=calls[kind].filter(at=>Date.now()-at<3600000);if(budgetReached(calls[kind].length,limit))throw new Error('后台研究每小时额度已用完');if(limit)calls[kind].push(Date.now());};
 const research=createResearchAgent({request,getKey,relationships,knowledge,readPublicPage:publicReader || ((url,signal)=>readPublicPage(url,{authorized:async origin=>origin===globalThis.location?.origin,signal})),reserve:reserve('model','modelCallsPerHour'),reserveSearch:reserve('search','searchesPerHour')});
 const execute=async(job,options)=>{const current=get(`live-assistant:config:${room}`,null);if(!current?.ai?.enabled || String(current.anchorId)!==job.input.anchor)throw new Error('AI已关闭或主播已变化，请核对后重新提交');
  const context={...job.input.context},selection=context.relationshipContext;
  if(selection?.focus && relationships)context.relationshipContext=scopedRelationshipContext(await relationships(job.question,relationshipResearchOptions(selection)),selection);
  const result=await research({...job,input:{...job.input,context,ai:resolveAITaskConfig(current.ai,'research')}},options);
  if(job.input.supplement){
   if(!saveSupplement)throw Error('当前宿主不支持保存补充知识');options.signal.throwIfAborted();
   await saveSupplement(result.entries,current,options.signal);return {...result,knowledgeStored:true};
  }
  return result;};
 const harness=new AgentHarness({store,execute,concurrency:1});return {submit:job=>harness.submit({...job,scope:`${room}:${anchor()}`}),list:async()=>{await harness.ready;return harness.list(`${room}:${anchor()}`);},cancel:id=>harness.cancel(id,`${room}:${anchor()}`),close:()=>harness.close()};
}
