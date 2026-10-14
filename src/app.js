import { Engine, DEFAULTS, copy, mergeConfig, validateConfig } from './core.js';
import { DouyinAdapter, RoomLock, pickElement } from './adapter.js';
import { createAIClient, validateEndpoint } from './ai.js';
import { Panel } from './ui.js';
import { IdentityReader, roomAdminStatus } from './identity.js';

export function boot(options = {}) {
  const demo = Boolean(options.demo);
  const page = options.page || (demo ? window : unsafeWindow);
  const room = demo ? 'demo' : location.pathname.match(/^\/(\d+)\/?$/)?.[1];
  if (!room || document.getElementById('douyin-live-assistant')) return;
  const initialPath = location.pathname;
  const get = options.get || ((key, fallback) => GM_getValue(key, fallback));
  const set = options.set || ((key, value) => GM_setValue(key, value));
  const del = options.del || (key => GM_deleteValue(key));
  const configKey = `live-assistant:config:${room}`;
  let config, configError = '';
  try { config = validateConfig(mergeConfig(get(configKey, {}))); }
  catch (e) { config = copy(DEFAULTS); configError = `旧配置无效，已使用默认值：${e.message}`; }
  if (!config.anchorId) config.anchorId = new URLSearchParams(location.search).get('anchor_id')?.match(/^\d+$/)?.[0] || '';
  const sessionKeys = new Map(); let panel, network = {}, logBacklog = [], starting = false, pickCleanup, renderTimer, viewerTimer, giftTimer;
  const viewers = new Map(), giftActivity = new Map(); let identity = {};
  const log = (category, message) => { if (panel) panel.log(category, message); else { logBacklog.push([category, message]); if (logBacklog.length > 200) logBacklog.shift(); } };
  const refresh = () => { if (panel && !renderTimer) renderTimer = setTimeout(() => { renderTimer = null; panel.refresh(engine, network); }, 100); };
  const rememberUser = event => {
    const user = event?.user;
    if (!user?.name) return;
    const key = user.id ? `uid:${user.id}` : user.secUid ? `sec:${user.secUid}` : `name:${user.name}`;
    const old = viewers.get(key);
    const club = (user.fanClubs || []).find(item => item.anchorId && item.anchorId === engine.config.anchorId);
    const next = { key, id:user.id || '', secUid:user.secUid || '', name:user.name.slice(0,60), wealthLevel:user.wealthLevel ?? old?.wealthLevel ?? null, fanLevel:club?.level ?? old?.fanLevel ?? null, fanStatus:club?.status ?? old?.fanStatus ?? null, seen:Date.now() };
    viewers.delete(key); viewers.set(key,next); while (viewers.size > 60) viewers.delete(viewers.keys().next().value);
    if (panel && !viewerTimer) viewerTimer = setTimeout(() => { viewerTimer = null; panel.updateViewers([...viewers.values()].reverse()); }, 1000);
    if (event.type === 'gift') {
      const giftKey = `${event.roomId || room}:${key}:${event.giftId || event.giftName}:${event.groupId || event.id || Date.now()}`;
      const oldGift = giftActivity.get(giftKey);
      giftActivity.delete(giftKey);
      giftActivity.set(giftKey, {
        key: giftKey, user: next, giftName: event.giftName || '礼物',
        count: Math.max(oldGift?.count || 0, Number(event.count) || 1),
        unitValue: Number.isFinite(event.unitValue) && event.unitValue > 0 ? event.unitValue : oldGift?.unitValue ?? null,
        seen: Date.now()
      });
      while (giftActivity.size > 50) giftActivity.delete(giftActivity.keys().next().value);
      if (panel && !giftTimer) giftTimer = setTimeout(() => { giftTimer = null; panel.updateGifts([...giftActivity.values()].reverse()); }, 500);
    }
  };
  const request = options.request || (details => GM_xmlhttpRequest(details));
  const secretKey = endpoint => `live-assistant:api-key:${new URL(validateEndpoint(endpoint)).origin}`;
  const client = createAIClient({ request, getKey: endpoint => sessionKeys.get(secretKey(endpoint)) ?? get(secretKey(endpoint), '') });
  const lock = new RoomLock({ room, get, set });
  const makeAdapter = options.adapterFactory || (settings => new DouyinAdapter(settings));
  const adapter = makeAdapter({
    page,
    getConfig: () => engine.config,
    onEvent: event => { if (location.pathname === initialPath) { rememberUser(event); engine.ingest(event); } },
    onLog: log, onStatus: status => { network = status; refresh(); },
    shouldReadChat: () => engine.running && (engine.config.ai.enabled || engine.config.keyword.enabled)
  });
  const engine = new Engine({
    config, log, changed: refresh, ai: client,
    send: demo ? async (text, isCurrent) => { if (!isCurrent()) return { submitted: false }; log('lab', `模拟发送：${text}`); return { submitted: true }; } : (text, isCurrent) => adapter.send(text, () => isCurrent() && lock.held && location.pathname === initialPath)
  });
  function applyIdentity(next) {
    identity = { ...next, admin: roomAdminStatus(next.self, next.adminUserIds) }; const c = engine.config;
    engine.setIdentity(identity);
    if (next.anchor && c.identity.autoAnchor) {
      if (c.anchorId && c.anchorId !== next.anchor.id && engine.running) pause('主播资料发生变化，已暂停；请核对后重新开始');
      c.anchorId = next.anchor.id;
    }
    if (c.identity.autoSelf && Object.hasOwn(next,'self')) c.selfId = next.self?.id || '';
    panel?.updateIdentity(identity); refresh();
  }
  const identityReader = demo ? null : options.identityFactory ? options.identityFactory(applyIdentity) : new IdentityReader({ page, room, onIdentity:applyIdentity });
  // 首屏渲染前安装，不重建连接、不改变 binaryType、不发送 ACK 或心跳。
  if (!demo) adapter.hook();
  else network = adapter.status = { hook: true, sockets: 1, frames: 1, events: 0, errors: 0, connected: true, lastFrame: Date.now() };
  async function keepKey(c, key, remember) {
    if (!key) return;
    const name = secretKey(c.ai.endpoint); sessionKeys.set(name, key);
    if (remember) await set(name, key); else await del(name);
  }
  function download(name, content) {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const pause = reason => { engine.stop(reason); lock.release(); };
  async function start() {
    if (engine.running || starting) return;
    if (!demo && engine.config.mode !== 'preview') {
      if (!adapter.healthy()) throw new Error('尚未连接直播数据，请刷新直播页，先用仅预览检查事件');
      const input = adapter.findInput(); adapter.findSend(input);
    }
    starting = true; const startEpoch = engine.epoch;
    try {
      if (!await lock.acquire()) throw new Error('此直播间已有另一个标签页运行场控，请先暂停另一页');
      if (engine.epoch !== startEpoch) { lock.release(); return; }
      if (location.pathname !== initialPath) { lock.release(); throw new Error('直播间已切换，请刷新页面'); }
      engine.start();
    } finally { starting = false; }
  }
  function lab() {
    let now = Date.now(); const local = copy(engine.config); local.mode = 'preview'; local.ai.enabled = false; local.keyword.enabled = false; local.like.enabled = true; local.timers = [];
    const test = new Engine({ config: local, now: () => now, log: (kind, message) => log('lab', `${kind}：${message}`) });
    const high = { id: 'test-user-1', name: '青山（测试）', wealthLevel: local.welcome.minWealth, fanClubs: [{ level: local.welcome.minFanLevel, status: 1, anchorId: local.anchorId || 'unknown-host' }] };
    test.start();
    test.ingest({ type: 'enter', id: 'test-enter-1', user: high });
    test.ingest({ type: 'enter', id: 'test-enter-2', user: { ...high, id: 'test-user-2', name: '其他直播间粉丝（测试）', fanClubs: [{ level: 30, status: 1, anchorId: 'other-host' }] } });
    test.ingest({ type: 'like', id: 'test-like-1', user: high, count: 30 });
    const unitValue = Math.max(1, local.gift.minValue);
    for (let count = 1; count <= 3; count++) test.ingest({ type: 'gift', id: `test-gift-${count}`, user: high, giftId: 'lab', giftName: '心意（测试）', unitValue, count, groupId: 'lab-group', final: count === 3 });
    test.ingest({ type: 'gift', id: 'test-gift-low', user: { ...high, id: 'test-user-3', name: '低价值礼物（测试）' }, giftName: '小心意（测试）', unitValue: 1, count: 1, groupId: 'lab-low', final: true });
    void (async () => {
      await test.tick(); now += local.sending.intervalSec * 1000 + 1; await test.tick();
      log('lab', '规则自检结束。以上均为独立模拟，不会写入真实发送队列或调用 AI。');
    })();
    panel.toast('规则自检已运行，请在设置 > 连接 > 运行记录中查看结果');
  }
  async function ready() {
    panel = new Panel({ config: engine.config, room, demo, callbacks: {
      start, stop: () => pause('人工暂停，已清空候选与弹幕上下文'), lab,
      identify: async () => { if (demo) { applyIdentity({ anchor:{ id:'1234567890', name:'模拟主播' }, self:{ id:'9876543210', name:'我的场控账号（模拟）' } }); panel.toast('已识别模拟主播和账号'); } else { await identityReader.refresh(); panel.toast('识别完成；未识别的项目可手动补充'); } },
      save: async (c, key, remember) => {
        await keepKey(c, key, remember); pause('正在保存设置，已暂停场控');
        if (c.identity.autoAnchor && identity.anchor) c.anchorId = identity.anchor.id;
        if (c.identity.autoSelf && Object.hasOwn(identity,'self')) c.selfId = identity.self?.id || '';
        await set(configKey, c); engine.update(c); refresh(); panel.toast('设置已保存，点击“开始场控”即可运行。');
      },
      testAI: async (c, key, remember) => {
        await keepKey(c, key, remember);
        const output = await client({ persona: c.ai.persona, knowledge: c.ai.knowledge, context: [], target: { name: '连接测试', text: '你好，请用一句话打招呼。' }, maxLength: c.sending.maxLength }, c.ai);
        log('ai', `连接测试通过：${output.slice(0, 300)}`); panel.toast('AI 连接测试通过。测试内容不会发送到公屏。');
      },
      approve: (id, text) => { if (!engine.approve(id, text)) panel.toast('无法批准此消息，请查看记录', true); else panel.toast('已批准，将在发送间隔允许后提交'); },
      discard: id => engine.discard(id), diagnose: () => adapter.diagnose(),
      exportConfig: () => download(`douyin-live-${room}.json`, JSON.stringify({ ...engine.config, mode: 'preview' }, null, 2)),
      exportLog: entries => download(`douyin-live-${room}-logs.json`, JSON.stringify(entries, null, 2)),
      forgetKey: async endpoint => { const name = secretKey(endpoint); await del(name); sessionKeys.delete(name); panel.root.querySelector('[data-api-key]').value = ''; panel.toast('此服务密钥已清除'); },
      pick: kind => {
        pickCleanup?.();
        if (panel.open) panel.toggleOpen();
        pickCleanup = pickElement(kind, selector => {
          if (!panel.open) panel.toggleOpen(); panel.tab('diagnostics');
          panel.root.querySelector(`[data-field="adapter.${kind === 'input' ? 'inputSelector' : 'sendSelector'}"]`).value = selector;
          panel.toast('已定位。请点击“保存设置”使其生效。');
        }, log, panel.host);
      }
    } });
    for (const args of logBacklog) panel.log(...args); logBacklog = [];
    if (configError) log('error', configError);
    log('system', demo ? '模拟环境就绪，点击“开始场控”，再从左侧添加事件。' : '脚本已加载，默认暂停。建议先仅预览检查事件，再启用发送。');
    if (!engine.config.anchorId) log('system', '未识别到主播 UID。欢迎功能的粉丝团核对需在“欢迎”页填写。');
    if (!demo) {
      try { adapter.observeDOM(); } catch (e) { log('error', `备用采集未启动：${e.message}`); }
      if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('打开抖音直播运营助手', () => { if (!panel.open) panel.toggleOpen(); });
    }
    panel.refresh(engine, network);
    if (demo) applyIdentity({ anchor:{ id:'1234567890', name:'模拟主播' }, self:{ id:'9876543210', name:'我的场控账号（模拟）' } });
    else void identityReader.refresh().catch(e => log('error', `自动识别暂不可用：${e.message}`));
    const timer = setInterval(async () => {
      if (demo) { network.lastFrame = adapter.status.lastFrame = Date.now(); }
      if (location.pathname !== initialPath) { pause('直播间已切换，请刷新页面重新载入对应设置'); clearInterval(timer); adapter.stopDOM?.(); identityReader?.close(); pickCleanup?.(); return; }
      if (engine.running && !lock.renew()) pause('另一标签页取得运行权，当前场控已暂停');
      adapter.sync?.();
      if (engine.running && !demo && engine.config.mode !== 'preview' && !adapter.healthy()) pause('直播数据中断，已暂停。连接恢复后请手动开始');
      try { await engine.tick(demo || engine.config.mode === 'preview' || adapter.healthy()); }
      catch (e) { log('error', e.message); pause('运行异常，已暂停'); }
    }, 1000);
    panel.updateGifts([...giftActivity.values()].reverse());
    window.addEventListener('pagehide', () => { pause('页面关闭'); clearInterval(timer); clearTimeout(renderTimer); clearTimeout(viewerTimer); clearTimeout(giftTimer); clearTimeout(panel.logTimer); clearTimeout(panel.toastTimer); adapter.stopDOM?.(); identityReader?.close(); pickCleanup?.(); }, { once: true });
    options.onReady?.({ engine, panel, adapter, stop: pause, rememberUser });
  }
  if (document.body) void ready(); else document.addEventListener('DOMContentLoaded', ready, { once: true });
  return engine;
}
