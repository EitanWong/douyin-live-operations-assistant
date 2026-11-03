import {createAIClient} from './ai.js';
import {createResilientAI} from './ai-resilience.js';
import {resolveReplyConfig} from './ai-pipeline.js';
import {createLocalReply} from './local-search.js';
import {cleanMessage} from '../core/engine.js';
import {isIntrusiveReply} from '../core/reply-context.js';
import {DIRECT_TURN_INSTRUCTION,TURN_TAKING_INSTRUCTION} from '../ai/conversation-policy.js';

export const AI_TEST_CASES=Object.freeze([
 {id:'greeting',label:'日常对话',question:'你好，晚上好。',intents:['chat']},
 {id:'live-data',label:'直播数据',question:'本场已采集了多少礼物钻石？没有数据请直接说明。',intents:['live-data']},
 {id:'web-search',label:'联网知识',question:'请查证抖音直播PK活动的加成规则，结合来源回答，不能确认的部分请说明。',intents:['web-search','knowledge'],sources:true},
 {id:'clarify',label:'条件澄清',question:'帮我查明天天气，地点还没告诉你，请先问我。',intents:['clarify']}
]);

const fingerprint=c=>JSON.stringify([c.anchorId,c.ai,c.sending]);
const cancelled=()=>Object.assign(new Error('测试已取消或配置、直播间已变化'),{name:'AbortError'});
function replyChecks(result,config,testCase){
 const checked=cleanMessage(result.answer,config),skip=result.answer==='[SKIP]';
 const checks=[{label:skip ? '模型选择不回复' : checked.ok ? '回复通过公屏格式与长度检查' : checked.reason,pass:skip || checked.ok},
  {label:'没有代主持或劝留表达',pass:!isIntrusiveReply(result.answer)}];
 if(result.intent==='web-search' || result.intent==='knowledge'){
  const citations=[...result.answer.matchAll(/\[(\d+)\]/gu)].map(row=>Number(row[1]));
  checks.push({label:'答案引用本次提供的有效来源',pass:!result.searchError && citations.length>0 && citations.every(index=>result.sources.some(source=>source.index===index))});
 }
 if(testCase){
  checks.push({label:`场景意图符合预期（${testCase.label}）`,pass:testCase.intents.includes(result.intent)});
  if(testCase.sources)checks.push({label:'知识场景有可核对的来源',pass:result.sources.length>0});
 }
 return checks;
}

// A private preview client: shares reply/routing/search code, never the sender.
// Its counters, conversation and diagnostics are separate from live operations.
export function createAIPlayground({request,getKey,search,knowledge,edge,getConfig,getContext,isCurrent=()=>true,now=Date.now}){
 let busy=false,configVersion='',contextRevision=0;const calls={cloud:[],local:[]};
 const reserve=(kind,limit)=>{
  calls[kind]=calls[kind].filter(at=>now()-at<3600000);
  if(calls[kind].length>=limit)throw new Error(`${kind==='cloud' ? '云端' : '本地'}测试每小时额度已用完`);
  calls[kind].push(now());
 };
 return {async run({question,mode='direct',fresh=false,turns=[],signal,onProgress=()=>{},testCase}={}){
  if(typeof question!=='string' || !question.trim() || [...question.trim()].length>1000)throw new Error('请填写1–1000字的测试问题');
  if(!['direct','contextual'].includes(mode))throw new Error('测试问答模式无效');
  if(busy)throw new Error('已有测试进行中，请等待或取消');
  const config=structuredClone(getConfig()),version=fingerprint(config),started=now(),reply=resolveReplyConfig(config.ai);
  if(version!==configVersion){configVersion=version;contextRevision++;}
  busy=true;
  const result={question:question.trim(),mode,contextRevision,status:'running',answer:'',error:'',at:started,elapsedMs:0,intent:'',provider:'',model:reply.model,
   query:'',cached:false,searchedAt:null,sources:[],searchError:'',calls:{cloud:0,local:0},checks:[]};
  const current=()=>!signal?.aborted && isCurrent() && version===fingerprint(getConfig());
  const emit=progress=>{if(current())try{onProgress(progress);}catch{}};
  const context=()=>{
   const live=getContext(config),history=turns.filter(row=>row.contextRevision===contextRevision).slice(-6);
   return {...live,context:[...(live.context || []),...history.map(row=>({name:'测试提问',text:row.question,at:started}))],
    recentReplies:[...(live.recentReplies || []),...history.map(row=>row.answer)].slice(-10)};
  };
  const onIntent=row=>{result.intent=row.intent;emit({stage:'intent',intent:row.intent});};
  const onSearch=row=>{Object.assign(result,{query:row.query,cached:Boolean(row.cached),searchedAt:row.searchedAt ?? null,sources:structuredClone(row.results || []),searchError:row.error || ''});};
  const localReserve=()=>{reserve('local',config.ai.edge.maxPerHour);result.calls.local++;return true;};
  const readOnlyKnowledge=knowledge ? {revision:()=>knowledge.revision(),candidates:(...args)=>knowledge.candidates(...args),find:(...args)=>knowledge.find(...args),remember:async()=>{}} : undefined;
  const cloud=createAIClient({getKey,search,knowledge:readOnlyKnowledge,onIntent,onSearch,request:details=>{
   if(!current())throw cancelled();reserve('cloud',config.ai.maxPerHour);result.calls.cloud++;return request(details);
  }});
  const local=edge && {...edge,reply:createLocalReply({edge,search,knowledge:readOnlyKnowledge,onSearch,onIntent})};
  const client=createResilientAI({cloud,edge:local,now,onTrace:row=>{result.provider=row.provider;if(row.provider==='edge')result.model=`本地 · ${config.ai.edge.textModel}`;}});
  try{
   if(!current())throw cancelled();
   const initial=context();result.context={chat:initial.context?.length || 0,media:initial.mediaContext?.observations?.length || 0,knowledge:config.ai.memory.enabled};
   emit({stage:'model'});
   const output=await client({...initial,getAIContext:context,persona:config.ai.persona,knowledge:config.ai.knowledge,signal,isCurrent:current,
    target:{type:'chat',name:'测试提问',address:'测试提问',text:result.question},task:{kind:'ai',instruction:mode==='direct' ? DIRECT_TURN_INSTRUCTION : TURN_TAKING_INSTRUCTION,data:{replyMode:mode}},
    maxLength:config.sending.maxLength,reserveLocal:localReserve,
    onLookup:row=>{result.query=row.query;emit({stage:'search',query:row.query});}
   },fresh ? {...config.ai,search:{...config.ai.search,rememberKnowledge:false}} : config.ai);
   if(!current())throw cancelled();
   result.answer=output;result.status=output==='[SKIP]' ? 'skipped' : 'succeeded';result.checks=replyChecks(result,config,testCase);
  }catch(error){result.status=error.name==='AbortError' || !current() ? 'cancelled' : 'failed';result.error=error.message;}
  finally{result.elapsedMs=now()-started;busy=false;}
  return result;
 }};
}
