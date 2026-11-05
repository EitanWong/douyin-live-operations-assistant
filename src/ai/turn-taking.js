export const REPLY_FREQUENCIES=[['off','完全不接话'],['mentions','仅回应 @ 场控'],['quiet','克制陪伴（推荐）'],['natural','自然交流'],['every','每句都接']];
export const REPLY_FREQUENCY_HELP={
 off:'暂停 AI 弹幕对话、主播语音回应和主动互动，包括 @；直播感知仍可继续。欢迎、答谢、游戏和规则消息由各自开关控制。',
 mentions:'只回应明确 @ 场控的弹幕；不回应主播语音或主动起话题。',
 quiet:'按语境择机接话。普通接话、语音回应与主动互动合计每10分钟最多2条；AI 对话累计10条后暂停普通接话。明确 @ 优先回复，不受十分钟条数上限限制，保留发送间隔与调用额度。',
 natural:'更积极地参与对话。普通接话、语音回应与主动互动合计每10分钟最多4条；AI 对话累计16条后暂停普通接话。明确 @ 优先回复，不受十分钟条数上限限制，保留发送间隔与调用额度。',
 every:'对每条有效弹幕和每段已完成的主播语音尝试回应，不要求先被点名或提问，取消额外接话冷却和热聊避让。仍过滤噪声、重复观察及过期内容；模型速度、调用额度和发送限制可能导致跳过。'
};
const profiles={
 off:{gap:Infinity,ambientGap:Infinity,ambientLimit:0,totalLimit:0,proactiveGap:Infinity,quiet:Infinity},
 every:{gap:0,ambientGap:0,ambientLimit:Infinity,totalLimit:Infinity,proactiveGap:180000,quiet:30000},
 quiet:{gap:8000,ambientGap:90000,ambientLimit:2,totalLimit:10,proactiveGap:300000,quiet:45000},
 natural:{gap:5000,ambientGap:45000,ambientLimit:4,totalLimit:16,proactiveGap:180000,quiet:30000},
 mentions:{gap:8000,ambientGap:Infinity,ambientLimit:0,totalLimit:10,proactiveGap:Infinity,quiet:Infinity}
};
export const replyProfile=ai=>profiles[ai.replyFrequency] || profiles.quiet;
const ambient=mode=>['contextual','proactive','speech'].includes(mode);
export const conversational=job=>job.kind==='ai';
export const turnViewerKey=user=>user?.id ? `id:${user.id}` : user?.secUid ? `sec:${user.secUid}` : '';
export const jobTurn=job=>({mode:job.aiProactive ? job.aiProactive.pacingMode || (job.aiProactive.mode==='speech' ? 'speech' : 'proactive') : job.aiChat?.pacingMode || (job.aiChat?.replyMode==='direct' ? 'direct' : 'contextual'),userKey:job.aiChat?.userKey || ''});

// One writer (the engine) records actual submissions, never model attempts or SKIP.
export class TurnTaking {
 constructor(){this.turns=[];this.lastNotice=null;this.lastAssessment=null;this.lastSpeechAssessment=null;}
 recent(scope,now){return this.turns.filter(row=>row.scope===scope && now>=row.at && now-row.at<600000);}
 mode(userKey,scope,now){
  const last=this.recent(scope,now).at(-1);
  return userKey && last?.userKey===userKey && now-last.at<=90000 && last.mode!=='proactive' ? 'continuation' : 'contextual';
 }
 canSpeak({mode,scope,now,ai,roomMessages=0}){
  if(ai.replyFrequency==='off')return false;
  if(ai.replyFrequency==='every' && mode!=='proactive')return true;
  const p=replyProfile(ai),rows=this.recent(scope,now),last=rows.at(-1);
  if(ai.replyFrequency==='mentions' && mode!=='direct' || mode!=='direct' && rows.length>=p.totalLimit)return false;
  if(last && now-last.at<p.gap)return false;
  if(mode==='host-question')return rows.filter(row=>row.mode==='host-question').length<6;
  if(!ambient(mode))return true;
  if(rows.filter(row=>ambient(row.mode)).length>=p.ambientLimit)return false;
  if(['contextual','speech'].includes(mode) && roomMessages>=8)return false;
  const gap=mode==='proactive' ? Math.max(p.proactiveGap,ai.proactiveIntervalSec*1000) : mode==='speech' ? p.gap : p.ambientGap;
  const notice=this.lastNotice?.scope===scope ? this.lastNotice.at : -Infinity;
  return now-Math.max(last?.at ?? -Infinity,notice)>=gap;
 }
 canAssess(input){
  const speech=['speech','host-question'].includes(input.mode);
  if(input.ai.replyFrequency==='every')return !speech || this.lastSpeechAssessment?.scope!==input.scope || input.key!==this.lastSpeechAssessment.key;
  if(speech){const last=this.lastSpeechAssessment;return this.canSpeak(input) && (last?.scope!==input.scope || input.now-last.at>=(input.mode==='host-question' ? 8000 : 20000) && (input.key!==last.key || input.now-last.at>=90000));}
  return this.canSpeak(input) && (input.mode!=='contextual' || this.lastAssessment?.scope!==input.scope || input.now-this.lastAssessment.at>=20000);
 }
 assessed(scope,now,mode='contextual',key=''){if(mode==='speech')this.lastSpeechAssessment={scope,at:now,key};else this.lastAssessment={scope,at:now};}
 record(job,scope,now){
  if(!conversational(job)){this.lastNotice={scope,at:now};return;}
  this.turns=this.turns.filter(row=>now-row.at<600000).concat({scope,at:now,...jobTurn(job),text:job.text}).slice(-100);
 }
 context({mode,userKey,scope,now,ai,roomMessages}){
  return {mode:mode==='host-question' ? 'speech' : mode,...(mode==='host-question' ? {priority:mode} : {}),frequency:ai.replyFrequency,observedChatLast30Sec:roomMessages,
   recentTurns:this.recent(scope,now).slice(-6).map(row=>({at:row.at,mode:row.mode,text:row.text,sameViewer:Boolean(userKey && row.userKey===userKey)})),
   policy:REPLY_FREQUENCY_HELP[ai.replyFrequency] || REPLY_FREQUENCY_HELP.quiet};
 }
 snapshot(){return {turns:this.turns,lastNotice:this.lastNotice,lastAssessment:this.lastAssessment,lastSpeechAssessment:this.lastSpeechAssessment};}
 restore(value,now){
  const valid=row=>typeof row?.scope==='string' && row.scope.length<=1000 && Number.isFinite(row.at) && row.at<=now && now-row.at<600000;
  this.turns=(Array.isArray(value?.turns) ? value.turns : []).filter(row=>valid(row) && ['direct','continuation','contextual','proactive','speech','host-question'].includes(row.mode) && typeof row.userKey==='string' && row.userKey.length<=500 && typeof row.text==='string' && row.text.length<=300).sort((a,b)=>a.at-b.at).slice(-100);
  this.lastNotice=valid(value?.lastNotice) ? value.lastNotice : null;
  this.lastAssessment=valid(value?.lastAssessment) ? value.lastAssessment : null;
  this.lastSpeechAssessment=valid(value?.lastSpeechAssessment) && typeof value.lastSpeechAssessment.key==='string' && value.lastSpeechAssessment.key.length<=1800 ? value.lastSpeechAssessment : null;
 }
}
