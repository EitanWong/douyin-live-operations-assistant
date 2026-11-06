import {accountSource} from '../ai/account-context.js';

const month=30*86400000;
function profileURL(secUid){
 if(typeof secUid!=='string' || !/^[A-Za-z0-9_.=-]{1,160}$/u.test(secUid))return null;
 return accountSource(`https://www.douyin.com/user/${secUid}`).url;
}
function observedActivity(row,now){
 const recent=at=>Number.isFinite(at) && at<=now && now-at<=month;
 const chatCount=new Set((row.statements || []).filter(s=>s.id && recent(s.at)).map(s=>s.id)).size;
 const gifts=new Map();for(const g of row.gifts || []){
  if(!g.key || !recent(g.at) || !Number.isSafeInteger(g.count) || g.count<1)continue;
  const old=gifts.get(g.key);gifts.set(g.key,{count:Math.max(g.count,old?.count || 0),unitDiamonds:Number.isFinite(g.unitDiamonds) && g.unitDiamonds>=0 ? g.unitDiamonds : old?.unitDiamonds ?? null});
 }
 const observedDiamonds=[...gifts.values()].some(g=>g.unitDiamonds===null) ? null : [...gifts.values()].reduce((sum,g)=>sum+g.count*g.unitDiamonds,0);
 return {chatCount,observedDiamonds};
}

// Priority describes observed interaction, never wealth, purchasing power or biography.
export function rankAccountTargets({anchor,profiles=[],audience=[],publicRecords=[],now=Date.now(),limit=10,minDiamonds=100,minChats=3}={}){
 const urls=new Map(),aliases=new Map();
 const observedProfiles=[...profiles,...publicRecords.flatMap(r=>[r.actor,r.target].filter(Boolean).map(a=>({...a,id:a.uid})))];
 const owners=new Map();
 for(const p of observedProfiles)if(p.id && p.secUid){if(!owners.has(p.secUid))owners.set(p.secUid,new Set());owners.get(p.secUid).add(p.id);}
 for(const p of observedProfiles){
  const url=profileURL(p.secUid);if(!url)continue;
  for(const key of [p.id ? `uid:${p.id}` : '',`sec:${p.secUid}`].filter(Boolean)){
   if(!aliases.has(key))aliases.set(key,new Set());aliases.get(key).add(url);
  }
 }
 for(const row of audience){
  if(!Number.isFinite(row.lastAt) || row.lastAt>now || now-row.lastAt>month)continue;
  const matched=aliases.get(row.key);if(matched?.size!==1)continue;
  const {chatCount,observedDiamonds}=observedActivity(row,now);
  const donor=observedDiamonds!==null && observedDiamonds>=minDiamonds;
  if(!donor && chatCount<minChats)continue;
  const url=[...matched][0],previous=urls.get(url),next={url,role:'viewer',reason:donor ? 'observed-gifts' : 'frequent-chat',chatCount,observedDiamonds};
  if(!previous || (observedDiamonds || 0)>(previous.observedDiamonds || 0) || chatCount>previous.chatCount)urls.set(url,next);
 }
 for(const row of publicRecords){
  const depth=(row.researchDepth ?? 0)+1;
  if(!['comment','danmaku'].includes(row.kind) || depth>2 || row.observedAt>now || now-row.observedAt>month)continue;
  for(const actor of [row.actor,row.target]){
   const url=profileURL(actor?.secUid);if(!url || owners.get(actor.secUid)?.size>1 || actor.uid && aliases.get(`uid:${actor.uid}`)?.size!==1)continue;
   const previous=urls.get(url);if(previous && (previous.depth ?? 0)<=depth)continue;
   urls.set(url,{url,role:'viewer',reason:'public-interaction',depth,chatCount:0,observedDiamonds:null});
  }
 }
 const host=profileURL(anchor?.secUid);if(host)urls.set(host,{url:host,role:'anchor',reason:'current-anchor',chatCount:0,observedDiamonds:null});
 return [...urls.values()].sort((a,b)=>Number(b.role==='anchor')-Number(a.role==='anchor') || (b.observedDiamonds || 0)-(a.observedDiamonds || 0) || b.chatCount-a.chatCount || a.url.localeCompare(b.url)).slice(0,Math.max(1,Math.min(20,limit)));
}
