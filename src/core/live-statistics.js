import { giftDate } from '../data/gifts.js';
import { CALENDAR_PERIODS, giftPeriodRange, summarizeGiftSessions } from './gift-analytics.js';
import { summarizeAnchorBattles } from './anchor-stats.js';

export const {giftSessionContext,giftHistoryContext,pkPeriodContext} = (()=>{
const number = value => Number.isFinite(value) ? value : null;
const text = value => typeof value === 'string' ? [...value].slice(0,80).join('') : '';
const fields = (row, keys) => Object.fromEntries(keys.map(key=>[key,number(row?.[key])]));
const totals = ['totalDiamonds','giftDiamonds','calibrationDiamonds','giftCount','unknownCount','estimatedIncome','calibrationIncome'];
const coverage = (rows, limit) => ({total:rows.length,included:Math.min(rows.length,limit),truncated:rows.length>limit});
const periods = now => {
  const date=giftDate(now);
  return {...Object.fromEntries(Object.entries(CALENDAR_PERIODS).map(([key,label])=>[key,{label,...giftPeriodRange(key,date)}])),
    yesterday:{label:'昨日',...giftPeriodRange('day',giftDate(now-86400000))},all:{label:'累计',start:null,end:null}};
};
const within = (at, range) => Number.isFinite(at) && (range.start === null || at>=range.start && at<range.end);
const contributor = row => ({name:text(row.name),...fields(row,['totalDiamonds','giftDiamonds','calibrationDiamonds','giftCount','unknownCount']),countsPartial:Boolean(row.countsPartial)});

// Project ledger display fields only. Raw session/user/gift IDs never leave the
// page; cumulative combo frames have already been reconciled by the ledger.
function giftSessionContext(session, now, {details = true} = {}) {
  if (!session) return null;
  const start=number(session.startAt), end=number(session.endAt);
  const result={startAt:start,endAt:end,startSource:text(session.startSource),endSource:text(session.endSource),
    durationMs:start>0 && start<=now && end!==null && (end===0 || end>=start) ? Math.min(end || now,now)-start : null,
    durationEstimated:session.startSource!=='platform' || Boolean(end && session.endSource!=='platform'),...fields(session,totals)};
  if (!details) return result;
  const users=[...(session.audience || [])].sort((a,b)=>(b.totalDiamonds || 0)-(a.totalDiamonds || 0));
  const highest=session.highestGift, gifts=highest?.gifts || [];
  return {...result,contributors:Array.isArray(session.audience) ? {...coverage(users,20),users:users.slice(0,20).map(contributor)} : null,
    highestGift:highest ? {unitDiamonds:number(highest.unitValue),tiedCount:number(highest.tiedCount),...coverage(gifts,20),truncated:highest.tiedCount>20 || gifts.length>20,gifts:gifts.slice(0,20).map(gift=>({
      name:text(gift.name),senders:{...coverage(gift.senders || [],20),names:(gift.senders || []).slice(0,20).map(user=>text(user.name))}
    }))} : null};
}

function giftHistoryContext(history, now) {
  if (!history) return null;
  const sessions=(history.sessions || []).filter(row=>Number.isFinite(row.startAt) && row.startAt>0 && row.startAt<=now);
  return {at:number(history.at),stale:!Number.isFinite(history.at) || history.at>now || now-history.at>120000,
    source:text(history.source),basis:'仅本机已采集的直播场次，按北京时间开播日期归属；不含无法归属场次的旧日账本，不代表主播全部直播。钻石含榜单补差，人民币为估算而非平台结算。',
    periods:Object.fromEntries(Object.entries(periods(now)).map(([key,range])=>{
      const selected=sessions.filter(row=>within(row.startAt,range)), summary=summarizeGiftSessions(selected,[],now);
      summary.calibrationIncome=selected.reduce((sum,row)=>sum+(row.calibrationIncome || 0),0);
      return [key,{label:range.label,startAt:range.start,endAt:range.end,...fields(summary,['sessions',...totals]),
        observedContributors:summary.audienceCount}];
    })),
    history:{...coverage(sessions,20),sessions:[...sessions].sort((a,b)=>b.startAt-a.startAt).slice(0,20).map(row=>giftSessionContext(row,now,{details:false}))}};
}

function pkPeriodContext(records, sessions, now) {
  // Match the dashboard's broadcast attribution, including PKs after midnight.
  // Without a known broadcast boundary the PK's own start time is explicit.
  const assigned=records.map(row=>{
    const at=row.startedAt || row.endedAt;
    const session=sessions.find(item=>row.roomId && item.roomId===row.roomId)
      || sessions.find(item=>at>=item.startAt && (!item.endAt || at<item.endAt));
    return {row,at:session?.startAt || at,estimated:!session};
  });
  return {basis:'按所属直播场次的北京时间开播日期归属；缺少场次边界时暂按 PK 开始时间归属，estimatedAssignments 标注此类场数。仅本机已观测记录。',
    periods:Object.fromEntries(Object.entries(periods(now)).map(([key,range])=>{
      const selected=assigned.filter(item=>within(item.at,range));
      return [key,{label:range.label,startAt:range.start,endAt:range.end,...summarizeAnchorBattles(selected.map(item=>item.row)),estimatedAssignments:selected.filter(item=>item.estimated).length}];
    }))};
}
return {giftSessionContext,giftHistoryContext,pkPeriodContext};
})();
