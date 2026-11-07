import {collectionPolicy} from '../core/collection-policy.js';
import {subjectKeySchema,researchSubject} from '../ai/audience-profile.js';
import {canReuseSource,knowledgeLifetime} from './web-knowledge.js';
import {retrieveKnowledge,RETRIEVAL_LIMITS} from './retrieval.js';
import {mergeSourcePassage,evidenceOffset,corpusReferenceSchema,CORPUS_REFERENCE_LIMIT} from '../ai/source-evidence.js';

const sourcePassage=(row,content)=>({index:1,title:row.title,url:row.source,content,sourceId:row.id,at:row.at,expiresAt:row.expiresAt,publishedAt:row.publishedAt ?? null,
 ...(row.subject ? {subject:row.subject} : {}),
 ...(row.evidenceKind ? {evidenceKind:row.evidenceKind} : {}),...(row.coverage ? {coverage:row.coverage} : {})});
const sourceInScope=(row,{subject,anchor}={})=>!row.subject || row.subject===subject || Boolean(anchor && row.subject===`uid:${anchor}`);

function corpusRecord(parts){
 const id=`corpus:${parts.map(({row,start,end})=>`${row.id}:${start}-${end}`).join(',')}`;
 const sources=parts.map(({row,start,end})=>sourcePassage(row,row.text.slice(start,end)));
 const source=sources.length===1 ? sources[0] : sources.reduce((old,incoming)=>mergeSourcePassage(old,incoming),undefined);
 for(const key of ['sourceId','subject'])if(sources[0][key] && sources.every(s=>s[key]===sources[0][key]))source[key]=sources[0][key];
 return {id,query:id,cached:true,freshness:'stable',searchedAt:source.at,expiresAt:source.expiresAt,results:[{...source,index:1}]};
}

function resolveCorpusRecord(query,rows,question){
 if(!corpusReferenceSchema.safeParse(query).success)return null;
 const refs=query.slice(7).split(',');
 const parts=[];
 for(const ref of refs){
  const match=/^([a-f0-9]{64}):(\d+)-(\d+)$/u.exec(ref);if(!match)return null;
  const row=rows.find(r=>r.id===match[1]),start=Number(match[2]),end=Number(match[3]);
  if(!row || !canReuseSource(question,row) || end<=start || end-start>RETRIEVAL_LIMITS.chunkChars || end>row.text.length || evidenceOffset(row.text,start)!==start || evidenceOffset(row.text,end)!==end)return null;
  if(parts.some(p=>p.row.source!==row.source || p.row.id===row.id && p.start<end && start<p.end))return null;
  parts.push({row,start,end});
 }
 return corpusRecord(parts);
}

export function retrieveSourceRecords(rows,question,now=Date.now(),scope={}){
 const available=rows.filter(row=>sourceInScope(row,scope) && canReuseSource(question,row,now));
 const found=retrieveKnowledge(available.map(r=>({id:r.id,title:r.title,content:r.text,source:r.source,updatedAt:r.at,expiresOn:''})),question,{maxPerSource:CORPUS_REFERENCE_LIMIT});
 const grouped=new Map();
 for(const chunk of found.chunks){
  if(!grouped.has(chunk.source))grouped.set(chunk.source,[]);
  grouped.get(chunk.source).push({row:available.find(r=>r.id===chunk.entryId),...chunk.range});
 }
 return [...grouped.values()].slice(0,3).map(corpusRecord);
}

// Background-owned canonical corpus. Page messages supply raw search sources,
// not graph edges or verified facts. Every operation resolves the saved scope.
export function createAutomaticKnowledge({corpus,readConfig,all,readAudience=async()=>null,readProfile=async()=>null,now=Date.now}){
 let tail=Promise.resolve();
 async function scopes(room,anchor){
  const found=new Map([[`${room}:${anchor}`,{room,anchor}]]);
  for(const [key,value] of Object.entries(all ? await all() : {})){
   const match=key.match(/^live-assistant:knowledge:(\d+):(\d+)$/u);
   if(match)found.set(`${match[1]}:${match[2]}`,{room:match[1],anchor:match[2]});
   const configured=key.match(/^live-assistant:config:(\d+)$/u);
   if(configured && /^\d{1,40}$/u.test(value?.anchorId))found.set(`${configured[1]}:${value.anchorId}`,{room:configured[1],anchor:String(value.anchorId)});
  }
  return [...found.values()];
 }
 return {handle(room,action,input={}){
  const work=tail.then(()=>handle(room,action,input));tail=work.catch(()=>{});return work;
 }};
 async function handle(room,action,input){
  const config=collectionPolicy(await readConfig(room)),anchor=String(config?.anchorId || '');
  if(!/^\d{1,30}$/u.test(anchor) || input.anchor!==anchor)throw Error('主播已变化，请刷新知识库');
  if(action==='version')return corpus.version(room,anchor);
  if(action==='clear'){for(const source of await scopes(room,anchor))await corpus.clear(source.room,source.anchor);return;}
  if(action==='remove'){
   if(!/^[a-f0-9]{64}$/u.test(input.id || ''))throw Error('来源标识无效');
   for(const source of await scopes(room,anchor))await corpus.remove(source.room,source.anchor,input.id);return;
  }
  if(action==='list'){
   if(config.ai?.search?.rememberKnowledge===false || config.ai?.assistant?.memoryEnabled===false)return [];
   const rows=[];
   for(const source of await scopes(room,anchor)){
    const owner=collectionPolicy(await readConfig(source.room));
    if(owner?.ai?.assistant?.memoryEnabled===false || owner?.ai?.search?.rememberKnowledge===false)continue;
    const audience=await readAudience(source.room,source.anchor),profile=await readProfile(source.room);
    rows.push(...(await corpus.list(source.room,source.anchor)).filter(r=>r.expiresAt>now() && (!r.subject || config.ai?.contextSources?.audience!==false && owner?.ai?.contextSources?.audience!==false && Number.isSafeInteger(r.subjectEpoch) && r.subjectEpoch===researchSubject(audience,r.subject,{...source,profile})?.epoch)).map(r=>({...r,scope:source})));
   }
   const unique=new Map();
   for(const row of rows.toSorted((a,b)=>a.expiresAt-b.expiresAt)){
    const old=unique.get(row.id);
    if(old)old.origins.push(row.scope);else unique.set(row.id,{...row,origins:[row.scope]});
   }
   return [...unique.values()];
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
 }
}

// Preserve the existing short-lived search cache contract, and persist original
// search passages with the same deletion generation and source freshness.
export function createKnowledgeMemory({cache,transport,anchor}){
 const call=(action,input={})=>transport(action,{anchor:String(anchor()),...input});
 const scope=options=>({...options,anchor:String(anchor())});
 const eligible=(record,rows,question='')=>record?.results?.every(s=>rows.some(r=>canReuseSource(question || record.query,r) && r.source===s.url && (s.sourceId ? r.id===s.sourceId && r.text.includes(s.content) : r.text===s.content)));
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
    return resolveCorpusRecord(query,rows,options.question || '');
   }
   const record=await cache.find(query,config,options);return eligible(record,rows,options.question) ? record : null;
  },
  async candidates(question,config,options={}){
   if(config.rememberKnowledge===false)return [];
   const [records,rows]=await Promise.all([cache.candidates(question,config),call('list')]);
   const scoped=rows.filter(r=>sourceInScope(r,scope(options))),selected=retrieveSourceRecords(scoped,question,Date.now(),scope(options)),urls=new Set(selected.flatMap(r=>r.results.map(s=>s.url)));
   for(const record of records.filter(r=>eligible(r,scoped,question)))if(selected.length<3 && record.results.every(s=>!urls.has(s.url))){selected.push(record);for(const s of record.results)urls.add(s.url);}
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
