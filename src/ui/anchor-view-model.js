import { summarizeAnchorBattles } from '../core/anchor-stats.js';

export const ANCHOR_PERIODS = {today:'今日','7':'近 7 日','30':'近 30 日',all:'累计'};

// One selection model drives metrics, charts, pagination and JSON export.
export function selectAnchorPeriod(report, period = 'today') {
  period = Object.hasOwn(ANCHOR_PERIODS, period) ? period : 'today';
  const allRows = report.battles || [], allTrend = report.trend || [];
  const days = period === 'today' ? 1 : period === 'all' ? 30 : Number(period);
  const trend = allTrend.slice(-days);
  const dates = new Set(trend.map(day => day.date));
  const rows = period === 'all' ? allRows : allRows.filter(row => row.date && dates.has(row.date));
  return {period, label:ANCHOR_PERIODS[period], rows, trend, summary:summarizeAnchorBattles(rows),
    range:period === 'all' ? '所有已观测场次；趋势展示最近 30 日' : `${trend[0]?.date || report.today?.date || '未知'} 至 ${trend.at(-1)?.date || report.today?.date || '未知'}`};
}
