import { anchorEscape } from './stat-visuals.js';

export const fanclubNumber=value=>typeof value==='string' && /^\d+$/.test(value) ? value.replace(/\B(?=(\d{3})+(?!\d))/g,',') : '未知';
export function fanclubMemberRows(members) {
  return members.length ? members.map(row=>`<tr><td>${row.position}</td><td>${anchorEscape(row.name || '昵称未采集')}</td><td>${row.level ?? '未知'}</td><td>${anchorEscape(row.badgeName || '未显示')}</td><td>${anchorEscape(row.intimacyDisplay || fanclubNumber(row.intimacy))}${row.intimacyApproximate ? '（缩略）' : ''}</td></tr>`).join('') : '<tr><td colspan="5">打开原生粉丝团成员页后自动采集；未加载的成员保持未知。</td></tr>';
}
export function fanclubActivities(rows) {
  return rows?.length ? rows.slice(0,10).map(row=>`<p>${anchorEscape(row.text || `${row.name || '观众'}${row.action==='join' ? '加入粉丝团' : row.action==='upgrade' ? '粉丝团等级提升' : '粉丝团状态更新'}`)}</p>`).join('') : '<p class="empty">暂无已观测的加入、升级或粉丝团播报。</p>';
}
