import { readExhibitionRetention } from '../src/browser/exhibition-retention.js';

// 仅在已知直播指标 iframe 读取可见文案；请求/协议数据缺失时作为后备来源。
const indicatorURL = new URL(location.href);
const anchorId = indicatorURL.searchParams.get('anchor_id_str') || indicatorURL.searchParams.get('anchor_id');
const roomId = indicatorURL.searchParams.get('room_id');
if (window !== window.top && /^\d{1,30}$/.test(anchorId || '') && /^\d{1,30}$/.test(roomId || '')) {
  let last = '', lastAt = 0;
  const poll = async () => {
    if (!chrome.runtime?.id) return;
    const value = readExhibitionRetention(document), now = Date.now();
    const key = JSON.stringify(value);
    if (value && (key !== last || now-lastAt >= 30000)) {
      try {
        const result = await chrome.runtime.sendMessage({type:'exhibition-indicator',event:{
          type:'anchor-exhibition-retention',source:'native-indicator',anchorId,roomId,
          id:`retention:frame:${now}`,receivedAt:now,...value}});
        if (result?.ok) {last=key;lastAt=now;}
      } catch { /* 页面或扩展更新后由新脚本恢复采集。 */ }
    }
  };
  void poll();
  const timer = setInterval(()=>{void poll();},3000);
  window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
}
