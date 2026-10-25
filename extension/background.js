import { validateEndpoint } from './ai.js';
import { GiftStore } from './gifts.js';
import { DurableStorage, isDurableKey } from './durable-storage.js';
import { installCollectionKeeper } from './collection-keeper.js';

const collectionKeeper = installCollectionKeeper(chrome);

const durableStorage = new DurableStorage({ local:chrome.storage.local });
const storageReady = (async()=>{ await chrome.storage.local.setAccessLevel({ accessLevel:'TRUSTED_CONTEXTS' }); await durableStorage.migrate(); })();
void storageReady.catch(()=>{});
const durableKey = isDurableKey;
const readRecord = async key => durableKey(key) ? durableStorage.get(key) : (await chrome.storage.local.get(key))[key];
const readAll = async () => durableStorage.getAll(['live-assistant:config:','live-assistant:profile:']);
const writeRecord = async (key,value) => {
  if (!durableKey(key)) return writeStorage(key,value);
  await durableStorage.set(key,value);
  await notifyChanges({[key]:{newValue:value}});
};
const deleteRecord = async keys => {
  const list = Array.isArray(keys) ? keys : [keys], durable = list.filter(durableKey), local = list.filter(key=>!durableKey(key));
  if (durable.length) await durableStorage.remove(durable);
  if (local.length) await chrome.storage.local.remove(local);
};
const giftStore = new GiftStore({
  get: async (key, fallback) => await readRecord(key) ?? fallback,
  set: async (key, value) => writeRecord(key, value),
  all: readAll
});
const themeKey = 'douyin-live-assistant:theme';
const themeValues = new Set(['system','light','dark']);
const roomFromUrl = value => {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://live.douyin.com') return null;
    return url.pathname.match(/^\/(\d+)\/?$/)?.[1] || url.searchParams.get('room_id')?.match(/^\d+$/)?.[0] || null;
  } catch { return null; }
};
const isRoom = sender => sender.frameId === 0 && Boolean(roomFromUrl(sender.tab?.url));
const keyAllowed = key => typeof key === 'string' && /^live-assistant:(config:\d+|runtime:\d+|income-calibration:\d+|event:\d+:[a-z\d-]+|api-key:https?:\/\/[^\s/]+)$/.test(key);
const jsonLength = value => {
  try { const text = JSON.stringify(value); return typeof text === 'string' ? text.length : null; }
  catch { return null; }
};
const eventTypes = new Set(['gift','like','chat','enter','start','end','pk-start','pk-score','pk-end','pk-multiplier','pk-card','pk-contribution','pk-effect','anchor-pk-tasks','room-state','room-stats','room-audience','social','fansclub','emoji-chat','screen-chat','room-notice','room-rank','rank-update','room-notify','room-sync','audio-chat','highlight-comment','light-gift','live-shopping','product-change','room-banner','rank-award','red-packet','activity-signal','chat-like','fan-ticket','room-activity-state','gift-panel-state','room-indicator','gift-catalog','battle-bonus','battle-property','battle-season-honor','popular-card','fansclub-statistics','group-live-members','group-live-income','room-ticket','linkmic-positions','guest-link-state','fansclub-push','anchor-exhibition','pk-rank-season']);
const validEvent = (event, maxBytes) => {
  try {
    const size = jsonLength(event);
    return Boolean(event) && eventTypes.has(event.type) && size != null && size <= maxBytes &&
      (event.text == null || typeof event.text === 'string') &&
      (event.user?.name == null || typeof event.user.name === 'string') &&
      (event.user?.fanClubs == null || Array.isArray(event.user.fanClubs));
  } catch { return false; }
};
const validProtocolFrame = record => {
  try {
    const size = jsonLength(record);
    const rawValid = record?.captureError === 'FRAME_TOO_LARGE'
      ? record.rawBase64 == null && record.rawBytes > 512 * 1024
      : record?.rawBytes <= 512 * 1024 && typeof record.rawBase64 === 'string' && record.rawBase64.length === Math.ceil(record.rawBytes / 3) * 4;
    return Boolean(record) && record.protocolVersion === 1 && ['socket','http-poll'].includes(record.transport) &&
      Number.isFinite(record.receivedAt) && record.receivedAt > 0 && Number.isSafeInteger(record.rawBytes) && record.rawBytes >= 0 &&
      size != null && size <= 900000 && Array.isArray(record.messages) && record.messages.length <= 500 &&
      record.messages.every(item => item && typeof item.method === 'string' && /^[A-Za-z0-9_]{1,120}$/.test(item.method) &&
        (item.messageId == null || typeof item.messageId === 'string' && item.messageId.length <= 80) &&
        Array.isArray(item.decodedTypes) && item.decodedTypes.length <= 16 && item.decodedTypes.every(type => typeof type === 'string' && /^[a-z0-9-]{1,64}$/.test(type))) &&
      (record.messagesOmitted == null || Number.isSafeInteger(record.messagesOmitted) && record.messagesOmitted >= 0 && record.messagesOmitted <= 100000) &&
      rawValid && (record.rawBase64 == null || record.rawBase64.length <= 700000 && /^[A-Za-z0-9+/]*={0,2}$/.test(record.rawBase64)) &&
      (record.rawEncoding == null || record.rawEncoding === 'utf8-text') &&
      (record.parseError == null || typeof record.parseError === 'string' && record.parseError.length <= 240) &&
      (record.captureError == null || record.captureError === 'FRAME_TOO_LARGE');
  } catch { return false; }
};
async function storageUsage() {
  const used = chrome.storage.local.getBytesInUse ? await chrome.storage.local.getBytesInUse(null) : null;
  // Chrome 111/112 have a smaller quota; honor the runtime's actual value.
  const quota = chrome.storage.local.QUOTA_BYTES || 5*1024*1024;
  return {used,quota,ratio:used == null ? null : used/quota};
}
// Diagnostic history is disposable. Unacknowledged events, runtime checkpoints,
// settings and income data are never candidates, including from other rooms.
// Callers serialize maintenance with writes using the same transaction queue.
let lastPruned = null;
async function maintainStorage(reserveBytes = 0, force = false) {
  const before = await storageUsage();
  const candidates = Object.entries(await chrome.storage.local.get(null))
    .filter(([key]) => /^live-assistant:protocol:\d+:[a-z\d-]+$/i.test(key))
    .map(([key, record]) => ({key,savedAt:Number(record?.savedAt) || 0}))
    .sort((a,b) => a.savedAt - b.savedAt || a.key.localeCompare(b.key));
  const cutoff = Date.now() - 24*60*60*1000;
  if (!force && candidates.length <= 1000 && !candidates.some(item=>item.savedAt < cutoff) && (before.used == null || before.used + reserveBytes < before.quota * .8)) return {...before,pruned:lastPruned};
  const target = Math.max(0, before.quota * .65 - reserveBytes);
  let after = before, deleted = 0, remaining = candidates.length;
  for (let offset = 0; offset < candidates.length; offset += 50) {
    const keys = candidates.slice(offset, offset + 50)
      .filter(item=>item.savedAt < cutoff || after.used != null && after.used > target || remaining > 800)
      .map(item=>item.key);
    if (!keys.length) break;
    await chrome.storage.local.remove(keys);
    deleted += keys.length; remaining -= keys.length;
    after = await storageUsage();
  }
  if (deleted) lastPruned = {deleted,bytes:Math.max(0, (before.used || 0) - (after.used || 0)),at:Date.now()};
  return {...after,pruned:lastPruned};
}
async function storageStatus() {
  const cache = await maintainStorage(), durable = await durableStorage.usage();
  return {...cache,durable};
}
async function writeStorage(key, value) {
  await maintainStorage((key.length + (jsonLength(value) || 0)) * 3);
  try { await chrome.storage.local.set({[key]:value}); }
  catch (error) {
    if (!/quota|配额|QUOTA_BYTES/i.test(error.message)) throw error;
    await maintainStorage((key.length + (jsonLength(value) || 0)) * 3, true);
    await chrome.storage.local.set({[key]:value});
  }
}
chrome.runtime.onMessage.addListener((message,sender,reply) => {
  if (message?.type === 'exhibition-indicator') {
    void (async()=>{
      try {
        const url = new URL(sender.url), event = message.event;
        if (sender.frameId <= 0 || !sender.tab?.id || !roomFromUrl(sender.tab.url)
          || url.origin !== 'https://lf-normal-gr-sourcecdn.bytegecko.com'
          || url.pathname !== '/obj/byte-gurd-source-gr/webcast/mono/h5/live_pc_indicator_container_douyin/pages/index.html'
          || event?.type !== 'anchor-exhibition-retention' || event.source !== 'native-indicator'
          || event.anchorId !== (url.searchParams.get('anchor_id_str') || url.searchParams.get('anchor_id'))
          || event.roomId !== url.searchParams.get('room_id') || !Number.isSafeInteger(event.remaining) || event.remaining < 0 || event.remaining > 10000
          || typeof event.name !== 'string' || event.name.length > 20 || typeof event.text !== 'string' || event.text.length > 200) throw new Error('指标来源无效');
        const value = await chrome.tabs.sendMessage(sender.tab.id,{type:'exhibition-indicator',frameURL:url.href,event:{
          type:event.type,source:event.source,anchorId:event.anchorId,roomId:event.roomId,name:event.name,text:event.text,remaining:event.remaining,
          id:`retention:frame:${sender.frameId}:${Date.now()}`,receivedAt:Date.now()}},{frameId:0});
        reply({ok:value?.ok === true});
      } catch { reply({ok:false}); }
    })();
    return true;
  }
  const extensionPage = sender.url?.startsWith(chrome.runtime.getURL('')) && !sender.tab;
  if (!isRoom(sender) && !extensionPage) { reply({ok:false,error:'请求来源无效'}); return; }
  void (async()=>{
    try {
      await storageReady;
      let value;
      if (message.type === 'init' && isRoom(sender)) value = Object.fromEntries(Object.entries(await durableStorage.getAll(['live-assistant:config:','live-assistant:runtime:','live-assistant:income-calibration:','live-assistant:api-key:'])).filter(([key])=>keyAllowed(key) && !key.startsWith('live-assistant:event:')));
      else if (message.type === 'collection-state' && isRoom(sender)) value = await collectionKeeper.update(sender,message.active);
      else if (message.type === 'theme-get' && (isRoom(sender) || extensionPage)) value = await readRecord(themeKey) ?? 'system';
      else if (message.type === 'theme-set' && (isRoom(sender) || extensionPage) && themeValues.has(message.value)) {
        await giftStore.transaction(() => writeRecord(themeKey,message.value)); value=true;
      }
      else if (message.type === 'set' && keyAllowed(message.key) && isRoom(sender)) {
        // Pending delivery state must not be truncated or rejected at the config limit.
        // Database failures retain the event journal for recovery.
        const size = jsonLength(message.value);
        if (size == null) throw Object.assign(new Error('设置无法序列化'),{code:'INVALID_CONFIG'});
        if (!message.key.startsWith('live-assistant:runtime:') && size > 1024*1024) throw new Error('设置过大');
        await giftStore.transaction(() => writeRecord(message.key,message.value)); value=true;
      }
      else if (message.type === 'delete' && keyAllowed(message.key) && isRoom(sender)) { await deleteRecord(message.key); value=true; }
      else if (message.type === 'event-append' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url), event = message.event;
        if (!validEvent(event, 12000)) throw Object.assign(new Error('直播事件无效'),{code:'INVALID_EVENT'});
        const id = typeof message.id === 'string' && /^[a-z\d-]{16,64}$/i.test(message.id) ? message.id : crypto.randomUUID();
        const key = `live-assistant:event:${room}:${id}`;
        value = await giftStore.transaction(async()=>{
          if (await readRecord(key)) return {key};
          const durableEvent = event.id ? event : {...event,id:`journal:${id}`};
          await writeRecord(key,{event:durableEvent,savedAt:Date.now()}); return {key};
        });
      }
      else if (message.type === 'protocol-append' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url), record = message.record;
        if (!validProtocolFrame(record)) throw Object.assign(new Error('协议帧记录无效或超过单条上限'),{code:'INVALID_PROTOCOL_FRAME'});
        const id = typeof message.id === 'string' && /^[a-z\d-]{16,64}$/i.test(message.id) ? message.id : crypto.randomUUID();
        const key = `live-assistant:protocol:${room}:${id}`;
        value = await giftStore.transaction(async()=>{
          if ((await chrome.storage.local.get(key))[key]) return {key};
          const usage = await maintainStorage((key.length + jsonLength(record)) * 3);
          if (usage.ratio != null && usage.ratio >= .8) throw Object.assign(new Error('本地存储已达80%，已停止新增协议帧；请先导出恢复数据并释放空间'),{code:'STORAGE_PRESSURE'});
          await writeStorage(key,{record,savedAt:Date.now()}); return {key};
        });
      }
      else if (message.type === 'protocol-list' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url), prefix = `live-assistant:protocol:${room}:`;
        value = Object.entries(await chrome.storage.local.get(null)).filter(([key])=>key.startsWith(prefix)).map(([key,entry])=>({key,...entry})).sort((a,b)=>a.savedAt-b.savedAt || a.key.localeCompare(b.key));
        const cursor = message.after;
        if (cursor) value = value.filter(entry=>entry.savedAt > cursor.savedAt || entry.savedAt === cursor.savedAt && entry.key.localeCompare(String(cursor.key)) > 0);
        value = value.slice(0,Math.min(100,Math.max(1,Number(message.limit) || 100)));
      }
      else if (message.type === 'event-list' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url), prefix = `live-assistant:event:${room}:`;
        value = await durableStorage.listEvents(room,message.after,Math.min(256,Math.max(1,Number(message.limit) || 256)));
      }
      else if (message.type === 'storage-status' && isRoom(sender)) value = await giftStore.transaction(storageStatus);
      else if (message.type === 'storage-clear-cache' && isRoom(sender)) value = await giftStore.transaction(async()=>{
        const keys = Object.keys(await chrome.storage.local.get(null)).filter(key=>/^live-assistant:protocol:\d+:[a-z\d-]+$/i.test(key));
        if (keys.length) await chrome.storage.local.remove(keys);
        return storageStatus();
      });
      else if (message.type === 'event-ack' && isRoom(sender) && typeof message.key === 'string') {
        const room = roomFromUrl(sender.tab.url), prefix = `live-assistant:event:${room}:`;
        if (!message.key.startsWith(prefix) || !keyAllowed(message.key)) throw new Error('事件确认范围无效');
        await deleteRecord(message.key); value=true;
      }
      else if (message.type === 'event-ack-many' && isRoom(sender) && Array.isArray(message.keys) && message.keys.length <= 100) {
        const room = roomFromUrl(sender.tab.url), prefix = `live-assistant:event:${room}:`;
        if (message.keys.some(key => typeof key !== 'string' || !key.startsWith(prefix) || !keyAllowed(key))) throw new Error('事件确认范围无效');
        await deleteRecord(message.keys); value=true;
      }
      else if (message.type === 'income-profiles' && isRoom(sender)) value = await giftStore.profiles();
      else if (message.type === 'income-profile' && isRoom(sender)) value = await giftStore.profile(message.profile);
      else if (message.type === 'income-report' && isRoom(sender)) value = await giftStore.report(String(message.room), message.month, {includeAllSessions:message.includeAllSessions === true});
      else if (message.type === 'income-session' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url);
        value = await giftStore.recordSession({...message, room, type:message.boundaryType});
      }
      else if (message.type === 'contribution-snapshot' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url), config = await readRecord(`live-assistant:config:${room}`);
        value = config?.incomeEnabled === false ? false : await giftStore.recordContributionSnapshot({...message,room});
      }
      else if (message.type === 'contribution-record' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url);
        const config = await readRecord(`live-assistant:config:${room}`);
        value = config?.incomeEnabled === false ? false : await giftStore.recordContribution({...message, room});
      }
      else if (message.type === 'gift-record' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url);
        const event = message.event;
        let valid = validEvent(event, 4000);
        try { valid = valid && (event.unitValue == null || (Number.isFinite(event.unitValue) && event.unitValue >= 0 && event.unitValue <= 1e9)); } catch { valid = false; }
        if (!valid) throw Object.assign(new Error('礼物记录无效'),{code:'INVALID_EVENT'});
        const config = await readRecord(`live-assistant:config:${room}`);
        if (config?.incomeEnabled === false) value = false;
        else value = await giftStore.record({ room, event, userKey: message.userKey, rate: message.rate, capturedAt:message.capturedAt });
      }
      else if (message.type === 'ai' && isRoom(sender)) {
        const url = validateEndpoint(message.url);
        if (!await chrome.permissions.contains({origins:[`${new URL(url).protocol}//${new URL(url).hostname}/*`]})) throw new Error('请点击扩展图标，授权当前 AI 服务域名后重试');
        if (typeof message.data !== 'string' || message.data.length > 100000) throw new Error('AI请求过大');
        const body = JSON.parse(message.data); if (!Array.isArray(body.messages) || typeof body.model !== 'string') throw new Error('AI请求无效');
        const controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),25000);
        try {
          const response = await fetch(url,{method:'POST',credentials:'omit',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json',...(typeof message.headers?.Authorization === 'string' ? {Authorization:message.headers.Authorization} : {})},body:message.data});
          const text = await response.text();
          value={status:response.status,responseText:text.slice(0,200000),finalUrl:response.url};
        } finally { clearTimeout(timeout); }
      } else throw new Error('不支持的请求');
      reply({ok:true,value});
    } catch (error) { reply({ok:false,error:error.name === 'AbortError' ? 'AI请求超时' : error.message,code:error.code || (/quota|配额|QUOTA_BYTES/i.test(error.message) ? 'STORAGE_QUOTA' : 'TRANSIENT')}); }
  })();
  return true;
});
async function notifyChanges(changes) {
  const relevant = Object.fromEntries(Object.entries(changes).filter(([key]) => /^(live-assistant:(config|income|income-calibration|profile):\d+|douyin-live-assistant:theme)$/.test(key)));
  if (!Object.keys(relevant).length) return;
  // Delivery of change notifications must never turn a committed write into a failure.
  try {
    const tabs = await chrome.tabs.query({url:'https://live.douyin.com/*'});
    for (const tab of tabs) {
      const room = roomFromUrl(tab.url);
      const scoped = Object.fromEntries(Object.entries(relevant).filter(([key]) => /:config:/.test(key) && key.endsWith(`:${room}`)));
      if (Object.keys(scoped).length) void chrome.tabs.sendMessage(tab.id,{type:'storage',changes:scoped}).catch(()=>{});
      if (Object.keys(relevant).some(key => /:(income|income-calibration|profile):/.test(key))) void chrome.tabs.sendMessage(tab.id,{type:'income-updated'}).catch(()=>{});
      if (relevant[themeKey]) void chrome.tabs.sendMessage(tab.id,{type:'theme-changed',value:relevant[themeKey].newValue}).catch(()=>{});
    }
    if (changes[themeKey]) void chrome.runtime.sendMessage({type:'theme-changed',value:changes[themeKey].newValue}).catch(()=>{});
  } catch {}
}
chrome.storage.onChanged.addListener(async(changes,area)=>{
  if (area === 'local') await notifyChanges(changes);
});
