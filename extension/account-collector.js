import {accountSource,ACCOUNT_SAMPLE_LIMIT} from '../src/ai/account-context.js';
const check=signal=>{if(signal?.aborted)throw Error('账号采集已取消');};
const pause=(ms,signal)=>new Promise((resolve,reject)=>{
 const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve();};
 const abort=()=>{finish();reject(Error('账号采集已取消'));};
 const timer=setTimeout(finish,ms);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
});
async function readPage(chrome,source,{signal,deadline,now,pause,settleMs,analyze}){
 let tab;
 try{
  tab=await chrome.tabs.create({url:source.url,active:false});let best=[],firstAt=null;
  while(now()<deadline){
   check(signal);
   try{
    const current=await chrome.tabs.get(tab.id);if(current.url && accountSource(current.url).url!==source.url)throw Error('页面跳转，无法核对目标账号');
    const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:()=>window.__liveAssistantPublicAccountV1?.snapshot() || []});
    check(signal);
    if(Array.isArray(result?.result) && result.result.length){
     best=result.result;firstAt ??=now();
     if(source.kind==='profile' && best.some(r=>r.kind==='work') || source.kind==='work' && now()-firstAt>=settleMs)break;
    }
   }catch(error){if(signal?.aborted || /页面跳转/u.test(error.message))throw error;}
   await pause(Math.min(500,Math.max(0,deadline-now())),signal);
  }
  check(signal);
  if(!best.length)throw Error('未读取到可核对的公开资料，可能需要登录、页面验证或资料不可见；请在抖音打开该链接核对');
  if(analyze && source.kind==='work')try{best.push(...await analyze({tabId:tab.id,source,records:best,signal}));}catch(error){check(signal);const work=best.find(r=>r.kind==='work');if(work)work.coverage=`已读取公开描述与页面互动；音画采样未完成：${String(error.message).slice(0,160)}`;}
  check(signal);return best;
 }finally{if(tab?.id)try{await chrome.tabs.remove(tab.id);}catch{}}
}

// One serialized research job visits at most one profile and two of its works.
export async function collectAccount(chrome,url,{signal,timeout=24000,settleMs=1500,now=Date.now,pause:wait=pause,analyze}={}){
 const source=accountSource(url);
 if(!await chrome.permissions.contains({origins:['https://www.douyin.com/*']}))throw Error('请在扩展权限中允许访问 www.douyin.com 后采集');
 const deadline=now()+timeout,options={signal,deadline:Math.min(deadline,now()+8000),now,pause:wait,settleMs,analyze};
 const rows=await readPage(chrome,source,options);
 if(source.kind==='work')return rows.slice(0,ACCOUNT_SAMPLE_LIMIT);
 const works=[...new Map(rows.filter(r=>r.kind==='work' && r.subject===source.id && r.url).map(r=>[r.id,r])).values()].sort((a,b)=>(b.publishedAt || 0)-(a.publishedAt || 0)).slice(0,2);
 for(const work of works){
  check(signal);if(now()>=deadline)break;
  try{
   const collected=await readPage(chrome,accountSource(work.url),{...options,deadline:Math.min(deadline,now()+8000)});
   const related=collected.filter(r=>r.subject===source.id && (r.kind==='work' ? r.id : r.workId)===work.id);
   rows.push(...related.map(r=>({...r,source:source.url})));
  }catch(error){check(signal);work.coverage=`作品描述已读取；互动/音画采样未完成：${String(error.message).slice(0,160)}`;}
 }
 const unique=new Map(rows.map(r=>[`${r.kind}:${r.id}`,r]));
 return [...unique.values()].slice(0,ACCOUNT_SAMPLE_LIMIT);
}
