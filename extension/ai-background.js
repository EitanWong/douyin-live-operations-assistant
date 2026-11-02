import {AgentHarness} from '../src/ai/harness.js';
import {createAgentTaskStore} from '../src/ai/task-store.js';
import {createResearchAgent,validateAgentInput} from '../src/ai/agent.js';
import {readPublicPage,validatePublicURL} from '../src/ai/public-sources.js';
import {validateEndpoint} from '../src/services/ai.js';
import {validateSearchEndpoint,validateSearchBody} from '../src/services/search.js';
import {resolveReplyConfig} from '../src/services/ai-pipeline.js';
export function createBackgroundAI({chrome,readRecord,fetch:fetcher=globalThis.fetch,store=createAgentTaskStore()}){
 const authorized=origin=>chrome.permissions.contains({origins:[`${origin}/*`]});
 const request=details=>{
  const controller=new AbortController();let timeout;
  void (async()=>{try{
   const searching=details.operation==='search',provider=details.searchProvider;
   const url=searching ? validateSearchEndpoint(details.url,provider) : validateEndpoint(details.url);
   if(!await authorized(new URL(url).origin))throw new Error('请先在扩展图标中授权模型或搜索域名');
   if(controller.signal.aborted)throw new Error('请求已取消');
   if(typeof details.data!=='string' || details.data.length>100000)throw new Error('后台请求超过容量');
   if(searching)validateSearchBody(provider==='searxng' ? Object.fromEntries(new URLSearchParams(details.data)) : JSON.parse(details.data),provider);
   timeout=setTimeout(()=>controller.abort(),Math.min(details.timeout || 25000,25000));
   const response=await fetcher(url,{method:'POST',credentials:'omit',redirect:'error',signal:controller.signal,headers:details.headers,body:details.data});
   const text=await response.text();if(text.length>200000)throw new Error('后台模型响应超过容量');details.onload({status:response.status,responseText:text,finalUrl:response.url});
  }catch(error){details.onerror?.(error);}finally{clearTimeout(timeout);}})();
  return {abort(){controller.abort();details.onabort?.();}};
 };
 const execute=async(job,options)=>{
  const config=await readRecord(`live-assistant:config:${job.scope.split(':')[0]}`);
  if(!config?.ai?.enabled || String(config.anchorId)!==job.input.anchor)throw new Error('AI已关闭或主播已变化，请核对后重新提交');
  const ai=resolveReplyConfig(config.ai);job.input.ai=ai;
  const keys=new Map();for(const [kind,endpoint] of [['ai',ai.endpoint],['search',ai.search?.enabled ? ai.search.endpoint : null]])if(endpoint){const origin=new URL(endpoint).origin;keys.set(`${kind}:${endpoint}`,await readRecord(`live-assistant:${kind==='ai'?'api-key':'search-key'}:${origin}`) || (kind==='ai' ? await readRecord(`live-assistant:media-key:${origin}`) : '') || '');}
  const agent=createResearchAgent({request,getKey:(kind,url)=>keys.get(`${kind}:${url}`) || '',readPublicPage:(url,signal)=>readPublicPage(url,{authorized,fetch:fetcher,signal}),reserve:scope=>store.reserve(scope)});
  return agent(job,options);
 };
 const harness=new AgentHarness({store,execute});
 return {ready:harness.ready,async handle(message,room){await harness.ready;const config=await readRecord(`live-assistant:config:${room}`),anchor=String(config?.anchorId || '');if(!/^\d{1,30}$/u.test(anchor))throw new Error('请先保存主播UID和AI设置');const scope=`${room}:${anchor}`;
   if(message.type==='agent-list')return harness.list(scope);
   if(message.type==='agent-cancel')return harness.cancel(message.id,scope);
   if(!config.ai?.enabled)throw new Error('请先启用并保存AI设置');
   const input=validateAgentInput({...message.input,anchor,ai:resolveReplyConfig(config.ai)});for(const url of input.sources)validatePublicURL(url);
   return harness.submit({id:message.id,scope,question:message.question,input});
  },wake:()=>harness.ready.then(()=>harness.drain()),close:()=>{harness.close();store.close();}};
}
