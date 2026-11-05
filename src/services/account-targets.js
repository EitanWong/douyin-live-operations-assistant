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
export function rankAccountTargets({anchor,profiles=[],audience=[],now=Date.now(),limit=10,minDiamonds=100,minChats=3}={}){
 const urls=new Map(),aliases=new Map();
 for(const p of profiles){
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
 const host=profileURL(anchor?.secUid);if(host)urls.set(host,{url:host,role:'anchor',reason:'current-anchor',chatCount:0,observedDiamonds:null});
 return [...urls.values()].sort((a,b)=>Number(b.role==='anchor')-Number(a.role==='anchor') || (b.observedDiamonds || 0)-(a.observedDiamonds || 0) || b.chatCount-a.chatCount || a.url.localeCompare(b.url)).slice(0,Math.max(1,Math.min(20,limit)));
}
