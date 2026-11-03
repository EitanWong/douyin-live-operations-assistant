import { fanclubFrameContext } from '../data/fanclub.js';
export { fanclubFrameContext };

function fanclubVisible(node,doc) {
  for (let element=node;element;element=element.parentElement) {
    if (element.hidden || element.getAttribute('aria-hidden')==='true') return false;
    const style=doc.defaultView?.getComputedStyle(element);
    if (style?.display==='none' || style?.visibility==='hidden') return false;
  }
  return true;
}
function fanclubDOMMember(row,index) {
  const display=row.querySelector('.fmlchlci-right')?.textContent.trim() || '';
  const match=display.replace(/[,，]/g,'').match(/^(\d+(?:\.\d+)?)(万|亿)?$/);
  const count=match ? Number(match[1])*(match[2]==='亿' ? 1e8 : match[2]==='万' ? 1e4 : 1) : null;
  const badge=row.querySelector('.webcast-fansclub-badge__normal, .webcast-fansclub-badge');
  const level=(badge?.getAttribute('src') || badge?.style.borderImageSource || '').match(/\/(?:star_guard|fansclub_new)_advanced_badge_(\d{1,3})_xmp\.png(?:[~"')]|$)/)?.[1];
  return {position:index+1,name:row.querySelector('.fansclub-list-item-nickname')?.textContent.trim().slice(0,160) || '',
    level:level ? Number(level) : null,badgeName:row.querySelector('.webcast-fansclub-badge__name')?.textContent.trim() || '',
    intimacy:Number.isSafeInteger(count) ? String(count) : null,intimacyDisplay:display,intimacyApproximate:Boolean(match?.[2])};
}
export function readFanclubMembers(doc) {
  const headers=[...doc.querySelectorAll('.fmlc-hasfans-header-left')].filter(node=>fanclubVisible(node,doc));
  if (headers.length!==1) return null;
  const summary=headers[0].textContent.replace(/\s/g,'').match(/^共([\d,，]+)位["“]?粉丝["”]?[,，]([\d,，]+)位勋章点亮中$/);
  if (!summary) return null;
  const rows=[...doc.querySelectorAll('.list-scroll .item')].filter(row=>fanclubVisible(row,doc));
  return {title:doc.querySelector('.title-bar-text')?.textContent.trim() || '',fansCount:summary[1].replace(/[,，]/g,''),lightedCount:summary[2].replace(/[,，]/g,''),
    members:rows.slice(0,500).map(fanclubDOMMember),truncated:rows.length>500,hiddenInactive:/不活跃成员已隐藏/.test(doc.body?.textContent || '')};
}
