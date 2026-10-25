export const MODERATION_DEFAULTS = {
  enabled:false, detector:'ai', terms:['傻逼','煞笔','脑残','去死'],
  sensitiveTerms:['买卖毒品','出售枪支','人肉地址'], trollTerms:['主播滚出去','大家一起举报搞垮','骗钱垃圾主播'],
  severeTerms:['杀你全家','弄死你','公布你家地址'],
  categories:{sensitive:true,abuse:true,troll:true}, threshold:3, banThreshold:6, windowSec:600,
  warningsEnabled:true, warningTemplate:'{user}，请文明发言（第{count}次提醒）。',
  repeatAction:'mute', severeAction:'ban', escalateBan:true, minConfidence:0.9, maxPerHour:600
};
export const MODERATION_LABELS = {sensitive:'敏感话题',abuse:'辱骂',troll:'恶意挑衅'};
const normalizeModerationText = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\p{Cf}\s]/gu,'');
export function localModeration(text, config) {
  const content=normalizeModerationText(text);
  for (const [category,terms] of [['abuse',config.terms],['sensitive',config.sensitiveTerms],['troll',config.trollTerms]]) {
    if (!config.categories[category]) continue;
    const hit=terms.find(term=>normalizeModerationText(term) && content.includes(normalizeModerationText(term)));
    const severe=config.severeTerms.find(term=>normalizeModerationText(term) && content.includes(normalizeModerationText(term)));
    if (hit || category === 'abuse' && severe) return {category,severity:severe?'severe':'mild',confidence:1,reason:`命中词：${hit || severe}`,source:'local'};
  }
  return null;
}
export function parseModerationResult(output, text) {
  let result;
  try { result=JSON.parse(String(output).trim().replace(/^```(?:json)?\s*/iu,'').replace(/\s*```$/u,'')); }
  catch { throw new Error('AI 判定不是有效 JSON'); }
  if (!result || Array.isArray(result) || !['none','sensitive','abuse','troll'].includes(result.category)
    || !['none','mild','severe'].includes(result.severity) || !Number.isFinite(result.confidence) || result.confidence<0 || result.confidence>1
    || typeof result.reason!=='string' || result.reason.length>200 || typeof result.evidence!=='string' || result.evidence.length>1000
    || (result.category==='none') !== (result.severity==='none')
    || result.category!=='none' && (!result.evidence.trim() || !text.includes(result.evidence))) throw new Error('AI 判定格式或原文证据无效');
  return result.category==='none' ? null : {category:result.category,severity:result.severity,confidence:result.confidence,reason:result.reason,evidence:result.evidence,source:'ai'};
}

// Keep moderation separate from conversational AI: no model-generated action,
// UID, endpoint, or public warning is ever executed directly.
export class Moderation {
  constructor(engine, manage) {
    this.engine=engine; this.manage=manage; this.users=new Map(); this.records=[]; this.calls=[];
    this.pending=0; this.chain=Promise.resolve(); this.serial=0;
  }
  snapshot() { return {users:[...this.users],records:this.records.slice(-100),serial:this.serial,calls:this.calls}; }
  restore(value) {
    this.users=new Map((value?.users || []).filter(pair=>Array.isArray(pair) && typeof pair[0]==='string' && Array.isArray(pair[1]?.hits)).slice(-1000));
    this.records=(value?.records || []).filter(row=>row && typeof row.id==='number').slice(-100).map(row=>row.status==='pending'?{...row,status:'unknown',detail:'刷新前操作结果未知，不自动重试'}:row);
    this.serial=Number.isSafeInteger(value?.serial)?value.serial:0;
    this.calls=(value?.calls || []).filter(at=>Number.isFinite(at) && this.engine.now()-at<3600000).slice(-36000);
  }
  inspect(event, onClean) {
    const e=this.engine, config=e.config, rule=config.moderation, epoch=e.epoch, at=e.now();
    if (Number.isFinite(event.receivedAt) && (at-event.receivedAt>30000 || event.receivedAt-at>5000)) { e.log('moderation','历史或异常时间弹幕仅保留日志，不计入自动处置'); return; }
    const current=()=>e.running && e.epoch===epoch && e.config===config && e.now()-at<30000;
    if (rule.detector==='local') {
      const result=localModeration(event.text,rule);
      if (result) void this.apply(event,result,current,true).catch(error=>e.log('moderation',`处置未完成：${error.message}`));
      else onClean();
      return;
    }
    const fallback=reason=>{
      if (!current()) return;
      if (e.cooldown('moderation:fallback',30)) e.log('moderation',`${reason}；本地词库仅提醒，本次不自动禁言或封禁`);
      const result=localModeration(event.text,rule);
      if (result) return this.apply(event,result,current,false);
      // Unclassified messages must not trigger conversational automation.
    };
    if (!config.ai.enabled) { void Promise.resolve(fallback('AI 服务未启用')).catch(error=>e.log('moderation',error.message)); return; }
    if (this.pending>=20) { void Promise.resolve(fallback('AI 检测队列已满')).catch(error=>e.log('moderation',error.message)); return; }
    if (String(event.text).length>1000) { void Promise.resolve(fallback('弹幕超过 AI 检测长度上限')).catch(error=>e.log('moderation',error.message)); return; }
    this.pending++;
    this.chain=this.chain.then(async()=>{
      if (!current()) return;
      this.calls=this.calls.filter(time=>e.now()-time<3600000);
      if (this.calls.length>=rule.maxPerHour) return fallback('AI 检测达到每小时上限');
      this.calls.push(e.now()); e.stats.aiCalls++;
      const context=e.history.filter(row=>at-row.at>=0 && at-row.at<config.ai.contextAgeSec*1000).slice(-8).map(row=>({text:row.text}));
      let result;
      try {
        const output=await e.ai({...e.aiContext(),task:{kind:'moderation',data:{sensitiveTopics:rule.sensitiveTerms,categories:rule.categories}},target:{text:String(event.text).slice(0,1000)},context},config.ai);
        result=parseModerationResult(output,String(event.text).slice(0,1000));
      } catch { return fallback('AI 内容判定失败'); }
      if (!current()) return;
      if (!result) { onClean(); return; }
      if (!rule.categories[result.category]) { onClean(); return; }
      if (result.confidence<rule.minConfidence) {
        this.record(event,result,'review','review','置信度不足，仅提醒管理员核查'); return;
      }
      await this.apply(event,result,current,true);
    }).catch(error=>e.log('moderation',`内容处置异常：${error.message}`)).finally(()=>{this.pending--;e.changed();});
  }
  record(event,result,action,status,detail) {
    const row={id:++this.serial,at:this.engine.now(),user:{id:event.user?.id || '',name:event.user?.name || '观众'},text:String(event.text).slice(0,300),...result,action,status,detail};
    this.records.push(row); this.records=this.records.slice(-100);
    this.engine.log('moderation',`${row.user.name}：${MODERATION_LABELS[result.category]} · ${detail}（${result.reason}）`);
    this.engine.changed(); return row;
  }
  async apply(event,result,current,canAct) {
    if (!current()) return;
    const e=this.engine, rule=e.config.moderation, user=event.user || {}, now=e.now();
    // A nickname is neither an identity nor a safe counter key.
    const key=user.id ? `uid:${user.id}` : user.secUid ? `sec:${user.secUid}` : '';
    let state=key && this.users.get(key);
    if (!state || !state.hits.some(hit=>now-hit.at<rule.windowSec*1000)) state={hits:[],actions:[]};
    state.hits=state.hits.filter(hit=>now-hit.at<rule.windowSec*1000);
    state.hits.push({at:now,confirmed:canAct}); state.hits=state.hits.slice(-100);
    if (key) { this.users.delete(key);this.users.set(key,state); }
    while (this.users.size>1000) this.users.delete(this.users.keys().next().value);
    const count=state.hits.length, confirmed=state.hits.filter(hit=>hit.confirmed).length;
    const action=result.severity==='severe'?rule.severeAction:rule.escalateBan && confirmed>=rule.banThreshold?'ban':confirmed>=rule.threshold?rule.repeatAction:'notify';
    if (action==='notify' || !canAct) {
      this.record(event,result,'notify','warned',`${count}/${rule.threshold} 次${!canAct?' · 本地降级提醒':''}`);
      if (rule.warningsEnabled && key) {
        const name=String(user.name || '观众').replace(/[\r\n{}<>@]/g,'').slice(0,12);
        e.enqueue('moderation',rule.warningTemplate.replace(/\{user\}/g,name).replace(/\{count\}/g,String(count)),{moderationWarning:true});
      }
      return;
    }
    if (!key || !/^\d+$/.test(user.id || '')) { this.record(event,result,action,'unavailable','缺少可靠 UID，请管理员手动核查'); return; }
    if (state.actions.includes(action) || state.actions.includes('ban')) { this.record(event,result,'notify','observed',`${count} 次 · 本时间窗已有管理操作，不重复提交`); return; }
    if (e.config.mode==='preview') { this.record(event,result,action,'preview',`仅预览：将${action==='ban'?'封禁':'禁言'}，未执行`); return; }
    state.actions.push(action);
    const row=this.record(event,result,action,'pending',`准备${action==='ban'?'封禁':'禁言'}（${count} 次）`);
    // Persist the attempt before crossing the page boundary. A refresh cannot
    // turn an unknown destructive request into an automatic second request.
    try { await e.checkpoint(); }
    catch { row.status='unavailable';row.detail='状态保存失败，未执行管理操作';e.log('moderation',row.detail);e.changed();return; }
    if (!current()) {row.status='cancelled';row.detail='已暂停、超时或配置变更，取消操作';e.changed();return;}
    try {
      const response=await this.manage(action,user,current);
      row.status=response?.simulated?'simulated':response?.submitted===true?'accepted':response?.unknown?'unknown':'unavailable';
      row.detail=response?.simulated?`模拟${action==='ban'?'封禁':'禁言'}，未调用平台`:response?.submitted===true?`平台已接受${action==='ban'?'封禁':'禁言'}请求`:response?.reason || '管理能力不可用，请手动核查';
    } catch { row.status='unknown';row.detail='管理结果未知，不自动重试，请核查平台状态'; }
    e.log('moderation',`${user.name || user.id}：${row.detail}`);e.changed();
  }
}
