import {validateRealtimeEndpoint,validateSDP} from '../src/services/ai-pipeline.js';
import { roomFromURL } from '../src/browser/room-context.js';
import { accessPage } from './page-access.js';
import { ProtocolCache } from './protocol-cache.js';
import { fanclubFrameContext, cleanFanclubSnapshot } from '../src/data/fanclub.js';
import { validateEndpoint } from '../src/services/ai.js';
import { validateSearchEndpoint, validateSearchBody } from '../src/services/search.js';
import {validateMediaRequest,MEDIA_REQUEST_LIMIT} from '../src/services/media.js';
import { GiftStore } from '../src/data/gifts.js';
import { DurableStorage, isDurableKey } from './durable-storage.js';
import { installCollectionKeeper } from './collection-keeper.js';
import {parseGiveawayState} from '../src/core/giveaway.js';

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
    return roomFromURL(url);
  } catch { return null; }
};
const isRoom = sender => sender.frameId === 0 && Boolean(roomFromUrl(sender.tab?.url)) && (!sender.url || roomFromUrl(sender.url) === roomFromUrl(sender.tab.url));
const keyAllowed = key => typeof key === 'string' && /^live-assistant:(config:\d+|runtime:\d+|income-calibration:\d+|event:\d+:[a-z\d-]+|(?:api-key|search-key|media-key):https?:\/\/[^\s/]+)$/.test(key);
const jsonLength = value => {
  try { const text = JSON.stringify(value); return typeof text === 'string' ? text.length : null; }
  catch { return null; }
};
const eventTypes = new Set(['anchor-fanclub','room-likes','gift','like','chat','enter','start','end','pk-start','pk-score','pk-end','pk-multiplier','pk-card','pk-contribution','pk-effect','anchor-pk-tasks','room-state','room-stats','room-audience','social','fansclub','emoji-chat','screen-chat','room-notice','room-rank','rank-update','room-notify','room-sync','audio-chat','highlight-comment','light-gift','live-shopping','product-change','room-banner','rank-award','red-packet','activity-signal','chat-like','fan-ticket','room-activity-state','gift-panel-state','room-indicator','gift-catalog','battle-bonus','battle-property','battle-season-honor','popular-card','fansclub-statistics','group-live-members','group-live-income','room-ticket','linkmic-positions','guest-link-state','fansclub-push','anchor-exhibition','pk-rank-season']);
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
// ProtocolCache owns diagnostic writes and maintenance independently of the ledger.
const protocolCache = new ProtocolCache({local:chrome.storage.local,usage:storageUsage});
const maintainStorage = (reserveBytes=0,force=false) => protocolCache.maintain(reserveBytes,force);
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
  if (message?.type === 'fanclub-frame') {
    void (async()=>{
      try {
        const context=fanclubFrameContext(sender.url),input=message.event;
        if (!context || sender.frameId<=0 || !sender.tab?.id || !roomFromUrl(sender.tab.url)
          || input?.type!=='anchor-fanclub' || input.source!=='native-fanclub'
          || input.anchorId!==context.anchorId || input.roomId!==context.roomId
          || !Array.isArray(input.members) || input.members.length>10) throw new Error('粉丝团来源无效');
        const event=cleanFanclubSnapshot({...input,viewer:context.viewer,clubId:context.clubId});
        if (!event || event.receivedAt>Date.now()+1000 || !validEvent(event,12000)) throw new Error('粉丝团数据无效');
        event.id=`fansclub:frame:${sender.frameId}:${event.snapshotId}:${event.chunk}`;
        const result=await chrome.tabs.sendMessage(sender.tab.id,{type:'fanclub-frame',frameURL:sender.url,event},{frameId:0});
        reply({ok:result?.ok===true});
      } catch {reply({ok:false});}
    })();
    return true;
  }
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
      if (message.type === 'page-command' && isRoom(sender)) value = await accessPage(chrome,sender,message.command);
      else if (message.type === 'init' && isRoom(sender)) value = Object.fromEntries(Object.entries(await durableStorage.getAll(['live-assistant:config:','live-assistant:runtime:','live-assistant:income-calibration:','live-assistant:api-key:','live-assistant:search-key:','live-assistant:media-key:'])).filter(([key])=>keyAllowed(key) && !key.startsWith('live-assistant:event:')));
      else if (['rewards-read','rewards-write'].includes(message.type) && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url);
        if (typeof message.key !== 'string' || !new RegExp(`^live-assistant:rewards:${room}:[1-9]\\d{0,24}$`).test(message.key)) throw new Error('活动记录范围无效');
        if (message.type === 'rewards-read') value = await durableStorage.get(message.key) || [];
        else {
          if (!Array.isArray(message.records) || message.records.length > 100 || jsonLength(message.records) > 50000) throw new Error('活动记录无效');
          await durableStorage.set(message.key,message.records);value=true;
        }
      }
      else if (['giveaway-read','giveaway-write'].includes(message.type) && isRoom(sender)) {
        const room=roomFromUrl(sender.tab.url),key=`live-assistant:giveaway:${room}`;
        if(message.key!==key)throw new Error('抽奖记录范围无效');
        if(message.type==='giveaway-read')value=await durableStorage.get(key) ?? null;
        else {
          const size=jsonLength(message.value);if(size==null || size>16*1024*1024)throw new Error('抽奖记录过大，请先导出历史记录');
          const state=parseGiveawayState(message.value,room);await durableStorage.set(key,state);value=true;
        }
      }
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
        value = await protocolCache.append(key,record);
      }
      else if (message.type === 'protocol-list' && isRoom(sender)) {
        value = await protocolCache.list(roomFromUrl(sender.tab.url),message.after,Math.min(100,Math.max(1,Number(message.limit)||100)));
      }
      else if (message.type === 'event-list' && isRoom(sender)) {
        const room = roomFromUrl(sender.tab.url), prefix = `live-assistant:event:${room}:`;
        value = await durableStorage.listEvents(room,message.after,Math.min(256,Math.max(1,Number(message.limit) || 256)));
      }
      else if (message.type === 'storage-status' && isRoom(sender)) value = await storageStatus();
      else if (message.type === 'storage-clear-cache' && isRoom(sender)) value = await (async()=>{ await protocolCache.clear();return storageStatus(); })();
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
      else if(message.type==='media-sdp' && isRoom(sender)){
        const url=validateRealtimeEndpoint(message.url);validateSDP(message.data);
        if(typeof message.headers?.Authorization!=='string' || !/^Bearer [^\s]{1,1000}$/u.test(message.headers.Authorization))throw new Error('百炼实时认证无效');
        if(!await chrome.permissions.contains({origins:[`${new URL(url).origin}/*`]}))throw new Error('请点击扩展图标，授权音视频服务域名后重试');
        const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);
        try{
          const response=await fetch(url,{method:'POST',credentials:'omit',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/sdp',Authorization:message.headers.Authorization},body:message.data});
          const text=await response.text();if(response.status>=200 && response.status<300)validateSDP(text);
          value={status:response.status,responseText:response.status>=200 && response.status<300 ? text : '',finalUrl:response.url};
        }finally{clearTimeout(timeout);}
      }
      else if (['ai','search','media'].includes(message.type) && isRoom(sender)) {
        const searching=message.type==='search';
        const provider=message.provider || (String(message.url).endsWith('/web-search') ? 'bocha' : 'tavily');
        const url = searching ? validateSearchEndpoint(message.url,provider) : validateEndpoint(message.url);
        if (!await chrome.permissions.contains({origins:[`${new URL(url).protocol}//${new URL(url).hostname}/*`]})) throw new Error(`请点击扩展图标，授权当前${searching ? '搜索' : ' AI '}服务域名后重试`);
        if (typeof message.data !== 'string' || message.data.length > (message.type==='media' ? MEDIA_REQUEST_LIMIT : 100000)) throw new Error('AI请求过大');
        const form=searching && provider==='searxng';
        const body = form ? Object.fromEntries(new URLSearchParams(message.data)) : JSON.parse(message.data);
        if(searching)validateSearchBody(body,provider);else if(message.type==='media')validateMediaRequest(body);else if (!Array.isArray(body.messages) || typeof body.model !== 'string') throw new Error('AI请求无效');
        const controller = new AbortController(), timeout = setTimeout(()=>controller.abort(),searching ? 8000 : 25000);
        try {
          const response = await fetch(url,{method:'POST',credentials:'omit',redirect:'error',signal:controller.signal,headers:{'Content-Type':form ? 'application/x-www-form-urlencoded' : 'application/json',...(typeof message.headers?.Authorization === 'string' ? {Authorization:message.headers.Authorization} : {})},body:message.data});
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
