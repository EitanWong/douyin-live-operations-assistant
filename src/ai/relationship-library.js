import {parseKnowledgeCorpus} from './knowledge-corpus.js';
import {AudienceMemory} from './audience-memory.js';
import {PerceptionMemory} from './live-memory.js';
import {AccountContext} from './account-context.js';
import {createRelationshipRetriever} from './relationship-memory.js';

// Query durable sources in the background. Never copy other rooms' mutable
// archives into a live page or create a competing graph database writer.
export function createRelationshipLibrary({all,now=Date.now}){
 const retrieve=createRelationshipRetriever();
 return {async query(room,query,override={},options={}){
  if(typeof query!=='string' || !query.trim() && !options.browse || query.length>2000)throw Error('人物问题需为1–2000字');
  const values=await all(),current=values[`live-assistant:config:${room}`],scopes=[],skipped=[];
  if(current?.ai?.assistant?.memoryEnabled===false)return retrieve({scopes:[],now:now()},query);
  const archives=new Map(Object.entries(values).filter(([key])=>key.startsWith('live-assistant:live-memory:')));
  for(const [key,config] of Object.entries(values))if(/^live-assistant:config:\d+$/u.test(key)){
   const sourceRoom=key.split(':').at(-1),snapshot=values[`live-assistant:runtime:${sourceRoom}`]?.accountSources;
   for(const anchor of new Set([String(config?.anchorId || ''),...(snapshot?.rows || []),...(snapshot?.history || [])].map(row=>typeof row==='string' ? row : row.anchor))){
    if(!/^\d{1,40}$/u.test(anchor))continue;
    const archiveKey=`live-assistant:live-memory:${sourceRoom}:${anchor}`;
    if(!archives.has(archiveKey))archives.set(archiveKey,{version:1,anchor,audience:{version:2,anchor,viewers:[]},perception:{observations:[],forgetBefore:0}});
   }
  }
  for(const [key,saved] of archives){
   const match=key.match(/^live-assistant:live-memory:(\d+):(\d{1,40})$/u);if(!match)continue;
   const [,sourceRoom,anchor]=match,config=values[`live-assistant:config:${sourceRoom}`],ai=config?.ai || {};
   if(ai.assistant?.memoryEnabled===false)continue;
   try{
    if(saved?.version!==1 || saved.anchor!==anchor || saved.audience?.anchor!==anchor)throw Error('scope');
    const selected=sourceRoom===String(room) && anchor===String(current?.anchorId),active=anchor===String(config?.anchorId);
    const audience=current?.ai?.contextSources?.audience!==false && ai.contextSources?.audience!==false ? new AudienceMemory({anchor,state:saved.audience,now}) : undefined;
    const accounts=new AccountContext({snapshot:values[`live-assistant:runtime:${sourceRoom}`]?.accountSources,now});
    const profile=values[`live-assistant:profile:${sourceRoom}`];
    scopes.push({room:sourceRoom,anchor,audience,perception:new PerceptionMemory({state:saved.perception,now}),
     anchorSecUid:active && String(profile?.anchorId)===anchor ? profile?.secUid : undefined,anchorName:active && String(profile?.anchorId)===anchor ? profile?.name : undefined,memory:active ? ai.memory : undefined,knowledge:active ? ai.knowledge : '',corpus:current?.ai?.search?.rememberKnowledge!==false && ai.search?.rememberKnowledge!==false ? parseKnowledgeCorpus(values[`live-assistant:knowledge:${sourceRoom}:${anchor}`],now()).rows : [],
     accounts:current?.ai?.contextSources?.accounts!==false && ai.contextSources?.accounts!==false ? [...accounts.history(anchor),...accounts.list(anchor)] : [],includeAccountHistory:true,
     ...(selected ? override : {})});
   }catch{skipped.push({room:sourceRoom,anchor});}
  }
  const result=retrieve({scopes,now:now()},query,options);
  return {...result,coverage:`${result.coverage}; ${scopes.length} durable room/anchor scopes; ${skipped.length} invalid scopes omitted`,unavailableScopes:skipped};
 }};
}
