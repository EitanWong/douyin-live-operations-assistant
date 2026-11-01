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
