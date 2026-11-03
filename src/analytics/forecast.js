import {MINUTE,MODEL_VERSION,nextMonth} from './schema.js';
import {clamp,mean,variance,distribution,random,normal,gamma,compound,featureVector,giftProbability} from './math.js';
import {semanticSummary,nextChatIntent} from './semantics.js';
import {calibrateForecast,feedbackMetrics} from './feedback.js';

const paths=192;
const missing=(reason,unit='diamonds')=>({status:'insufficient-data',point:null,low:null,high:null,unit,reason,sampleSize:0,calibration:'unavailable'});
function estimate(values,method,n,unit='diamonds'){return {status:'ready',...distribution(values),unit,method,sampleSize:n,calibration:'uncalibrated',intervalLevel:.8};}
const validMinutes=(rows,now)=>rows.filter(m=>m.at+MINUTE<=now && m.at>=now-180*MINUTE && m.coverageMs>=54000 && !m.gap && !m.unknownCount);
function amountSampler(minutes){
 const amounts=minutes.flatMap(m=>m.amounts || []).filter(a=>a>0),groups=minutes.reduce((s,m)=>s+(m.giftUnits ?? m.giftGroups ?? 0),0),exposure=minutes.reduce((s,m)=>s+m.coverageMs/MINUTE,0);
 if(minutes.length<3 || !amounts.length)return null;
 return {amounts,groups,exposure,sample:(duration,r)=>compound(gamma(.5+groups,exposure,r)*duration,amounts,r)};
}
function revenueForecast(data,sampler,duration,observed=0){
 if(!sampler)return missing('需要至少3个有效完整分钟和已知价格礼物；缺失区间不按零计算');
 const r=random(`${data.scope}:${data.now}:${duration}:revenue`),samples=Array.from({length:paths},()=>observed+sampler.sample(duration,r));
 return {...estimate(samples,'gamma-poisson-empirical-marks',sampler.exposure),horizonMinutes:duration,observed,basis:'条件于计划剩余时长；未采集的已发生礼物不在此预测内，不代表平台结算'};
}
function onlineForecasts(minutes,now){
 const rows=minutes.filter(m=>m.at<=now && Number.isFinite(m.online) && m.onlineAt<=now && now-m.onlineAt<15*MINUTE && !m.gap).slice(-10);
 return [1,5,15].map(h=>{
  if(rows.length<3 || now-rows.at(-1).onlineAt>2*MINUTE)return {...missing('在线人数样本不足或已过期','people'),horizonMinutes:h};
  const changes=rows.slice(1).map((m,i)=>(m.online-rows[i].online)/Math.max(1,(m.onlineAt-rows[i].onlineAt)/MINUTE));
  const last=rows.at(-1).online,drift=clamp(mean(changes),-last*.1,last*.1),point=Math.max(0,last+drift*Math.sqrt(h)),spread=1.282*Math.sqrt((variance(changes)+Math.max(1,last*.05))*h);
  return {status:'ready',point,low:Math.max(0,point-spread),high:point+spread,unit:'people',horizonMinutes:h,method:'local-level-damped-trend',sampleSize:rows.length,calibration:'uncalibrated',intervalLevel:.8};
 });
}
function monthlyForecast(data){
 const rows=data.sessions.filter(s=>s.complete && s.endAt<=data.now && s.endAt>s.startAt && s.endAt-s.startAt>=15*MINUTE);
 const rates=rows.map(s=>s.diamonds/((s.endAt-s.startAt)/3600000));
 const period=nextMonth(data.now);
 if(rows.length<5)return {...missing('需要至少5场覆盖完整且已结束的直播；也可导入带来源的本人月报'),period,kind:'scenario'};
 const daysInMonth=(Date.parse(period.end)-Date.parse(period.start))/86400000,days=Math.min(data.settings.plannedDays,daysInMonth),r=random(`${data.scope}:${data.now}:month`);
 const samples=Array.from({length:paths},()=>{
  // A shared regime factor preserves positive dependence across planned days.
  const regime=Math.exp(normal(r)*.2-.02);let total=0;
  for(let d=0;d<days;d++)total+=rates[Math.floor(r()*rates.length)]*data.settings.hoursPerDay*regime;
  return total;
 });
 return {...estimate(samples,'session-bootstrap-shared-regime',rows.length),period,kind:'scenario',plannedDays:days,hoursPerDay:data.settings.hoursPerDay,basis:'假定按计划开播、近期经营状态可延续；从整月路径总额提取区间，非每日分位数相加'};
}
function historicalMonthly(data){
 const rows=(data.history || []).filter(r=>r.kind==='self' && r.month<new Date(data.now+8*3600000).toISOString().slice(0,7));
 if(rows.length<3)return null;
 const period=nextMonth(data.now),days=Math.min(data.settings.plannedDays,(Date.parse(period.end)-Date.parse(period.start))/86400000),r=random(`${data.scope}:${data.now}:monthly-import`);
 return {...estimate(Array.from({length:paths},()=>{const row=rows[Math.floor(r()*rows.length)];return row.diamonds/row.hours*days*data.settings.hoursPerDay;}),'authorized-monthly-bootstrap',rows.length),period,kind:'scenario',plannedDays:days,hoursPerDay:data.settings.hoursPerDay,basis:'按已导入本人月报的小时收益及所填未来排班推演；导入来源未经平台自动验证'};
}
export function historicalEstimate(input,history,now){
 if(input.month>=new Date(now+8*3600000).toISOString().slice(0,7))return {...missing('历史估算月份必须早于当前月份'),kind:'historical-estimate',month:input.month};
 const comparable=history.filter(r=>r.month<=new Date(now+8*3600000).toISOString().slice(0,7) && (!input.grade || r.grade===input.grade) && (!input.category || r.category===input.category));
 if(!comparable.length || !(input.hours>0))return {...missing('没有带来源的可比历史样本；段位本身不能恢复收入'),kind:'historical-estimate',month:input.month};
 const rates=comparable.map(r=>Math.log(Math.max(.01,r.diamonds/r.hours))),r=random(`${input.month}:${input.hours}:${input.grade}:history`),sd=Math.max(.5,Math.sqrt(variance(rates)));
 return {...estimate(Array.from({length:paths},()=>Math.exp(mean(rates)+normal(r)*sd)*input.hours),'conditional-log-rate',comparable.length),kind:'historical-estimate',month:input.month,
  sources:[...new Set(comparable.map(row=>row.source))],basis:'根据所填段位/品类筛选参考样本并假设小时收益可迁移；未经个人历史准确率验证，不回填观测账本'};
}
export function rankForecast(rules,outcomes,now){
 const rows=outcomes.filter(r=>r.scoreFinal && r.endedAt<=now && ['win','loss','draw'].includes(r.outcome));
 if(!rules?.source || rows.length<5)return {...missing('需要完整赛季积分规则及至少5场已确认终局','points'),probability:null,kind:'scenario'};
 const r=random(`rank:${now}:${rules.source}`),wins=rows.filter(row=>row.outcome==='win').length,losses=rows.filter(row=>row.outcome==='loss').length;
 const values=Array.from({length:paths},()=>{let score=rules.points;const a=gamma(wins+1,1,r),b=gamma(rows.length-wins+1,1,r),p=a/(a+b);
  for(let i=0;i<rules.plannedBattles;i++){const u=r();score=Math.max(0,score+(u<p ? rules.winPoints:u<p+(1-p)*losses/Math.max(1,rows.length-wins) ? -rules.lossPoints:0));}return score;});
 return {...estimate(values,'beta-binomial-season-simulation',rows.length,'points'),probability:values.filter(v=>v>=rules.promotionPoints).length/paths,kind:'scenario',ruleSource:rules.source,basis:'按已确认积分规则和所填计划场数推演；不含未知重置、保护或相对排名机制'};
}
function pkForecast(pk,now){
 const competitors=pk?.competitors || [],trend=pk?.trend || [];
 if(pk?.phase!=='active' || pk.dataQuality?.stale || competitors.length<2 || competitors.length>8 || competitors.some(c=>!c.scoreObserved || c.scoreAgeMs>15000) || !(pk.remainingMs>0) || trend.length<3)return {...missing('需新鲜的双方/多方比分、剩余时间和至少3次比分采样','pk-points'),probability:null};
 const rates=competitors.map(c=>{
  const scores=trend.filter(t=>t.at<=now).map(t=>({at:t.at,score:t.competitorScores?.[c.anchorId] ?? (competitors.length===2?(c.isSelf?t.selfScore:t.opponentScore):undefined)})).filter(t=>Number.isFinite(t.score));
  return scores.slice(1).map((t,i)=>Math.max(0,t.score-scores[i].score)/Math.max(1,(t.at-scores[i].at)/1000));
 });
 if(rates.some(row=>row.length<2))return {...missing('参战方比分时间线不足','pk-points'),probability:null};
 const r=random(`pk:${pk.key}:${now}`),seconds=pk.remainingMs/1000,counts=competitors.map(()=>({win:0,draw:0,final:[]}));
 for(let i=0;i<paths;i++){
  const regime=Math.exp(normal(r)*.3-.045),totals=competitors.map((c,j)=>c.score+Math.max(0,Math.round(mean(rates[j])*seconds*regime+Math.sqrt(Math.max(1,variance(rates[j]))*seconds)*normal(r))));
  const top=Math.max(...totals),ties=totals.filter(v=>v===top).length;
  totals.forEach((value,j)=>{counts[j].final.push(value);if(value===top)counts[j][ties>1?'draw':'win']++;});
 }
 const rows=counts.map((c,i)=>({name:competitors[i].name || '昵称未采集',isSelf:competitors[i].isSelf,win:c.win/paths,draw:c.draw/paths,loss:1-(c.win+c.draw)/paths,...distribution(c.final)}));
 return {status:'ready',unit:'pk-points',method:'joint-score-path-simulation',sampleSize:trend.length,rows,probability:rows.find(r=>r.isSelf)?.win ?? null,calibration:'uncalibrated',basis:'按近期计分速度和当前赛制延续推演；不把PK积分当钻石，不重复乘已计入比分的加成；未来道具变化未知'};
}
function viewerForecasts(data){
 const model=data.model || {},mature=model.trials>=50 && model.positives>=5 && model.trials-model.positives>=10;
 return data.users.filter(u=>!u.minor && data.now-u.lastAt<5*MINUTE).slice(0,50).map(u=>({id:u.userId,name:u.name,observedDiamonds:u.diamonds,observedGiftGroups:u.giftGroups,
  probability:mature ? giftProbability(model,featureVector(u,data.now,data.pk?.phase==='active')):null,status:mature?'ready':'insufficient-data',horizonMinutes:5,method:'online-logistic-empirical-base',sampleSize:model.trials || 0,calibration:'prequential',
  reasons:[`已观察${u.chats || 0}条弹幕`, `已观察${u.giftGroups || 0}组礼物`,u.intent==='support'?'近期文本有明确支持表达':'没有明确送礼表达'],intent:u.intent || 'unknown',
  basis:'仅近期互动的可识别用户；预测未来5分钟本房间可观察送礼，不证明在线、财力或真实心理'}));
}
function thousandForecast(data,sampler){
 const users=data.users.filter(u=>!u.minor && u.sessionId===data.session?.key).slice(0,100),known=users.filter(u=>u.sessionDiamonds>=1000).length;
 if(!sampler || !users.length)return {...missing('已识别观众或礼物价格样本不足','people'),known,rows:[]};
 const r=random(`thousand:${data.scope}:${data.now}`),hits=users.map(()=>0),tops=users.map(()=>0),counts=[];
 const totalWeight=users.reduce((s,u)=>s+u.sessionDiamonds+20,0);
 for(let i=0;i<paths;i++){
  const lambda=gamma(.5+sampler.groups,sampler.exposure,r)*data.settings.remainingMinutes,totals=users.map((u,j)=>{
   const v=u.sessionDiamonds+compound(lambda*(u.sessionDiamonds+20)/totalWeight,sampler.amounts,r);if(v>=1000)hits[j]++;return v;});
  counts.push(totals.filter(v=>v>=1000).length);const top=[...totals].sort((a,b)=>b-a)[Math.min(2,totals.length-1)];totals.forEach((v,j)=>{if(v>=top)tops[j]++;});
 }
 return {...estimate(counts,'contribution-share-joint-simulation',users.length,'people'),known,scope:'observed-users-only',rows:users.map((u,i)=>({name:u.name,userId:u.userId,observed:u.sessionDiamonds,reachProbability:hits[i]/paths,topThreeProbability:tops[i]/paths})).sort((a,b)=>b.observed-a.observed).slice(0,20),
  basis:'仅已识别贡献者，假定未来贡献份额延续；新进/静默观众未知，不能解释为官方完整千票榜；席位含并列'};
}
export function forecastReport(data){
 const minutes=validMinutes(data.minutes.filter(m=>!m.sessionId || m.sessionId===data.session?.key),data.now),fresh=data.connected!==false && !data.session?.endAt && data.settings.enabled,sampler=fresh?amountSampler(minutes):null,observed=data.session?.diamonds || 0;
 const viewers=data.settings.viewerEnabled ? viewerForecasts(data):[];
 const history=data.feedback || [];
 const revenue=revenueForecast(data,sampler,data.settings.remainingMinutes,observed),flow=calibrateForecast(revenueForecast(data,sampler,5),'diamonds',history,data.now);
 const online=onlineForecasts(fresh?data.minutes:[],data.now).map(row=>calibrateForecast(row,'online',history,data.now));
 const month=monthlyForecast(data);const forecastMonth=month.status==='ready'?month:historicalMonthly(data) || month;
 const evaluated=data.forecasts.filter(f=>f.evaluation?.status==='scored' && f.asOf<data.now),numeric=evaluated.filter(f=>f.target==='diamonds' && Number.isFinite(f.evaluation.error));
 return {phase:!data.settings.enabled?'disabled':fresh?'ready':'stale',asOf:data.now,observedDiamonds:observed,modelVersion:MODEL_VERSION,scope:data.scope,revenue,flow,online,month:forecastMonth,
  feedback:{targets:feedbackMetrics(history,data.now),calibrations:[{target:'diamonds',horizonMinutes:5,...flow.feedback},...online.map(row=>({target:'online',horizonMinutes:row.horizonMinutes,...row.feedback}))]},
  historical:historicalEstimate({month:data.settings.historyMonth,hours:data.settings.historyHours,grade:data.settings.grade,category:data.settings.category},data.history || [],data.now),
  pk:pkForecast(data.pk,data.now),rank:rankForecast(data.settings.rankRules || {},data.outcomes || [],data.now),viewers,thousand:thousandForecast(data,sampler),
  semantics:{...semanticSummary(data.minutes.filter(m=>m.at<=data.now && m.at>=data.now-10*MINUTE)),nextIntent:data.now-(data.chatModel?.lastAt || 0)<=5*MINUTE?nextChatIntent(data.chatModel):[],method:'smoothed-intent-markov',evaluation:{scored:data.chatModel?.scored || 0,logLoss:data.chatModel?.scored?data.chatModel.logLoss/data.chatModel.scored:null},basis:'下一条弹幕规则意图的平滑一阶转移模型；边预测边评分，仅验证规则标签，不预测原话或真实心理'},
  coverage:{validMinutes:minutes.length,minutes:data.minutes.length,observedMs:data.session?.coverageMs || 0,unknownCount:data.session?.unknownCount || 0,startKnown:Boolean(data.session?.startKnown),connected:data.connected,lastPulse:data.lastPulse},
  evaluation:{scored:evaluated.length,censored:data.forecasts.filter(f=>f.evaluation?.status==='censored').length,mae:numeric.length?mean(numeric.map(f=>Math.abs(f.evaluation.error))):null,
   coverage:numeric.length?mean(numeric.map(f=>Number(f.evaluation.covered))):null,viewerTrials:data.model?.trials || 0,viewerBrier:data.model?.trials?data.model.brier/data.model.trials:null,buckets:data.model?.buckets || [],targets:['diamonds','online'].map(target=>{const rows=evaluated.filter(f=>f.target===target);return {target,n:rows.length,mae:rows.length?mean(rows.map(f=>Math.abs(f.evaluation.error))):null,coverage:rows.length?mean(rows.map(f=>Number(f.evaluation.covered))):null};})},
  settings:data.settings,retention:{minuteDays:45,forecastDays:30,userDays:30},basis:'模型区间未经独立留出集验证；所有人民币金额按所填结算系数条件估算，不是平台结算'};
}
