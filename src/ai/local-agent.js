import {resolveReplyConfig} from '../services/ai-pipeline.js';
import {AgentHarness} from './harness.js';
import {createResearchAgent} from './agent.js';
import {readPublicPage} from './public-sources.js';
import {relationshipResearchOptions,scopedRelationshipContext} from '../services/relationship-query.js';
export function createLocalAgentTasks({room,anchor,request,getKey,get,set,publicReader,relationships,knowledge}){
 const key=`live-assistant:ai-tasks:${room}`;let rows=get(key,[]) || [],calls=[];
 const store={all:async()=>rows,put:async job=>{rows=rows.filter(r=>r.id!==job.id && Date.now()-r.createdAt<86400000).concat(job).slice(-30);await set(key,rows);}};
 const research=createResearchAgent({request,getKey,relationships,knowledge,readPublicPage:publicReader || ((url,signal)=>readPublicPage(url,{authorized:async origin=>origin===globalThis.location?.origin,signal})),reserve:async()=>{calls=calls.filter(at=>Date.now()-at<3600000);if(calls.length>=20)throw new Error('后台研究每小时额度已用完');calls.push(Date.now());}});
 const execute=async(job,options)=>{const current=get(`live-assistant:config:${room}`,null);if(!current?.ai?.enabled || String(current.anchorId)!==job.input.anchor)throw new Error('AI已关闭或主播已变化，请核对后重新提交');
  const context={...job.input.context},selection=context.relationshipContext;
  if(selection?.focus && relationships)context.relationshipContext=scopedRelationshipContext(await relationships(job.question,relationshipResearchOptions(selection)),selection);
  return research({...job,input:{...job.input,context,ai:resolveReplyConfig(current.ai)}},options);};
 const harness=new AgentHarness({store,execute,concurrency:1});return {submit:job=>harness.submit({...job,scope:`${room}:${anchor()}`}),list:async()=>{await harness.ready;return harness.list(`${room}:${anchor()}`);},cancel:id=>harness.cancel(id,`${room}:${anchor()}`),close:()=>harness.close()};
}
