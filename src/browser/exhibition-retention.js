// 只解析平台明确展示的展馆保级文案，不把展馆档次当作 PK 段位。
export function parseExhibitionRetention(value) {
  const text = String(value || '').replace(/\s+/g,'').slice(0,200);
  if (!/展馆/.test(text)) return null;
  const match = text.match(/(?:还差|还需|差)(\d{1,4})款(?:礼物)?(?:即可|可)?保级/);
  const kept = /(?:已保级|保级成功|保级已完成)/.test(text);
  if (!match && !kept || match && kept && Number(match[1]) !== 0) return null;
  return {name:text.match(/([\p{Script=Han}]{0,8}展馆)/u)?.[1] || '展馆',
    remaining:match ? Number(match[1]) : 0, text};
}

export function retentionFromIndicatorResponse(response, now = Date.now()) {
  if (response?.status_code !== 0) return null;
  const data = response.data, role = data?.role || 'user';
  const view = data?.banner_detail?.role2views?.[role] || data?.banner_detail?.role2views?.user;
  if (!view || Number(view.expireTime) > 0 && now > Number(view.expireTime)) return null;
  const found = new Map();
  for (const banner of (Array.isArray(view.banners) ? view.banners : []).slice(0,20)) {
    if (Number(banner.start_time || banner.startTime) > now || Number(banner.end_time || banner.endTime) > 0 && Number(banner.end_time || banner.endTime) < now) continue;
    const strings = [];
    let visited = 0;
    const collect = (value,depth) => {
      if (++visited > 150 || depth > 6) return;
      if (typeof value === 'string' && value.length <= 200 && !/https?:|sslocal:/.test(value)) strings.push(value);
      else if (value && typeof value === 'object') for (const item of Object.values(value).slice(0,30)) collect(item,depth+1);
    };
    collect(banner.props || banner[`${banner.component}_props`],0);
    const value = parseExhibitionRetention(strings.join(''));
    if (value) found.set(`${value.name}:${value.remaining}`,value);
  }
  return found.size === 1 ? [...found.values()][0] : null;
}

export function readExhibitionRetention(document) {
  const root = document.querySelector('[data-e2e="room-info-bar"], #room_info_bar, [class*="room_info_bar"]') || document.body;
  if (!root) return null;
  const values = new Map();
  const candidates = document.evaluate?.('/html/body/div/div/div/div/div/div/div[1]/div[2]/div/div[2]/div',document,null,9,null)?.singleNodeValue;
  const nodes = [...(candidates ? [candidates] : []), ...root.querySelectorAll('div,span,p')].slice(0,500);
  for (const node of nodes) {
    if (node.closest('#chatroom, [data-e2e*="chat"], [data-live-assistant], [role="dialog"]')) continue;
    const text = node.textContent || '';
    if (text.length > 200) continue;
    let visible = true;
    for (let el=node; el; el=el.parentElement) {
      const style = document.defaultView?.getComputedStyle(el);
      if (el.hidden || el.getAttribute('aria-hidden') === 'true' || style?.display === 'none' || style?.visibility === 'hidden') {visible=false;break;}
    }
    const value = visible && parseExhibitionRetention(text);
    if (value) values.set(`${value.name}:${value.remaining}`,value);
  }
  return values.size === 1 ? [...values.values()][0] : null;
}
