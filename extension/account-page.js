import {accountSource,normalizeAccountPayload,mergeAccountRecord,ACCOUNT_SAMPLE_LIMIT} from '../src/ai/account-context.js';
import {parsePublicMediaSource,PUBLIC_MEDIA_SOURCE_TTL} from '../src/services/public-media-source.js';
// Observe only responses the native page already requests; no signer or cookies leave the page.
const key='__liveAssistantPublicAccountV1';
let source;try{source=accountSource(location.href);}catch{}
if(source && !window[key]){
 const rows=new Map(),pending=[],mediaSources=new Set(),downloadSources=new Map();
 const mediaURLs=payload=>{
  const work=rows.get(`work:${source.id}`);if(!work)return;
  const stack=[payload];let visited=0;
  while(stack.length && visited++<1000){const row=stack.pop();if(!row || typeof row!=='object' || row.secret || row.status?.is_private || row.status?.is_delete)continue;
   if(row.aweme_id===source.id && row.author?.sec_uid===work.subject){
    for(const address of [row.video?.play_addr,row.video?.play_addr_h264,row.video?.play_addr_265,...(Array.isArray(row.video?.bit_rate) ? row.video.bit_rate : []).slice(0,8).map(r=>r?.play_addr)])for(const value of (Array.isArray(address?.url_list) ? address.url_list : []).slice(0,4))if(typeof value==='string' && value.length<=2000 && value.startsWith('https://') && (mediaSources.has(value) || mediaSources.size<32)){
     mediaSources.add(value);const at=Date.now();
     const candidate=parsePublicMediaSource({workId:source.id,author:work.subject,authorUid:work.actor?.uid ?? null,url:value,durationMs:row.video?.duration,observedAt:at,expiresAt:at+PUBLIC_MEDIA_SOURCE_TTL});
     if(!candidate)continue;
     const previous=downloadSources.get(value);
     downloadSources.set(value,downloadSources.has(value) && (!previous || previous.authorUid!==candidate.authorUid || previous.author!==candidate.author || previous.durationMs!==candidate.durationMs) ? null : candidate);
    }
   }
   for(const child of Object.values(row).slice(0,100))if(child && typeof child==='object' && stack.length<1000)stack.push(child);
  }
 };
 const add=records=>{for(const r of records){const key=`${r.kind}:${r.id}`;rows.set(key,mergeAccountRecord(rows.get(key),r));}while(rows.size>ACCOUNT_SAMPLE_LIMIT)rows.delete(rows.keys().next().value);};
 const ingest=(payload,requestURL)=>{
  const at=Date.now();add(normalizeAccountPayload(payload,source,at));
  const work=rows.get(`work:${source.id}`);mediaURLs(payload);
  if(work){
   add(normalizeAccountPayload(payload,source,at,{work}));
   for(const row of pending.splice(0))add(normalizeAccountPayload(row.payload,source,row.at,{work}));
  }else if(requestURL && source.kind==='work'){pending.push({payload,at});while(pending.length>4)pending.shift();}
 };
 const accepted=value=>{try{
  const u=new URL(value,location.href);
  if(!['https://www.douyin.com','https://www-hj.douyin.com'].includes(u.origin) || u.username || u.password || !/^\/aweme\/v1\/web\/(user\/profile\/other|aweme\/(post|detail)|comment\/list(?:\/reply)?|danmaku\/get(?:_v2)?)\/$/u.test(u.pathname))return false;
  const workId=u.searchParams.get('aweme_id') || u.searchParams.get('item_id');
  return !workId || source.kind==='work' && workId===source.id;
 }catch{return false;}};
 const snapshot=()=>{
  if(location.href.split('?')[0].replace(/\/$/u,'')!==source.url)return [];
  for(const v of [window._ROUTER_DATA,window.__INITIAL_STATE__])try{ingest(v);}catch{}
  for(const s of document.querySelectorAll('script#RENDER_DATA,script#__NEXT_DATA__,script[type="application/json"]')){
   const raw=s.textContent;if(raw.length>1000000)continue;try{ingest(JSON.parse(raw));}catch{try{ingest(JSON.parse(decodeURIComponent(raw)));}catch{}}
  }
  return [...rows.values()];
 };
 const mediaMatches=value=>location.href.split('?')[0].replace(/\/$/u,'')===source.url && mediaSources.has(value);
 const mediaSource=value=>mediaMatches(value) ? parsePublicMediaSource(downloadSources.get(value),{workId:source.id,author:rows.get(`work:${source.id}`)?.subject}) : null;
 Object.defineProperty(window,key,{value:{snapshot,mediaMatches,mediaSource},configurable:false});
 const original=window.fetch;
 window.fetch=function(...args){const result=original.apply(this,args);if(accepted(args[0]?.url || args[0]))void result.then(async r=>{
  const reader=r.clone().body?.getReader();if(!reader)return;const chunks=[];let bytes=0;
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>1000000){await reader.cancel();return;}chunks.push(part.value);}
   const buffer=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}ingest(JSON.parse(new TextDecoder().decode(buffer)),args[0]?.url || args[0]);
  }catch{}finally{reader.releaseLock();}
 }).catch(()=>{});return result;};
 const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send,urls=new WeakMap();
 XMLHttpRequest.prototype.open=function(method,url,...rest){urls.set(this,url);return open.call(this,method,url,...rest);};
 XMLHttpRequest.prototype.send=function(...args){if(accepted(urls.get(this)))this.addEventListener('load',()=>{try{if(this.responseType==='json')ingest(this.response,urls.get(this));else if(this.responseText.length<=1000000)ingest(JSON.parse(this.responseText),urls.get(this));}catch{}},{once:true});return send.apply(this,args);};
}
