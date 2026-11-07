import {z} from 'zod';
import {audienceProfile,subjectKeySchema,subjectEpoch,profileSources,subjectRow} from './audience-profile.js';
export const RESEARCH_DEFAULTS=Object.freeze({enabled:false,profileEnabled:false,intervalSec:180,maxPerHour:3});
export const researchSettingsSchema=z.strictObject({enabled:z.boolean(),profileEnabled:z.boolean().default(false),intervalSec:z.number().int().min(60).max(3600),maxPerHour:z.number().int().min(1).max(10)});
export const continuousEnabled=config=>Boolean(config?.ai?.enabled && config.ai.assistant?.memoryEnabled!==false && config.ai.assistant?.research?.enabled);
const normalize=text=>text.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
function observations(memory,now,seen,includeAudience,turn,includeAccounts){
 const viewers=(includeAudience ? memory.audience?.viewers || [] : []).flatMap(v=>{
  const subject=subjectKeySchema.safeParse(v.key).success ? v.key : undefined,priority=subject ? audienceProfile(v,memory.anchor,now).research.priority : 0;
  return (v.statements || []).slice(-3).map(r=>({...r,kind:'chat',subject,epoch:subjectEpoch(memory.audience,subject),priority}));
 });
 const refresh=(includeAudience && includeAccounts ? memory.audience?.viewers || [] : []).flatMap(v=>{
  if(!subjectRow(memory.audience,v.key) || v.lastAt>now || now-v.lastAt>30*86400000)return [];
  const sources=profileSources(v,memory.audience.viewers);if(!sources.length)return [];
  return [{kind:'profile-refresh',subject:v.key,epoch:subjectEpoch(memory.audience,v.key),priority:0,at:now,sources,
   text:`复查${v.name || '该账号'}的抖音公开主页和已提及的公开事件，更新有来源的人物背景、明确自述和关系线索；保留未知与冲突，不按昵称认人，不推断私人生活、财富或送礼概率。`}];
 });
 const unattributed=(includeAudience ? memory.audience?.unattributed || [] : []).slice(-3).map(r=>({...r,kind:'chat',priority:0}));
 const media=(memory.perception?.observations || []).filter(r=>['audio','video','omni'].includes(r.kind) && r.isFinal!==false && Number.isFinite(r.endedAt) && r.endedAt>=r.at && r.endedAt<=now && !['[SILENCE]','[UNKNOWN]'].includes(r.text?.trim())).slice(-6).map(r=>({...r,priority:0}));
 const rows=[...viewers,...unattributed,...media,...refresh];
 const last=subject=>Math.max(0,...seen.filter(r=>r.subject===subject).map(r=>r.at));
 const fair=turn===2;
 return rows.filter(r=>typeof r.text==='string' && r.text.trim().length>=6 && Number.isFinite(r.at) && r.at<=now && now-r.at<300000)
  .sort((a,b)=>Number(a.kind==='profile-refresh')-Number(b.kind==='profile-refresh') || (fair ? Number(b.priority<2)-Number(a.priority<2) : 0) || b.priority-a.priority || last(a.subject)-last(b.subject) || b.at-a.at);
}
async function digest(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}
const observationKey=row=>digest(`${row.subject || 'unattributed'}:${row.epoch || 0}:${row.kind==='profile-refresh' ? row.kind : normalize(row.text)}`);
const researchEvidence=row=>({id:row.id,text:row.text.slice(0,1000),at:row.at,endedAt:row.endedAt,inputSource:row.inputSource,source:row.kind,identity:row.subject || 'unverified sampled conversation; speaker and visible identity unknown'});
export function researchEvidenceIsCurrent(context,archive){
 return (context || []).every(ref=>{
  if(!ref.id || !['chat','audio','video','omni'].includes(ref.source))return true;
  const rows=ref.source==='chat' ? (subjectKeySchema.safeParse(ref.identity).success ? subjectRow(archive?.audience,ref.identity)?.statements : archive?.audience?.unattributed) : archive?.perception?.observations;
  return (rows || []).some(row=>row.id===ref.id && row.at===ref.at && row.text.slice(0,1000)===ref.text && (ref.source==='chat' || row.kind===ref.source && row.endedAt===ref.endedAt));
 });
}

// Alarm-driven work discovery. No timer or long model request holds the page.
// Stable task IDs bridge the crash window between submission and watermark save.
export function createContinuousResearch({configs,read,store,submit,cancelDisabled,hasPending,now=Date.now}){
 let pending;
 const tick=async()=>{
  const values=await configs();await cancelDisabled(values);
  for(const [key,config] of Object.entries(values)){
   if(!/^live-assistant:config:\d+$/u.test(key) || !continuousEnabled(config))continue;
   const room=key.split(':').at(-1),anchor=String(config.anchorId),scope=`${room}:${anchor}`,parsed=researchSettingsSchema.safeParse({...RESEARCH_DEFAULTS,...config.ai.assistant.research});
   if(!parsed.success)continue;const settings=parsed.data;
   if(!/^\d{1,30}$/u.test(anchor) || hasPending(scope))continue;
   const at=now(),old=await store.readLoop(scope) || {scope,seen:[],calls:[],nextAt:0};
   const calls=old.calls.filter(t=>t<=at && at-t<3600000);if(old.nextAt>at || calls.length>=settings.maxPerHour)continue;
   const memory=await read(`live-assistant:live-memory:${room}:${anchor}`);if(memory?.anchor!==anchor)continue;
   const turn=(old.turn ?? old.seen.length)%3,seen=old.seen.filter(r=>at-r.at<86400000),available=observations(memory,at,seen,config.ai.contextSources?.audience!==false,turn,config.ai.contextSources?.accounts!==false && config.ai.accountCollection?.enabled!==false);let candidate,hash;
   for(const row of available){const key=await observationKey(row);if(!seen.some(r=>r.key===key)){candidate=row;hash=key;break;}}
   if(!candidate)continue;
   const batch=candidate.kind==='profile-refresh' ? [candidate] : [candidate,...available.filter(r=>r!==candidate && r.kind!=='profile-refresh' && r.subject===candidate.subject)].slice(0,6);
   const id=`auto-${(await digest(`${scope}:${hash}:${Math.floor(candidate.at/86400000)}`)).slice(0,64)}`;
   await submit({id,scope,question:candidate.text.trim().slice(0,1000),input:{anchor,...(candidate.subject ? {subject:candidate.subject,subjectEpoch:candidate.epoch} : {}),ai:config.ai,sources:candidate.sources || [],context:{now:at,persona:config.ai.persona,knowledge:config.ai.knowledge,
    context:batch.map(researchEvidence)}}});
   const nextSeen=[...seen,...await Promise.all(batch.map(async row=>({key:await observationKey(row),at,subject:row.subject,kind:row.kind})))],retained=[...nextSeen.filter(r=>r.kind==='profile-refresh'),...nextSeen.filter(r=>r.kind!=='profile-refresh').slice(-100)];
   await store.writeLoop({scope,turn:(turn+1)%3,updatedAt:at,seen:retained,calls:[...calls,at],nextAt:at+settings.intervalSec*1000});
  }
 };
 return {tick(){if(!pending)pending=tick().finally(()=>{pending=null;});return pending;}};
}
