// MAIN 观察直播帧，并复用原页面请求客户端发送公屏消息；不接触扩展存储或密钥。
const jsonBytes = value => {
  try { const text = JSON.stringify(value); return typeof text === 'string' ? text.length * 2 : null; }
  catch { return null; }
};
const currentRoom = () => location.pathname.match(/^\/(\d+)\/?$/)?.[1] || new URLSearchParams(location.search).get('room_id')?.match(/^\d+$/)?.[0];
const room = currentRoom();
if (room) {
  const backlog = [], captureBacklog = []; let backlogBytes = 0, captureBacklogBytes = 0, bridgeGaps = 0, captureGaps = 0, ready = false, paused = false, flushing = false, flushingCaptures = false;
  let emitStatus = () => {};
  const publish = event => {
    try { window.postMessage({ source:'live-assistant-page-v1', room, type:'event', event }, location.origin); }
    catch { bridgeGaps++; emitStatus(); }
  };
  const publishCapture = record => {
    try { window.postMessage({ source:'live-assistant-page-v1', room, type:'protocol-frame', record }, location.origin); }
    catch { captureGaps++; emitStatus(); }
  };
  const flushCaptures = async()=>{
    if (flushingCaptures || !ready) return;
    flushingCaptures = true;
    try {
      while (ready && captureBacklog.length) {
        for (const item of captureBacklog.splice(0,32)) { captureBacklogBytes -= item.bytes; publishCapture(item.record); }
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    } finally { flushingCaptures = false; }
  };
  const enqueueCapture = record => {
    const bytes = jsonBytes(record);
    if (bytes == null) { captureGaps++; emitStatus(); return; }
    if (ready) publishCapture(record);
    else if (captureBacklog.length < 256 && captureBacklogBytes + bytes <= 8*1024*1024) { captureBacklog.push({record,bytes}); captureBacklogBytes += bytes; }
    else { captureGaps++; emitStatus(); }
    void flushCaptures();
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
  const adapter = new DouyinAdapter({ page:window, getConfig:()=>copy(DEFAULTS), onLog:()=>{}, onCapture:enqueueCapture, onPK:event=>{
    // PK 只读观察直接交给 content 的分析通道，不受普通事件存储背压阻塞。
    if (ready) publish(event); else enqueue(event);
  }, onEvent:event=>{
    if (event.type.startsWith('pk-')) return; // onPK 已交付一份，避免桥接重复。
    if (ready && !paused && !backlog.length) publish(event); else enqueue(event);
  }, onStatus:status=>window.postMessage({ source:'live-assistant-page-v1', room, type:'status', status:{...status,bridgeGaps,bridgePending:backlog.length,captureBridgeGaps:captureGaps,captureBridgePending:captureBacklog.length} },location.origin) });
  emitStatus = () => adapter.emitStatus();
  adapter.hook();
  window.addEventListener('message', e => {
    if (e.source !== window || e.origin !== location.origin || e.data?.source !== 'live-assistant-content-v1') return;
    if (e.data.type === 'hello') { ready = true; void flush(); void flushCaptures(); adapter.emitStatus(); }
    if (e.data.type === 'collection-pulse' && e.data.room === room && currentRoom() === room) {
      adapter.collectionGuard?.tick(); adapter.emitStatus();
      window.postMessage({source:'live-assistant-page-v1',room,type:'collection-result',id:e.data.id,active:adapter.status.collection?.active === true},location.origin);
    }
    if (e.data.type === 'collection-stop' && e.data.room === room) adapter.collectionGuard?.stop();
    if (e.data.type === 'flow' && e.data.room === room) { paused = Boolean(e.data.paused); if (!paused) void flush(); adapter.emitStatus(); }
    if (e.data.type === 'send-api' && e.data.room === room && currentRoom() === room && typeof e.data.id === 'string' && e.data.id.length <= 64) {
      const {id,operation,channel,token,text,action,target,count,sequence} = e.data;
      if (!['prepare','commit','prepare-moderation','commit-moderation','prepare-like','commit-like','stop-like'].includes(operation)) return;
      void (async()=>{
        const sender = adapter.requestSender;
        const result = operation === 'prepare-like' ? sender?.prepareLike() || {available:false}
          : operation === 'commit-like' ? typeof token === 'string' && token.length<=64 ? await sender?.commitLike(token,count,sequence) : {submitted:false}
          : operation === 'stop-like' ? typeof token === 'string' && token.length<=64 ? sender?.stopLike(token) : {stopped:false}
          : operation === 'prepare-moderation' ? sender?.prepareModeration(action,target) || {available:false}
          : operation === 'commit-moderation' ? typeof token === 'string' && token.length<=64 ? await sender?.commitModeration(token) : {submitted:false}
          : operation === 'prepare' ? sender?.prepare(channel) || {available:false}
          : typeof token === 'string' && typeof text === 'string' && text.length <= 200 ? await sender?.commit(token,text) : {submitted:false,reason:'请求参数无效'};
        window.postMessage({source:'live-assistant-page-v1',room,type:'send-api-result',id,result},location.origin);
      })();
    }
  });
}
