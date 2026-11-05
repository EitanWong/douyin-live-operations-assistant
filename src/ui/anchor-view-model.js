import { summarizeAnchorBattles } from '../core/anchor-stats.js';
import { sessionTime } from './live-session-view.js';
import { CALENDAR_PERIODS, giftPeriodRange, summarizeGiftSessions, giftAnalyticsTrend } from '../core/gift-analytics.js';
import { giftDate } from '../data/gifts.js';

export const ANCHOR_PERIODS = {session:'当前场次',...CALENDAR_PERIODS,'7':'近 7 场','30':'近 30 场',all:'累计'};

// One selection model drives metrics, charts, pagination and JSON export.
export function selectAnchorPeriod(report, period = 'session', income = null, sessionId = '', date = giftDate(), now = Date.now()) {
  period = Object.hasOwn(ANCHOR_PERIODS, period) ? period : 'session';
  const known = new Map((income?.allSessions || income?.sessions || []).map(session => [session.id, session]));
  if (income?.currentSession) known.set(income.currentSession.id, income.currentSession);
  const allSessions = [...known.values()].sort((a,b) => b.startAt-a.startAt);
  const current = income?.currentSession || allSessions[0] || null;
  const selectedSession = sessionId ? known.get(sessionId) || current : current;
  const calendar=giftPeriodRange(period,date);
  const sessions = calendar ? allSessions.filter(session=>session.startAt>=calendar.start && session.startAt<calendar.end)
    : period === 'session' ? selectedSession ? [selectedSession] : [] : period === 'all' ? allSessions : allSessions.slice(0, Number(period));
  const allRows = report.battles || [];
  // PKs belong to the broadcast in which they started, including PKs ending after midnight.
  const assignment = new Map(allRows.map(row => {
    const at = row.startedAt || row.endedAt;
    return [row, allSessions.find(session => at >= session.startAt && (!session.endAt || at < session.endAt))?.id];
  }));
  const ids = new Set(sessions.map(session => session.id));
  const rows = period === 'all' ? allRows : allRows.filter(row => ids.has(assignment.get(row)));
  const trend = sessions.slice(0,30).reverse().map(session => ({...session, ...summarizeAnchorBattles(allRows.filter(row => assignment.get(row) === session.id))}));
  const label = period === 'session' ? sessionId && selectedSession?.id !== current?.id ? '所选场次' : selectedSession?.endAt ? '最近场次' : '当前场次' : ANCHOR_PERIODS[period];
  return {period, label, rows, trend, sessions, allSessions, selectedSession, calendar, summary:summarizeAnchorBattles(rows),
    gifts:summarizeGiftSessions(sessions,allSessions,now),giftTrend:giftAnalyticsTrend(sessions,period,date,now),
    range:calendar ? `${calendar.label} · ${sessions.length} 场直播` : sessions.length ? `${sessions.length} 场直播 · ${sessionTime(sessions.at(-1).startAt)} 至 ${sessions[0].endAt ? sessionTime(sessions[0].endAt) : '直播中'}` : '尚无已识别的直播场次'};
}
