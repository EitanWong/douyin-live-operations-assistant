import {createAIClient} from './ai.js';
import {createResilientAI} from './ai-resilience.js';
import {resolveReplyConfig} from './ai-pipeline.js';
import {createLocalReply} from './local-search.js';
import {cleanMessage} from '../core/engine.js';
import {isIntrusiveReply} from '../core/reply-context.js';
import {DIRECT_TURN_INSTRUCTION,TURN_TAKING_INSTRUCTION} from '../ai/conversation-policy.js';
import {evaluateReply} from '../ai/reply-evaluation.js';
import {researchSettings,budgetReached} from '../ai/research-settings.js';
import {resolveAITaskConfig} from './ai-task-config.js';
export {AI_TEST_CASES} from '../ai/reply-evaluation.js';

const fingerprint=c=>JSON.stringify([c.anchorId,c.ai,c.sending]);
const cancelled=()=>Object.assign(new Error('测试已取消或配置、直播间已变化'),{name:'AbortError'});
function replyChecks(result,config,testCase){
 if(result.mode==='relationships')return [{label:'工作台回答在1200字以内',pass:Boolean(result.answer.trim()) && [...result.answer].length<=1200}];
 const checked=cleanMessage(result.answer,config),skip=result.answer==='[SKIP]';
 const checks=[{label:skip ? '模型选择不回复' : checked.ok ? '回复通过公屏格式与长度检查' : checked.reason,pass:skip || checked.ok},
  {label:'没有代主持或劝留表达',pass:!isIntrusiveReply(result.answer)}];
 if(['web-search','knowledge','weather','public-data'].includes(result.intent)){
  const citations=result.citationIndices;
  checks.push({label:'答案引用本次提供的有效来源',pass:!result.searchError && citations.length>0 && citations.every(index=>result.sources.some(source=>source.index===index))});
 }
 if(testCase){
  checks.push({label:`场景意图符合预期（${testCase.label}）`,pass:testCase.intents.includes(result.intent)});
  if(testCase.sources)checks.push({label:'知识场景有可核对的来源',pass:result.sources.length>0});
  checks.push(...evaluateReply(result,testCase));
 }
 return checks;
}

// A private preview client: shares reply/routing/search code, never the sender.
// Its counters, conversation and diagnostics are separate from live operations.
export function createAIPlayground({request,getKey,search,research,knowledge,edge,getConfig,getContext,isCurrent=()=>true,now=Date.now}){
 let busy=false,configVersion='',contextRevision=0;const calls={cloud:[],local:[],background:[]};
 const reserve=(kind,limit)=>{
  calls[kind]=calls[kind].filter(at=>now()-at<3600000);
  if(budgetReached(calls[kind].length,limit))throw new Error(`${kind==='background' ? '后台' : kind==='cloud' ? '云端' : '本地'}测试每小时额度已用完`);
  calls[kind].push(now());
 };
 return {async run({question,mode='direct',fresh=false,turns=[],signal,onProgress=()=>{},testCase,relationshipContext}={}){
  if(typeof question!=='string' || !question.trim() || [...question.trim()].length>1000)throw new Error('请填写1–1000字的测试问题');
  if(!['direct','contextual','relationships'].includes(mode))throw new Error('测试问答模式无效');
  if(mode==='relationships' && !Array.isArray(relationshipContext?.entities))throw new Error('关系问答需要当前人物证据');
  if(busy)throw new Error('已有测试进行中，请等待或取消');
  const config=structuredClone(getConfig()),version=fingerprint(config),started=now(),controlled=testCase?.fixture;
  if(controlled)config.ai={...config.ai,knowledge:'',memory:{...config.ai.memory,enabled:false},search:{...config.ai.search,enabled:true,rememberKnowledge:false}};
  const reply=resolveReplyConfig(config.ai);
  if(version!==configVersion){configVersion=version;contextRevision++;}
  busy=true;
  const result={question:question.trim(),mode,contextRevision,status:'running',answer:'',error:'',at:started,elapsedMs:0,intent:'',provider:'',model:reply.model,controlled:Boolean(controlled),
   query:'',cached:false,searchedAt:null,sources:[],queries:[],sourceReview:[],excludedSources:[],citationIndices:[],searchError:'',citationWarning:'',calls:{cloud:0,local:0},checks:[],trace:[]};
  const current=()=>!signal?.aborted && isCurrent() && version===fingerprint(getConfig());
  const emit=progress=>{if(current())try{onProgress({...progress,trace:structuredClone(result.trace)});}catch{}};
  const record=(stage,label,detail='',status='succeeded')=>{
   result.trace.push({stage,label,detail,status,elapsedMs:now()-started});
   emit({stage,intent:result.intent,query:result.query});
  };
  const context=()=>{
   const live=controlled ? structuredClone(controlled.context) : getContext(config),history=controlled ? [] : turns.filter(row=>row.contextRevision===contextRevision).slice(-6);
   return {...live,context:[...(live.context || []),...history.map(row=>({name:'测试提问',text:row.question,at:started}))],
    recentReplies:[...(live.recentReplies || []),...history.map(row=>row.answer)].slice(-10)};
  };
  const onIntent=row=>{result.intent=row.intent;record('intent','识别提问意图',row.intent);};
  const onSearch=row=>{
   Object.assign(result,{query:row.query,cached:Boolean(row.cached),searchedAt:row.searchedAt ?? null,sources:structuredClone(row.results || []),queries:structuredClone(row.searches || []),sourceReview:structuredClone(row.evidence || []),excludedSources:structuredClone(row.excluded || []),citationIndices:[...(row.citationIndices || [])],searchError:row.error || '',citationWarning:row.citationWarning || ''});
   if(row.topic==='live-pk')record('verification','核对资料范围',`${row.searches?.length || 0}组查询，${row.results?.length || 0}条适用来源，排除${row.excluded?.length || 0}条不适用资料`);
  };
  const sources=found=>{if(found)record('sources',found.cached ? '读取有效缓存' : '取得搜索资料',`${found.results?.length || 0} 条来源${found.error ? ` · ${found.error}` : ''}`,found.error ? 'warning' : 'succeeded');return found;};
  const localReserve=()=>{reserve('local',config.ai.edge.maxPerHour);result.calls.local++;record('model','调用本地模型',config.ai.edge.textModel,'running');return true;};
  const readOnlyKnowledge=knowledge ? {revision:()=>knowledge.revision(),candidates:(...args)=>knowledge.candidates(...args),find:async(...args)=>sources(await knowledge.find(...args)),remember:async()=>{}} : undefined;
  const lookup=controlled || search ? async(...args)=>{
   try{return sources(controlled ? {query:args[0],searchedAt:now(),results:structuredClone(controlled.sources)} : await search(...args));}
   catch(error){record('sources','搜索未完成',error.message,'warning');throw error;}
  } : undefined;
  const previewResearch=controlled || !research ? undefined : args=>research({...args,request:details=>{
   if(!current())throw cancelled();
   if(!['search','weather','public-data'].includes(details.operation)){
    reserve('background',researchSettings(config.ai).modelCallsPerHour);result.calls.cloud++;result.calls.background=(result.calls.background || 0)+1;
    record('model','调用后台研究模型',resolveAITaskConfig(config.ai,'research').model,'running');
   }
   return request(details);
  }});
  const cloud=createAIClient({getKey,search:lookup,research:previewResearch,knowledge:readOnlyKnowledge,onIntent,onSearch,request:details=>{
   if(['weather','public-data'].includes(details.operation))return request(details);
   if(!current())throw cancelled();reserve('cloud',config.ai.maxPerHour);result.calls.cloud++;record('model',result.intent ? '根据资料整理答案' : '调用回复模型',reply.model,'running');return request(details);
  }});
  const local=edge && {...edge,reply:createLocalReply({edge,request,search:lookup,research:previewResearch,knowledge:readOnlyKnowledge,onSearch,onIntent})};
  const client=createResilientAI({cloud,edge:local,now,onTrace:row=>{result.provider=row.provider;if(row.provider==='edge')result.model=`本地 · ${config.ai.edge.textModel}`;record('provider','模型执行结果',`${row.provider==='edge' ? '本地' : '云端'} · ${{ok:'已完成',timeout:'超时',unavailable:'不可用'}[row.status] || row.status}`,row.status==='ok' ? 'succeeded' : 'warning');}});
  try{
   if(!current())throw cancelled();
   const initial=context();result.context={chat:initial.context?.length || 0,media:initial.mediaContext?.observations?.length || 0,knowledge:config.ai.memory.enabled};
   record('context','准备测试上下文',`${result.context.chat} 条对话 · ${result.context.media} 条音画观察 · 知识库${result.context.knowledge ? '开启' : '关闭'}`);
   const output=await client({...initial,getAIContext:context,persona:config.ai.persona,knowledge:config.ai.knowledge,signal,isCurrent:current,
    ...(mode==='relationships' ? {getRelationshipContext:()=>relationshipContext,relationshipContext} : {}),
    target:{type:'chat',name:'测试提问',address:'测试提问',text:result.question},task:{kind:'ai',instruction:mode==='relationships' ? '面向操作者梳理人际关系，只使用提供的人物和原话证据。优先围绕relationships.focus中的人物，区分核实、自述、互动与冲突。先列直接关系和依据，再说明连接路径与未知；路径不能推导直接关系，未找到不能编造。回答仅在工作台展示。' : mode==='direct' ? DIRECT_TURN_INSTRUCTION : TURN_TAKING_INSTRUCTION,data:{replyMode:mode}},
    maxLength:mode==='relationships' ? 1200 : config.sending.maxLength,reserveLocal:localReserve,
    onLookup:row=>{result.query=row.query;record('search',controlled ? '读取固定评测资料' : '联网查证',row.query,'running');}
   },fresh ? {...config.ai,search:{...config.ai.search,rememberKnowledge:false}} : config.ai);
   if(!current())throw cancelled();
   result.answer=output;result.status=output==='[SKIP]' ? 'skipped' : 'succeeded';result.checks=replyChecks(result,config,testCase);
   record('checks','格式与来源检查',`${result.checks.filter(row=>row.pass).length}/${result.checks.length} 项通过`,result.checks.every(row=>row.pass) ? 'succeeded' : 'warning');
   record('complete',result.status==='skipped' ? '本次选择不回复' : '生成最终答案','仅展示在测试页，不发送公屏');
  }catch(error){result.status=error.name==='AbortError' || !current() ? 'cancelled' : 'failed';result.error=error.message;record(result.status,result.status==='cancelled' ? '测试已取消' : '测试未完成',error.message,result.status);}
  finally{result.elapsedMs=now()-started;busy=false;}
  return result;
 }};
}
