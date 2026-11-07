import {aiContextQuery} from './ai-context.js';
const cancelled=()=>Object.assign(Error('人物资料查询已取消'),{name:'AbortError'});
// The answer retains every selected relationship, conflict and identity boundary.
// Rich dossiers are only needed for the selected people, not every neighbour.
export function relationshipAnswerContext(graph,focus){
 const chosen=new Set(focus.entityIds.length ? focus.entityIds : graph.entities.slice(0,3).map(n=>n.id));
 return {...graph,focus,entities:graph.entities.map(({dossier,...person})=>({...person,...(chosen.has(person.id) && dossier ? {dossier} : {})})),coverage:`${graph.coverage || ''}; detailed dossiers limited to focused people; absent details remain unknown`};
}
export function relationshipResearchOptions(context){
 const focus=context?.focus;
 if(!focus || !['single','group','global'].includes(focus.scope))return {};
 return {browse:true,...(context.deduplication?.enabled ? {deduplicate:true} : {}),overview:focus.scope==='global',entityIds:Array.isArray(focus.entityIds) ? focus.entityIds.filter(id=>typeof id==='string' && id.startsWith('person:')).slice(0,6) : []};
}
export function scopedRelationshipContext(graph,context){
 if(!context?.focus)return graph;
 const focus=context.focus,ids=graph.entities.filter(n=>focus.entityIds?.includes(n.id)).map(n=>n.id);
 if(focus.scope!=='global' && ids.length!==new Set(focus.entityIds).size)throw Error('选定人物已不在当前资料中，请重新选择。');
 return relationshipAnswerContext(graph,{scope:focus.scope,entityIds:ids,names:graph.entities.filter(n=>ids.includes(n.id)).map(n=>n.name)});
}
// Preserve a small evidence seed in the fixed research target even when the
// optional full graph exceeds the model context budget. Tools can expand it.
export function relationshipResearchSeed(graph){
 if(!graph?.focus)return undefined;
 const focus=graph.focus,chosen=new Set(focus.entityIds),names=new Map(graph.entities.map(n=>[n.id,n.name]));
 const people=graph.entities.filter(n=>!chosen.size || chosen.has(n.id)).slice(0,6).map(n=>({id:n.id,name:n.name,role:n.role,facets:(n.dossier?.facets || []).slice(0,2),events:(n.dossier?.events || []).slice(0,1)}));
 const relevant=graph.relations.filter(r=>!chosen.size || chosen.has(r.from) || chosen.has(r.to)).toSorted((a,b)=>Number(b.status==='conflicted')-Number(a.status==='conflicted'));
 const relations=relevant.slice(0,12).map(r=>({from:names.get(r.from),to:names.get(r.to),predicate:r.predicate,negative:r.negative,status:r.status,evidence:r.evidence?.slice(0,1)}));
 const seed={focus,people,relations,...(graph.deduplication?.enabled ? {deduplication:{enabled:true}} : {}),coverage:'Selected evidence seed only; query relationships and knowledge for omitted records. Absence remains unknown.',omittedRelations:graph.relations.length-relations.length};
 for(const person of people)for(const field of ['events','facets'])while(JSON.stringify(seed).length>6000 && person[field].length)person[field].pop();
 while(JSON.stringify(seed).length>6000 && relations.length){relations.pop();seed.omittedRelations++;}
 return seed;
}
export const relationshipEvidenceVersion=graph=>JSON.stringify([graph?.entities,graph?.relations,graph?.ambiguities,graph?.sources,graph?.deduplication],function(key,value){
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
