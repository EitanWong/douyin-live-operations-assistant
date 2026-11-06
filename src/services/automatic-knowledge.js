import {knowledgeLifetime} from './web-knowledge.js';

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
 const eligible=(record,rows)=>record?.results?.every(s=>rows.some(r=>r.source===s.url && r.text===s.content));
 return {...cache,capacity:1000,
  async revision(){return {cache:await cache.revision(),corpus:await call('version'),anchor:String(anchor())};},
  async remember(found,config,options={}){
   const revision=options.revision;
   await cache.remember(found,config,{...options,revision:revision?.cache});
   if(config.rememberKnowledge===false || !found?.results?.length || revision?.anchor && revision.anchor!==String(anchor()))return;
   await call('remember',{sources:found.results.map(source=>({...source,at:found.searchedAt})),version:revision?.corpus,lifetime:knowledgeLifetime(`${found.query || ''} ${options.question || ''}`,options.freshness)});
  },
  async find(...args){const [record,rows]=await Promise.all([cache.find(...args),call('list')]);return eligible(record,rows) ? record : null;},
  async candidates(...args){const [records,rows]=await Promise.all([cache.candidates(...args),call('list')]);return records.filter(r=>eligible(r,rows));},
  async list(){
   const [cached,rows]=await Promise.all([cache.list(),call('list')]);
   const urls=new Set(rows.map(r=>r.source));
   return [...rows.map(r=>({id:`corpus:${r.id}`,query:r.title,searchedAt:r.at,expiresAt:r.expiresAt,results:[{index:1,title:r.title,url:r.source,content:r.text}]})),...cached.filter(r=>eligible(r,rows) && !r.results.every(s=>urls.has(s.url)))].sort((a,b)=>b.searchedAt-a.searchedAt).slice(0,1000);
  },
  async remove(id){if(id.startsWith('corpus:')){const row=(await call('list')).find(r=>r.id===id.slice(7));await call('remove',{id:id.slice(7)});for(const cached of await cache.list())if(cached.results.some(s=>s.url===row?.source))await cache.remove(cached.id);}else await cache.remove(id);},
  async clear(){await call('clear');await cache.clear();}
 };
}
