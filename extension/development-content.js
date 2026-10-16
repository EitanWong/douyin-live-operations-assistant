// 独立开发心跳，每两秒通过扩展端口检查构建；直播网页不能通过 postMessage 触发更新。
(() => {
  if (!/^\/\d+\/?$/.test(location.pathname)) return;
  const port = chrome.runtime.connect({name:'live-assistant-development'});
  const ping = () => { try { port.postMessage({type:'check'}); } catch { clearInterval(timer); } };
  const timer = setInterval(ping, 2000);
  port.onDisconnect.addListener(() => clearInterval(timer));
  window.addEventListener('pagehide', () => { clearInterval(timer); port.disconnect(); }, {once:true});
  ping();
})();
