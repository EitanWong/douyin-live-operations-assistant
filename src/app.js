import { Engine, DEFAULTS, copy, mergeConfig, validateConfig } from './core/engine.js';
import { DouyinAdapter, RoomLock, pickElement } from './browser/adapter.js';
import { createAIClient, validateEndpoint } from './services/ai.js';
import { Panel } from './ui/panel.js';
import { IdentityReader, roomAdminStatus } from './browser/identity.js';
import { GiftLedger, GiftStore, giftDate } from './data/gifts.js';
import { JournalCommitter, RuntimeWriter } from './runtime/journal.js';

export function boot(options = {}) {
  const demo = Boolean(options.demo);
  const page = options.page || (demo ? window : unsafeWindow);
  const room = demo ? 'demo' : location.pathname.match(/^\/(\d+)\/?$/)?.[1];
  if (!room || document.getElementById('douyin-live-assistant')) return;
  const initialPath = location.pathname;
  const get = options.get || ((key, fallback) => GM_getValue(key, fallback));
  const set = options.set || ((key, value) => GM_setValue(key, value));
  const del = options.del || (key => GM_deleteValue(key));
  const repository = options.repository || new GiftStore({ get, set, all: options.all || (() => Object.fromEntries((typeof GM_listValues === 'function' ? GM_listValues() : [configKey]).map(key => [key, get(key, null)]))) });
  const configKey = `live-assistant:config:${room}`;
  const runtimeKey = `live-assistant:runtime:${room}`;
  const runtimeSnapshot = get(runtimeKey, null);
  let config, configError = '';
  try { config = validateConfig(mergeConfig(get(configKey, {}))); }
  catch (e) { config = copy(DEFAULTS); configError = `旧配置无效，已使用默认值：${e.message}`; }
  if (!config.anchorId) config.anchorId = new URLSearchParams(location.search).get('anchor_id')?.match(/^\d+$/)?.[0] || '';
  const sessionKeys = new Map(); let panel, engine, network = {}, logBacklog = [], starting = false, pickCleanup, renderTimer, viewerTimer, giftTimer, incomeTimer, incomeRequest = 0, runtimeSaveTimer, profileSignature = '', closed = false, suspended = false;
  const runtimeWriter = new RuntimeWriter(snapshot => set(runtimeKey, snapshot));
  // 自动开启只在本页首次进入时保持武装；只有用户明确点击暂停才关闭。
  let autoStartArmed = true, resumeAutoStart = false, manualPause = false, autoStartNext = 0, autoStartError = '';
  const viewers = new Map(), giftActivity = new Map(), giftLedger = new GiftLedger();
  // 账本写入与场控发送解耦：存储短暂失败时保留最新连击进度并自动重试，
  // 不让一次扩展后台/IndexedDB 抖动造成收入遗漏。
  const incomePending = new Map(); let incomeDrainBusy = false, incomeRetryTimer = null;
  function persistRuntime(immediate = false) {
    if (!engine || closed && !immediate) return;
    clearTimeout(runtimeSaveTimer); runtimeSaveTimer = null;
    const save = () => {
      const snapshot = { ...engine.snapshot(), incomePending:JSON.parse(JSON.stringify([...incomePending])),collection:network.ingestion ? {...network.ingestion,bridgeGaps:network.bridgeGaps || 0,frameGaps:network.frameGaps || 0} : runtimeSnapshot?.collection || null };
      const write = runtimeWriter.save(snapshot);
      const reported = write.catch(error => log('error', `运行状态保存失败：${error.message}`));
      return immediate ? write : reported;
    };
    if (immediate) return save();
    runtimeSaveTimer = setTimeout(() => { runtimeSaveTimer = null; void save(); }, 250);
  }
  const journalCommitter = options.journal ? new JournalCommitter({
    checkpoint: () => persistRuntime(true),
    ack: keys => options.journal.ackMany ? options.journal.ackMany(keys) : Promise.all(keys.map(key => options.journal.ack(key))),
    active: () => !closed && !suspended,
    onError: error => log('error', `运行状态批量确认失败，事件日志保留待重试：${error.message}`)
  }) : null;
  let identity = {};
  const log = (category, message) => { if (panel) panel.log(category, message); else { logBacklog.push([category, message]); if (logBacklog.length > 200) logBacklog.shift(); } };
  const refresh = () => { if (panel && !closed && !suspended && !renderTimer) renderTimer = setTimeout(() => { renderTimer = null; panel.refresh(engine, network); }, 100); };
  let sendingScheduled = false, senderActive = false;
  const wakeSender = () => {
    if (sendingScheduled || senderActive || !engine?.running || engine.busy || closed || suspended || location.pathname !== initialPath) return;
    const now = Date.now();
    if (!engine.queue.some(job => engine.giftReady(job, now)) && ![...engine.gifts.values()].some(gift => gift.due <= now && gift.count > gift.credited)) return;
    if (!demo && engine.config.mode !== 'preview' && !adapter.healthy()) return;
    sendingScheduled = true;
    queueMicrotask(async () => {
      sendingScheduled = false;
      if (!engine.running || engine.busy || closed || suspended || location.pathname !== initialPath) return;
      const beforeJob = engine.selectNextJob(engine.queue, Date.now())?.id;
      const beforeSent = engine.stats.submitted + engine.stats.previews;
      senderActive = true;
      try { await engine.tick(demo || engine.config.mode === 'preview' || adapter.healthy()); }
      catch (error) { log('error', `即时发送异常，消息保留：${error.message}`); }
      finally {
        senderActive = false;
        // 格式错误等没有进展的任务交给常规检查，避免微任务持续重试阻塞页面。
        if (engine.stats.submitted + engine.stats.previews > beforeSent || engine.selectNextJob(engine.queue, Date.now())?.id !== beforeJob) wakeSender();
      }
    });
  };
  async function loadIncome({ profiles = false } = {}) {
    if (!panel || closed) return;
    const request = ++incomeRequest;
    try {
      if (profiles) panel.updateProfiles(await repository.profiles());
      const selection = panel.incomeSelection();
      const month = giftDate().slice(0, 7);
      const [selected, current] = await Promise.all([
        repository.report(selection.room, selection.month),
        selection.room === room && selection.month === month ? null : repository.report(room, month)
      ]);
      if (closed || request !== incomeRequest) return;
      panel.updateIncome(selected);
      const own = current || selected;
      if (engine.config.incomeEnabled && own) panel.updateGiftSummary(own.days.find(day => day.date === giftDate()) || {totalDiamonds:0,giftCount:0,unknownCount:0,estimatedIncome:0}, engine.config.gift.yuanPerDiamond, true);
    } catch (error) { if (!closed) { panel.incomeError(error.message); log('error', `礼物账本读取失败：${error.message}`); } }
  }
  function refreshIncome() {
    if (closed || incomeTimer) return;
    incomeTimer = setTimeout(() => { incomeTimer = null; void loadIncome(); }, 500);
  }
  const incomeKey = (record, userKey) => `${record.roomId || room}:${userKey || record.user?.id || 'anonymous'}:${record.giftId || record.giftName || 'gift'}:${record.groupId || record.id || 'single'}`;
  const drainIncome = async () => {
    if (incomeDrainBusy || closed || !incomePending.size || !engine.config.incomeEnabled) return;
    incomeDrainBusy = true;
    try {
      for (const [key, item] of incomePending) {
        if (item.nextAt > Date.now()) continue;
        try {
          await repository.record({ room, event:item.event, userKey:item.userKey, rate:item.rate, capturedAt:item.capturedAt });
          if (incomePending.get(key) === item) { incomePending.delete(key); persistRuntime(); }
          refreshIncome();
        } catch (error) {
          item.attempts++;
          item.nextAt = Date.now() + Math.min(30000, 500 * 2 ** Math.min(item.attempts, 6));
          if (item.attempts === 1 || item.attempts % 5 === 0) {
            panel?.incomeError(error.message); log('error', `礼物账本保存失败，${Math.round((item.nextAt - Date.now()) / 1000)} 秒后重试：${error.message}`);
          }
        }
      }
    } finally {
      incomeDrainBusy = false;
      if (incomePending.size && !closed && engine.config.incomeEnabled) {
        clearTimeout(incomeRetryTimer);
        let next = 30000;
        for (const item of incomePending.values()) next = Math.min(next, Math.max(100, item.nextAt - Date.now()));
        incomeRetryTimer = setTimeout(() => { incomeRetryTimer = null; void drainIncome(); }, next);
      }
    }
  };
  const queueIncome = (event, userKey) => {
    const key = incomeKey(event, userKey), old = incomePending.get(key);
    if (!old && incomePending.size >= 2000) throw Object.assign(new Error('待入账礼物已达上限；原始日志保留，请恢复存储后重试'),{code:'BACKPRESSURE'});
    // 同一连击只保留最新累计数；GiftStore 会按持久进度计算增量。
    const nextEvent = old && Number(old.event.count) > Number(event.count) ? old.event : event;
    incomePending.set(key, { event:nextEvent, userKey, rate:engine.config.gift.yuanPerDiamond, capturedAt:old?.capturedAt || event.capturedAt || Date.now(), attempts:old?.attempts || 0, nextAt:old?.nextAt || Date.now() });
    void drainIncome();
  };
  async function registerProfile(name) {
    const profile = { room, anchorId: engine.config.anchorId, name: name || identity.anchor?.name };
    const signature = `${profile.anchorId}:${profile.name || ''}`;
    if (profileSignature === signature) return;
    await repository.profile(profile); profileSignature = signature;
    if (panel) await loadIncome({profiles:true});
  }
  const refreshGifts = () => {
    if (!panel || giftTimer) return;
    giftTimer = setTimeout(() => {
      giftTimer = null;
      panel.updateGifts([...giftActivity.values()].reverse());
      if (!engine.config.incomeEnabled) panel.updateGiftSummary(giftLedger.snapshot(), engine.config.gift.yuanPerDiamond);
    }, 500);
  };
  const rememberUser = event => {
    if (engine?.isSelfUser(event?.user)) return;
    const user = event?.user;
    if (event?.type === 'gift') {
      const eventUserKey = user?.id ? `uid:${user.id}` : user?.secUid ? `sec:${user.secUid}` : user?.name ? `name:${user.name}` : 'anonymous';
      const override = engine.config.gift.prices[event.giftId] ?? engine.config.gift.prices[event.giftName];
      const unitValue = event.unitValue > 0 ? event.unitValue : override > 0 ? override : null;
      const record = { type:'gift', id:event.id, groupId:event.groupId, giftId:event.giftId, giftName:event.giftName, roomId:event.roomId, count:Number(event.count) || 1, unitValue, at:event.at, receivedAt:event.receivedAt, capturedAt:event._journalSavedAt || event.receivedAt || Date.now(), final:Boolean(event.final), user:{id:user?.id || ''} };
      giftLedger.observe(record, room, eventUserKey);
      if (engine.config.incomeEnabled) queueIncome(record, eventUserKey);
      if (!user?.name) refreshGifts();
    }
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
      refreshGifts();
    }
  };
  const request = options.request || (details => GM_xmlhttpRequest(details));
  const secretKey = endpoint => `live-assistant:api-key:${new URL(validateEndpoint(endpoint)).origin}`;
  const client = createAIClient({ request, getKey: endpoint => sessionKeys.get(secretKey(endpoint)) ?? get(secretKey(endpoint), '') });
  const lock = options.lock || new RoomLock({ room });
  const makeAdapter = options.adapterFactory || (settings => new DouyinAdapter(settings));
  const adapter = makeAdapter({
    page,
    getConfig: () => engine.config,
    onEcho:event=>engine?.observeEcho(event),
    onEvent: async event => {
      const journalKey = event?._journalKey;
      const { _journalKey, _journalId, _journalSavedAt, ...liveEvent } = event || {};
      // A journal append may finish after pagehide. Keep that record for recovery.
      if (!engine || closed || suspended || location.pathname !== initialPath) return;
      const echoed = engine.observeEcho(liveEvent);
      if (engine.isSelfUser(liveEvent?.user) && (echoed || !engine.acceptsSelfGameChat(liveEvent))) {
        if (journalKey) await options.journal.ack(journalKey);
        return;
      }
      let journalWrite = null;
      if ((engine.running || liveEvent.type === 'gift') && options.journal && !journalKey) {
        // Incoming messages are structured-cloned in the extension, but direct
        // integrations/tests may provide frozen objects. Work on a shallow copy
        // before attaching recovery metadata so a read-only event cannot abort
        // the whole inbox drain.
        const journalId = event?._journalId || crypto.randomUUID();
        event = {...liveEvent,_journalId:journalId};
        try { journalWrite = Promise.resolve(options.journal.append(liveEvent,journalId)); }
        catch (error) { log('error', `事件日志写入失败，直播互动已继续处理：${error.message}`); }
        if (!event.id) event.id = `journal:${journalId}`;
      } else event = {...liveEvent,...(journalKey ? {_journalKey:journalKey,_journalSavedAt} : {})};
      if (closed || suspended || location.pathname !== initialPath) return;
      // 账本/侧栏错误不能中断场控回复，也不能阻塞同帧中后续的消息。
      try { rememberUser(event); } catch (error) { log('error', `互动资料更新失败：${error.message}`); }
      engine.ingest(event);
      if (journalWrite) {
        void (async () => {
          try {
            const saved = await journalWrite;
            event._journalKey = saved.key;
            event._journalSavedAt = saved.savedAt;
            journalCommitter?.add(saved.key);
          } catch (error) { log('error', `事件日志写入失败，直播互动已继续处理：${error.message}`); }
        })();
      } else if (journalKey || event?._journalKey) journalCommitter?.add(journalKey || event._journalKey);
    },
    onLog: log, onStatus: status => {
      const previousGaps = (network.ingestion?.gaps || 0)+(network.bridgeGaps || 0)+(network.frameGaps || 0);
      network = status; refresh(); wakeSender();
      if ((status.ingestion?.gaps || 0)+(status.bridgeGaps || 0)+(status.frameGaps || 0) !== previousGaps) persistRuntime();
    },
    shouldReadChat: () => engine.running && ((engine.config.ai.enabled && engine.config.ai.chatEnabled) || engine.config.bot.enabled || engine.config.keyword.enabled || engine.config.moderation.enabled)
  });
  engine = new Engine({
    config, log, ai: client,
    changed: () => { refresh(); persistRuntime(); wakeSender(); }, checkpoint: () => persistRuntime(true),
    onStop: () => { lock.release(); autoStartArmed = false; },
    send: demo ? async (text, isCurrent, hooks) => { if (!isCurrent()) return { submitted: false }; await hooks.beforeClick(); log('lab', `模拟发送：${text}`); engine.observeEcho({type:'chat',source:'socket',user:{id:engine.config.selfId},text,receivedAt:Date.now()}); return { submitted: true,clicked:true }; } : (text, isCurrent, hooks) => adapter.send(text, () => isCurrent() && lock.held && location.pathname === initialPath,hooks)
  });
  if (runtimeSnapshot?.version === 1 && Array.isArray(runtimeSnapshot.incomePending)) for (const entry of copy(runtimeSnapshot.incomePending)) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[1]?.event) incomePending.set(entry[0], entry[1]);
  }
  if (engine.restore(runtimeSnapshot)) {
    autoStartArmed = engine.resumeRequested || Boolean(engine.config.automation.autoStart);
    if (engine.resumeRequested) log('system', '已恢复上次运行状态，连接就绪后自动续跑');
  }
  function applyIdentity(next) {
    identity = { ...next, admin: roomAdminStatus(next.self, next.adminUserIds) }; const c = engine.config;
    engine.setIdentity(identity);
    if (next.anchor && c.identity.autoAnchor) {
      if (c.anchorId && c.anchorId !== next.anchor.id && engine.running) log('error', '识别到主播资料变化；场控保持运行，请检查当前房间配置');
      c.anchorId = next.anchor.id;
    }
    if (c.identity.autoSelf && Object.hasOwn(next,'self')) c.selfId = next.self?.id || '';
    panel?.updateIdentity(identity); refresh();
    if (next.anchor) void registerProfile(next.anchor.name).catch(error => log('error', `主播资料保存失败：${error.message}`));
  }
  const identityReader = demo ? null : options.identityFactory ? options.identityFactory(applyIdentity) : new IdentityReader({ page, room, onIdentity:applyIdentity });
  // 首屏渲染前安装，不重建连接、不改变 binaryType、不发送 ACK 或心跳。
  if (!demo) { adapter.restoreCollection?.(runtimeSnapshot?.collection); adapter.hook(); }
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
  const pause = (reason, { manual = false } = {}) => {
    if (manual) manualPause = true;
    autoStartArmed = false;
    engine.stop(reason);
  };
  async function start({ automatic = false } = {}) {
    if (engine.running || starting || closed || suspended) return;
    if (!automatic) { manualPause = false; autoStartArmed = true; autoStartError = ''; }
    adapter.sync?.();
    if (!demo && engine.config.mode !== 'preview') {
      if (!adapter.healthy()) {
        if (automatic) return false;
        throw new Error('尚未连接直播数据，请刷新直播页，先用仅预览检查事件');
      }
      const input = adapter.findInput(); adapter.findSend(input);
    }
    starting = true; const startEpoch = engine.epoch;
    try {
      const acquired = await lock.acquire();
      if (engine.epoch !== startEpoch || closed || suspended) { lock.release(); return; }
      if (!acquired) {
        if (automatic) return false;
        throw new Error('此直播间已有另一个标签页运行场控，请先暂停另一页');
      }
      if (location.pathname !== initialPath) { lock.release(); throw new Error('直播间已切换，请刷新页面'); }
      engine.start();
      if (options.journal && adapter.replayJournal) void adapter.replayJournal().catch(error => log('error', `恢复事件日志失败：${error.message}`));
      autoStartError = '';
      return true;
    } finally { starting = false; }
  }
  async function tryAutoStart() {
    if (!engine || engine.running || !engine.config.automation.autoStart || !autoStartArmed || manualPause || closed || suspended || starting || Date.now() < autoStartNext) return;
    // 预览模式不需要直播连接；自动模式等连接 open 后再申请锁和检查输入框。
    if (!demo && engine.config.mode !== 'preview' && !adapter.healthy()) return;
    autoStartNext = Date.now() + 2000;
    try {
      const started = await start({ automatic: true });
      if (started) log('system', '已按当前主播设置自动开始场控');
    } catch (error) {
      if (autoStartError !== error.message) { autoStartError = error.message; log('system', `自动开启等待中：${error.message}`); }
    }
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
      await test.tick(); await test.tick();
      log('lab', '规则自检结束。以上均为独立模拟，不会写入真实发送队列或调用 AI。');
    })();
    panel.toast('规则自检已运行，请在设置 > 连接 > 运行记录中查看结果');
  }
  async function ready() {
    panel = new Panel({ config: engine.config, room, demo, callbacks: {
      start: () => start(), stop: () => pause('人工暂停，已清空发送队列与弹幕上下文', { manual: true }), lab,
      identify: async () => { if (demo) { applyIdentity({ anchor:{ id:'1234567890', name:'模拟主播' }, self:{ id:'9876543210', name:'我的场控账号（模拟）' } }); panel.toast('已识别模拟主播和账号'); } else { await identityReader.refresh(); panel.toast('识别完成；未识别的项目可手动补充'); } },
      save: async (c, key, remember) => {
        await keepKey(c, key, remember);
        if (c.identity.autoAnchor && identity.anchor) c.anchorId = identity.anchor.id;
        if (c.identity.autoSelf && Object.hasOwn(identity,'self')) c.selfId = identity.self?.id || '';
        await set(configKey, c); engine.update(c); manualPause = false; autoStartArmed = Boolean(c.automation.autoStart); autoStartNext = 0; autoStartError = ''; refresh(); panel.toast(c.automation.autoStart ? '设置已保存；连接就绪后会自动开始场控。' : '设置已保存，点击“开始场控”即可运行。');
        if (!c.incomeEnabled) panel.updateGiftSummary(giftLedger.snapshot(), c.gift.yuanPerDiamond);
        else await loadIncome();
      },
      testAI: async (c, key, remember) => {
        await keepKey(c, key, remember);
        const output = await client({ persona: c.ai.persona, knowledge: c.ai.knowledge, context: [], target: { name: '连接测试', text: '你好，请用一句话打招呼。' }, maxLength: c.sending.maxLength }, c.ai);
        log('ai', `连接测试通过：${output.slice(0, 300)}`); panel.toast('AI 连接测试通过。测试内容不会发送到公屏。');
      },
      diagnose: () => adapter.diagnose(),
      recoverEvents: async () => { await drainIncome(); await journalCommitter?.flush(); await adapter.recoverEvents?.(); await adapter.checkStorage?.(); refresh(); },
      exportEvents: async () => download(`douyin-recovery-${room}.json`,JSON.stringify({savedAt:Date.now(),runtime:engine.snapshot(),incomePending:[...incomePending],collection:adapter.exportEvents ? await adapter.exportEvents() : network},null,2)),
      exportConfig: () => download(`douyin-live-${room}.json`, JSON.stringify(engine.config, null, 2)),
      income: () => loadIncome({profiles:true}),
      exportIncome: async () => { const selection = panel.incomeSelection(); download(`douyin-income-${selection.room}-${selection.month}.json`, JSON.stringify(await repository.report(selection.room, selection.month), null, 2)); },
      addProfile: async input => {
        const url = new URL(input.trim());
        const target = url.hostname === 'live.douyin.com' && url.protocol === 'https:' && url.pathname.match(/^\/(\d+)\/?$/)?.[1];
        if (!target) throw new Error('请填写 https://live.douyin.com/数字 形式的直播间地址');
        await repository.profile({room:target,anchorId:url.searchParams.get('anchor_id') || ''});
        await loadIncome({profiles:true}); panel.toast('已添加主播。点击“打开并配置”设置该主播的独立规则。');
      },
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
    log('system', demo ? '模拟环境就绪，点击“开始场控”，再从左侧添加事件。' : '脚本已加载。点击“开始场控”后，符合规则的消息将按当前发送方式运行，无需逐条审核。');
    if (!engine.config.anchorId) log('system', '未识别到主播 UID。欢迎功能的粉丝团核对需在“欢迎”页填写。');
    if (!demo) {
      try { adapter.observeDOM(); } catch (e) { log('error', `备用采集未启动：${e.message}`); }
      if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('打开抖音直播运营助手', () => { if (!panel.open) panel.toggleOpen(); });
    }
    panel.refresh(engine, network);
    if (demo) applyIdentity({ anchor:{ id:'1234567890', name:'模拟主播' }, self:{ id:'9876543210', name:'我的场控账号（模拟）' } });
    else void identityReader.refresh().catch(e => log('error', `自动识别暂不可用：${e.message}`));
    let lastDateCheck = 0, lastStorageCheck = 0, lastPKRefresh = 0, lastContributionCheck = 0, contributionCheckBusy = false, incomeDay = giftDate(), waitingForConnection = false;
    const timer = setInterval(async () => {
      if (closed || suspended) return;
      if (demo) { network.lastFrame = adapter.status.lastFrame = Date.now(); }
      if (Date.now() - lastDateCheck >= 60000) { lastDateCheck = Date.now(); const day = giftDate(); if (day !== incomeDay) { incomeDay = day; refreshIncome(); } }
      if (engine.config.incomeEnabled && repository.recordContribution && adapter.readAudienceContributions && Date.now() - lastContributionCheck >= 15000 && !contributionCheckBusy) {
        lastContributionCheck = Date.now(); contributionCheckBusy = true;
        void (async () => {
          try {
            const rows = adapter.readAudienceContributions();
            const knownByName = new Map();
            let matched = 0, updated = false;
            const nameKey = value => String(value || '').replace(/\s+/g, '').trim();
            for (const viewer of viewers.values()) {
              const key = nameKey(viewer.name), list = knownByName.get(key) || []; list.push(viewer); knownByName.set(key, list);
            }
            for (const row of rows) {
              const matches = knownByName.get(nameKey(row.name)) || [];
              const id = row.userId && /^\d{4,30}$/.test(row.userId) ? row.userId : matches.length === 1 ? matches[0].id : '';
              if (!id) continue;
              matched++;
              updated = await repository.recordContribution({ room, date:giftDate(), userId:`uid:${id}`, name:row.name, score:row.score, scoreIsFloor:row.scoreIsFloor }) || updated;
            }
            panel?.updateContributionStatus({rows:rows.length,matched,checkedAt:Date.now()});
            if (updated) refreshIncome();
          } catch (error) { log('error', `在线贡献榜校准读取失败：${error.message}`); }
          finally { contributionCheckBusy = false; }
        })();
      }
      if (location.pathname !== initialPath) { log('error', '直播间地址已切换；场控保持当前状态，当前页不再处理新消息'); clearInterval(timer); adapter.stopDOM?.(); identityReader?.close(); pickCleanup?.(); return; }
      adapter.sync?.();
      if (engine.pk.current()?.phase === 'active' && Date.now() - lastPKRefresh >= 1000) { lastPKRefresh = Date.now(); refresh(); }
      if (adapter.checkStorage && Date.now()-lastStorageCheck >= 15000) { lastStorageCheck = Date.now(); void adapter.checkStorage().catch(error=>log('error',`存储用量检查失败：${error.message}`)); }
      void tryAutoStart();
      const waiting = engine.running && !demo && engine.config.mode !== 'preview' && !adapter.healthy();
      if (waiting !== waitingForConnection) { waitingForConnection = waiting; if (engine.running) log('system', waiting ? '直播数据重连中，暂缓发送；连接恢复后继续' : '直播数据连接已恢复，继续场控'); }
      const tickEpoch = engine.epoch;
      try { await engine.tick(demo || engine.config.mode === 'preview' || adapter.healthy()); }
      catch (e) { if (engine.epoch === tickEpoch) log('error', `运行异常，场控保持运行：${e.message}`); }
    }, 250);
    panel.updateGifts([...giftActivity.values()].reverse());
    if (!engine.config.incomeEnabled) panel.updateGiftSummary(giftLedger.snapshot(), engine.config.gift.yuanPerDiamond);
    void registerProfile().catch(error => log('error', `主播资料保存失败：${error.message}`));
    window.addEventListener('pagehide', event => {
      resumeAutoStart = event.persisted && autoStartArmed && !manualPause;
      const wasRunning = engine.running || engine.resumeRequested;
      suspended = true; closed = !event.persisted;
      engine.resumeRequested = wasRunning && !manualPause;
      engine.stop(event.persisted ? '页面进入缓存，保留运行状态' : '页面刷新或关闭，保留运行状态', { preserveWork:true });
      clearTimeout(runtimeSaveTimer); runtimeSaveTimer = null; void persistRuntime(true).catch(() => {});
      if (closed) { clearInterval(timer); identityReader?.close(); adapter.closeEvents?.(); }
      clearTimeout(renderTimer); renderTimer = null; clearTimeout(viewerTimer); viewerTimer = null; clearTimeout(giftTimer); giftTimer = null; clearTimeout(incomeTimer); incomeTimer = null;
      clearTimeout(panel.logTimer); panel.logTimer = null; clearTimeout(panel.toastTimer); clearTimeout(incomeRetryTimer); incomeRetryTimer = null; adapter.stopDOM?.(); pickCleanup?.();
      journalCommitter?.pause();
    });
    window.addEventListener('pageshow', event => {
      if (!event.persisted || closed) return;
      suspended = false;
      autoStartArmed = resumeAutoStart && !manualPause; autoStartNext = 0;
      journalCommitter?.resume();
      void drainIncome();
      adapter.sync?.();
      if (!demo) { try { adapter.observeDOM(); } catch (e) { log('error', e.message); } void identityReader.refresh().catch(e => log('error', e.message)); }
      refresh(); refreshGifts(); void loadIncome({profiles:true});
    });
    void drainIncome();
    options.onReady?.({ engine, panel, adapter, stop: pause, rememberUser, refreshIncome });
  }
  if (document.body) void ready(); else document.addEventListener('DOMContentLoaded', ready, { once: true });
  return engine;
}
