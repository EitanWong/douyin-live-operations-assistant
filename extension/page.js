// MAIN 世界仅观察原页面直播帧，不接触扩展存储、密钥或发送功能。
const room = location.pathname.match(/^\/(\d+)\/?$/)?.[1];
if (room) {
  const adapter = new DouyinAdapter({ page:window, getConfig:()=>copy(DEFAULTS), onLog:()=>{}, onEvent:event=>window.postMessage({ source:'live-assistant-page-v1', room, type:'event', event }, location.origin), onStatus:status=>window.postMessage({ source:'live-assistant-page-v1', room, type:'status', status },location.origin) });
  adapter.hook();
  window.addEventListener('message', e => {
    if (e.source === window && e.origin === location.origin && e.data?.source === 'live-assistant-content-v1' && e.data.type === 'hello') adapter.emitStatus();
  });
}
