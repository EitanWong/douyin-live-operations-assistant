import {retrieveMemories} from './knowledge.js';
import {DOUYIN_RULES} from '../data/douyin-rules.js';

export function currentAIPrompt(prompt) {
  const current=prompt.getAIContext?.();
  return current ? {...prompt,liveContext:current.liveContext,context:current.context,recentReplies:current.recentReplies,mediaContext:current.mediaContext} : prompt;
}

export function assembleAIContext(prompt,config) {
  const now=prompt.getNow?.() ?? prompt.now ?? Date.now();
  const media=prompt.task?.kind==='moderation' ? null : typeof prompt.getMediaContext==='function' ? prompt.getMediaContext() : prompt.mediaContext || null;
  const contextQuery=[...(prompt.context || []).slice(-4).map(row=>row.text),...(media?.observations || []).slice(-3).map(row=>row.text)].join(' ').slice(-2400);
  const query=String(prompt.target?.text || prompt.task?.instruction || prompt.task?.data?.reference || '').slice(0,2000);
  const retrieval=retrieveMemories(config.memory,query,now,{contextQuery});
  // Keep the established memories field; serialize each passage only once.
  const {chunks,...retrievalMeta}=retrieval;
  const memories=chunks.map(row=>({...row,id:row.entryId,chunkId:row.id}));
  return {
    evidence_context:{at:now,rules:DOUYIN_RULES,sessionKnowledge:prompt.knowledge || '',memories,retrieval:retrievalMeta},
    media_context:media,
    context_meta:{schemaVersion:1,assembledAt:now,liveObservedAt:prompt.liveContext?.observedAt ?? null,
      sourcePolicy:'Current structured live observations for metrics; media recognition for sampled scene clues; local passages for background; web results for external facts. Conflicts and missing evidence stay unknown.',
      knowledgeMethod:retrieval.method,mediaCoverage:media?.coverage || null}
  };
}

// Trim whole optional records, retaining valid JSON and the task's fixed facts.
export function applyContextBudget(input,limit){
  const data=structuredClone(input),omissions=[];
  data.context_meta ??={};data.context_meta.budget={unit:'characters',limit,omissions};
  const size=()=>JSON.stringify(data).length;
  const candidates=(value,path=[],out=[])=>{
    if(!value || typeof value!=='object')return out;
    for(const [key,child] of Object.entries(value)){
      const next=[...path,key];if(next[0]==='target' || next[0]==='data' || next.join('.')==='context_meta.budget')continue;
      if(Array.isArray(child) && child.length)out.push({parent:value,key,path:next.join('.'),chars:JSON.stringify(child).length});
      else if(child && typeof child==='object')candidates(child,next,out);
    }return out;
  };
  for(let iteration=0;size()>limit && iteration<200;iteration++){
    const row=candidates(data).sort((a,b)=>b.chars-a.chars)[0];
    if(row){
      const before=row.parent[row.key],count=Math.max(1,Math.ceil(before.length/2));
      row.parent[row.key]=['recent_chat','recent_replies','recentChat'].includes(row.key) ? before.slice(count) : before.slice(0,before.length-count);
      const existing=omissions.find(value=>value.path===row.path);if(existing)existing.removedRecords+=count;else omissions.push({path:row.path,removedRecords:count});
    }else if(data.evidence_context?.sessionKnowledge){const text=data.evidence_context.sessionKnowledge;data.evidence_context.sessionKnowledge='';omissions.push({path:'evidence_context.sessionKnowledge',removedChars:text.length});}
    else throw new Error('固定任务与汇总事实超过上下文预算，请缩短任务资料或提高上下文预算');
  }
  if(size()>limit)throw new Error('上下文超过字符预算');
  return data;
}

// Stable aggregate facts only: new chat, elapsed clocks and sampled histories do not invalidate a reply.
export function liveFactFingerprint(context){
  const roots=['roomStats','audience','income','giftHistory','pk','pkHistory','tasks','exhibition','rank'];
  const ignored=/^(?:at|.*At|.*AgeMs|duration.*|remainingMs|selfSpeed|opponentSpeed|selfVelocity60|opponentVelocity60|estimates|dataQuality|chatSignals|contributorActivity|effectHistory|activity|basis|sampleBasis|.*Coverage)$/u;
  const stable=value=>{
    if(Array.isArray(value))return undefined;
    if(!value || typeof value!=='object')return value;
    return Object.fromEntries(Object.keys(value).sort().filter(key=>!ignored.test(key) && !Array.isArray(value[key])).map(key=>[key,stable(value[key])]));
  };
  return JSON.stringify(Object.fromEntries(roots.map(key=>[key,stable(context?.[key] ?? null)])));
}
