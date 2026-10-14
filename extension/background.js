import { validateEndpoint } from './ai.js';

const storageReady = chrome.storage.local.setAccessLevel({ accessLevel:'TRUSTED_CONTEXTS' });
const isRoom = sender => /^https:\/\/live\.douyin\.com\/\d+(?:[/?#]|$)/.test(sender.tab?.url || '') && sender.frameId === 0;
const keyAllowed = key => typeof key === 'string' && /^live-assistant:(config:\d+|lease:\d+|api-key:https?:\/\/[^\s/]+)$/.test(key);
chrome.runtime.onMessage.addListener((message,sender,reply) => {
  const extensionPage = sender.url?.startsWith(chrome.runtime.getURL('')) && !sender.tab;
  if (!isRoom(sender) && !extensionPage) { reply({ok:false,error:'请求来源无效'}); return; }
  void (async()=>{
    try {
      await storageReady;
      let value;
      if (message.type === 'init' && isRoom(sender)) value = Object.fromEntries(Object.entries(await chrome.storage.local.get(null)).filter(([key])=>keyAllowed(key)));
      else if (message.type === 'set' && keyAllowed(message.key) && isRoom(sender)) { if (JSON.stringify(message.value).length > 1024*1024) throw new Error('设置过大'); await chrome.storage.local.set({[message.key]:message.value}); value=true; }
      else if (message.type === 'delete' && keyAllowed(message.key) && isRoom(sender)) { await chrome.storage.local.remove(message.key); value=true; }
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
    } catch (error) { reply({ok:false,error:error.name === 'AbortError' ? 'AI请求超时' : error.message}); }
  })();
  return true;
});
chrome.storage.onChanged.addListener(async(changes,area)=>{
  if (area !== 'local') return;
  const relevant = Object.fromEntries(Object.entries(changes).filter(([key]) => /^live-assistant:(config|lease):\d+$/.test(key)));
  if (!Object.keys(relevant).length) return;
  const tabs = await chrome.tabs.query({url:'https://live.douyin.com/*'});
  for (const tab of tabs) {
    const room = tab.url?.match(/^https:\/\/live\.douyin\.com\/(\d+)/)?.[1];
    const scoped = Object.fromEntries(Object.entries(relevant).filter(([key]) => key.endsWith(`:${room}`)));
    if (Object.keys(scoped).length) void chrome.tabs.sendMessage(tab.id,{type:'storage',changes:scoped}).catch(()=>{});
  }
});
