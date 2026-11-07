import {subjectKeySchema,researchSubject} from '../ai/audience-profile.js';
import {canReuseSource,knowledgeLifetime} from './web-knowledge.js';
import {retrieveKnowledge} from './retrieval.js';

const sourcePassage=(row,content)=>({index:1,title:row.title,url:row.source,content,sourceId:row.id,at:row.at,expiresAt:row.expiresAt,publishedAt:row.publishedAt ?? null,
 ...(row.subject ? {subject:row.subject} : {}),
 ...(row.evidenceKind ? {evidenceKind:row.evidenceKind} : {}),...(row.coverage ? {coverage:row.coverage} : {})});
const sourceInScope=(row,{subject,anchor}={})=>!row.subject || row.subject===subject || Boolean(anchor && row.subject===`uid:${anchor}`);

export function retrieveSourceRecords(rows,question,now=Date.now(),scope={}){
 const available=rows.filter(row=>sourceInScope(row,scope) && canReuseSource(question,row,now));
 const found=retrieveKnowledge(available.map(r=>({id:r.id,title:r.title,content:r.text,source:r.source,updatedAt:r.at,expiresOn:''})),question,{maxPerSource:1});
 return found.chunks.slice(0,3).map(chunk=>{
  const row=available.find(r=>r.id===chunk.entryId),id=`corpus:${row.id}:${chunk.range.start}-${chunk.range.end}`;
  return {id,query:id,cached:true,freshness:'stable',searchedAt:row.at,expiresAt:row.expiresAt,
   results:[sourcePassage(row,chunk.content)]};
 });
}

// Background-owned canonical corpus. Page messages supply raw search sources,
// not graph edges or verified facts. Every operation resolves the saved scope.
export function createAutomaticKnowledge({corpus,readConfig,readAudience=async()=>null,readProfile=async()=>null,now=Date.now}){
 return {async handle(room,action,input={}){
  const config=await readConfig(room),anchor=String(config?.anchorId || '');
  if(!/^\d{1,30}$/u.test(anchor) || input.anchor!==anchor)throw Error('主播已变化，请刷新知识库');
  if(action==='version')return corpus.version(room,anchor);
  if(action==='clear')return corpus.clear(room,anchor);
  if(action==='remove'){
   if(!/^[a-f0-9]{64}$/u.test(input.id || ''))throw Error('来源标识无效');
   return corpus.remove(room,anchor,input.id);
  }
  if(action==='list'){
   const audience=await readAudience(room,anchor),profile=await readProfile(room);
   return (await corpus.list(room,anchor)).filter(r=>r.expiresAt>now() && (!r.subject || config.ai?.assistant?.memoryEnabled!==false && config.ai?.contextSources?.audience!==false && Number.isSafeInteger(r.subjectEpoch) && r.subjectEpoch===researchSubject(audience,r.subject,{room,anchor,profile})?.epoch));
  }
  if(action!=='remember')throw Error('知识库操作无效');
  if(!config.ai?.enabled || config.ai.assistant?.memoryEnabled===false || config.ai.search?.rememberKnowledge===false)throw Error('自动知识记忆已关闭');
  let scope={};
  if(input.subject!==undefined){
   const subject=subjectKeySchema.parse(input.subject),audience=await readAudience(room,anchor),identity=researchSubject(audience,subject,{room,anchor,profile:await readProfile(room)}),epoch=identity?.epoch;
   if(config.ai?.contextSources?.audience===false || !identity || input.subjectEpoch!==undefined && input.subjectEpoch!==epoch)throw Error('人物画像已删除或变化');
   scope={subject,subjectEpoch:epoch};
  }
  return corpus.remember(room,anchor,input.sources,{version:input.version,lifetime:input.lifetime,...scope});
 }};
}

// Preserve the existing short-lived search cache contract, and persist original
// search passages with the same deletion generation and source freshness.
export function createKnowledgeMemory({cache,transport,anchor}){
 const call=(action,input={})=>transport(action,{anchor:String(anchor()),...input});
 const scope=options=>({...options,anchor:String(anchor())});
  const eligible=(record,rows)=>record?.results?.every(s=>rows.some(r=>r.source===s.url && (s.sourceId ? r.id===s.sourceId && r.text.includes(s.content) : r.text===s.content)));
 return {...cache,capacity:1000,
  async revision(){return {cache:await cache.revision(),corpus:await call('version'),anchor:String(anchor())};},
  async remember(found,config,options={}){
   const revision=options.revision;
   if(!options.subject)await cache.remember(found,config,{...options,revision:revision?.cache});
   if(config.rememberKnowledge===false || !found?.results?.length || revision?.anchor && revision.anchor!==String(anchor()))return;
   await call('remember',{...(options.subject ? {subject:options.subject,subjectEpoch:options.subjectEpoch} : {}),sources:found.results.map(source=>({...source,at:found.searchedAt})),version:revision?.corpus,lifetime:knowledgeLifetime(`${found.query || ''} ${options.question || ''}`,options.freshness)});
  },
  async find(query,config,options={}){
   const rows=(await call('list')).filter(r=>sourceInScope(r,scope(options)));
   if(query.startsWith('corpus:')){
    if(config.rememberKnowledge===false)return null;
    const [,id,range]=query.split(':'),row=rows.find(r=>r.id===id);if(!row || !canReuseSource(options.question || '',row))return null;
    const match=/^(\d+)-(\d+)$/u.exec(range || '');if(!match)return null;const start=Number(match[1]),end=Number(match[2]);
    if(end<=start || end-start>600 || end>row.text.length)return null;
    return {id:query,query,cached:true,searchedAt:row.at,expiresAt:row.expiresAt,results:[sourcePassage(row,row.text.slice(start,end))]};
   }
   const record=await cache.find(query,config,options);return eligible(record,rows) ? record : null;
  },
  async candidates(question,config,options={}){
   if(config.rememberKnowledge===false)return [];
   const [records,rows]=await Promise.all([cache.candidates(question,config),call('list')]);
   const scoped=rows.filter(r=>sourceInScope(r,scope(options))),selected=retrieveSourceRecords(scoped,question,Date.now(),scope(options)),urls=new Set(selected.flatMap(r=>r.results.map(s=>s.url)));
   for(const record of records.filter(r=>eligible(r,scoped)))if(selected.length<3 && record.results.every(s=>!urls.has(s.url))){selected.push(record);for(const s of record.results)urls.add(s.url);}
   return selected;
  },
  async list(){
   const [cached,rows]=await Promise.all([cache.list(),call('list')]);
   const urls=new Set(rows.map(r=>r.source));
   return [...rows.map(r=>({id:`corpus:${r.id}`,query:r.title,searchedAt:r.at,expiresAt:r.expiresAt,results:[sourcePassage(r,r.text)]})),...cached.filter(r=>eligible(r,rows) && !r.results.every(s=>urls.has(s.url)))].sort((a,b)=>b.searchedAt-a.searchedAt).slice(0,1000);
  },
  async remove(id){if(id.startsWith('corpus:')){const row=(await call('list')).find(r=>r.id===id.slice(7));await call('remove',{id:id.slice(7)});for(const cached of await cache.list())if(cached.results.some(s=>s.url===row?.source))await cache.remove(cached.id);}else await cache.remove(id);},
  async clear(){await call('clear');await cache.clear();}
 };
}
