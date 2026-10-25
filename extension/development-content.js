// 独立开发心跳，每两秒通过扩展端口检查构建；直播网页不能通过 postMessage 触发更新。
(() => {
  if (!/^\/\d+\/?$/.test(location.pathname)) return;
  let port, timer, stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    window.removeEventListener('pagehide', stop);
    // 扩展重载会让 connect、端口操作和监听器清理都失效。
    try { port?.onDisconnect.removeListener(disconnected); } catch {}
    try { port?.disconnect(); } catch {}
  };
  const disconnected = () => {
    // 在回调内读取 lastError，避免后台退出产生 Unchecked runtime.lastError。
    try { void chrome.runtime.lastError; } catch {}
    stop();
  };
  const ping = () => {
    if (stopped) return;
    try { port.postMessage({type:'check'}); } catch { stop(); }
  };
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.connect) return;
    port = chrome.runtime.connect({name:'live-assistant-development'});
    port.onDisconnect.addListener(disconnected);
    if (stopped) return;
    window.addEventListener('pagehide', stop, {once:true});
    timer = setInterval(ping, 2000);
    ping();
  } catch { stop(); }
})();
