import {createDirectStreamSource} from './browser/live-stream.js';
import {resolveMediaConfig,resolveReplyConfig,aliEndpoints,pipelineConfig} from './services/ai-pipeline.js';
import {createRealtimeCapture,createSDPExchange} from './browser/omni-realtime.js';
import { RoomContext } from './browser/room-context.js';
import { Engine, DEFAULTS, copy, mergeConfig, validateConfig } from './core/engine.js';
import { matchesGiveawayChat } from './core/giveaway.js';
import { DouyinAdapter, RoomLock, pickElement, watchAudienceContributions } from './browser/adapter.js';
import { createAIClient, validateEndpoint, generatePhrases } from './services/ai.js';
import { createSearchClient, validateSearchEndpoint } from './services/search.js';
import {createMediaClient,MediaEvidence,validateMediaConfig} from './services/media.js';
import {LiveMediaAnalyzer,createDisplayCapture} from './browser/live-media.js';
import { Panel } from './ui/panel.js';
import { IdentityReader, roomAdminStatus } from './browser/identity.js';
import { GiftLedger, GiftStore, giftDate, contributionSnapshot } from './data/gifts.js';
import { JournalCommitter, RuntimeWriter } from './runtime/journal.js';
import { failureCode } from './runtime/inbox.js';
import { audienceAge } from './core/audience.js';
import { createPageTools } from './runtime/tool-host.js';
import { hasUnacknowledgedRuntimeAlert, normalizeRuntimeAlertState, reconcileRuntimeAlertState, runtimeAlertState } from './runtime/health.js';

export function boot(options = {}) {
  const demo = Boolean(options.demo);
  const page = options.page || (demo ? window : unsafeWindow);
  const roomContext = new RoomContext(window);
  const room = demo ? 'demo' : roomContext.room;
  if (!room || document.getElementById('douyin-live-assistant')) return;
  const get = options.get || ((key, fallback) => GM_getValue(key, fallback));
  const set = options.set || ((key, value) => GM_setValue(key, value));
  const del = options.del || (key => GM_deleteValue(key));
  const repository = options.repository || new GiftStore({ get, set, all: options.all || (() => Object.fromEntries((typeof GM_listValues === 'function' ? GM_listValues() : [configKey]).map(key => [key, get(key, null)]))) });
  const configKey = `live-assistant:config:${room}`;
  const runtimeKey = `live-assistant:runtime:${room}`;
  const runtimeSnapshot = get(runtimeKey, null);
  let acknowledgedRuntimeAlert = normalizeRuntimeAlertState(runtimeSnapshot?.collection?.acknowledgedRuntimeAlert || {});
  let config, configError = '';
  try { config = validateConfig(mergeConfig(get(configKey, {}))); }
  catch (e) { config = copy(DEFAULTS); configError = `旧配置无效，已使用默认值：${e.message}`; }
  if (!config.anchorId) config.anchorId = new URLSearchParams(location.search).get('anchor_id')?.match(/^\d+$/)?.[0] || '';
  const sessionKeys = new Map(); let panel, engine, tools, network = {}, logBacklog = [], starting = false, pickCleanup, renderTimer, viewerTimer, giftTimer, incomeTimer, incomeRequest = 0, runtimeSaveTimer, profileSignature = '', closed = false, suspended = false, persistenceDisabled = false;
  const runtimeWriter = new RuntimeWriter(snapshot => set(runtimeKey, snapshot));
  // 自动开启只在本页首次进入时保持武装；只有用户明确点击暂停才关闭。
  let autoStartArmed = true, resumeAutoStart = false, manualPause = false, autoStartNext = 0, autoStartError = '';
  const viewers = new Map(), giftActivity = new Map(), giftLedger = new GiftLedger();
  // 账本写入与场控发送解耦：存储短暂失败时保留最新连击进度并自动重试，
  // 不让一次扩展后台/IndexedDB 抖动造成收入遗漏。
  const incomePending = new Map(); let incomeDrainBusy = false, incomeRetryTimer = null;
  let incomeSummary = null, incomeFailure = '', incomeContext = null, ledgerAnchorId = '';
  function renderIncomeSummary() {
    if (panel && engine.config.incomeEnabled) panel.updateGiftSummary(incomeSummary || {}, engine.config.gift.yuanPerDiamond, true, { pending:incomePending.size, error:incomeFailure });
  }
  const contextError = error => failureCode(error) === 'CONTEXT_INVALID';
  const contextFailure = () => Object.assign(new Error('扩展上下文已失效，请先导出恢复数据，再刷新直播页'), {code:'CONTEXT_INVALID'});
  function reportPersistenceError(error, message) {
    if (!contextError(error)) { log('error', `${message}：${error.message}`); return; }
    if (persistenceDisabled) return;
    persistenceDisabled = true;
    journalCommitter?.pause();
    clearTimeout(runtimeSaveTimer); runtimeSaveTimer = null;
    clearTimeout(incomeRetryTimer); incomeRetryTimer = null;
    incomeFailure = contextFailure().message;
    network = {...network,contextInvalidated:true};
    renderIncomeSummary(); refresh();
    log('error', '扩展连接已失效，已停止后台重试。请先导出恢复数据，再刷新直播页；自动发送暂缓，直播事件仍继续接收。');
  }
  function persistRuntime(immediate = false) {
    if (!engine || closed && !immediate) return;
    if (runtimeWriter.failure || adapter.persistenceUnavailable?.()) return immediate ? Promise.reject(runtimeWriter.failure || contextFailure()) : Promise.resolve();
    clearTimeout(runtimeSaveTimer); runtimeSaveTimer = null;
    const save = () => {
      const snapshot = { ...engine.snapshot(), incomePending:JSON.parse(JSON.stringify([...incomePending])),collection:{...(network.ingestion ? {...network.ingestion,bridgeGaps:network.bridgeGaps || 0,frameGaps:network.frameGaps || 0,captureGaps:network.capture?.gaps || 0} : runtimeSnapshot?.collection || {}),acknowledgedRuntimeAlert} };
      const write = runtimeWriter.save(snapshot);
      const reported = write.catch(error => reportPersistenceError(error, '运行状态保存失败'));
      return immediate ? write : reported;
    };
    if (immediate) return save();
    runtimeSaveTimer = setTimeout(() => { runtimeSaveTimer = null; void save(); }, 250);
  }
  const journalCommitter = options.journal ? new JournalCommitter({
    checkpoint: () => persistRuntime(true),
    ack: keys => options.journal.ackMany ? options.journal.ackMany(keys) : Promise.all(keys.map(key => options.journal.ack(key))),
    active: () => !closed && !suspended && !persistenceDisabled,
    onError: error => reportPersistenceError(error, '运行状态批量确认失败，事件日志保留待重试')
  }) : null;
  let identity = {};
  const log = (category, message) => { if (panel) panel.log(category, message); else { logBacklog.push([category, message]); if (logBacklog.length > 200) logBacklog.shift(); } };
  const refresh = () => { if (panel && !closed && !suspended && !renderTimer) renderTimer = setTimeout(() => { renderTimer = null; panel.refresh(engine, network); }, 100); };
  let sendingScheduled = false, senderActive = false;
  const wakeSender = () => {
    if (persistenceDisabled || sendingScheduled || senderActive || !engine?.senderEnabled() || engine.busy || closed || suspended || !roomContext.current()) return;
    const now = Date.now();
    if (!engine.queue.some(job => engine.giftReady(job, now)) && ![...engine.gifts.values()].some(gift => gift.due <= now && gift.count > gift.credited)) return;
    if (!demo && engine.config.mode !== 'preview' && !adapter.healthy()) return;
    sendingScheduled = true;
    queueMicrotask(async () => {
      sendingScheduled = false;
      if (persistenceDisabled || !engine.senderEnabled() || engine.busy || closed || suspended || !roomContext.current()) return;
      const beforeJob = engine.selectNextJob(engine.queue, Date.now())?.id;
      const beforeSent = engine.stats.submitted + engine.stats.previews;
      senderActive = true;
      try { await engine.tick(demo || engine.config.mode === 'preview' || adapter.healthy()); }
      catch (error) { reportPersistenceError(error, '即时发送异常，消息保留'); }
      finally {
        senderActive = false;
        // 格式错误等没有进展的任务交给常规检查，避免微任务持续重试阻塞页面。
        if (engine.stats.submitted + engine.stats.previews > beforeSent || engine.selectNextJob(engine.queue, Date.now())?.id !== beforeJob) wakeSender();
      }
    });
  };
  async function loadIncome({ profiles = false, force = false } = {}) {
    if (!panel || closed || persistenceDisabled && !force) return;
    const request = ++incomeRequest;
    try {
      if (profiles) panel.updateProfiles(await repository.profiles());
      const selection = panel.incomeSelection();
      const incomeAnchorId = engine.config.anchorId;
      const month = giftDate().slice(0, 7);
      const [selected, current] = await Promise.all([
        repository.report(selection.room, selection.month, {includeAllSessions:selection.room === room && selection.month === month}),
        selection.room === room && selection.month === month ? null : repository.report(room, month, {includeAllSessions:true})
      ]);
      if (closed || request !== incomeRequest || incomeAnchorId !== engine.config.anchorId) return;
      panel.updateIncome(selected);
      const own = current || selected;
      panel.updateAnchorIncome({...own,anchorId:incomeAnchorId});
      incomeSummary = own.currentSession || {totalDiamonds:0,giftCount:0,unknownCount:0,estimatedIncome:0};
      incomeContext = own.currentSession ? {...own.currentSession,anchorId:incomeAnchorId,at:Date.now(),source:'durable-ledger',month:own.month,summary:own.summary,days:own.days} : null;
      if (!incomePending.size) incomeFailure = '';
      renderIncomeSummary();
    } catch (error) { if (!closed) { incomeFailure = error.message; renderIncomeSummary(); panel.incomeError(error.message); reportPersistenceError(error, '礼物账本读取失败'); } }
  }
  function refreshIncome() {
    if (closed || persistenceDisabled || incomeTimer) return;
    incomeTimer = setTimeout(() => { incomeTimer = null; void loadIncome(); }, 500);
  }
  const incomeKey = (record, userKey) => `${record.roomId || room}:${userKey || record.user?.id || 'anonymous'}:${record.giftId || record.giftName || 'gift'}:${record.groupId || record.id || 'single'}`;
  const drainIncome = async () => {
    if (persistenceDisabled || incomeDrainBusy || closed || !incomePending.size || !engine.config.incomeEnabled) return;
    incomeDrainBusy = true;
    try {
      for (const [key, item] of incomePending) {
        if (item.nextAt > Date.now()) continue;
        try {
          await repository.record({ room, event:item.event, userKey:item.userKey, rate:item.rate, capturedAt:item.capturedAt });
          incomeFailure = '';
          if (incomePending.get(key) === item) { incomePending.delete(key); persistRuntime(); }
          refreshIncome();
        } catch (error) {
          if (contextError(error)) {
            reportPersistenceError(error, '礼物账本保存失败');
            break;
          }
          incomeFailure = error.message; renderIncomeSummary();
          item.attempts++;
          item.nextAt = Date.now() + Math.min(30000, 500 * 2 ** Math.min(item.attempts, 6));
          if (item.attempts === 1 || item.attempts % 5 === 0) {
            panel?.incomeError(error.message); log('error', `礼物账本保存失败，${Math.round((item.nextAt - Date.now()) / 1000)} 秒后重试：${error.message}`);
          }
        }
      }
    } finally {
      incomeDrainBusy = false;
      if (incomePending.size && !closed && engine.config.incomeEnabled && !persistenceDisabled) {
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
    // 入账排队时就保存恢复点，不能依赖引擎正在运行或后续写入成功。
    persistRuntime();
    renderIncomeSummary();
    void drainIncome();
  };
  async function registerProfile(name) {
    if (persistenceDisabled) return;
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
      if (!engine.config.incomeEnabled) panel.updateGiftSummary(giftLedger.currentSession() || {}, engine.config.gift.yuanPerDiamond);
    }, 500);
  };
  const rememberUser = event => {
    if (engine?.isSelfUser(event?.user) && event?.type !== 'gift') return;
    const user = event?.user;
    if (event?.type === 'gift') {
      const eventUserKey = user?.id ? `uid:${user.id}` : user?.secUid ? `sec:${user.secUid}` : user?.name ? `name:${user.name}` : 'anonymous';
      const override = engine.config.gift.prices[event.giftId] ?? engine.config.gift.prices[event.giftName];
      const unitValue = event.unitValue > 0 ? event.unitValue : override > 0 ? override : null;
      const record = { type:'gift', id:event.id, groupId:event.groupId, giftId:event.giftId, giftName:event.giftName, roomId:event.roomId, count:Number(event.count) || 1, unitValue, at:event.at, receivedAt:event.receivedAt, capturedAt:event._journalSavedAt || event.receivedAt || Date.now(), final:Boolean(event.final), user:{id:user?.id || ''} };
      giftLedger.observe(record, room, eventUserKey, engine.config.gift.yuanPerDiamond);
      ledgerAnchorId=engine.config.anchorId;
      if (engine.config.incomeEnabled) queueIncome(record, eventUserKey);
      if (!user?.name) refreshGifts();
    }
    if (!user?.name) return;
    const key = user.id ? `uid:${user.id}` : user.secUid ? `sec:${user.secUid}` : `name:${user.name}`;
    const old = viewers.get(key);
    const club = (user.fanClubs || []).find(item => item.anchorId && item.anchorId === engine.config.anchorId);
    const next = { key, id:user.id || '', secUid:user.secUid || '', name:user.name.slice(0,60), gender:Object.hasOwn(user,'gender') ? user.gender : old?.gender ?? null,
      age:Object.hasOwn(user,'birthdayValid') || Object.hasOwn(user,'birthdayDescription') ? audienceAge(user) : old?.age ?? null,
      wealthLevel:user.wealthLevel ?? old?.wealthLevel ?? null, fanLevel:club?.level ?? old?.fanLevel ?? null, fanStatus:club?.status ?? old?.fanStatus ?? null, seen:Date.now() };
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
  const mediaSecretKey=endpoint=>`live-assistant:media-key:${new URL(validateEndpoint(endpoint)).origin}`;
  let activeMediaConfig=resolveMediaConfig(config.ai),mediaAnchor=config.anchorId;
  const mediaEvidence=new MediaEvidence();
  const mediaKey=endpoint=>(sessionKeys.get(mediaSecretKey(endpoint)) ?? get(mediaSecretKey(endpoint),'')) || (sessionKeys.get(secretKey(endpoint)) ?? get(secretKey(endpoint),''));
  const recognizeMedia=createMediaClient({request,getKey:mediaKey});
  const clearMedia=()=>{mediaEvidence.clear();panel?.aiSettings.observations([]);};
  const directSource=options.directStreamSource || createDirectStreamSource({page,env:window});
  const sourceFor=config=>config.inputSource==='display' ? undefined : directSource;
  const exchange=createSDPExchange({request,getKey:mediaKey});
  const realtimeCapture=createRealtimeCapture({exchange,env:window,sourceFactory:directSource});
  const media=new LiveMediaAnalyzer({capture:options.mediaCapture || (args=>createDisplayCapture({...args,sourceFactory:sourceFor(args.config)},window)),
    realtimeCapture:options.realtimeCapture || realtimeCapture,recognize:recognizeMedia,
    onObservation:row=>{mediaEvidence.add(row);panel?.aiSettings.observations(mediaEvidence.context(activeMediaConfig.contextAgeSec).observations);},
    onState:state=>{if(state.state==='idle')clearMedia();panel?.aiSettings.state(state);},
    onError:error=>{panel?.aiSettings.showError(error.message);log('ai',`音视频识别：${error.message}`);}
  });
  const searchSecretKey = endpoint => `live-assistant:search-key:${new URL(validateSearchEndpoint(endpoint)).origin}`;
  const searchClient = createSearchClient({request,getKey:endpoint=>sessionKeys.get(searchSecretKey(endpoint)) ?? get(searchSecretKey(endpoint),'')});
  let aiStatusSequence=0;
  const client = createAIClient({ request, getKey: (endpoint,ai) => pipelineConfig(ai).mode==='omni-only' ? mediaKey(endpoint) : sessionKeys.get(secretKey(endpoint)) ?? get(secretKey(endpoint), ''),search:searchClient,
    onStatus:status=>{if (engine && resolveReplyConfig(engine.config.ai).endpoint===status.endpoint && resolveReplyConfig(engine.config.ai).model===status.model && status.sequence>aiStatusSequence) {aiStatusSequence=status.sequence;panel?.setAIServiceStatus(status.error);}},
    onIntent:record=>log('ai',`识别意图：${({'live-data':'直播数据','web-search':'联网查询',chat:'普通对话',clarify:'澄清问题',skip:'无需回复'})[record.intent]}`),
    onSearch:record=>{panel?.recordSearch(record);log('ai',record.error ? `联网搜索失败：${record.error}` : `联网搜索：${record.query} · ${record.results.length} 条来源`);}
  });
  const lock = options.lock || new RoomLock({ room });
  const makeAdapter = options.adapterFactory || (settings => new DouyinAdapter(settings));
  let stoppedBroadcast = '';
  const stopEndedTools = () => {
    const state = engine.liveMode;
    const key = state.endedAt ? JSON.stringify([state.roomId,state.endedAt]) : '';
    if (key && key !== stoppedBroadcast) {media.stop();tools?.notify('stop', '直播已结束，已停止工具任务');}
    stoppedBroadcast = key;
  };
  const adapter = makeAdapter({
    page,
    getConfig: () => engine.config,
    onPK:event=>{
      if (!engine || closed || suspended || !roomContext.current()) return;
      if (engine.ingestPK(event)) {stopEndedTools();refresh();persistRuntime();}
    },
    onEcho:event=>engine?.observeEcho(event),
    onEvent: async event => {
      const journalKey = event?._journalKey;
      const { _journalKey, _journalId, _journalSavedAt, ...liveEvent } = event || {};
      // A journal append may finish after pagehide. Keep that record for recovery.
      if (!engine || closed || suspended || !roomContext.current()) return;
      if(['start','end'].includes(liveEvent.type)) {engine.ingestPK(liveEvent);stopEndedTools();}
      const echoed = engine.observeEcho(liveEvent);
      if (['like','fansclub','fansclub-push'].includes(liveEvent.type) && engine.isSelfUser(liveEvent?.user)) {
        engine.ingest(liveEvent);refresh();persistRuntime();
      }
      if (liveEvent.type !== 'gift' && engine.isSelfUser(liveEvent?.user) && (echoed || !engine.acceptsSelfGameChat(liveEvent))) {
        if (journalKey) await options.journal.ack(journalKey);
        return;
      }
      let journalWrite = null;
      const passiveDataEvent = ['anchor-fanclub','room-likes','like','room-stats','room-audience','social','fansclub','emoji-chat','screen-chat','room-notice','room-rank','rank-update','room-notify','room-sync','audio-chat','highlight-comment','light-gift','live-shopping','product-change','room-banner','rank-award','red-packet','activity-signal','chat-like','fan-ticket','room-activity-state','gift-panel-state','room-indicator','gift-catalog','battle-bonus','battle-property','battle-season-honor','popular-card','fansclub-statistics','group-live-members','group-live-income','room-ticket','linkmic-positions','guest-link-state','fansclub-push','anchor-exhibition','pk-rank-season','anchor-pk-tasks'].includes(liveEvent.type);
      if ((engine.running || tools?.state('giveaway')?.receiving || ['gift','start','end'].includes(liveEvent.type) || passiveDataEvent) && options.journal && !journalKey && !persistenceDisabled) {
        // Incoming messages are structured-cloned in the extension, but direct
        // integrations/tests may provide frozen objects. Work on a shallow copy
        // before attaching recovery metadata so a read-only event cannot abort
        // the whole inbox drain.
        const journalId = event?._journalId || crypto.randomUUID();
        event = {...liveEvent,_journalId:journalId};
        try { journalWrite = Promise.resolve(options.journal.append(liveEvent,journalId)); }
        catch (error) { reportPersistenceError(error, '事件日志写入失败，直播互动已继续处理'); }
        if (!event.id) event.id = `journal:${journalId}`;
      } else event = {...liveEvent,...(journalKey ? {_journalKey:journalKey,_journalSavedAt} : {})};
      if (closed || suspended || !roomContext.current()) return;
      if (!persistenceDisabled && ['start','end'].includes(liveEvent.type)) {
        const observedAt = liveEvent.observedAt || liveEvent.receivedAt || Date.now();
        const at = Number.isFinite(liveEvent.at) && liveEvent.at > 0 ? liveEvent.at : observedAt;
        const source = liveEvent.source || 'platform', roomId = liveEvent.roomId || '';
        const startAt = liveEvent.startAt || 0;
        giftLedger.observeSession({type:liveEvent.type,at,source,roomId,observedAt,startAt});
        refreshGifts();
        try { await repository.recordSession({room,type:liveEvent.type,at,observedAt,roomId,source,startAt}); refreshIncome(); }
        catch (error) { if (journalWrite) await journalWrite; reportPersistenceError(error, '直播场次边界保存失败'); throw error; }
      }
      // 账本/侧栏错误不能中断场控回复，也不能阻塞同帧中后续的消息。
      try {
        rememberUser(event);
        if (event.type === 'room-audience') for (const row of [...(event.ranks || []),...(event.seats || [])]) {
          if (row.user) rememberUser({...event,type:'audience-rank',user:row.user});
        }
      } catch (error) { log('error', `互动资料更新失败：${error.message}`); }
      const giveawayState=tools?.state('giveaway');
      const giveawayRound=giveawayState?.phase==='running' ? giveawayState.rounds.find(round=>round.status==='running') : null;
      engine.ingest(event, {giveawayChat:matchesGiveawayChat(giveawayRound,event,Date.now())});
      stopEndedTools();
      if(['chat','gift'].includes(liveEvent.type)) {
        await tools?.ready;
        try{await tools?.dispatch('event',liveEvent);}
        catch(error){if(journalWrite)await journalWrite;throw error;}
      }
      if (journalWrite) {
        void (async () => {
          try {
            const saved = await journalWrite;
            event._journalKey = saved.key;
            event._journalSavedAt = saved.savedAt;
            journalCommitter?.add(saved.key);
          } catch (error) { reportPersistenceError(error, '事件日志写入失败，直播互动已继续处理'); }
        })();
      } else if (journalKey || event?._journalKey) journalCommitter?.add(journalKey || event._journalKey);
    },
    onLog: log, onStatus: status => {
      const previousGaps = (network.ingestion?.gaps || 0)+(network.bridgeGaps || 0)+(network.frameGaps || 0)+(network.capture?.gaps || 0);
      const previousAcknowledgement = JSON.stringify(acknowledgedRuntimeAlert);
      const nextStatus = {...status,contextInvalidated:status.contextInvalidated || persistenceDisabled};
      acknowledgedRuntimeAlert = reconcileRuntimeAlertState(nextStatus,acknowledgedRuntimeAlert);
      network = {...nextStatus,acknowledgedRuntimeAlert};
      if (network.contextInvalidated) reportPersistenceError(contextFailure(), '扩展连接已失效');
      refresh(); wakeSender();
      if ((status.ingestion?.gaps || 0)+(status.bridgeGaps || 0)+(status.frameGaps || 0)+(status.capture?.gaps || 0) !== previousGaps || JSON.stringify(acknowledgedRuntimeAlert) !== previousAcknowledgement) persistRuntime();
    },
    shouldReadChat: () => tools?.state('giveaway')?.phase==='running' || engine.config.ai.enabled || engine.running && (engine.config.bot.enabled || engine.config.keyword.enabled || engine.config.moderation.enabled),
    shouldReadMilestones: () => engine.running
  });
  engine = new Engine({
    config, log, ai: client,
    claimGiveaway:(message,owner)=>tools.invoke('giveaway','claimFeedback',{key:message.key,owner}),
    giveawayCurrent:message=>{
      if(!tools || tools.closed || tools.suspended)return null;
      if(tools.guard('giveaway') || tools.status().find(row=>row.id==='giveaway')?.phase!=='active')return null;
      const round=tools.state('giveaway')?.rounds?.find(row=>row.id===message.roundId);
      if(!round)return null;
      const broadcast=identity.live?.roomId || engine.liveMode?.roomId || '';
      if(round.broadcastId && broadcast && round.broadcastId!==broadcast)return false;
      return message.kind==='result' ? round.status==='drawn' : message.kind==='cancelled' ? round.status==='cancelled' : round.status==='running';
    },
    mediaContext:()=>media.state==='running' && mediaAnchor===engine.config.anchorId && (demo || roomContext.current()) ? mediaEvidence.context(activeMediaConfig.contextAgeSec) : null,
    liveData: () => {
      const local=giftLedger.currentSession();
      const saved=engine.config.incomeEnabled && incomeContext?.anchorId===engine.config.anchorId ? incomeContext : null;
      const current=engine.pkOperations.broadcast?.roomId;
      const income=saved && (!current || saved.roomId===current) ? saved : local && ledgerAnchorId===engine.config.anchorId && (!current || local.roomId===current)
        ? {...local,anchorId:engine.config.anchorId,at:Date.now(),source:'page-ledger'} : null;
      return {income:income ? {...income,pending:incomePending.size} : null};
    },
    manage: demo ? async (action,user,isCurrent) => { if (!isCurrent()) return {submitted:false}; log('lab',`模拟${action==='ban'?'封禁':'禁言'}：${user.name}`); return {submitted:true,simulated:true}; } : (action,user,isCurrent) => adapter.moderate(action,user,() => isCurrent() && lock.held && !closed && !suspended && !persistenceDisabled && roomContext.current()),
    changed: () => { refresh(); persistRuntime(); wakeSender(); }, checkpoint: () => persistRuntime(true),
    onStop: () => { media.stop(); lock.release(); autoStartArmed = false; },
    send: demo ? async (text, isCurrent, hooks) => { if (!isCurrent()) return { submitted: false }; await hooks.beforeClick(); log('lab', `模拟发送：${text}`); engine.observeEcho({type:'chat',source:'socket',user:{id:engine.config.selfId},text,receivedAt:Date.now()}); return { submitted: true,clicked:true }; } : async (text, isCurrent, hooks) => {
      const independent=!engine.running;
      if(independent && (!isCurrent() || !await lock.acquire()))return {submitted:false,reason:'等待当前直播间发送锁'};
      try {return await adapter.send(text,()=>isCurrent() && lock.held && roomContext.current(),hooks);}
      finally {if(independent && !engine.running && !starting)lock.release();}
    }
  });
  tools = createPageTools({page:window,room,engine,adapter,demo,log,
    getRoomId:()=>identity.live?.roomId || engine.liveMode?.roomId || '',
    current:()=>!closed && !suspended && roomContext.current(),unavailable:()=>persistenceDisabled,liveStatus:()=>identity.live?.status,
    rewardStorage:options.rewardStorage || {get:key=>get(key,[]),set},
    giveawayStorage:options.giveawayStorage || {get:key=>get(key,null),set},
    giveawayPendingEvents:options.journal?.pending ? after=>options.journal.pending(after) : undefined,
    saveConfig:async (key,value)=>{
      if(closed || suspended || persistenceDisabled || !roomContext.current())throw new Error('页面状态已变化，请刷新后保存');
      const c=copy(engine.config);c[key]=value;validateConfig(c);await set(configKey,c);engine.update(c);
    },changed:(id,state)=>panel?.updateToolState(id,state)
  });
  if (runtimeSnapshot?.version === 1 && Array.isArray(runtimeSnapshot.incomePending)) for (const entry of copy(runtimeSnapshot.incomePending)) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[1]?.event) incomePending.set(entry[0], entry[1]);
  }
  if (engine.restore(runtimeSnapshot)) {
    autoStartArmed = engine.resumeRequested || Boolean(engine.config.automation.autoStart);
    if (engine.resumeRequested) log('system', '已恢复上次运行状态，连接就绪后自动续跑');
  }
  function applyIdentity(next) {
    if(closed || suspended || !roomContext.current())return;
    identity = { ...next, admin: roomAdminStatus(next.self, next.adminUserIds) }; const c = engine.config;
    engine.setIdentity(identity);
    if (next.anchor && c.identity.autoAnchor) {
      if(media.state!=='idle' && mediaAnchor!==next.anchor.id)media.stop();
      if (c.anchorId && c.anchorId !== next.anchor.id && engine.running) log('error', '识别到主播资料变化；场控保持运行，请检查当前房间配置');
      c.anchorId = next.anchor.id;
    }
    if (c.identity.autoSelf && Object.hasOwn(next,'self')) c.selfId = next.self?.id || '';
    panel?.updateIdentity(identity); refresh();
    if (next.live && !closed && !suspended && roomContext.current()) {
      const live = next.live, type = live.status === 'live' ? 'start' : 'end';
      const at = type === 'start' ? live.startAt || live.observedAt : live.endAt || live.observedAt;
      const event = {type, roomId:live.roomId, at, startAt:live.startAt, observedAt:live.observedAt, receivedAt:live.observedAt,
        source:(type === 'start' ? !live.startAt : !live.endAt) ? 'platform-observed' : 'platform'};
      void Promise.resolve(adapter.dispatch ? adapter.dispatch(event) : adapter.onEvent(event)).catch(error => reportPersistenceError(error, '直播状态保存失败'));
    }
    if (next.anchor) void registerProfile(next.anchor.name).catch(error => reportPersistenceError(error, '主播资料保存失败'));
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
  async function keepSearchKey(c, credentials = {}) {
    if(!credentials.key)return;
    const name=searchSecretKey(c.ai.search.endpoint);sessionKeys.set(name,credentials.key);
    if(credentials.remember)await set(name,credentials.key);else await del(name);
  }
  function prepareMediaKeys(c,credentials={}) {
    const keys=new Map();
    const preset=!['custom','text'].includes(pipelineConfig(c.ai).mode);
    for(const kind of preset ? ['pipeline'] : ['vision','audio']){
      const value=credentials[kind];if(!value?.key)continue;
      const name=mediaSecretKey(preset ? aliEndpoints(c.ai).chat : c.ai.media[`${kind}Endpoint`]);
      if(keys.has(name) && (keys.get(name).key!==value.key || keys.get(name).remember!==value.remember))throw new Error('同域音视频服务请使用相同密钥和记住选项，或仅在一处填写');
      keys.set(name,value);
    }
    for(const [name,value] of keys)sessionKeys.set(name,value.key);
    return async()=>{for(const [name,value] of keys)if(value.remember)await set(name,value.key);else await del(name);};
  }
  function download(name, content) {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const pause = (reason, { manual = false } = {}) => {
    media.stop();
    tools.notify('stop', reason);
    if (manual) manualPause = true;
    autoStartArmed = false;
    engine.stop(reason);
  };
  async function start({ automatic = false } = {}) {
    if (persistenceDisabled) throw contextFailure();
    if (engine.running || starting || closed || suspended) return;
    if (!automatic) { manualPause = false; tools.notify('resume'); autoStartArmed = true; autoStartError = ''; }
    adapter.sync?.();
    if (!demo && engine.config.mode !== 'preview') {
      if (!adapter.healthy()) {
        if (automatic) return false;
        throw new Error('尚未连接直播数据，请刷新直播页，先用仅预览检查事件');
      }
      if (!adapter.requestAvailable?.('chat')) {
        const input = adapter.findInput(); adapter.findSend(input);
      }
    }
    starting = true; const startEpoch = engine.epoch;
    try {
      const acquired = await lock.acquire();
      if (engine.epoch !== startEpoch || closed || suspended) { lock.release(); return; }
      if (!acquired) {
        if (automatic) return false;
        throw new Error('此直播间已有另一个标签页运行场控，请先暂停另一页');
      }
      if (!roomContext.current()) { lock.release(); throw new Error('直播间已切换，请刷新页面'); }
      engine.start();
      if (options.journal && adapter.replayJournal) void adapter.replayJournal().catch(error => reportPersistenceError(error, '恢复事件日志失败'));
      autoStartError = '';
      return true;
    } finally { starting = false; }
  }
  async function tryAutoStart() {
    if (persistenceDisabled || !engine || engine.running || !engine.config.automation.autoStart || !autoStartArmed || manualPause || closed || suspended || starting || Date.now() < autoStartNext) return;
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
      toolAction:(id, action, value) => tools.invoke(id, action, value),
      toolControl:(id, action) => action === 'restart' ? tools.restart(id) : tools.disable(id),
      start: () => start(), stop: () => pause('人工暂停，已清空发送队列与弹幕上下文', { manual: true }), lab,
      debugSend: (channel = 'chat') => {
        if (persistenceDisabled) throw contextFailure();
        if (!engine.running || engine.config.mode !== 'auto') throw new Error('请在自动发送模式下开始场控后再测试');
        if (!adapter.healthy()) throw new Error('直播数据未连接，暂不能发送测试消息');
        if (!['chat', 'admin'].includes(channel)) throw new Error('不支持的调试弹幕类型');
        const text = channel === 'admin' ? '管理员弹幕调试消息发送测试' : '调试消息发送测试';
        if (!engine.enqueue('debug', text, { channel })) throw new Error('测试消息未能加入发送队列');
        wakeSender();
      },
      identify: async () => { if (demo) { applyIdentity({ anchor:{ id:'1234567890', name:'模拟主播' }, self:{ id:'9876543210', name:'我的场控账号（模拟）' } }); panel.toast('已识别模拟主播和账号'); } else { await identityReader.refresh(); panel.toast('识别完成；未识别的项目可手动补充'); } },
      save: async (c, key, remember, searchCredentials,mediaCredentials) => {
        await keepKey(c, key, remember);
        await keepSearchKey(c,searchCredentials);
        await prepareMediaKeys(c,mediaCredentials)();
        if (c.identity.autoAnchor && identity.anchor) c.anchorId = identity.anchor.id;
        if (c.identity.autoSelf && Object.hasOwn(identity,'self')) c.selfId = identity.self?.id || '';
        if(c.anchorId!==mediaAnchor || JSON.stringify(resolveMediaConfig(c.ai))!==JSON.stringify(activeMediaConfig))media.stop();
        await set(configKey, c); if (JSON.stringify(resolveReplyConfig(engine.config.ai))!==JSON.stringify(resolveReplyConfig(c.ai))) panel.setAIServiceStatus(''); engine.update(c); tools.notify('resume'); tools.notify('tick'); manualPause = false; autoStartArmed = Boolean(c.automation.autoStart); autoStartNext = 0; autoStartError = ''; refresh(); panel.toast(c.rewards.enabled ? '设置已保存；福袋红包自动参与已开启。' : c.automation.autoStart ? '设置已保存；连接就绪后会自动开始场控。' : '设置已保存，点击“开始场控”即可运行。');
        if (!c.incomeEnabled) panel.updateGiftSummary(giftLedger.currentSession() || {}, c.gift.yuanPerDiamond);
        else await loadIncome();
      },
      startMedia:async(c,credentials)=>{
        if(closed || suspended || !demo && !roomContext.current())throw new Error('页面或直播间已切换，请刷新后重新选择直播标签页');
        const effective=resolveMediaConfig(c.ai);validateMediaConfig(effective,true);const persistKeys=prepareMediaKeys(c,credentials);
        for(const kind of ['vision','audio'])if(!(effective.omniEnabled && kind==='audio') && effective[kind==='vision' ? 'videoEnabled' : 'audioEnabled'] && !mediaKey(effective[`${kind}Endpoint`]) && !['localhost','127.0.0.1','[::1]'].includes(new URL(effective[`${kind}Endpoint`]).hostname))throw new Error('请先填写音视频服务 API Key');
        activeMediaConfig=copy(effective);mediaAnchor=engine.config.anchorId;clearMedia();
        const started=media.start(activeMediaConfig);
        try {await Promise.all([persistKeys(),started]);}catch(error){media.stop();throw error;}
      },
      stopMedia:()=>media.stop(),clearMedia,
      forgetMediaKey:async(kind,endpoint)=>{const name=mediaSecretKey(endpoint);media.stop();await del(name);sessionKeys.delete(name);for(const input of panel.root.querySelectorAll('[data-media-key]'))input.value='';panel.toast('此服务的音视频密钥已清除；同域普通AI密钥需在服务连接中清除');},
      hasAIKey: (endpoint,omni=false) => Boolean(omni ? mediaKey(endpoint) : sessionKeys.get(secretKey(endpoint)) ?? get(secretKey(endpoint), '')),
      generatePhrases: async (c, key, remember, options,mediaCredentials) => {
        await keepKey(c, key, remember);await prepareMediaKeys(c,mediaCredentials)();
        return generatePhrases(client, c, {...options,sharedContext:engine.aiContext(c)});
      },
      testAI: async (c, key, remember,_searchCredentials,mediaCredentials) => {
        await keepKey(c, key, remember);await prepareMediaKeys(c,mediaCredentials)();
        const output = await client({ persona: c.ai.persona, knowledge: c.ai.knowledge, ...engine.aiContext(c),target: { name: '连接测试', text: '你好，请用一句话打招呼。' }, maxLength: c.sending.maxLength }, c.ai);
        log('ai', `连接测试通过：${output.slice(0, 300)}`); panel.toast('AI 连接测试通过。测试内容不会发送到公屏。');
      },
      testSearch: async (c,credentials) => {
        await keepSearchKey(c,credentials);
        const result=await searchClient('抖音直播', {...c.ai.search,enabled:true});
        panel.recordSearch({...result,question:'搜索连接测试'});panel.toast(`搜索连接通过，返回 ${result.results.length} 条来源。`);
      },
      forgetSearchKey:async endpoint=>{const name=searchSecretKey(endpoint);await del(name);sessionKeys.delete(name);panel.node('[data-search-key]').value='';panel.toast('搜索服务密钥已清除');},
      diagnose: () => ({...adapter.diagnose(),roomData:engine.roomData}),
      acknowledgeRuntimeAlert: async () => {
        acknowledgedRuntimeAlert = runtimeAlertState(network);
        network = {...network,acknowledgedRuntimeAlert};
        try { await persistRuntime(true); }
        catch (error) { reportPersistenceError(error,'采集提示确认状态保存失败'); }
        refresh();
      },
      recoverEvents: async () => {
        await drainIncome(); await journalCommitter?.flush(); await adapter.recoverEvents?.(); await adapter.checkStorage?.();
        acknowledgedRuntimeAlert = runtimeAlertState(network); network = {...network,acknowledgedRuntimeAlert};
        await persistRuntime(true); refresh();
      },
      clearCache: async () => { await adapter.clearCache?.(); await adapter.checkStorage?.(); refresh(); },
      exportEvents: async () => {
        // 后台失联时仍可导出内存里的待入账事实；不能让读取日志失败挡住自救。
        let collection;
        try { collection = adapter.exportEvents ? await adapter.exportEvents() : network; }
        catch (error) { collection = {error:error.message}; }
        download(`douyin-recovery-${room}.json`,JSON.stringify({room,savedAt:Date.now(),runtime:engine.snapshot(),incomePending:[...incomePending],collection},null,2));
      },
      importIncome: async data => {
        if (!engine.config.incomeEnabled) throw new Error('请先启用收入统计');
        if (data?.room !== room || !Array.isArray(data.incomePending) || data.incomePending.length > 2000) throw new Error('请选择当前直播间导出的礼物恢复数据');
        const records = data.incomePending.map(entry => entry?.[1]);
        if (records.some(item => item?.event?.type !== 'gift' || !(item.event.groupId || item.event.id) || typeof item.userKey !== 'string' || !Number.isFinite(item.capturedAt) || item.capturedAt <= 0 || !Number.isFinite(item.rate) || item.rate < 0 || item.rate > 10 || !Number.isFinite(item.event.count) || item.event.count < 1 || item.event.count > 1e9 || (item.event.unitValue != null && (!Number.isFinite(item.event.unitValue) || item.event.unitValue < 0 || item.event.unitValue > 1e9)))) throw new Error('礼物恢复记录无效');
        for (const item of records) await repository.record({room,event:item.event,userKey:item.userKey,rate:item.rate,capturedAt:item.capturedAt});
        for (const item of incomePending.values()) item.nextAt = Date.now();
        await drainIncome();
        await loadIncome({force:true});
        panel.toast(`已恢复 ${records.length} 组礼物，重复记录自动去重`);
      },
      exportConfig: () => download(`douyin-live-${room}.json`, JSON.stringify(engine.config, null, 2)),
      income: () => loadIncome({profiles:true}),
      refreshAnchor: () => adapter.anchorData?.refresh(),
      exportAnchor: data => download(`douyin-anchor-${data.anchorId}-${data.period}-${giftDate()}.json`, JSON.stringify(data, null, 2)),
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
    tools.ready = tools.start();
    if (demo) applyIdentity({ anchor:{ id:'1234567890', name:'模拟主播' }, self:{ id:'9876543210', name:'我的场控账号（模拟）' } });
    else void identityReader.refresh().catch(e => log('error', `自动识别暂不可用：${e.message}`));
    let lastDateCheck = 0, lastStorageCheck = 0, lastPKRefresh = 0, lastContributionCheck = 0, lastLiveCheck = Date.now(), contributionCheckBusy = false, incomeDay = giftDate(), waitingForConnection = false;
    const sampleContributions = async () => {
      if (closed || suspended || persistenceDisabled || !engine.config.incomeEnabled ||
        !(repository.recordContributionSnapshot || repository.recordContribution) || !adapter.readAudienceContributions || contributionCheckBusy ||
        !roomContext.current() || identity.live?.status && identity.live.status !== 'live') return;
      const session = giftLedger.currentSession();
      if (!session || session.endAt) return;
      contributionCheckBusy = true; lastContributionCheck = Date.now();
      try {
        const capturedAt = Date.now(), roomId = identity.live?.roomId || session.roomId || '';
        const rows = adapter.readAudienceContributions();
        // The restored audience cache retains identities beyond the 60-row UI.
        const known = [...(engine.audience?.users?.values() || [])].filter(user=>capturedAt-user.observedAt <= engine.audience.retention);
        known.push(...viewers.values());
        const snapshot = contributionSnapshot(rows,known);
        const normalized = snapshot.rows;
        let updated = false;
        if (repository.recordContributionSnapshot) {
          updated = await repository.recordContributionSnapshot({room,roomId,capturedAt,rate:engine.config.gift.yuanPerDiamond,rows:normalized});
        } else for (const row of snapshot.entries) {
          updated = await repository.recordContribution({room,roomId,capturedAt,rate:engine.config.gift.yuanPerDiamond,...row}) || updated;
        }
        panel?.updateContributionStatus({rows:rows.length,matched:normalized.filter(row=>row.userId).length,checkedAt:capturedAt});
        if (updated) refreshIncome();
      } catch (error) { reportPersistenceError(error,'在线贡献榜校准读取失败'); }
      finally {contributionCheckBusy=false;}
    };
    let stopContributionWatch = watchAudienceContributions(()=>void sampleContributions());
    const timer = setInterval(async () => {
      if (closed || suspended) return;
      tools.notify('tick');
      if (demo) { network.lastFrame = adapter.status.lastFrame = Date.now(); }
      if (!demo && identityReader.refreshRoom && roomContext.current() && Date.now() - lastLiveCheck >= 15000) {
        lastLiveCheck = Date.now();
        // Query failures and a disconnected socket are unknown state, never a broadcast end.
        void identityReader.refreshRoom().catch(() => {});
      }
      if (Date.now() - lastDateCheck >= 60000) { lastDateCheck = Date.now(); refresh(); const day = giftDate(); if (day !== incomeDay) { incomeDay = day; refreshIncome(); } }
      if (Date.now()-lastContributionCheck >= 5000) void sampleContributions();
      if (!roomContext.current()) { media.stop(); void tools.close(); log('error', '直播间地址已切换；场控保持当前状态，当前页不再处理新消息'); clearInterval(timer); stopContributionWatch(); adapter.stopDOM?.(); identityReader?.close(); pickCleanup?.(); return; }
      adapter.sync?.();
      if ((engine.pk.current()?.phase === 'active' || panel.activeTab === 'pk') && Date.now() - lastPKRefresh >= 1000) { lastPKRefresh = Date.now(); refresh(); }
      if (adapter.checkStorage && !persistenceDisabled && Date.now()-lastStorageCheck >= 15000) { lastStorageCheck = Date.now(); void adapter.checkStorage().catch(error=>reportPersistenceError(error,'存储用量检查失败')); }
      void tryAutoStart();
      if (persistenceDisabled) return;
      const waiting = engine.running && !demo && engine.config.mode !== 'preview' && !adapter.healthy();
      if (waiting !== waitingForConnection) { waitingForConnection = waiting; if (engine.running) log('system', waiting ? '直播数据重连中，暂缓发送；连接恢复后继续' : '直播数据连接已恢复，继续场控'); }
      const tickEpoch = engine.epoch;
      try { await engine.tick(demo || engine.config.mode === 'preview' || adapter.healthy()); }
      catch (e) { if (engine.epoch === tickEpoch) reportPersistenceError(e, '运行异常，场控保持运行'); }
    }, 250);
    panel.updateGifts([...giftActivity.values()].reverse());
    if (!engine.config.incomeEnabled) panel.updateGiftSummary(giftLedger.currentSession() || {}, engine.config.gift.yuanPerDiamond);
    void registerProfile().catch(error => reportPersistenceError(error, '主播资料保存失败'));
    window.addEventListener('pagehide', event => {
      media.stop();
      void (event.persisted ? tools.suspend() : tools.close());
      resumeAutoStart = event.persisted && autoStartArmed && !manualPause;
      const wasRunning = engine.running || engine.resumeRequested;
      suspended = true; closed = !event.persisted; stopContributionWatch();
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
      void tools.resume().then(() => { if (manualPause) tools.notify('stop', '本页已手动暂停'); });
      stopContributionWatch = watchAudienceContributions(()=>void sampleContributions());
      void sampleContributions();
      autoStartArmed = resumeAutoStart && !manualPause; autoStartNext = 0;
      journalCommitter?.resume();
      void drainIncome();
      adapter.sync?.();
      if (!demo) { try { adapter.observeDOM(); } catch (e) { log('error', e.message); } void identityReader.refresh().catch(e => log('error', e.message)); }
      refresh(); refreshGifts(); void loadIncome({profiles:true});
    });
    void drainIncome();
    options.onReady?.({ engine, panel, adapter, tools,media, stop: pause, rememberUser, refreshIncome, checkpoint:() => persistRuntime(true) });
  }
  if (document.body) void ready(); else document.addEventListener('DOMContentLoaded', ready, { once: true });
  return engine;
}
