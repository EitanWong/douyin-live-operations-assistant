// MAIN 世界仅观察原页面直播帧，不接触扩展存储、密钥或发送功能。
const room = location.pathname.match(/^\/(\d+)\/?$/)?.[1];
if (room) {
  // content 世界握手前完整保留事件，避免初始化稍慢时丢掉聊天/礼物。
  // 页面切换会销毁本脚本，队列生命周期天然与当前直播间一致。
  const backlog = []; let ready = false;
  const publish = event => window.postMessage({ source:'live-assistant-page-v1', room, type:'event', event }, location.origin);
  const adapter = new DouyinAdapter({ page:window, getConfig:()=>copy(DEFAULTS), onLog:()=>{}, onEvent:event=>{
    if (ready) publish(event);
    else backlog.push(event);
  }, onStatus:status=>window.postMessage({ source:'live-assistant-page-v1', room, type:'status', status },location.origin) });
  adapter.hook();
  window.addEventListener('message', e => {
    if (e.source === window && e.origin === location.origin && e.data?.source === 'live-assistant-content-v1' && e.data.type === 'hello') {
      ready = true; for (const event of backlog.splice(0)) publish(event); adapter.emitStatus();
    }
  });
}
