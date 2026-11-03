import {z} from 'zod';
import {accountSource} from '../ai/account-context.js';
export const ACCOUNT_COLLECTION_DEFAULTS=Object.freeze({enabled:true,autoRefresh:true,intervalMinutes:60,maxPerHour:6,urls:[]});
const schema=z.object({enabled:z.boolean(),autoRefresh:z.boolean(),intervalMinutes:z.number().int().min(15).max(1440),maxPerHour:z.number().int().min(1).max(30),urls:z.array(z.string().max(300)).max(10)});
export function validateAccountCollection(input){const c=schema.parse({...ACCOUNT_COLLECTION_DEFAULTS,...input});c.urls=[...new Set(c.urls.map(url=>accountSource(url).url))];return c;}
export function createAccountRefresh({collector,accounts,scope,config,changed,now=Date.now,onStatus=()=>{}}){
 let active=null,closed=false,lastAutomatic=-Infinity;const attempts=new Map();let calls=[];
 const refresh=async(url,{automatic=false}={})=>{
  if(closed || !collector)throw new Error('公开资料采集需要 Chrome 扩展版');
  if(active)throw new Error('资料采集正在进行，请稍候或取消');
  if(!config().enabled)throw new Error('公开资料采集已关闭');
  url=accountSource(url).url;const anchor=scope();if(!anchor)throw new Error('请先确认当前主播身份');
  calls=calls.filter(at=>now()-at<3600000);if(calls.length>=(config().maxPerHour ?? 6))throw new Error('公开资料采集已达每小时上限');
  const job={anchor,url,automatic};active=job;calls.push(now());attempts.set(`${anchor}:${url}`,now());while(attempts.size>100)attempts.delete(attempts.keys().next().value);
  try{
   accounts.forget(anchor,url);await changed();
   if(active!==job || scope()!==anchor)throw new Error('采集已取消或主播已切换');
   const rows=await collector.collect(url);
   if(active!==job || scope()!==anchor || !config().enabled || automatic && (!config().autoRefresh || !config().urls.includes(url)))throw new Error('采集已取消或上下文失效');
   accounts.replace(anchor,url,rows);await changed();return rows;
  }finally{if(active===job)active=null;}
 };
 const cancel=async()=>{if(active)active=null;await collector?.cancel();};
 const tick=async()=>{
  const c={...ACCOUNT_COLLECTION_DEFAULTS,...config()};
  if(active && (scope()!==active.anchor || !c.enabled || active.automatic && (!c.autoRefresh || !c.urls.includes(active.url)))){await cancel();return false;}
  if(closed || active || !collector || !scope() || !c.enabled || !c.autoRefresh || now()-lastAutomatic<60000)return false;
  calls=calls.filter(at=>now()-at<3600000);if(calls.length>=c.maxPerHour)return false;
  const records=accounts.list(scope());
  const url=c.urls.map(value=>accountSource(value).url).find(value=>now()-Math.max(attempts.get(`${scope()}:${value}`) ?? -Infinity,...records.filter(r=>r.source===value).map(r=>r.observedAt))>=c.intervalMinutes*60000);
  if(!url)return false;lastAutomatic=now();
  try{const rows=await refresh(url,{automatic:true});onStatus(`自动更新公开资料 ${rows.length} 条`);return true;}catch(error){onStatus(`公开资料更新：${error.message}`);return false;}
 };
 return {refresh,tick,cancel,close:()=>{closed=true;void cancel().catch(()=>{});}};
}
