// Small SVG-free visual primitives: shared scales, explicit unknown values,
// keyboard-readable data and theme tokens; no chart runtime or animation work.
export const anchorEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const anchorNumberFormat = new Intl.NumberFormat('zh-CN');
const anchorMoneyFormat = new Intl.NumberFormat('zh-CN', {style:'currency',currency:'CNY',maximumFractionDigits:2});
export const anchorNumber = value => Number.isFinite(value) ? anchorNumberFormat.format(value) : '未知';
export const anchorMoney = value => Number.isFinite(value) ? anchorMoneyFormat.format(value) : '未知';
export const anchorPercent = value => Number.isFinite(value) ? `${+(value * 100).toFixed(1)}%` : '未知';

export function statProgress(label, current, target) {
  const known = Number.isFinite(current) && current >= 0 && Number.isFinite(target) && target > 0;
  const percentage = known ? Math.min(100, current / target * 100) : 0;
  return `<div class="stat-progress-label"><span>${anchorEscape(label)}</span><span>${anchorNumber(current)} / ${anchorNumber(target)}</span></div><div class="stat-progress" ${known ? `role="progressbar" aria-label="${anchorEscape(label)}" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(current,target)}"` : `role="img" aria-label="${anchorEscape(label)}：进度未知"`}><span style="transform:scaleX(${percentage / 100})"></span></div>`;
}

export function statBars(points, {label, format = anchorNumber} = {}) {
  if (!points.length) return '<p class="empty">暂无已采集数据</p>';
  const maximum = Math.max(1, ...points.map(point => Number.isFinite(point.value) ? point.value : 0));
  return `<div class="stat-bars" role="list" aria-label="${anchorEscape(label)}" style="--stat-columns:${points.length}">${points.map(point => {
    const known = Number.isFinite(point.value), value = known ? format(point.value) : '未知';
    const description = `${point.date} · ${value}${point.note ? ` · ${point.note}` : ''}`;
    return `<div class="stat-bar" role="listitem" tabindex="0" aria-label="${anchorEscape(description)}" title="${anchorEscape(description)}"><span class="stat-bar-value">${anchorEscape(value)}</span><div class="stat-bar-track"><span class="stat-bar-fill" style="transform:scaleY(${known ? Math.max(0, point.value) / maximum : 0})"></span>${!known ? '<span class="stat-bar-unknown">?</span>' : ''}</div><time datetime="${anchorEscape(point.date)}">${anchorEscape(point.date.slice(5))}</time></div>`;
  }).join('')}</div>`;
}

export function statDistribution(summary) {
  const groups = [['wins','胜','win'],['losses','负','loss'],['draws','平','draw'],['pending','待确认','pending']];
  if (!summary.battles) return '<p class="empty">暂无已观测场次，胜率等待明确终局。</p>';
  return `<div class="stat-distribution" role="img" aria-label="${anchorEscape(groups.map(([key,label]) => `${label} ${summary[key]} 场`).join('，'))}">${groups.filter(([key]) => summary[key] > 0).map(([key,label,status]) => `<span data-outcome="${status}" style="flex:${summary[key]}" title="${label} ${summary[key]} 场"></span>`).join('')}</div>`;
}
