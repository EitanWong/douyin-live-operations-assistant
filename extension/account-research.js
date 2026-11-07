import {accountSource} from '../src/ai/account-context.js';
import {validateAccountCollection} from '../src/services/account-refresh.js';
import {parseWorkProgress,advanceWorkProgress} from '../src/services/public-work-progress.js';

// Only this queue writes its budget. Browser work never holds the live archive lock.
export function createAccountResearch({readConfig,readBudget,writeBudget,readProgress=async()=>null,writeProgress=async()=>{},collect,archive,now=Date.now}){
 let tail=Promise.resolve(),pending=0;
 const state=async room=>{const c=await readConfig(room);return {anchor:String(c?.anchorId || ''),config:validateAccountCollection(c?.ai?.accountCollection)};};
 const check=async(room,anchor,signal)=>{
  if(signal?.aborted)throw Error('账号采集已取消');
  const current=await state(room);
  if(!current.anchor || current.anchor!==anchor || !current.config.enabled)throw Error('主播或采集上下文已变化');
  return current.config;
 };
 return {async collect(room,url,{signal}={}){
  const source=accountSource(url);url=source.url;
  const initial=await state(room);await check(room,initial.anchor,signal);
  if(pending>=8)throw Error('公开资料采集队列已满，请稍后重试');
  pending++;
  const work=tail.then(async()=>{
   const config=await check(room,initial.anchor,signal),at=now(),saved=await readBudget();
   const calls=Array.isArray(saved) ? saved.filter(t=>Number.isFinite(t) && t<=at && at-t<3600000).slice(-30) : [];
   if(calls.length>=config.maxPerHour)throw Error('公开资料采集已达共享每小时上限');
   await writeBudget([...calls,at]);await check(room,initial.anchor,signal);
   const progress=source.kind==='profile' ? parseWorkProgress(await readProgress(room,initial.anchor),now()) : null,visits=[],media=[];
   const records=await collect(url,{signal,room,anchor:initial.anchor,visited:progress?.profiles.find(r=>r.url===url)?.works || [],onWork:visit=>visits.push(visit),onMedia:value=>{if(media.length<2)media.push(value);}});await check(room,initial.anchor,signal);
   await archive({room,anchor:initial.anchor,source:url,records,media,at:now()});
   await check(room,initial.anchor,signal);
   if(progress && visits.length)await writeProgress(room,initial.anchor,advanceWorkProgress(progress,url,visits,now()));
   return records;
  });
  tail=work.catch(()=>{}).finally(()=>{pending--;});
  return work;
 }};
}
