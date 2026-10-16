// 仅 --dev 构建引用。正式扩展没有本地更新权限、监听或心跳。
export function installDevelopmentReload({ chrome, revision, endpoint, beforeReload, fetchUpdate = fetch }) {
  const pendingKey = 'live-assistant:development:refresh';
  const roomURL = url => /^https:\/\/live\.douyin\.com\/\d+(?:[/?#]|$)/.test(url || '');
  let checking, reloading = false;
  async function restoreTabs() {
    // storage.session 会在扩展重载时清空，刷新交接必须保存在 local。
    const pending = (await chrome.storage.local.get(pendingKey))[pendingKey];
    if (!pending || pending.from === revision) return;
    await chrome.storage.local.remove(pendingKey);
    for (const saved of pending.tabs) {
      try {
        const current = await chrome.tabs.get(saved.id);
        // 重载期间用户已经导航的页面不刷新。
        if (current.url === saved.url && roomURL(current.url)) await chrome.tabs.reload(saved.id);
      } catch (error) { console.info('开发更新：跳过已关闭或不可刷新的标签页', error.message); }
    }
  }
  const restored = restoreTabs();
  void restored.catch(error => console.error('开发更新：恢复标签页失败', error));
  async function check() {
    try {
      await restored;
      const response = await fetchUpdate(endpoint, { cache:'no-store', credentials:'omit', redirect:'error', signal:AbortSignal.timeout(5000) });
      if (!response.ok) return;
      const build = await response.json();
      if (!/^[a-f0-9]{64}$/.test(build.revision) || build.revision === revision) return;
      const tabs = (await chrome.tabs.query({url:'https://live.douyin.com/*'})).filter(tab => roomURL(tab.url)).map(tab => ({id:tab.id,url:tab.url}));
      // 已提交到后台的礼物写入完成后才重载，不清空任何配置或账本。
      await beforeReload();
      await chrome.storage.local.set({[pendingKey]:{from:revision,tabs}});
      reloading = true;
      chrome.runtime.reload();
    } catch (error) {
      // 本地开发服务退出时静默等待下次检测，正常场控照常运行。
      reloading = false;
    }
  }
  function checkUpdate() {
    if (reloading) return Promise.resolve();
    if (!checking) checking = (async () => { try { await check(); } finally { checking = null; } })();
    return checking;
  }
  // 顶层同步注册监听，支持 MV3 工作线程重新唤醒。
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'live-assistant-development' || port.sender?.frameId !== 0 || !roomURL(port.sender?.tab?.url)) return;
    port.onMessage.addListener(() => { void checkUpdate(); });
  });
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'live-assistant-development') void checkUpdate(); });
  void (async () => {
    try { await chrome.alarms.create('live-assistant-development', {periodInMinutes:0.5}); }
    catch (error) { console.error('开发更新：无法创建更新检测', error); }
  })();
  void checkUpdate();
  return { checkUpdate, restored };
}
