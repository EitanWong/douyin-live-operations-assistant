import { validateEndpoint } from './ai.js';
import { GiftStore } from './gifts.js';

const storageReady = chrome.storage.local.setAccessLevel({ accessLevel:'TRUSTED_CONTEXTS' });
const giftStore = new GiftStore({
  get: async (key, fallback) => (await chrome.storage.local.get(key))[key] ?? fallback,
  set: async (key, value) => chrome.storage.local.set({ [key]: value }),
  all: async () => chrome.storage.local.get(null)
});
const isRoom = sender => /^https:\/\/live\.douyin\.com\/\d+(?:[/?#]|$)/.test(sender.tab?.url || '') && sender.frameId === 0;
const keyAllowed = key => typeof key === 'string' && /^live-assistant:(config:\d+|runtime:\d+|income-calibration:\d+|event:\d+:[a-z\d-]+|api-key:https?:\/\/[^\s/]+)$/.test(key);
const jsonLength = value => {
  try { const text = JSON.stringify(value); return typeof text === 'string' ? text.length : null; }
  catch { return null; }
};
const eventTypes = new Set(['gift','like','chat','enter','end','pk-start','pk-score','pk-end','pk-multiplier','pk-card','pk-contribution','pk-effect','room-state']);
const validEvent = (event, maxBytes) => {
  try {
    const size = jsonLength(event);
    return Boolean(event) && eventTypes.has(event.type) && size != null && size <= maxBytes &&
      (event.text == null || typeof event.text === 'string') &&
      (event.user?.name == null || typeof event.user.name === 'string') &&
      (event.user?.fanClubs == null || Array.isArray(event.user.fanClubs));
  } catch { return false; }
};
async function storageUsage() {
  const used = chrome.storage.local.getBytesInUse ? await chrome.storage.local.getBytesInUse(null) : null;
  // Chrome 111/112 have a smaller quota; honor the runtime's actual value.
  const quota = chrome.storage.local.QUOTA_BYTES || 5*1024*1024;
  return {used,quota,ratio:used == null ? null : used/quota};
}
chrome.runtime.onMessage.addListener((message,sender,reply) => {
  const extensionPage = sender.url?.startsWith(chrome.runtime.getURL('')) && !sender.tab;
  if (!isRoom(sender) && !extensionPage) { reply({ok:false,error:'请求来源无效'}); return; }
  void (async()=>{
    try {
      await storageReady;
      let value;
      if (message.type === 'init' && isRoom(sender)) value = Object.fromEntries(Object.entries(await chrome.storage.local.get(null)).filter(([key])=>keyAllowed(key) && !key.startsWith('live-assistant:event:')));
      else if (message.type === 'set' && keyAllowed(message.key) && isRoom(sender)) {
        // Pending delivery state must not be truncated or rejected at the config limit.
        // chrome.storage enforces its real quota; failures retain the event journal.
        const size = jsonLength(message.value);
        if (size == null) throw Object.assign(new Error('设置无法序列化'),{code:'INVALID_CONFIG'});
        if (!message.key.startsWith('live-assistant:runtime:') && size > 1024*1024) throw new Error('设置过大');
        await chrome.storage.local.set({[message.key]:message.value}); value=true;
      }
      else if (message.type === 'delete' && keyAllowed(message.key) && isRoom(sender)) { await chrome.storage.local.remove(message.key); value=true; }
      else if (message.type === 'event-append' && isRoom(sender)) {
        const room = sender.tab.url.match(/^https:\/\/live\.douyin\.com\/(\d+)/)[1], event = message.event;
        if (!validEvent(event, 12000)) throw Object.assign(new Error('直播事件无效'),{code:'INVALID_EVENT'});
        const id = typeof message.id === 'string' && /^[a-z\d-]{16,64}$/i.test(message.id) ? message.id : crypto.randomUUID();
        const key = `live-assistant:event:${room}:${id}`;
        value = await giftStore.transaction(async()=>{
          if ((await chrome.storage.local.get(key))[key]) return {key};
          const usage = await storageUsage();
          if (usage.ratio != null && usage.ratio >= .8) throw Object.assign(new Error('本地存储已达80%，已停止新增日志并预留恢复空间；请先处理积压或释放空间，再恢复采集'),{code:'STORAGE_PRESSURE'});
          const durableEvent = event.id ? event : {...event,id:`journal:${id}`};
          await chrome.storage.local.set({[key]:{event:durableEvent,savedAt:Date.now()}}); return {key};
        });
      }
      else if (message.type === 'event-list' && isRoom(sender)) {
        const room = sender.tab.url.match(/^https:\/\/live\.douyin\.com\/(\d+)/)[1], prefix = `live-assistant:event:${room}:`;
        value = Object.entries(await chrome.storage.local.get(null)).filter(([key])=>key.startsWith(prefix)).map(([key,record])=>({key,...record})).sort((a,b)=>a.savedAt-b.savedAt || a.key.localeCompare(b.key));
        const cursor = message.after;
        if (cursor) value = value.filter(record=>record.savedAt > cursor.savedAt || record.savedAt === cursor.savedAt && record.key.localeCompare(String(cursor.key)) > 0);
        value = value.slice(0,Math.min(256,Math.max(1,Number(message.limit) || 256)));
      }
      else if (message.type === 'storage-status' && isRoom(sender)) value = await storageUsage();
      else if (message.type === 'event-ack' && isRoom(sender) && typeof message.key === 'string') {
        const room = sender.tab.url.match(/^https:\/\/live\.douyin\.com\/(\d+)/)[1], prefix = `live-assistant:event:${room}:`;
        if (!message.key.startsWith(prefix) || !keyAllowed(message.key)) throw new Error('事件确认范围无效');
        await chrome.storage.local.remove(message.key); value=true;
      }
      else if (message.type === 'event-ack-many' && isRoom(sender) && Array.isArray(message.keys) && message.keys.length <= 100) {
        const room = sender.tab.url.match(/^https:\/\/live\.douyin\.com\/(\d+)/)[1], prefix = `live-assistant:event:${room}:`;
        if (message.keys.some(key => typeof key !== 'string' || !key.startsWith(prefix) || !keyAllowed(key))) throw new Error('事件确认范围无效');
        await chrome.storage.local.remove(message.keys); value=true;
      }
      else if (message.type === 'income-profiles' && isRoom(sender)) value = await giftStore.profiles();
      else if (message.type === 'income-profile' && isRoom(sender)) value = await giftStore.profile(message.profile);
      else if (message.type === 'income-report' && isRoom(sender)) value = await giftStore.report(String(message.room), message.month);
      else if (message.type === 'contribution-record' && isRoom(sender)) {
        const room = sender.tab.url.match(/^https:\/\/live\.douyin\.com\/(\d+)/)[1];
        const config = (await chrome.storage.local.get(`live-assistant:config:${room}`))[`live-assistant:config:${room}`];
        value = config?.incomeEnabled === false ? false : await giftStore.recordContribution({...message, room});
      }
      else if (message.type === 'gift-record' && isRoom(sender)) {
        const room = sender.tab.url.match(/^https:\/\/live\.douyin\.com\/(\d+)/)[1];
        const event = message.event;
        let valid = validEvent(event, 4000);
        try { valid = valid && (event.unitValue == null || (Number.isFinite(event.unitValue) && event.unitValue >= 0 && event.unitValue <= 1e9)); } catch { valid = false; }
        if (!valid) throw Object.assign(new Error('礼物记录无效'),{code:'INVALID_EVENT'});
        const config = (await chrome.storage.local.get(`live-assistant:config:${room}`))[`live-assistant:config:${room}`];
        if (config?.incomeEnabled === false || (config?.selfId && String(event.user?.id) === config.selfId)) value = false;
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
chrome.storage.onChanged.addListener(async(changes,area)=>{
  if (area !== 'local') return;
  const relevant = Object.fromEntries(Object.entries(changes).filter(([key]) => /^live-assistant:(config|income|income-calibration|profile):\d+$/.test(key)));
  if (!Object.keys(relevant).length) return;
  const tabs = await chrome.tabs.query({url:'https://live.douyin.com/*'});
  for (const tab of tabs) {
    const room = tab.url?.match(/^https:\/\/live\.douyin\.com\/(\d+)/)?.[1];
    const scoped = Object.fromEntries(Object.entries(relevant).filter(([key]) => /:config:/.test(key) && key.endsWith(`:${room}`)));
    if (Object.keys(scoped).length) void chrome.tabs.sendMessage(tab.id,{type:'storage',changes:scoped}).catch(()=>{});
    if (Object.keys(relevant).some(key => /:(income|income-calibration|profile):/.test(key))) void chrome.tabs.sendMessage(tab.id,{type:'income-updated'}).catch(()=>{});
  }
});
