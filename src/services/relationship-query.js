import {aiContextQuery} from './ai-context.js';
const cancelled=()=>Object.assign(Error('人物资料查询已取消'),{name:'AbortError'});
// The answer retains every selected relationship, conflict and identity boundary.
// Rich dossiers are only needed for the selected people, not every neighbour.
export function relationshipAnswerContext(graph,focus){
 const chosen=new Set(focus.entityIds.length ? focus.entityIds : graph.entities.slice(0,3).map(n=>n.id));
 return {...graph,focus,entities:graph.entities.map(({dossier,...person})=>({...person,...(chosen.has(person.id) && dossier ? {dossier} : {})})),coverage:`${graph.coverage || ''}; detailed dossiers limited to focused people; absent details remain unknown`};
}
export const relationshipEvidenceVersion=graph=>JSON.stringify([graph?.entities,graph?.relations,graph?.ambiguities,graph?.sources],function(key,value){
 if(key==='at' && this?.source==='运营本场资料' || ['from','through'].includes(key) && this?.basis==='deduplicated observed gifts in this room over 30 days; lower bound, not lifetime spending')return 0;
 return value;
});
export function withRelationshipEvidence({reply,query,persist}){
 return async(prompt,config)=>{
  const current=()=>!prompt.signal?.aborted && (!prompt.isCurrent || prompt.isCurrent());
  if(!current())throw cancelled();
  const question=aiContextQuery(prompt);
  if(!query || !question || config.assistant?.memoryEnabled===false)return reply(prompt,config);
  await persist();if(!current())throw cancelled();
  let graph,remote=true;
  try{graph=await query(question);}catch{
   if(!current())throw cancelled();
   remote=false;const local=prompt.getRelationshipContext?.(question);
   graph=local ? {...local,coverage:`${local.coverage}; cross-room query unavailable, current room only`} : null;
  }
  if(!current())throw cancelled();
  const output=await reply({...prompt,getRelationshipContext:q=>q===question ? graph : prompt.getRelationshipContext?.(q)},config);
  if(!current())throw cancelled();
  if(remote && (graph?.sources?.chunks?.length || graph?.relations?.length || graph?.entities?.some(node=>node.evidence?.length || node.dossier))){
   const latest=await query(question);if(!current())throw cancelled();
   if(relationshipEvidenceVersion(graph)!==relationshipEvidenceVersion(latest))throw Error('人物资料已变化，本次回答已作废，请重新查询');
  }
  return output;
 };
}
