import {accountSource} from '../src/ai/account-context.js';

export async function collectAccount(chrome,url,{signal,timeout=12000}={}){
 const source=accountSource(url);let tab;
 if(!await chrome.permissions.contains({origins:['https://www.douyin.com/*']}))throw new Error('请在扩展权限中允许访问 www.douyin.com 后采集');
 try{
  tab=await chrome.tabs.create({url:source.url,active:false});const deadline=Date.now()+timeout;let best=[];
  while(Date.now()<deadline){
   if(signal?.aborted)throw new Error('账号采集已取消');
   try{
    const current=await chrome.tabs.get(tab.id);if(current.url && accountSource(current.url).url!==source.url)throw new Error('页面跳转，无法核对目标账号');
    const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:()=>window.__liveAssistantPublicAccountV1?.snapshot() || []});
    if(Array.isArray(result?.result) && result.result.length){best=result.result;if(best.some(r=>r.kind==='work') || source.kind==='work')return best;}
   }catch(error){if(/页面跳转/u.test(error.message))throw error;}
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(best.length)return best;
  throw new Error('未读取到可核对的公开资料，可能需要登录、页面验证或资料不可见；请在抖音打开该链接核对');
 }finally{if(tab?.id)try{await chrome.tabs.remove(tab.id);}catch{}}
}
