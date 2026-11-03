import {seedPredictionDemo} from './demo.js';
import {AnalyticsArchive} from './archive.js';
import {forecastReport} from './forecast.js';
import {scopeKey,MINUTE,MODEL_VERSION,parseSettings} from './schema.js';

// One owner in the extension background; IndexedDB transactions also serialize
// writes from standalone pages. No browser page owns mutable training state.
export class PredictionService {
 constructor({archive=new AnalyticsArchive(),now=Date.now}={}){this.archive=archive;this.now=now;this.tail=Promise.resolve();this.cache=new Map();}
 call(context,action,value){
  const scope=scopeKey(context),run=()=>this.execute(context,scope,action,value);
  const task=this.tail.catch(()=>{}).then(run);this.tail=task;return task;
 }
 async execute(context,scope,action,value){
  const now=this.now();
  if(action==='event'){const result=await this.archive.ingest(context,value,now);if(result)this.cache.delete(scope);return result;}
  if(action==='pulse'){await this.archive.pulse(context,value,now);return true;}
  if(action==='settings'){const result=await this.archive.configure(context,parseSettings(value));this.cache.delete(scope);return result;}
  if(action==='import'){const count=await this.archive.importHistory(context,value);this.cache.delete(scope);return count;}
  if(action==='forget'){if(typeof value!=='string' || value.length>180)throw new Error('观众标识无效');await this.archive.forget(context,value);this.cache.delete(scope);return true;}
  if(action==='clear'){await this.archive.clear(context,now);this.cache.delete(scope);return true;}
  if(action==='demo'){await seedPredictionDemo(this.archive,context,now);this.cache.delete(scope);return true;}
  if(action==='export')return this.archive.export(context,now);
  if(action==='report')return this.report(context,scope,now);
  throw new Error('预测操作无效');
 }
 async report(context,scope,now){
  const previous=this.cache.get(scope);
  if(previous && now-previous.asOf<15000)return previous;
  await this.archive.evaluate(context,now);
  const data=await this.archive.read(context,now),report=forecastReport(data);
  report.simulated=Boolean(data.simulated);
  const startAt=Math.ceil(now/1000)*1000,bucket=now,records=[];
  if(report.flow.status==='ready')records.push({id:`flow:${bucket}`,target:'diamonds',startAt,dueAt:startAt+5*MINUTE,horizonMinutes:5,...report.flow});
  for(const row of report.online.filter(r=>r.status==='ready'))records.push({id:`online:${row.horizonMinutes}:${bucket}`,target:'online',startAt,dueAt:startAt+row.horizonMinutes*MINUTE,...row});
  records.push({id:`snapshot:${Math.floor(now/60000)}`,target:'snapshot',asOf:now,dueAt:null,kind:'scenario',value:{revenue:report.revenue,month:report.month,historical:report.historical,pk:report.pk,rank:report.rank,thousand:report.thousand,semantics:report.semantics}});
  for(const record of records){record.asOf=now;record.modelVersion=MODEL_VERSION;record.sessionId=data.session?.key;}
  await this.archive.saveForecasts(context,records);
  const comparison=f=>({id:f.id,asOf:f.asOf,startAt:f.startAt,target:f.target,horizonMinutes:f.horizonMinutes,point:f.point,low:f.low,high:f.high,dueAt:f.dueAt,baseline:f.baseline || null,feedback:f.feedback || null,modelVersion:f.modelVersion,evaluation:f.evaluation || null});
  report.forecastHistory=data.forecasts.filter(f=>f.target!=='snapshot').slice(0,60).map(comparison);
  report.comparisons=(data.feedback || []).filter(f=>f.evaluation?.status==='scored' && f.dueAt<=now && f.evaluation.at<=now).sort((a,b)=>b.dueAt-a.dueAt).slice(0,120).map(comparison);
  report.timeline=data.minutes.filter(m=>m.sessionId===data.session?.key).slice(-90).map(m=>({at:m.at,diamonds:m.diamonds,online:m.online ?? null,onlineAt:m.onlineAt ?? null,coverageMs:m.coverageMs,chats:m.chats || 0,enters:m.enters || 0,giftUnits:m.giftUnits || 0}));
  report.sessions=data.sessions.filter(s=>s.endAt && s.complete).slice(0,100).map(s=>({startAt:s.startAt,endAt:s.endAt,diamonds:s.diamonds,complete:true}));
  const sessionUsers=data.users.filter(u=>u.sessionId===data.session?.key && !u.minor),payers=sessionUsers.filter(u=>(u.sessionGiftGroups || 0)>0).length;
  report.statistics={observedUsers:sessionUsers.length,payers,payerRatio:sessionUsers.length?payers/sessionUsers.length:null,basis:'有界的本机已识别互动样本，非全房间转化率'};
  report.samples=data.minutes.flatMap(m=>m.samples || []).slice(-8).map(s=>({text:s.text,at:s.at}));
  this.cache.set(scope,report);if(this.cache.size>20)this.cache.delete(this.cache.keys().next().value);return report;
 }
 close(){this.archive.close();this.cache.clear();}
}

export function createPredictionClient({transport,context,clock=Date.now}={}){
 const supported=Boolean(transport || globalThis.indexedDB);
 let local,failed='',latest=null,lastPulse=0,activeScope='',tail=Promise.resolve(),enabled=supported,paused=false;
 const scope=()=>{const c={...context()},key=c.anchor ? `${c.room}:${c.anchor}`:'';if(key!==activeScope){activeScope=key;latest=null;lastPulse=0;enabled=supported;}return c;};
 const perform=async(c,action,value)=>{
  if(!c.anchor)throw new Error('请先识别主播后使用预测');
  if(transport)return transport(action,value,c.anchor);
  if(!supported)throw new Error('当前环境没有可用的IndexedDB，预测档案未启用；直播互动仍可使用');
  local ||=new PredictionService({now:clock});return local.call(c,action,value);
 };
 const call=(action,value,c=scope())=>{const work=tail.catch(()=>{}).then(()=>perform(c,action,value));tail=work;return work;};
 const ingest=event=>{
  const c=scope();
  if(paused || !enabled || !['gift','chat','enter','start','end','room-audience'].includes(event.type) || !c.anchor)return Promise.resolve();
  const user=event.user,value={...event,id:event.id || event._journalId,receivedAt:event.receivedAt || clock(),user:user ? {id:/^\d{1,30}$/.test(String(user.id))?String(user.id):undefined,secUid:user.secUid || undefined,name:user.name,minor:user.minor}:undefined};
  return call('event',value,c);
 };
 return {ingest,call,scope:()=>{const c=scope();return `${c.room}:${c.anchor}`;},pause:()=>{paused=true;latest=null;},resume:()=>{paused=false;lastPulse=0;},enabled:()=>{scope();return enabled && !paused;},
  pulse:async info=>{const c=scope();if(paused || clock()-lastPulse<5000 || !c.anchor)return;lastPulse=clock();try{await call('pulse',info,c);failed='';}catch(e){failed=e.message;}},
  report:async()=>{const c=scope();try{const r=await call('report',undefined,c);if(`${scope().room}:${scope().anchor}`===`${c.room}:${c.anchor}`){latest=r;enabled=r.settings?.enabled!==false;failed='';}return r;}catch(e){failed=e.message;return {phase:'unavailable',reason:failed};}},
  context:()=>{scope();return latest && clock()-latest.asOf<30000 ? {scope:latest.scope,asOf:latest.asOf,modelVersion:latest.modelVersion,revenue:latest.revenue,month:latest.month,online:latest.online,pk:latest.pk,coverage:latest.coverage,basis:latest.basis}:null;},
  error:()=>failed,close:()=>local?.close()};
}
