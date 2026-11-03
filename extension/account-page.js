import {accountSource,normalizeAccountPayload} from '../src/ai/account-context.js';
// Observe only responses the native page already requests; no signer or cookies leave the page.
const key='__liveAssistantPublicAccountV1';
let source;try{source=accountSource(location.href);}catch{}
if(source && !window[key]){
 const rows=new Map();
 const ingest=payload=>{for(const r of normalizeAccountPayload(payload,source))rows.set(`${r.kind}:${r.id}`,r);while(rows.size>30)rows.delete(rows.keys().next().value);};
 const accepted=value=>{try{const u=new URL(value,location.href);return u.origin===location.origin && /^\/aweme\/v1\/web\/(user\/profile\/other|aweme\/(post|detail))\/$/u.test(u.pathname);}catch{return false;}};
 const snapshot=()=>{
  if(location.href.split('?')[0].replace(/\/$/u,'')!==source.url)return [];
  for(const v of [window._ROUTER_DATA,window.__INITIAL_STATE__])try{ingest(v);}catch{}
  for(const s of document.querySelectorAll('script#RENDER_DATA,script#__NEXT_DATA__,script[type="application/json"]')){
   const raw=s.textContent;if(raw.length>1000000)continue;try{ingest(JSON.parse(raw));}catch{try{ingest(JSON.parse(decodeURIComponent(raw)));}catch{}}
  }
  return [...rows.values()];
 };
 Object.defineProperty(window,key,{value:{snapshot},configurable:false});
 const original=window.fetch;
 window.fetch=function(...args){const result=original.apply(this,args);if(accepted(args[0]?.url || args[0]))void result.then(async r=>{
  const reader=r.clone().body?.getReader();if(!reader)return;const chunks=[];let bytes=0;
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>1000000){await reader.cancel();return;}chunks.push(part.value);}
   const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}ingest(JSON.parse(new TextDecoder().decode(buffer)));
  }catch{}finally{reader.releaseLock();}
 }).catch(()=>{});return result;};
 const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send,urls=new WeakMap();
 XMLHttpRequest.prototype.open=function(method,url,...rest){urls.set(this,url);return open.call(this,method,url,...rest);};
 XMLHttpRequest.prototype.send=function(...args){if(accepted(urls.get(this)))this.addEventListener('load',()=>{try{if(this.responseType==='json')ingest(this.response);else if(this.responseText.length<=1000000)ingest(JSON.parse(this.responseText));}catch{}},{once:true});return send.apply(this,args);};
}
