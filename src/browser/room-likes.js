// Native room totals can be abbreviated. Keep the displayed precision rather
// than presenting a rounded DOM number as an exact platform count.
export function readRoomLikes(doc) {
  const matches=[];
  for (const node of doc.querySelectorAll('*')) {
    if (node.children.length || node.closest('#chatroom, [data-live-assistant], script, style')) continue;
    const match=node.textContent.trim().match(/^(\d[\d,，]*(?:\.\d+)?)(万|亿)?\s*本场点赞$/);
    if (!match || !roomLikesVisible(node,doc)) continue;
    const total=Number(match[1].replace(/[,，]/g,''))*(match[2]==='亿' ? 1e8 : match[2]==='万' ? 1e4 : 1);
    if (!Number.isSafeInteger(total) || total<0) continue;
    matches.push({total,display:match[1]+(match[2] || ''),approximate:Boolean(match[2])});
  }
  return matches.length && matches.every(row=>row.display===matches[0].display) ? matches[0] : null;
}

function roomLikesVisible(node,doc) {
  for (let element=node;element;element=element.parentElement) {
    if (element.hidden || element.getAttribute('aria-hidden')==='true') return false;
    const style=doc.defaultView?.getComputedStyle(element);
    if (style?.display==='none' || style?.visibility==='hidden') return false;
  }
  return true;
}
