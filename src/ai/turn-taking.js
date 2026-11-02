export const REPLY_FREQUENCIES=[['quiet','克制陪伴（推荐）'],['natural','自然交流'],['mentions','仅回应 @ 场控']];
const profiles={
 quiet:{gap:8000,ambientGap:90000,ambientLimit:2,totalLimit:10,proactiveGap:300000,quiet:45000},
 natural:{gap:5000,ambientGap:45000,ambientLimit:4,totalLimit:16,proactiveGap:180000,quiet:30000},
 mentions:{gap:8000,ambientGap:Infinity,ambientLimit:0,totalLimit:10,proactiveGap:Infinity,quiet:Infinity}
};
export const replyProfile=ai=>profiles[ai.replyFrequency] || profiles.quiet;
const ambient=mode=>['contextual','proactive'].includes(mode);
export const conversational=job=>job.kind==='ai';
export const turnViewerKey=user=>user?.id ? `id:${user.id}` : user?.secUid ? `sec:${user.secUid}` : '';
export const jobTurn=job=>({mode:job.aiProactive ? 'proactive' : job.aiChat?.pacingMode || (job.aiChat?.replyMode==='direct' ? 'direct' : 'contextual'),userKey:job.aiChat?.userKey || ''});

// One writer (the engine) records actual submissions, never model attempts or SKIP.
export class TurnTaking {
 constructor(){this.turns=[];this.lastNotice=null;this.lastAssessment=null;}
 recent(scope,now){return this.turns.filter(row=>row.scope===scope && now>=row.at && now-row.at<600000);}
 mode(userKey,scope,now){
  const last=this.recent(scope,now).at(-1);
  return userKey && last?.userKey===userKey && now-last.at<=90000 && last.mode!=='proactive' ? 'continuation' : 'contextual';
 }
 canSpeak({mode,scope,now,ai,roomMessages=0}){
  const p=replyProfile(ai),rows=this.recent(scope,now),last=rows.at(-1);
  if(ai.replyFrequency==='mentions' && mode!=='direct' || rows.length>=p.totalLimit)return false;
  if(last && now-last.at<p.gap)return false;
  if(!ambient(mode))return true;
  if(rows.filter(row=>ambient(row.mode)).length>=p.ambientLimit)return false;
  if(mode==='contextual' && roomMessages>=8)return false;
  const gap=mode==='proactive' ? Math.max(p.proactiveGap,ai.proactiveIntervalSec*1000) : p.ambientGap;
  const notice=this.lastNotice?.scope===scope ? this.lastNotice.at : -Infinity;
  return now-Math.max(last?.at ?? -Infinity,notice)>=gap;
 }
 canAssess(input){
  return this.canSpeak(input) && (input.mode!=='contextual' || this.lastAssessment?.scope!==input.scope || input.now-this.lastAssessment.at>=20000);
 }
 assessed(scope,now){this.lastAssessment={scope,at:now};}
 record(job,scope,now){
  if(!conversational(job)){this.lastNotice={scope,at:now};return;}
  this.turns=this.turns.filter(row=>now-row.at<600000).concat({scope,at:now,...jobTurn(job),text:job.text}).slice(-100);
 }
 context({mode,userKey,scope,now,ai,roomMessages}){
  return {mode,frequency:ai.replyFrequency,observedChatLast30Sec:roomMessages,
   recentTurns:this.recent(scope,now).slice(-6).map(row=>({at:row.at,mode:row.mode,text:row.text,sameViewer:Boolean(userKey && row.userKey===userKey)})),
   policy:'先判断是否轮到场控；频率上限不是发言任务。未点名且不确定对话归属时保持沉默。'};
 }
 snapshot(){return {turns:this.turns,lastNotice:this.lastNotice,lastAssessment:this.lastAssessment};}
 restore(value,now){
  const valid=row=>typeof row?.scope==='string' && row.scope.length<=1000 && Number.isFinite(row.at) && row.at<=now && now-row.at<600000;
  this.turns=(Array.isArray(value?.turns) ? value.turns : []).filter(row=>valid(row) && ['direct','continuation','contextual','proactive'].includes(row.mode) && typeof row.userKey==='string' && row.userKey.length<=500 && typeof row.text==='string' && row.text.length<=300).sort((a,b)=>a.at-b.at).slice(-100);
  this.lastNotice=valid(value?.lastNotice) ? value.lastNotice : null;
  this.lastAssessment=valid(value?.lastAssessment) ? value.lastAssessment : null;
 }
}
