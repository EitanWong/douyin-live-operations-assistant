// Alarms wake throttled content scripts; live leases prevent automatic OS sleep.
// Session storage survives MV3 worker termination and stays in trusted contexts.
export function installCollectionKeeper(chrome, {wakeTimeoutMs = 5000} = {}) {
  const session = chrome.storage.session, key = 'live-assistant:collection-leases';
  if (!session || !chrome.alarms || !chrome.power) return {
    update:async()=>({awake:false,error:'后台保活 API 不可用'}), refresh:async()=>{}
  };
  let tail = Promise.resolve();
  const serialize = operation => {
    const previous = tail;
    const task = (async()=>{try {await previous;} catch {} return operation();})();
    tail = task; void task.catch(()=>{}); return task;
  };
  const eligible = url => {
    try { const u = new URL(url); return u.origin === 'https://live.douyin.com' && (/^\/\d+\/?$/.test(u.pathname) || /^\d+$/.test(u.searchParams.get('room_id') || '')); }
    catch { return false; }
  };
  const apply = async leases => {
    await session.set({[key]:leases});
    const awake = Object.keys(leases).length > 0;
    try {
      if (awake) chrome.power.requestKeepAwake('system');
      else chrome.power.releaseKeepAwake();
      return {awake,error:''};
    } catch (error) { return {awake:false,error:String(error.message || error)}; }
  };
  const update = (sender, active) => serialize(async()=>{
    if (sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || !eligible(sender.tab?.url)) return {awake:false,error:'无效直播页'};
    const leases = (await session.get(key))[key] || {};
    if (active === true) leases[sender.tab.id] = sender.tab.url; else delete leases[sender.tab.id];
    return apply(leases);
  });
  const refresh = () => serialize(async()=>{
    const tabs = await chrome.tabs.query({url:'https://live.douyin.com/*'}), leases = {};
    await Promise.allSettled(tabs.filter(tab=>eligible(tab.url)).map(async tab => {
      let timeout;
      try {
        const result = await Promise.race([
          chrome.tabs.sendMessage(tab.id, {type:'collection-wake'}, {frameId:0}),
          new Promise(resolve=>{timeout=setTimeout(()=>resolve(null),wakeTimeoutMs);})
        ]);
        if (result?.active === true) leases[tab.id] = tab.url;
      } catch { /* Closed, navigated, or extension context no longer present. */ }
      finally { clearTimeout(timeout); }
    }));
    return apply(leases);
  });
  const remove = id => serialize(async()=>{
    const leases = (await session.get(key))[key] || {}; delete leases[id]; return apply(leases);
  });
  chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name === 'live-assistant-collection') void refresh().catch(()=>{});});
  chrome.tabs.onRemoved?.addListener(id=>{void remove(id).catch(()=>{});});
  chrome.tabs.onUpdated?.addListener((id,change)=>{if(change.url || change.status === 'loading') void remove(id).catch(()=>{});});
  // Recreate and reconcile on every worker start; the browser may clear alarms.
  void Promise.resolve(chrome.alarms.create('live-assistant-collection', {periodInMinutes:0.5})).catch(()=>{});
  void refresh().catch(()=>{});
  return {update,refresh};
}
