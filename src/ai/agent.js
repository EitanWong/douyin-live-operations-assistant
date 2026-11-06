import {createAIClient} from '../services/ai.js';
import {createSearchClient} from '../services/search.js';
import {validateEndpoint} from '../services/ai.js';
import {validateSearchEndpoint} from '../services/search.js';
import {z} from 'zod';
import {validateMemory,MEMORY_DEFAULTS} from '../services/knowledge.js';
import {validateAssistant,ASSISTANT_DEFAULTS} from './assistant-config.js';
import {CONTEXT_DEFAULTS} from './context-policy.js';
const schema=z.strictObject({anchor:z.string().regex(/^\d{1,30}$/u),ai:z.record(z.string(),z.unknown()),context:z.record(z.string(),z.unknown()),sources:z.array(z.string().url().max(2000)).max(3).default([])});
export function validateAgentInput(input){
 const data=schema.parse(input),raw=data.ai;const endpoint=validateEndpoint(raw.endpoint);if(typeof raw.model!=='string' || !raw.model.trim() || raw.model.length>200)throw new Error('后台模型无效');
 let search={enabled:false};if(raw.search?.enabled){const value=raw.search;if(!Number.isInteger(value.maxResults) || value.maxResults<1 || value.maxResults>5)throw new Error('搜索来源数无效');search={enabled:true,provider:value.provider,endpoint:validateSearchEndpoint(value.endpoint,value.provider),maxResults:value.maxResults,maxPerHour:20};}
 const context={};for(const key of ['persona','knowledge','context','recentReplies','liveContext','mediaContext','accountContext','relationshipContext','now'])if(data.context[key]!==undefined)context[key]=data.context[key];
 return {anchor:data.anchor,context,sources:data.sources,ai:{endpoint,model:raw.model,temperature:0.2,search,contextSources:z.object(Object.fromEntries(Object.keys(CONTEXT_DEFAULTS).map(key=>[key,z.boolean()]))).parse({...CONTEXT_DEFAULTS,...raw.contextSources}),memory:validateMemory(raw.memory || MEMORY_DEFAULTS),assistant:validateAssistant(raw.assistant || ASSISTANT_DEFAULTS),pipeline:{mode:'text',contextBudgetChars:24000}}};
}
// A bounded, read-only agent. Model planning cannot create tools, change URLs,
// send messages, manage viewers or write factual memories on its own.
export function createResearchAgent({request,getKey,readPublicPage,reserve=async()=>{}}){
 return async(job,{signal,checkpoint})=>{
  const data=validateAgentInput(job.input);await checkpoint('context','读取任务提交时的上下文快照与本地知识');
  const pages=[];for(const url of data.sources){if(signal.aborted)throw new Error('任务已取消');await checkpoint('public-source',new URL(url).hostname);try{const page=await readPublicPage(url,signal);pages.push({...page,text:page.text.slice(0,2000),truncated:page.text.length>2000});}catch(error){pages.push({url,error:error.message});}}
  const sources=[],citationIndices=[];let modelCalls=0;const metered=details=>{if(!['search','weather','public-data'].includes(details.operation)){modelCalls++;if(modelCalls>3)throw new Error('Agent模型调用预算已用完');}return request(details);};
  const search=createSearchClient({request:metered,getKey:endpoint=>getKey('search',endpoint)});
  const client=createAIClient({request:metered,getKey:endpoint=>getKey('ai',endpoint),search,
   onIntent:record=>{void checkpoint('plan',record.intent).catch(()=>{});},onSearch:record=>{sources.push(...(record.results || []));citationIndices.push(...(record.citationIndices || []));}});
  await reserve(job.scope);await checkpoint('agent','常规2次模型调用，超长时最多压缩1次；最多2次并行搜索；后台结果不发送公屏');
  const context=data.context;
  const prompt={...context,task:{kind:'agent',instruction:'后台研究当前问题；按已核实上下文回答，必要时搜索，缺资料明确说明。'},target:{text:job.question,public_sources:pages},maxLength:1000,signal,isCurrent:()=>!signal.aborted,
   canFollowup:()=>modelCalls<2};
  // Reserve the second model call before allowing a search follow-up. The
  // reservation is conservative: unused capacity is not refunded after failure.
  prompt.reserveFollowup=async()=>{if(modelCalls>=3)return false;if(modelCalls===2)await reserve(job.scope);return true;};
  await reserve(job.scope);
  const answer=await client(prompt,data.ai);if(signal.aborted)throw new Error('任务已取消');await checkpoint('result','保存带来源结果，等待用户核对');
  return {answer,citationIndices,sources:sources.slice(0,5),publicSources:pages,at:Date.now(),contextAt:context.now || null,modelCalls,coverage:'snapshot research; no automatic public posting or factual-memory write'};
 };
}
