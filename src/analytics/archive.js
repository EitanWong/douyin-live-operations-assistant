import Dexie from 'dexie';
import {MINUTE,DAY,LIMITS,MODEL_VERSION,parseEvent,parsePulse,parseSettings,parseHistory,scopeKey,userKey} from './schema.js';
import {analyzeChat,updateChatModel} from './semantics.js';
import {featureVector,learnGift,giftProbability} from './math.js';

const tables={meta:'&scope',settings:'&scope',minutes:'&key,[scope+at],scope',sessions:'&key,[scope+startAt],scope',users:'&key,[scope+lastAt],scope',seen:'&key,[scope+at],scope',progress:'&key,[scope+at],scope',forecasts:'&id,[scope+asOf],[scope+dueAt],scope',exposures:'&id,[scope+dueAt],scope',history:'&key,scope',outcomes:'&key,scope'};
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const blankMinute=(scope,at)=>({key:`${scope}:${at}`,scope,at,coverageMs:0,ranges:[],cash:[],diamonds:0,giftGroups:0,giftUnits:0,unknownCount:0,chats:0,amounts:[],intents:{},topics:{},emotions:{},samples:[]});
const newModel=()=>({trials:0,positives:0,weights:Array(6).fill(0),brier:0});

export class AnalyticsArchive {
 constructor({indexedDB=globalThis.indexedDB,IDBKeyRange=globalThis.IDBKeyRange,name='douyin-live-prediction'}={}){
  this.db=new Dexie(name,{indexedDB,IDBKeyRange});this.db.version(1).stores(tables);this.db.on('versionchange',()=>this.db.close());
 }
 transaction(work){return this.db.transaction('rw',this.db.tables,work);}
 async metadata(scope){return await this.db.meta.get(scope) || {scope,serial:0,sessionKey:null,lastPulse:0,connected:false,forgotten:[],model:newModel()};}
 async minute(scope,at){at=Math.floor(at/MINUTE)*MINUTE;return await this.db.minutes.get(`${scope}:${at}`) || blankMinute(scope,at);}
 async session(meta,event,now){
  let s=meta.sessionKey ? await this.db.sessions.get(meta.sessionKey):null;
  const eventAt=event.receivedAt ?? now;
  if(s && eventAt<s.startAt){return await this.db.sessions.where('scope').equals(meta.scope).filter(row=>row.startAt<=eventAt && (!row.endAt || row.endAt>=eventAt)).first() || null;}
  const roomChanged=event.roomId && s?.roomId && s.roomId!==event.roomId;
  if(roomChanged && s && !s.endAt){s.endAt=now;s.complete=false;await this.db.sessions.put(s);s=null;}
  if(!s || s.endAt){
   if(s?.endAt && eventAt<=s.endAt)return s;
   if(s?.endAt && event.type!=='start' && !roomChanged)return null;
   if(!s && event.type==='end')return null;
   s={key:`${meta.scope}:session:${eventAt}:${++meta.serial}`,scope:meta.scope,startAt:eventAt,endAt:0,startKnown:false,complete:false,roomId:event.roomId || '',diamonds:0,giftGroups:0,giftUnits:0,unknownCount:0,coverageMs:0};meta.sessionKey=s.key;meta.connected=false;
  }
  if(event.type==='start'){
   const start=event.startAt || event.at || event.receivedAt;
   if(event.source!=='platform-observed' && start<=now && start>now-2*DAY){s.startAt=Math.min(s.startAt,start);s.startKnown=true;}
  }
  if(event.roomId && !s.roomId)s.roomId=event.roomId;
  return s;
 }
 async ingest(context,input,now=Date.now()){
  const scope=scopeKey(context),event=parseEvent(input,now),uid=userKey(event.user),identity=event.groupId || event.id;
  if(event.anchorId && event.anchorId!==context.anchor)return false;
  if(event.type==='gift' && !identity)throw new Error('预测采集礼物事件缺少稳定标识');
  const hash=await digest(`${event.type}:${event.id || `${event.receivedAt}:${uid}:${event.text || ''}`}`);
  const group=event.type==='gift' ? await digest(`${event.roomId || ''}:${uid}:${event.giftId || event.giftName || ''}:${identity}`):null;
  const userHash=uid ? await digest(uid):'';
  return this.transaction(async()=>{
   const meta=await this.metadata(scope),settings=await this.settings(context);
   if(!settings.enabled || event.receivedAt<Math.max(meta.forgetBefore || 0,meta.cutoff || 0))return false;
   const key=`${scope}:${hash}`;
   if(event.type!=='gift' && await this.db.seen.get(key))return false;
   const session=await this.session(meta,event,now);if(!session)return false;
   const minute=await this.minute(scope,event.receivedAt);minute.sessionId=session.key;
   if(event.user?.minor && uid){await this.db.users.delete(`${scope}:${uid}`);await this.db.exposures.where('scope').equals(scope).filter(e=>e.userId===uid).delete();meta.model=newModel();}
   const identified=uid && settings.viewerEnabled && !event.user.minor && !meta.forgotten.includes(userHash);
   let user=identified ? await this.db.users.get(`${scope}:${uid}`):null;
   if(identified && !user)user={key:`${scope}:${uid}`,scope,userId:uid,name:'',lastAt:0,diamonds:0,giftGroups:0,chats:0,giftTimes:[]};
   if(user){
    user.name=String(event.user.name || user.name).slice(0,80);user.lastAt=Math.max(user.lastAt,event.receivedAt);user.minor ||=event.user.minor===true;
    if(user.sessionId!==session.key && session.key===meta.sessionKey){user.sessionId=session.key;user.sessionDiamonds=0;user.sessionGiftGroups=0;}
   }
   if(event.type==='gift')await this.applyGift(scope,group,event,session,minute,user,now);
   if(event.type==='enter')minute.enters=(minute.enters || 0)+1;
   if(event.type==='chat')this.applyChat(event,minute,user,meta);
   if(event.type==='room-audience' && Number.isFinite(event.onlineCount)){const samples=new Map((minute.onlineSamples || []).map(r=>[Math.floor(r.at/1000),r]));samples.set(Math.floor(event.receivedAt/1000),{at:event.receivedAt,value:event.onlineCount});minute.onlineSamples=[...samples.values()].sort((a,b)=>a.at-b.at).slice(-60);const last=minute.onlineSamples.at(-1);minute.online=last.value;minute.onlineAt=last.at;}
   if(event.type==='end'){
    session.endAt=Math.min(now,event.at || event.receivedAt);session.complete=session.startKnown && session.coverageMs/Math.max(MINUTE,session.endAt-session.startAt)>=.9 && !session.gap && !session.unknownCount;
    if(session.key===meta.sessionKey)meta.connected=false;
   }
   await this.db.minutes.put(minute);await this.db.sessions.put(session);await this.db.meta.put(meta);
   if(user)await this.db.users.put(user);
   if(event.type!=='gift')await this.db.seen.put({key,scope,at:event.receivedAt});
   return true;
  });
 }
 async applyGift(scope,group,event,session,minute,user,now){
  const key=`${scope}:${session.key}:${group}`,old=await this.db.progress.get(key) || {count:0,unit:null,parts:[]};
  const unit=event.unitValue>0?event.unitValue:old.unit,count=Math.max(old.count,event.count),added=count-old.count;
  const diamonds=count*(unit || 0)-old.count*(old.unit || 0),unknown=(unit?0:count)-(old.unit?0:old.count),groups=old.count===0?1:0;
  session.diamonds+=diamonds;session.unknownCount=Math.max(0,session.unknownCount+unknown);session.giftGroups+=groups;session.giftUnits+=added;
  const parts=[...(old.parts || []),...(added?[{at:event.receivedAt,count:added,fresh:true}]:[])];
  minute.giftGroups+=groups;minute.giftUnits+=added;
  for(const part of parts){
   const change=part.count*((unit || 0)-(part.fresh?0:old.unit || 0)),unknownChange=part.count*((unit?0:1)-(part.fresh?0:old.unit?0:1));
   if(!change && !unknownChange)continue;
   const m=Math.floor(part.at/MINUTE)*MINUTE===minute.at?minute:await this.minute(scope,part.at);
   m.sessionId=session.key;m.diamonds+=change;m.unknownCount=Math.max(0,m.unknownCount+unknownChange);
   const second=Math.floor(part.at/1000)*1000,entry=(m.cash ||= []).find(row=>row.at===second);
   if(entry){entry.diamonds+=change;entry.unknown+=unknownChange;}else m.cash.push({at:second,diamonds:change,unknown:unknownChange});
   if(unit && (part.fresh || !old.unit))m.amounts=[...m.amounts,...Array(Math.min(part.count,24)).fill(unit)].slice(-64);
   if(m!==minute)await this.db.minutes.put(m);
  }
  if(user){user.diamonds+=diamonds;if(user.sessionId===session.key){user.sessionDiamonds+=diamonds;user.sessionGiftGroups=(user.sessionGiftGroups || 0)+groups;}user.giftGroups+=groups;if(added){user.lastGiftAt=Math.max(user.lastGiftAt || 0,event.receivedAt);user.giftTimes=[...user.giftTimes,event.receivedAt].filter(t=>t>=now-10*MINUTE).slice(-2000);}}
  const compact=new Map();for(const part of parts){const at=Math.floor(part.at/1000)*1000;compact.set(at,(compact.get(at) || 0)+part.count);}
  await this.db.progress.put({key,scope,at:now,count,unit,parts:[...compact].map(([at,count])=>({at,count}))});
 }
 applyChat(event,minute,user,meta){
  const sem=analyzeChat(event.text);minute.chats++;
  meta.chatModel=updateChatModel(meta.chatModel,sem.intent,event.receivedAt);
  for(const [field,value] of [['intents',sem.intent],['topics',sem.topic],['emotions',sem.emotion]])minute[field][value]=(minute[field][value] || 0)+1;
  minute.samples=[...minute.samples,{userId:user?.userId || '',text:String(event.text || '').slice(0,160),at:event.receivedAt}].slice(-3);
  if(user){user.chats++;user.intent=sem.intent;user.emotion=sem.emotion;}
 }
 async pulse(context,info,now=Date.now()){
  const scope=scopeKey(context);info=parsePulse(info,now);
  return this.transaction(async()=>{
   const meta=await this.metadata(scope),settings=await this.settings(context);
   if(!settings.enabled)return;
   let session=meta.sessionKey ? await this.db.sessions.get(meta.sessionKey):null;
   if(info.connected && !session)session=await this.session(meta,{roomId:info.roomId},now);
   const delta=now-meta.lastPulse;
   if(info.connected && meta.connected && delta>0 && delta<=15000 && session && !session.endAt)await this.cover(scope,session,meta.lastPulse,now);
   if(session && !session.endAt && (delta>15000 && meta.lastPulse || info.gaps> (meta.gaps || 0))){session.gap=true;const m=await this.minute(scope,now);m.gap=true;await this.db.minutes.put(m);}
   meta.lastPulse=now;meta.connected=info.connected===true;meta.gaps=Math.max(meta.gaps || 0,info.gaps || 0);
   meta.pk=info.pk || null;
   for(const row of (info.outcomes || []).filter(row=>row.scoreFinal && row.endedAt<=now && ['win','loss','draw'].includes(row.outcome)))await this.db.outcomes.put({key:`${scope}:${row.battleKey}`,scope,...row});
   if(session)await this.db.sessions.put(session);await this.evaluateWithin(scope,meta,now);
   if(settings.viewerEnabled && info.connected && session && !session.endAt)await this.createExposures(scope,meta,now);
   if(!meta.prunedAt || now-meta.prunedAt>3600000){await this.prune(scope,now);meta.prunedAt=now;meta.cutoff=now-LIMITS.replayDays*DAY;}
   await this.db.meta.put(meta);
  });
 }
 async cover(scope,session,start,end){
  for(let at=start;at<end;){
   const until=Math.min(end,(Math.floor(at/MINUTE)+1)*MINUTE),m=await this.minute(scope,at),before=m.coverageMs;
   const ranges=[...(m.ranges || []),[at,until]].sort((a,b)=>a[0]-b[0]),merged=[];
   for(const range of ranges){const last=merged.at(-1);if(last && range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}
   m.ranges=merged;m.coverageMs=merged.reduce((sum,[a,b])=>sum+b-a,0);m.sessionId=session.key;await this.db.minutes.put(m);session.coverageMs+=m.coverageMs-before;at=until;
  }
 }
 async createExposures(scope,meta,now){
  const startAt=Math.floor(now/(5*MINUTE))*5*MINUTE;
  if(meta.exposureAt===startAt)return;meta.exposureAt=startAt;
  const users=await this.db.users.where('[scope+lastAt]').between([scope,now-5*MINUTE],[scope,now],true,true).reverse().limit(LIMITS.viewers).toArray();
  for(const u of users.filter(u=>!u.minor))await this.db.exposures.put({id:`${scope}:${u.userId}:${startAt}`,scope,userId:u.userId,startAt:now,dueAt:now+5*MINUTE,sessionId:meta.sessionKey,x:featureVector(u,now,meta.pk?.phase==='active'),probability:giftProbability(meta.model,featureVector(u,now,meta.pk?.phase==='active'))});
 }
 async settings(context){return parseSettings((await this.db.settings.get(scopeKey(context)))?.value || {});}
 async configure(context,value){const scope=scopeKey(context),settings=parseSettings(value);await this.db.settings.put({scope,value:settings});return settings;}
 async importHistory(context,value){const scope=scopeKey(context),rows=parseHistory(value),keys=await Promise.all(rows.map(row=>digest(JSON.stringify(row))));await this.transaction(async()=>{const count=await this.db.history.where('scope').equals(scope).count();if(count+rows.length>4800)throw new Error('参考样本最多4800条，请先导出并清理旧样本');for(let i=0;i<rows.length;i++)await this.db.history.put({key:`${scope}:${keys[i]}`,scope,...rows[i]});});return rows.length;}
 async saveForecasts(context,records){
  const scope=scopeKey(context);
  await this.transaction(async()=>{for(const record of records)if(!await this.db.forecasts.get(`${scope}:${record.id}`))await this.db.forecasts.add({...record,id:`${scope}:${record.id}`,scope});});
 }
 async observedWindow(scope,start,end){
  const minutes=await this.db.minutes.where('[scope+at]').between([scope,Math.floor(start/MINUTE)*MINUTE],[scope,end],true,false).toArray();
  let covered=0;
  for(const m of minutes)for(const [a,b] of m.ranges || [])covered+=Math.max(0,Math.min(end,b)-Math.max(start,a));
  return {minutes,complete:covered>=.9*(end-start) && !minutes.some(m=>m.gap || m.unknownCount)};
 }
 async evaluateWithin(scope,meta,now){
  const pending=await this.db.forecasts.where('[scope+dueAt]').between([scope,0],[scope,now],true,true).filter(f=>!f.evaluation && Number.isFinite(f.dueAt)).toArray();
  for(const f of pending){
   const window=await this.observedWindow(scope,f.startAt,f.dueAt);let actual=null;
   if(window.complete){
    if(f.target==='diamonds')actual=window.minutes.flatMap(m=>m.cash || []).filter(row=>row.at>=f.startAt && row.at<f.dueAt).reduce((s,row)=>s+row.diamonds,0);
    if(f.target==='online'){const row=window.minutes.flatMap(m=>m.onlineSamples || []).filter(r=>r.at>=f.dueAt-MINUTE && r.at<=f.dueAt).sort((a,b)=>a.at-b.at).at(-1);if(row)actual=row.value;}
   }
   f.evaluation=Number.isFinite(actual) ? {status:'scored',actual,error:actual-f.point,covered:actual>=f.low && actual<=f.high,at:now}:{status:'censored',actual:null,at:now};await this.db.forecasts.put(f);
  }
  const exposures=await this.db.exposures.where('[scope+dueAt]').between([scope,0],[scope,now],true,true).toArray();
  for(const e of exposures){
   const w=await this.observedWindow(scope,e.startAt,e.dueAt),u=await this.db.users.get(`${scope}:${e.userId}`);
   if(w.complete && u && !u.minor && e.sessionId===meta.sessionKey){const y=Number(u.giftTimes.some(at=>at>e.startAt && at<=e.dueAt));meta.model=learnGift(meta.model || newModel(),e.x,y,e.probability);}
   await this.db.exposures.delete(e.id);
  }
 }
 async evaluate(context,now=Date.now()){const scope=scopeKey(context);await this.transaction(async()=>{const m=await this.metadata(scope);await this.evaluateWithin(scope,m,now);await this.db.meta.put(m);});}
 async prune(scope,now){
  for(const [table,index,days] of [['minutes','at',LIMITS.minuteDays],['forecasts','asOf',LIMITS.forecastDays],['users','lastAt',LIMITS.userDays],['seen','at',LIMITS.replayDays],['progress','at',LIMITS.replayDays],['sessions','startAt',LIMITS.sessionDays]])await this.db[table].where(`[scope+${index}]`).between([scope,0],[scope,now-days*DAY],true,false).delete();
  await this.db.outcomes.where('scope').equals(scope).filter(row=>row.endedAt<now-LIMITS.sessionDays*DAY).delete();
 }
 async read(context,now=Date.now()){
  const scope=scopeKey(context);
  return this.db.transaction('r',this.db.tables,async()=>{
   const meta=await this.metadata(scope);
   const [settings,minutes,sessions,users,forecasts,history,outcomes]=await Promise.all([
    this.settings(context),this.db.minutes.where('[scope+at]').between([scope,now-LIMITS.reportMinutes*MINUTE],[scope,now],true,true).toArray(),
    this.db.sessions.where('[scope+startAt]').between([scope,0],[scope,now],true,true).reverse().limit(1000).toArray(),
    this.db.users.where('[scope+lastAt]').between([scope,now-30*DAY],[scope,now],true,true).reverse().limit(500).toArray(),
    this.db.forecasts.where('[scope+asOf]').between([scope,now-30*DAY],[scope,now],true,true).reverse().limit(1000).toArray(),
    this.db.history.where('scope').equals(scope).toArray(),this.db.outcomes.where('scope').equals(scope).toArray()]);
   return {scope,now,simulated:Boolean(meta.simulated),settings,minutes,sessions,users,forecasts,history,outcomes,model:meta.model,session:meta.sessionKey?await this.db.sessions.get(meta.sessionKey) || null:null,pk:meta.pk || null,chatModel:meta.chatModel || null,connected:meta.connected && now-meta.lastPulse<15000,lastPulse:meta.lastPulse};
  });
 }
 async forget(context,uid){
  const scope=scopeKey(context),hash=await digest(uid);
  return this.transaction(async()=>{
   const meta=await this.metadata(scope);if(meta.forgotten.length>=10000)throw new Error('个体排除名单已满，请导出后清空分析档案');meta.forgotten=[...new Set([...meta.forgotten,hash])];meta.model=newModel();
   await this.db.users.delete(`${scope}:${uid}`);await this.db.exposures.where('scope').equals(scope).filter(e=>e.userId===uid).delete();
   const minutes=await this.db.minutes.where('scope').equals(scope).filter(m=>m.samples?.some(s=>s.userId===uid)).toArray();
   for(const m of minutes){m.samples=m.samples.filter(s=>s.userId!==uid);await this.db.minutes.put(m);}
   await this.db.meta.put(meta);
  });
 }
 async clear(context,now=Date.now()){
  const scope=scopeKey(context);
  return this.transaction(async()=>{for(const name of Object.keys(tables))if(!['meta','settings'].includes(name))await this.db[name].where('scope').equals(scope).delete();await this.db.meta.put({scope,serial:0,lastPulse:0,connected:false,forgotten:[],forgetBefore:now,model:newModel()});});
 }
 async export(context,now=Date.now()){
  const scope=scopeKey(context),data={schemaVersion:1,exportedAt:now,scope,modelVersion:MODEL_VERSION};
  await this.db.transaction('r',this.db.tables,async()=>{for(const name of ['minutes','sessions','users','forecasts','history','outcomes'])data[name]=await this.db[name].where('scope').equals(scope).toArray();data.settings=await this.settings(context);const meta=await this.metadata(scope);data.simulated=Boolean(meta.simulated);data.models={gift:meta.model,chat:meta.chatModel};});return data;
 }
 close(){this.db.close();}
}
