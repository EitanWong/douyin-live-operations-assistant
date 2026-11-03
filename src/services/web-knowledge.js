import Dexie from 'dexie';
import {z} from 'zod';
import {retrieveKnowledge} from './retrieval.js';
import {validateSearchEndpoint} from './search.js';

const MINUTE=60000,DAY=86400000;
const refreshRequest=/重新(?:查|搜|核)|再(?:查|搜)一次|更新(?:一下|资料|知识|缓存)|不要(?:用|使用)?缓存|最新|实时|此刻/iu;
const volatileQuestion=/天气|气温|降雨|预报|空气质量|新闻|赛果|比分|汇率|股价|价格|热搜|今天|今日|明天|昨天|现在|当前|最近|本周|本月|今年|\b(?:weather|news|today|tomorrow|price|score)\b/iu;
const rulesQuestion=/规则|政策|机制|抖音|\bpk\b/iu;
const normalize=value=>String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/gu,' ');
export function knowledgeLifetime(query,freshness){
 if(volatileQuestion.test(query) || freshness==='realtime')return 2*MINUTE;
 if(rulesQuestion.test(query) || freshness==='rules')return DAY;
 return freshness==='stable' ? 7*DAY : 10*MINUTE;
}
const sourceSchema=z.strictObject({index:z.number().int().min(1).max(5),title:z.string().max(160),url:z.string().max(2000).refine(value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol) && !u.username && !u.password;}catch{return false;}}),content:z.string().min(1).max(1200),publishedAt:z.string().max(80).nullable()});
const recordSchema=z.strictObject({id:z.string().uuid(),key:z.string().max(5000),profile:z.string().max(2500),query:z.string().min(1).max(300),provider:z.enum(['bocha','tavily','searxng']),freshness:z.enum(['realtime','rules','stable','short']),searchedAt:z.number().finite().nonnegative(),expiresAt:z.number().finite().nonnegative(),results:z.array(sourceSchema).min(1).max(5)});
const profileFor=config=>JSON.stringify([config.provider || 'bocha',validateSearchEndpoint(config.endpoint,config.provider || 'bocha'),config.maxResults]);
const keyFor=(query,profile)=>JSON.stringify([profile,normalize(query)]);
function fresh(row,now){return recordSchema.safeParse(row).success && row.searchedAt<=now && row.expiresAt>now && row.expiresAt<=row.searchedAt+knowledgeLifetime(row.query,row.freshness) && row.key===keyFor(row.query,row.profile);}
function expiry(query,freshness,at){
 const until=at+knowledgeLifetime(query,freshness);
 // Relative dates change at midnight even if the short weather TTL remains.
 const midnight=(Math.floor((at+8*3600000)/DAY)+1)*DAY-8*3600000;
 return volatileQuestion.test(query) || freshness==='realtime' ? Math.min(until,midnight) : until;
}

// Each public source record has its own atomic write. Live-page tabs share the
// origin's database; user-entered room memories and private agent jobs stay apart.
export function createWebKnowledge({indexedDB=globalThis.indexedDB,IDBKeyRange=globalThis.IDBKeyRange,now=Date.now}={}){
 const db=indexedDB ? new Dexie('douyin-live-web-knowledge',{indexedDB,IDBKeyRange}) : null;
 db?.version(1).stores({sources:'&key,id,profile,searchedAt,expiresAt',meta:'&id'});
 const transient=new Map();let epoch=0,writes=Promise.resolve();
 const transaction=async work=>{if(!db){const pending=writes.then(work);writes=pending.catch(()=>{});return pending;}await db.open();return db.transaction('rw',db.sources,db.meta,work);};
 const rows=async()=>{if(!db)return structuredClone([...transient.values()]);await db.open();return db.sources.toArray();};
 const removeKey=key=>db ? db.sources.delete(key) : transient.delete(key);
 const revision=async()=>{if(!db)return epoch;await db.open();return (await db.meta.get('epoch'))?.value || 0;};
 const list=async()=> (await rows()).filter(row=>fresh(row,now())).sort((a,b)=>b.searchedAt-a.searchedAt || a.id.localeCompare(b.id));
 return {
  persistent:Boolean(db),revision,list,
  async find(query,config,{question=''}={}){
   if(config.rememberKnowledge===false || refreshRequest.test(question))return null;
   const key=keyFor(query,profileFor(config));if(db)await db.open();const row=db ? await db.sources.get(key) : transient.get(key);
   return row && fresh(row,now()) && now()-row.searchedAt<knowledgeLifetime(`${query} ${question}`,row.freshness) ? {...structuredClone(row),cached:true} : null;
  },
  async candidates(question,config){
   if(config.rememberKnowledge===false || refreshRequest.test(question))return [];
   const profile=profileFor(config),available=(await list()).filter(row=>row.profile===profile && now()-row.searchedAt<knowledgeLifetime(`${row.query} ${question}`,row.freshness));
   const matches=retrieveKnowledge(available.map(row=>({id:row.id,title:row.query,content:row.results.map(r=>`${r.title}\n${r.content}`).join('\n'),source:'联网来源',updatedAt:row.searchedAt,expiresOn:''})),question);
   return [...new Set(matches.chunks.map(r=>r.entryId))].slice(0,2).map(id=>{const row=available.find(r=>r.id===id);return {id:row.id,query:row.query,freshness:row.freshness,searchedAt:row.searchedAt,expiresAt:row.expiresAt,results:row.results};});
  },
  async remember(found,config,{freshness='short',question='',revision:expected}={}){
   if(config.rememberKnowledge===false || !found || found.provider && found.provider!==(config.provider || 'bocha') || !['realtime','rules','stable','short'].includes(freshness))return;
   const profile=profileFor(config),query=String(found.query || '').trim();
   const row={id:crypto.randomUUID(),key:keyFor(query,profile),profile,query,provider:found.provider || config.provider || 'bocha',freshness,searchedAt:found.searchedAt,expiresAt:expiry(`${query} ${question}`,freshness,found.searchedAt),results:structuredClone(found.results)};
   if(!fresh(row,now()))return;
   await transaction(async()=>{
    if(expected!==undefined && expected!==await revision())return;
    const old=db ? await db.sources.get(row.key) : transient.get(row.key);if(old?.searchedAt>row.searchedAt)return;
    if(db)await db.sources.put(row);else transient.set(row.key,row);
    const all=await rows(),valid=all.filter(r=>fresh(r,now())).sort((a,b)=>b.searchedAt-a.searchedAt || a.id.localeCompare(b.id));
    const keep=new Set(valid.slice(0,100).map(r=>r.key));for(const r of all)if(!keep.has(r.key))await removeKey(r.key);
   });
  },
  async remove(id){await transaction(async()=>{for(const row of await rows())if(row.id===id)await removeKey(row.key);await bump();});},
  async clear(){await transaction(async()=>{if(db)await db.sources.clear();else transient.clear();await bump();});},
  close(){db?.close();}
 };
 async function bump(){if(db)await db.meta.put({id:'epoch',value:await revision()+1});else epoch++;}
}
