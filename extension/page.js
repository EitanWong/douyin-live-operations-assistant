// MAIN 世界仅观察原页面直播帧，不接触扩展存储、密钥或发送功能。
const jsonBytes = value => {
  try { const text = JSON.stringify(value); return typeof text === 'string' ? text.length * 2 : null; }
  catch { return null; }
};
const room = location.pathname.match(/^\/(\d+)\/?$/)?.[1];
if (room) {
  const backlog = []; let backlogBytes = 0, bridgeGaps = 0, ready = false, paused = false, flushing = false;
  let emitStatus = () => {};
  const publish = event => {
    try { window.postMessage({ source:'live-assistant-page-v1', room, type:'event', event }, location.origin); }
    catch { bridgeGaps++; emitStatus(); }
  };
  const flush = async()=>{
    if (flushing) return;
    flushing = true;
    try {
      while (ready && !paused && backlog.length) {
        for (const item of backlog.splice(0,128)) { backlogBytes -= item.bytes; publish(item.event); }
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    } finally { flushing = false; }
  };
  const enqueue = event => {
    const bytes = jsonBytes(event);
    if (bytes == null) { bridgeGaps++; emitStatus(); return; }
    if (backlog.length < 4096 && backlogBytes+bytes <= 8*1024*1024) { backlog.push({event,bytes}); backlogBytes += bytes; }
    else { bridgeGaps++; emitStatus(); }
    void flush();
  };
  const adapter = new DouyinAdapter({ page:window, getConfig:()=>copy(DEFAULTS), onLog:()=>{}, onPK:event=>{
    // PK 只读观察直接交给 content 的分析通道，不受普通事件存储背压阻塞。
    if (ready) publish(event); else enqueue(event);
  }, onEvent:event=>{
    if (event.type.startsWith('pk-')) return; // onPK 已交付一份，避免桥接重复。
    if (ready && !paused && !backlog.length) publish(event); else enqueue(event);
  }, onStatus:status=>window.postMessage({ source:'live-assistant-page-v1', room, type:'status', status:{...status,bridgeGaps,bridgePending:backlog.length} },location.origin) });
  emitStatus = () => adapter.emitStatus();
  adapter.hook();
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin || e.data?.source !== 'live-assistant-content-v1') return;
    if (e.data.type === 'hello') { ready = true; void flush(); adapter.emitStatus(); }
    if (e.data.type === 'flow' && e.data.room === room) { paused = Boolean(e.data.paused); if (!paused) void flush(); adapter.emitStatus(); }
  });
}
