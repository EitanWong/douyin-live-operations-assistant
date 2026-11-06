import {aiContextQuery} from './ai-context.js';
const cancelled=()=>Object.assign(Error('人物资料查询已取消'),{name:'AbortError'});
export const relationshipEvidenceVersion=graph=>JSON.stringify([graph?.entities,graph?.relations,graph?.ambiguities,graph?.sources],function(key,value){return key==='at' && this?.source==='运营本场资料' ? 0 : value;});
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
  if(remote && (graph?.sources?.chunks?.length || graph?.relations?.length || graph?.entities?.some(node=>node.evidence?.length))){
   const latest=await query(question);if(!current())throw cancelled();
   if(relationshipEvidenceVersion(graph)!==relationshipEvidenceVersion(latest))throw Error('人物资料已变化，本次回答已作废，请重新查询');
  }
  return output;
 };
}
