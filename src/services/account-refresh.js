import {z} from 'zod';
import {accountSource} from '../ai/account-context.js';
export const ACCOUNT_COLLECTION_DEFAULTS=Object.freeze({enabled:true,autoRefresh:true,autoResearch:false,researchLimit:10,minDiamonds:100,minChats:3,intervalMinutes:60,maxPerHour:6,urls:[]});
const schema=z.object({enabled:z.boolean(),autoRefresh:z.boolean(),autoResearch:z.boolean(),researchLimit:z.number().int().min(1).max(20),minDiamonds:z.number().int().min(1).max(1e9),minChats:z.number().int().min(1).max(1000),intervalMinutes:z.number().int().min(15).max(1440),maxPerHour:z.number().int().min(1).max(30),urls:z.array(z.string().max(300)).max(10)});
export function validateAccountCollection(input){const c=schema.parse({...ACCOUNT_COLLECTION_DEFAULTS,...input});c.urls=[...new Set(c.urls.map(url=>accountSource(url).url))];return c;}
export function createAccountRefresh({collector,accounts,scope,config,changed,targets=()=>[],snapshot,now=Date.now,onStatus=()=>{}}){
 const saved=z.object({calls:z.array(z.number().finite()).max(30),attempts:z.array(z.tuple([z.string().max(400),z.number().finite()])).max(100)}).safeParse(snapshot);
 let active=null,closed=false,lastAutomatic=-Infinity;const attempts=new Map(saved.success ? saved.data.attempts.filter(([,at])=>at<=now()) : []);let calls=saved.success ? saved.data.calls.filter(at=>at<=now() && now()-at<3600000) : [];
 const selection=()=>{
  const c={...ACCOUNT_COLLECTION_DEFAULTS,...config()},selected=c.urls.map(url=>({url:accountSource(url).url,role:'selected'}));
  if(c.autoResearch)for(const target of targets().slice(0,c.researchLimit))try{
   const source=accountSource(target.url);if(source.kind==='profile' && ['anchor','viewer'].includes(target.role) && !selected.some(r=>r.url===source.url))selected.push({url:source.url,role:target.role,depth:Number.isInteger(target.depth) && target.depth>=0 && target.depth<=2 ? target.depth : 0});
  }catch{}
  return selected;
 };
 const selected=job=>selection().some(r=>r.url===job.url && r.role===job.role && (r.depth ?? 0)===job.depth);
 const refresh=async(url,{automatic=false,role='selected',depth=0}={})=>{
  if(closed || !collector)throw new Error('公开资料采集需要 Chrome 扩展版');
  if(active)throw new Error('资料采集正在进行，请稍候或取消');
  if(!config().enabled)throw new Error('公开资料采集已关闭');
  url=accountSource(url).url;const anchor=scope();if(!anchor)throw new Error('请先确认当前主播身份');
  calls=calls.filter(at=>now()-at<3600000);if(calls.length>=(config().maxPerHour ?? 6))throw new Error('公开资料采集已达每小时上限');
  const job={anchor,url,automatic,role,depth};active=job;calls.push(now());attempts.delete(`${anchor}:${url}`);attempts.set(`${anchor}:${url}`,now());while(attempts.size>100)attempts.delete(attempts.keys().next().value);
  try{
   accounts.invalidate(anchor,url);await changed();
   if(active!==job || scope()!==anchor)throw new Error('采集已取消或主播已切换');
   const rows=await collector.collect(url);
   if(active!==job || scope()!==anchor || !config().enabled || automatic && (!config().autoRefresh || !selected(job)))throw new Error('采集已取消或上下文失效');
   accounts.replace(anchor,url,rows,{role,depth});await changed();return rows;
  }finally{if(active===job)active=null;}
 };
 const cancel=async()=>{if(active)active=null;await collector?.cancel();};
 const tick=async()=>{
  const c={...ACCOUNT_COLLECTION_DEFAULTS,...config()};
  if(active && (scope()!==active.anchor || !c.enabled || active.automatic && (!c.autoRefresh || !selected(active)))){await cancel();return false;}
  if(closed || active || !collector || !scope() || !c.enabled || !c.autoRefresh || now()-lastAutomatic<60000)return false;
  calls=calls.filter(at=>now()-at<3600000);if(calls.length>=c.maxPerHour)return false;
  const records=accounts.list(scope());
  const last=url=>Math.max(attempts.get(`${scope()}:${url}`) ?? -Infinity,...records.filter(r=>r.source===url).map(r=>r.observedAt));
  const target=selection().map((row,index)=>({...row,index,last:last(row.url)})).filter(row=>now()-row.last>=c.intervalMinutes*60000).sort((a,b)=>a.last-b.last || a.index-b.index)[0];
  if(!target)return false;lastAutomatic=now();
  try{const rows=await refresh(target.url,{automatic:true,role:target.role,depth:target.depth ?? 0});onStatus(`自动更新公开资料 ${rows.length} 条`);return true;}catch(error){onStatus(`公开资料更新：${error.message}`);return false;}
 };
 return {refresh,tick,cancel,snapshot:()=>({calls:[...calls],attempts:[...attempts]}),close:()=>{closed=true;void cancel().catch(()=>{});}};
}
