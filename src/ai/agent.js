import {subjectKeySchema,RESEARCH_BUDGETS} from './audience-profile.js';
import {makeAIRequest} from '../services/ai.js';
import {createResearchGraph,RESEARCH_INSTRUCTION} from './research-graph.js';
import {sourceExpiresAt} from '../services/web-knowledge.js';
import {relationshipEvidenceVersion,relationshipResearchSeed,relationshipResearchOptions,scopedRelationshipContext} from '../services/relationship-query.js';
import {createPublicDataClient} from '../services/public-data.js';
import {createWeatherClient} from '../services/weather.js';
import {createSearchClient,requestJSON} from '../services/search.js';
import {validateEndpoint} from '../services/ai.js';
import {validateSearchEndpoint} from '../services/search.js';
import {z} from 'zod';
import {validateMemory,MEMORY_DEFAULTS} from '../services/knowledge.js';
import {validateAssistant,ASSISTANT_DEFAULTS} from './assistant-config.js';
import {CONTEXT_DEFAULTS} from './context-policy.js';
const schema=z.strictObject({subject:subjectKeySchema.optional(),subjectEpoch:z.number().int().nonnegative().optional(),anchor:z.string().regex(/^\d{1,30}$/u),ai:z.record(z.string(),z.unknown()),context:z.record(z.string(),z.unknown()),sources:z.array(z.string().url().max(2000)).max(3).default([])});
export function validateAgentInput(input){
 const data=schema.parse(input),raw=data.ai;const endpoint=validateEndpoint(raw.endpoint);if(typeof raw.model!=='string' || !raw.model.trim() || raw.model.length>200)throw new Error('后台模型无效');
 let search={enabled:false};if(raw.search?.enabled){const value=raw.search;if(!Number.isInteger(value.maxResults) || value.maxResults<1 || value.maxResults>5)throw new Error('搜索来源数无效');search={enabled:true,provider:value.provider,endpoint:validateSearchEndpoint(value.endpoint,value.provider),maxResults:value.maxResults,maxPerHour:20};}
 const context={};for(const key of ['persona','knowledge','context','recentReplies','liveContext','mediaContext','accountContext','relationshipContext','now'])if(data.context[key]!==undefined)context[key]=data.context[key];
 return {anchor:data.anchor,...(data.subject ? {subject:data.subject,subjectEpoch:data.subjectEpoch} : {}),context,sources:data.sources,ai:{endpoint,model:raw.model,temperature:0.2,search,contextSources:z.object(Object.fromEntries(Object.keys(CONTEXT_DEFAULTS).map(key=>[key,z.boolean()]))).parse({...CONTEXT_DEFAULTS,...raw.contextSources}),memory:validateMemory(raw.memory || MEMORY_DEFAULTS),assistant:validateAssistant(raw.assistant || ASSISTANT_DEFAULTS),pipeline:{mode:'text',contextBudgetChars:24000}}};
}
export function createResearchAgent({tier='standard',profile,request,getKey,readPublicPage,reserve=async()=>{},reserveSearch=async()=>{},knowledge,relationships,checkpointer,guard=async()=>{}}){
 return async(job,{signal,checkpoint})=>{
  const data=validateAgentInput(job.input),limits=RESEARCH_BUDGETS[tier];if(!limits)throw Error('研究深度无效');
  const scopedLookup=relationships && (async query=>scopedRelationshipContext(await relationships(query,relationshipResearchOptions(data.context.relationshipContext)),data.context.relationshipContext));
  const current=async state=>{
   if(signal.aborted)throw Error('任务已取消');await guard();
   if(state?.sources?.some(row=>row.expiresAt && row.expiresAt<=Date.now()))throw Error('研究来源已过期，请重新提交');
   for(const row of state?.observations || [])if(row.action==='relationships' && !row.output?.error && scopedLookup && relationshipEvidenceVersion(row.output)!==relationshipEvidenceVersion(await scopedLookup(row.query)))throw Error('人物资料已变化，研究结果已作废');
  };
  await current();await checkpoint('context','读取当前有效知识与关系，恢复已落盘的研究步骤');
  const search=createSearchClient({request,getKey:endpoint=>getKey('search',endpoint)});
  const dated=(found,freshness='stable')=>({...found,results:(found.results || []).map(row=>{const at=found.searchedAt ?? Date.now();return {...row,at,expiresAt:sourceExpiresAt(`${job.question} ${found.query || ''}`,freshness,at)};})});
  const runtime=createResearchGraph({tier,checkpointer,checkpoint,guard:current,question:job.question,initialSources:data.sources,
   search:async query=>{await reserveSearch(job.scope);return dated(await search(query,data.ai.search,{signal,timeout:15000}));},
   read:async url=>{const page=await readPublicPage(url,signal),at=page.at ?? page.readAt ?? Date.now();return {...page,at,expiresAt:Math.min(Number.isFinite(page.expiresAt) ? page.expiresAt : Infinity,sourceExpiresAt(job.question,'stable',at))};},knowledge,relationships:scopedLookup,
   publicData:async call=>dated(await createPublicDataClient({request})(call,{signal,now:Date.now(),timeout:15000}),'realtime'),
   weather:async({action,...plan})=>dated(await createWeatherClient({request})({...plan,intent:'weather'},{signal,now:Date.now(),timeout:15000}),'realtime'),
   plan:async state=>{
    await reserve(job.scope);await current();
    const body=makeAIRequest({...data.context,task:{kind:'agent'},researchInstruction:RESEARCH_INSTRUCTION,target:{text:job.question,...(profile ? {profile} : {}),...((data.context.relationshipContext?.focus) ? {relationshipEvidence:relationshipResearchSeed(data.context.relationshipContext)} : {}),
     agent_state:{...state.workingContext,remainingModelCalls:limits.modelCalls-state.modelCalls,budget:limits}},maxLength:1000},data.ai);
    const result=await requestJSON(request,{url:data.ai.endpoint,key:getKey('ai',data.ai.endpoint),body,stream:body.stream,signal});
    const raw=result.choices?.[0]?.message?.content;if(typeof raw!=='string')throw Error('研究模型没有返回文本');return raw;
   }});
  const id=`research-v1:${job.scope}:${job.id || crypto.randomUUID()}`;
  const result=await runtime.run({id,signal});await current(result);await checkpoint('result','研究结果与原始来源已保存，前台可按问题检索原文');
  return {answer:result.answer,citationIndices:result.citationIndices,sources:result.sources,publicSources:result.publicSources,observations:result.observations,
   at:Date.now(),contextAt:data.context.now || null,modelCalls:result.modelCalls,stopReason:result.stopReason,runtime:'langgraph',researchTier:tier,coverage:'bounded public evidence; no automatic public posting; only source text may enter factual memory'};
 };
}
