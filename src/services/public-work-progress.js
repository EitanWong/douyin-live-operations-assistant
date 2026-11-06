import {z} from 'zod';
import {accountSource} from '../ai/account-context.js';

export const PUBLIC_WORK_LIMITS=Object.freeze({perRun:2,works:200,profiles:100,refreshMs:86400000,retryMs:15*60000,retentionMs:180*86400000});
const visit=z.object({id:z.string().regex(/^[A-Za-z0-9_.=-]{1,160}$/u),status:z.enum(['complete','failed']),at:z.number().finite().nonnegative()});
const snapshot=z.object({version:z.literal(1),profiles:z.array(z.object({url:z.string().max(300),works:z.array(visit).max(PUBLIC_WORK_LIMITS.works)})).max(PUBLIC_WORK_LIMITS.profiles)});
export function parseWorkProgress(input,now){
 const parsed=snapshot.safeParse(input);if(!parsed.success)return {version:1,profiles:[]};
 return {version:1,profiles:parsed.data.profiles.flatMap(row=>{
  try{const source=accountSource(row.url);if(source.kind!=='profile' || source.url!==row.url)return [];}catch{return [];}
  return [{...row,works:row.works.filter(v=>v.at<=now && now-v.at<PUBLIC_WORK_LIMITS.retentionMs)}];
 })};
}
export function selectPublicWorks(rows,source,visited,now){
 const history=new Map(z.array(visit).safeParse(visited).data?.filter(v=>v.at<=now).map(v=>[v.id,v]) || []);
 return [...new Map(rows.filter(r=>{
  if(r.kind!=='work' || r.subject!==source.id)return false;
  try{const target=accountSource(r.url);return target.kind==='work' && target.id===r.id && target.url===r.url;}catch{return false;}
 }).map(r=>[r.id,r])).values()].filter(r=>{
  const last=history.get(r.id);return !last || now-last.at>=(last.status==='complete' ? PUBLIC_WORK_LIMITS.refreshMs : PUBLIC_WORK_LIMITS.retryMs);
 }).sort((a,b)=>{
  const aLast=history.get(a.id),bLast=history.get(b.id);
  return Number(aLast?.status==='complete')-Number(bLast?.status==='complete') || (aLast?.status==='complete' && bLast?.status==='complete' ? aLast.at-bLast.at : 0) || (b.publishedAt || 0)-(a.publishedAt || 0) || a.id.localeCompare(b.id);
 }).slice(0,PUBLIC_WORK_LIMITS.perRun);
}
export function advanceWorkProgress(input,url,visits,now){
 const saved=parseWorkProgress(input,now),old=saved.profiles.find(r=>r.url===url),works=new Map((old?.works || []).map(r=>[r.id,r]));
 for(const value of visits){const parsed=visit.safeParse(value);if(parsed.success && parsed.data.at<=now)works.set(value.id,parsed.data);}
 const updated={url,works:[...works.values()].sort((a,b)=>b.at-a.at || a.id.localeCompare(b.id)).slice(0,PUBLIC_WORK_LIMITS.works)};
 return {version:1,profiles:[...saved.profiles.filter(r=>r.url!==url),updated].slice(-PUBLIC_WORK_LIMITS.profiles)};
}
