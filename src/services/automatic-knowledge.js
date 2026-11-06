import {canReuseSource,knowledgeLifetime} from './web-knowledge.js';
import {retrieveKnowledge} from './retrieval.js';

export function retrieveSourceRecords(rows,question,now=Date.now()){
 const available=rows.filter(row=>canReuseSource(question,row,now));
 const found=retrieveKnowledge(available.map(r=>({id:r.id,title:r.title,content:r.text,source:r.source,updatedAt:r.at,expiresOn:''})),question);
 return found.chunks.slice(0,3).map(chunk=>{
  const row=available.find(r=>r.id===chunk.entryId),id=`corpus:${row.id}:${chunk.range.start}-${chunk.range.end}`;
  return {id,query:id,cached:true,freshness:'stable',searchedAt:row.at,expiresAt:row.expiresAt,
   results:[{index:1,title:row.title,url:row.source,content:chunk.content,sourceId:row.id,at:row.at,expiresAt:row.expiresAt,publishedAt:null}]};
 });
}

// Background-owned canonical corpus. Page messages supply raw search sources,
// not graph edges or verified facts. Every operation resolves the saved scope.
export function createAutomaticKnowledge({corpus,readConfig,now=Date.now}){
 return {async handle(room,action,input={}){
  const config=await readConfig(room),anchor=String(config?.anchorId || '');
  if(!/^\d{1,30}$/u.test(anchor) || input.anchor!==anchor)throw Error('主播已变化，请刷新知识库');
  if(action==='version')return corpus.version(room,anchor);
  if(action==='clear')return corpus.clear(room,anchor);
  if(action==='remove'){
   if(!/^[a-f0-9]{64}$/u.test(input.id || ''))throw Error('来源标识无效');
   return corpus.remove(room,anchor,input.id);
  }
  if(action==='list')return (await corpus.list(room,anchor)).filter(r=>r.expiresAt>now());
  if(action!=='remember')throw Error('知识库操作无效');
  if(!config.ai?.enabled || config.ai.assistant?.memoryEnabled===false || config.ai.search?.rememberKnowledge===false)throw Error('自动知识记忆已关闭');
  return corpus.remember(room,anchor,input.sources,{version:input.version,lifetime:input.lifetime});
 }};
}

// Preserve the existing short-lived search cache contract, and persist original
// search passages with the same deletion generation and source freshness.
export function createKnowledgeMemory({cache,transport,anchor}){
 const call=(action,input={})=>transport(action,{anchor:String(anchor()),...input});
  const eligible=(record,rows)=>record?.results?.every(s=>rows.some(r=>r.source===s.url && (s.sourceId ? r.id===s.sourceId && r.text.includes(s.content) : r.text===s.content)));
 return {...cache,capacity:1000,
  async revision(){return {cache:await cache.revision(),corpus:await call('version'),anchor:String(anchor())};},
  async remember(found,config,options={}){
   const revision=options.revision;
   await cache.remember(found,config,{...options,revision:revision?.cache});
   if(config.rememberKnowledge===false || !found?.results?.length || revision?.anchor && revision.anchor!==String(anchor()))return;
   await call('remember',{sources:found.results.map(source=>({...source,at:found.searchedAt})),version:revision?.corpus,lifetime:knowledgeLifetime(`${found.query || ''} ${options.question || ''}`,options.freshness)});
  },
  async find(query,config,options={}){
   const rows=await call('list');
   if(query.startsWith('corpus:')){
    if(config.rememberKnowledge===false)return null;
    const [,id,range]=query.split(':'),row=rows.find(r=>r.id===id);if(!row || !canReuseSource(options.question || '',row))return null;
    const match=/^(\d+)-(\d+)$/u.exec(range || '');if(!match)return null;const start=Number(match[1]),end=Number(match[2]);
    if(end<=start || end-start>600 || end>row.text.length)return null;
    return {id:query,query,cached:true,searchedAt:row.at,expiresAt:row.expiresAt,results:[{index:1,title:row.title,url:row.source,content:row.text.slice(start,end),sourceId:row.id,at:row.at,publishedAt:null}]};
   }
   const record=await cache.find(query,config,options);return eligible(record,rows) ? record : null;
  },
  async candidates(question,config){
   if(config.rememberKnowledge===false)return [];
   const [records,rows]=await Promise.all([cache.candidates(question,config),call('list')]);
   return [...records.filter(r=>eligible(r,rows)),...retrieveSourceRecords(rows,question)].slice(0,3);
  },
  async list(){
   const [cached,rows]=await Promise.all([cache.list(),call('list')]);
   const urls=new Set(rows.map(r=>r.source));
   return [...rows.map(r=>({id:`corpus:${r.id}`,query:r.title,searchedAt:r.at,expiresAt:r.expiresAt,results:[{index:1,title:r.title,url:r.source,content:r.text}]})),...cached.filter(r=>eligible(r,rows) && !r.results.every(s=>urls.has(s.url)))].sort((a,b)=>b.searchedAt-a.searchedAt).slice(0,1000);
  },
  async remove(id){if(id.startsWith('corpus:')){const row=(await call('list')).find(r=>r.id===id.slice(7));await call('remove',{id:id.slice(7)});for(const cached of await cache.list())if(cached.results.some(s=>s.url===row?.source))await cache.remove(cached.id);}else await cache.remove(id);},
  async clear(){await call('clear');await cache.clear();}
 };
}
