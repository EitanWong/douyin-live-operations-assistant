export const CONTEXT_SOURCES=Object.freeze({audience:'观众样本与互动',income:'本场收入与历史账本',pk:'PK、展馆与段位',predictions:'PK 预测与推演',roomEvents:'连麦、团播、榜单与购物状态',accounts:'所选公开主页与作品',health:'采集完整性'});
export const CONTEXT_DEFAULTS=Object.freeze(Object.fromEntries(Object.keys(CONTEXT_SOURCES).map(key=>[key,true])));

export function selectLiveSources(context,selection={}){
 const sources={...CONTEXT_DEFAULTS,...selection},c=context;
 if(!sources.audience){c.audience=null;c.audienceProfiles={total:0,included:0,users:[],sampleBasis:'已关闭观众上下文'};c.recentEvents=[];}
 if(!sources.income)c.income=null;
 if(!sources.pk)for(const key of ['pk','pkHistory','tasks','exhibition','rank','exhibitionRetention'])c[key]=null;
 if(!sources.predictions && c.pk){c.pk.estimates=null;c.pk.contributorActivity=null;c.pk.effectHistory=null;}
 if(!sources.roomEvents){c.roomEvents=[];c.roomSignals=[];}
 if(!sources.health)c.collectionHealth=null;
 c.coverage ??={};c.coverage.disabledSources=Object.keys(sources).filter(key=>!sources[key]);return c;
}

const text=value=>typeof value==='string' ? value.slice(0,160) : '';
const number=value=>typeof value==='number' && Number.isFinite(value) ? value : typeof value==='string' && /^\d{1,15}$/u.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null;
// Explicit projections preserve useful native details without copying nested protocol objects.
export function roomSignalContext(events,now,maxAge){
 const latest=new Map();for(const row of events){const at=row.receivedAt ?? row.at;if(Number.isFinite(at) && at<=now)latest.set(row.type,{row,at});}
 return [...latest.values()].slice(-20).map(({row:r,at})=>({
  type:r.type,at,stale:now-at>maxAge,text:text(r.text || r.description || r.content || r.title || r.display),
  total:number(r.total),fansCount:number(r.fansCount),messageType:number(r.messageType),
  members:(r.members || []).slice(0,12).map(m=>({name:text(m.user?.name),score:m.showScore ? number(m.score) : null,coverage:'公开成员榜采样；隐藏分值未知'})),
  linkedUsers:(r.linkedUsers || []).slice(0,12).map(m=>({name:text(m.user?.name),scoreDisplay:text(m.scoreDisplay),role:number(m.userRole)})),
  positions:(r.positions || []).slice(0,12).map(m=>({name:m.masked || m.hideStatus ? '' : text(m.activeName),status:number(m.status),masked:Boolean(m.masked || m.hideStatus)})),
  ranks:(r.ranks || []).slice(0,12).map(m=>({name:m.profileHidden ? '' : text(m.user?.name),score:m.profileHidden ? '' : text(m.score),hidden:Boolean(m.profileHidden)})),
  updates:(r.updates || []).slice(0,8).map(m=>({text:text(m.text),rank:number(m.ownerRank),countdown:number(m.countdown)})),
  categories:(r.categories || []).slice(0,8).map(m=>({name:text(m.name),type:text(m.type)})),
  coverage:'页面原生结构化采样；成员榜分值和收益字段单位未核实，不当作人民币收入或关系'
 }));
}
export function contextInventory(context,accountCount=0){
 const c=context || {};
 return [
  `近期弹幕 ${c.recentChat?.length || 0} 条；观众资料 ${c.audienceProfiles?.included || 0} 人（采样）`,
  `公开主页/作品 ${accountCount} 条；原生房间信号 ${c.roomSignals?.length || 0} 类`,
  `本场账本：${c.income ? c.income.stale ? '已过期' : '可用（估算）' : '未知或已关闭'}；PK：${c.pk ? c.pk.stale ? '已过期' : '可用' : '未知或已关闭'}`,
  `预测：${c.pk?.estimates ? 'PK 未校准推演可用' : '无可用预测'}；未接入的预测不会补造`,
  `采集完整性：${c.collectionHealth ? `${c.collectionHealth.connected ? '已连接' : '等待连接'}；已知缺口 ${c.collectionHealth.gaps ?? '未知'}` : '未知或已关闭'}`,
  `关闭来源：${c.coverage?.disabledSources?.map(key=>CONTEXT_SOURCES[key]).join('、') || '无'}；缺失、过期与截断按实际披露`
 ];
}
