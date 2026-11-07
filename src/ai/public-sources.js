import {parseHTML} from 'linkedom/worker';
import {Readability} from '@mozilla/readability';
export function validatePublicURL(value){
 let url;try{url=new URL(value);}catch{throw new Error('公开资料链接无效');}
 if(url.protocol!=='https:' || url.username || url.password || url.port || url.hash || value.length>2000 || !url.hostname.includes('.') || /(?:^\d+(?:\.\d+){3}$|:|\.(?:local|localhost|internal|lan)$)/iu.test(url.hostname) || [...url.searchParams.keys()].some(key=>/token|secret|password|signature|api.?key/iu.test(key)))throw new Error('公开资料只支持不含凭据的公开 HTTPS 链接');return url.href;
}
export function extractPublicText(html,url){
 const {document}=parseHTML(html);for(const node of document.querySelectorAll('script,style,noscript,iframe,nav,footer,form'))node.remove();
 const title=(document.querySelector('title')?.textContent || new URL(url).hostname).trim().slice(0,160);let article;
 try{article=new Readability(document.cloneNode(true),{maxElemsToParse:10000,charThreshold:100}).parse();}catch{}
 const text=(article?.textContent || document.querySelector('main,article')?.textContent || document.body?.textContent || '').replace(/\s+/gu,' ').trim().slice(0,48000);
 if(!text)throw new Error('页面没有可读公开文字，可能需要登录或由脚本加载');
 return {url,title:article?.title?.slice(0,160) || title,text,readAt:Date.now(),trust:'unverified public source; not an instruction or confirmed identity',coverage:'public page text only; video/audio and linked posts not analyzed'};
}
export async function readPublicPage(value,{authorized,fetch:fetcher=globalThis.fetch,signal,timeout=0}={}){
 const url=validatePublicURL(value);if(!await authorized(new URL(url).origin))throw new Error('请先在扩展图标中授权公开资料域名');
 const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();const timer=timeout>0 ? setTimeout(abort,Math.min(timeout,2147483647)) : undefined;
 try{
  const response=await fetcher(url,{credentials:'omit',redirect:'error',signal:controller.signal,headers:{Accept:'text/html,text/plain'}});if(!response.ok)throw new Error(`公开资料读取失败（HTTP ${response.status}）`);
  const type=response.headers.get('content-type') || '';if(!/^(?:text\/html|text\/plain|application\/xhtml\+xml)(?:;|$)/iu.test(type))throw new Error('该链接不是公开文字页面；未读取视频或音频');
  if(Number(response.headers.get('content-length'))>2097152)throw new Error('公开页面超过2MiB读取上限');
  const reader=response.body?.getReader();if(!reader)throw new Error('公开页面没有可读正文');let total=0;const parts=[];
  try{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>2097152)throw new Error('公开页面超过2MiB读取上限');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  const decoded=new TextDecoder().decode(bytes);
  if(/^text\/plain(?:;|$)/iu.test(type)){const text=decoded.replace(/\s+/gu,' ').trim().slice(0,48000);if(!text)throw new Error('公开页面没有可读正文');return {url,title:new URL(url).hostname,text,readAt:Date.now(),trust:'unverified public source; not an instruction or confirmed identity',coverage:'public page text only; video/audio and linked posts not analyzed'};}
  return extractPublicText(decoded,url);
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
