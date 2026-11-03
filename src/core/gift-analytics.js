import { giftDate } from '../data/gifts.js';

const ANALYTICS_DAY = 86400000, ANALYTICS_OFFSET = 8 * 3600000;
export const CALENDAR_PERIODS = {day:'今日',week:'本周',month:'本月',quarter:'本季',year:'本年'};

// Calendar boundaries never depend on the computer's timezone. Weeks start Monday.
export function giftPeriodRange(period, date = giftDate()) {
  if (!Object.hasOwn(CALENDAR_PERIODS,period)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const at = Date.parse(`${date}T00:00:00+08:00`);
  if (!Number.isFinite(at) || giftDate(at) !== date) return null;
  const d = new Date(at + ANALYTICS_OFFSET), year = d.getUTCFullYear(), month = d.getUTCMonth();
  const midnight = (y,m,day=1) => Date.UTC(y,m,day)-ANALYTICS_OFFSET;
  let start = at, end = at+ANALYTICS_DAY;
  if (period === 'week') { start -= ((d.getUTCDay()+6)%7)*ANALYTICS_DAY; end=start+7*ANALYTICS_DAY; }
  if (period === 'month') { start=midnight(year,month); end=midnight(year,month+1); }
  if (period === 'quarter') { const first=Math.floor(month/3)*3; start=midnight(year,first); end=midnight(year,first+3); }
  if (period === 'year') { start=midnight(year,0); end=midnight(year+1,0); }
  return {start,end,date,label:`${giftDate(start)} — ${giftDate(end-1)}`};
}

export function summarizeGiftSessions(sessions, allSessions = sessions, now = Date.now()) {
  const total = {sessions:sessions.length,totalDiamonds:0,giftDiamonds:0,calibrationDiamonds:0,giftCount:0,unknownCount:0,estimatedIncome:0};
  const users = new Map(), today = giftDate(now), todaySessions = new Map();
  for (const session of allSessions) if (giftDate(session.startAt) === today) for (const user of session.audience || []) {
    const ids=todaySessions.get(user.userId) || new Set(); ids.add(session.id); todaySessions.set(user.userId,ids);
  }
  for (const session of sessions) {
    for (const key of ['totalDiamonds','giftCount','unknownCount','estimatedIncome','calibrationDiamonds']) total[key] += session[key] || 0;
    total.giftDiamonds += session.giftDiamonds ?? session.totalDiamonds ?? 0;
    for (const user of session.audience || []) {
      if (!/^(?:uid:\d+|sec:.+)$/.test(user.userId || '')) continue;
      const row=users.get(user.userId) || {userId:user.userId,name:'',sessions:0,todaySessions:todaySessions.get(user.userId)?.size || 0,totalDiamonds:0,giftDiamonds:0,calibrationDiamonds:0,giftCount:0,unknownCount:0,countsPartial:false,lastAt:0};
      if (user.name && session.startAt >= row.lastAt) row.name=user.name;
      row.lastAt=Math.max(row.lastAt,session.startAt); row.sessions++;
      for (const key of ['totalDiamonds','giftDiamonds','calibrationDiamonds','giftCount','unknownCount']) row[key] += user[key] || 0;
      row.countsPartial ||= Boolean(user.countsPartial);
      users.set(user.userId,row);
    }
  }
  const audience=[...users.values()].sort((a,b)=>b.totalDiamonds-a.totalDiamonds || b.sessions-a.sessions || a.userId.localeCompare(b.userId));
  return {...total,audience,audienceCount:audience.length,unattributedDiamonds:Math.max(0,total.totalDiamonds-audience.reduce((sum,row)=>sum+row.totalDiamonds,0))};
}

export function giftAnalyticsTrend(sessions, period, date, now = Date.now()) {
  const range=giftPeriodRange(period,date);
  if (!range) return sessions.slice(0,30).reverse().map(session=>({label:giftDate(session.startAt).slice(5),startAt:session.startAt,...summarizeGiftSessions([session],[],now)}));
  const end=Math.min(range.end,Math.max(range.start,now+1)), buckets=[];
  for (let start=range.start;start<end;) {
    const d=new Date(start+ANALYTICS_OFFSET);
    const next=period === 'year' ? Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)-ANALYTICS_OFFSET
      : start+(period === 'quarter' ? 7 : 1)*ANALYTICS_DAY;
    const until=Math.min(next,range.end);
    buckets.push({label:period === 'year' ? `${d.getUTCMonth()+1}月` : giftDate(start).slice(5),startAt:start,endAt:until,
      ...summarizeGiftSessions(sessions.filter(session=>session.startAt>=start && session.startAt<until),[],now)});
    start=until;
  }
  return buckets;
}
