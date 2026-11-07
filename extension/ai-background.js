import {AI_REQUEST_LIMIT,AI_RESPONSE_LIMIT} from '../src/services/ai-wire.js';
import {knowledgeLifetime,canReuseSource} from '../src/services/web-knowledge.js';
import {relationshipEvidenceVersion,relationshipResearchOptions,scopedRelationshipContext} from '../src/services/relationship-query.js';
import {AgentHarness} from '../src/ai/harness.js';
import {createAgentTaskStore} from '../src/ai/task-store.js';
import {createResearchAgent,validateAgentInput} from '../src/ai/agent.js';
import {subjectEpoch} from '../src/ai/audience-profile.js';
import {resolveResearchProfile,checkResearchProfile} from '../src/ai/research-profile.js';
import {readPublicPage,validatePublicURL} from '../src/ai/public-sources.js';
import {createAIClient,validateEndpoint} from '../src/services/ai.js';
import {validateSearchEndpoint,validateSearchBody} from '../src/services/search.js';
import {resolveAITaskConfig,taskModelSecret} from '../src/services/ai-task-config.js';
import {createProfileInsightUpdater} from '../src/ai/profile-insights.js';
import {validateWeatherURL} from '../src/services/weather.js';
import {validatePublicDataURL} from '../src/services/public-data.js';
import {retrieveSourceRecords} from '../src/services/automatic-knowledge.js';
import {formatAccountEvidence} from '../src/ai/account-evidence.js';
import {continuousEnabled,createContinuousResearch,researchEvidenceIsCurrent} from '../src/ai/continuous-research.js';
import {researchLimits,researchSettings} from '../src/ai/research-settings.js';
import {servicePermissionPattern} from './service-permissions.js';
export function createBackgroundAI({chrome,readRecord,writeRecord,readConfigs=async()=>({}),relationships,knowledge,collectAccount,saveSupplement,fetch:fetcher=globalThis.fetch,store=createAgentTaskStore()}){
 const authorized=origin=>chrome.permissions.contains({origins:[servicePermissionPattern(origin)]});
 const request=details=>{
  const controller=new AbortController();let timeout;
  void (async()=>{try{
   const searching=details.operation==='search',weather=['weather','public-data'].includes(details.operation),provider=details.searchProvider;
   const url=weather ? details.operation==='weather' ? validateWeatherURL(details.url) : validatePublicDataURL(details.url) : searching ? validateSearchEndpoint(details.url,provider) : validateEndpoint(details.url);
   const origin=new URL(url).origin;
   if(!await authorized(origin))throw new Error(weather ? `公开数据服务域名 ${origin} 尚未授权，请在扩展详情中允许访问后重试` : `${searching ? '搜索服务' : '后台研究模型'}域名 ${origin} 尚未授权，请点击扩展图标，在“AI 服务访问权限”中点击“${searching ? '授权搜索服务域名' : '授权后台研究服务域名'}”后重试`);
   if(controller.signal.aborted)throw new Error('请求已取消');
   if(!weather && (typeof details.data!=='string' || details.data.length>AI_REQUEST_LIMIT))throw new Error('后台请求超过容量');
   if(searching)validateSearchBody(provider==='searxng' ? Object.fromEntries(new URLSearchParams(details.data)) : JSON.parse(details.data),provider);
   if(details.timeout>0)timeout=setTimeout(()=>controller.abort(),Math.min(details.timeout,2147483647));
   const response=await fetcher(url,{method:weather ? 'GET' : 'POST',credentials:'omit',redirect:'error',signal:controller.signal,headers:weather ? {} : details.headers,body:weather ? undefined : details.data});
   const text=await response.text();if(text.length>AI_RESPONSE_LIMIT)throw new Error('后台模型响应超过容量');details.onload({status:response.status,responseText:text,finalUrl:response.url});
  }catch(error){details.onerror?.(error);}finally{clearTimeout(timeout);}})();
  return {abort(){controller.abort();details.onabort?.();}};
 };
 const profiles=writeRecord && createProfileInsightUpdater({read:readRecord,write:writeRecord,reserve:async scope=>{const config=await readRecord(`live-assistant:config:${scope.split(':')[0]}`);return store.reserve(scope,researchSettings(config?.ai).modelCallsPerHour);},client:async(prompt,ai)=>{
  const origin=new URL(ai.endpoint).origin,secret=taskModelSecret(ai,'profile'),key=(secret && await readRecord(secret)) || await readRecord(`live-assistant:api-key:${origin}`) || await readRecord(`live-assistant:media-key:${origin}`) || '';
  return createAIClient({request,getKey:()=>key})(prompt,ai);
 }});
 const execute=async(job,options)=>{
  const config=await readRecord(`live-assistant:config:${job.scope.split(':')[0]}`);
  if(!config?.ai?.enabled || String(config.anchorId)!==job.input.anchor)throw new Error('AI已关闭或主播已变化，请核对后重新提交');
  const ai=resolveAITaskConfig(config.ai,'research');job.input.ai=ai;
  const room=job.scope.split(':')[0],subject=await resolveResearchProfile({room,anchor:job.input.anchor,subject:job.input.subject,epoch:job.input.subjectEpoch,ai,question:job.question,read:readRecord}),tier=subject?.tier || 'standard',limits=researchLimits(ai),settings=researchSettings(ai),relationshipContext=job.input.context?.relationshipContext,graphOptions=relationshipResearchOptions(relationshipContext),graph=relationships ? await relationships(room,job.question,graphOptions) : null;
  if(subject && config.ai.contextSources?.accounts!==false && config.ai.accountCollection?.enabled!==false)job.input.sources=[...new Set([...subject.sources,...job.input.sources])].slice(0,3);
  if(relationships){job.input.context ||= {};job.input.context.relationshipContext=scopedRelationshipContext(graph,relationshipContext);}
  const keys=new Map();for(const [kind,endpoint] of [['ai',ai.endpoint],['search',ai.search?.enabled ? ai.search.endpoint : null]])if(endpoint){const origin=new URL(endpoint).origin;keys.set(`${kind}:${endpoint}`,(kind==='ai' && taskModelSecret(config.ai,'research') && await readRecord(taskModelSecret(config.ai,'research'))) || await readRecord(`live-assistant:${kind==='ai'?'api-key':'search-key'}:${origin}`) || (kind==='ai' ? await readRecord(`live-assistant:media-key:${origin}`) : '') || '');}
  const knowledgeVersion=knowledge ? await knowledge.handle(room,'version',{anchor:job.input.anchor}) : undefined;
  const profileConfig=resolveAITaskConfig(config.ai,'profile');
  const binding={profile:subject?.binding,tier,ai:validateAgentInput(job.input).ai,knowledgeVersion,relationships:relationshipEvidenceVersion(graph),...(config.ai.assistant?.research?.profileEnabled ? {profileModel:[profileConfig.endpoint,profileConfig.model]} : {})};
  await options.bind?.(binding);
  const guard=async()=>{
   const latest=await readRecord(`live-assistant:config:${room}`);
   if(!latest?.ai?.enabled || String(latest.anchorId)!==job.input.anchor || job.id.startsWith('auto-') && !continuousEnabled(latest))throw Error('AI或持续研究已关闭，或主播已变化');
   if(job.id.startsWith('auto-') && !researchEvidenceIsCurrent(job.input.context?.context,await readRecord(`live-assistant:live-memory:${room}:${job.input.anchor}`)))throw Error('研究原始对话或感知已删除，本次研究已作废');
   await checkResearchProfile({room,anchor:job.input.anchor,subject:job.input.subject,binding:subject?.binding,read:readRecord});
   const current=validateAgentInput({...job.input,ai:resolveAITaskConfig(latest.ai,'research')}).ai;
   if(JSON.stringify(current)!==JSON.stringify(binding.ai))throw Error('AI设置已变化，请重新提交研究');
   if(binding.profileModel){const model=resolveAITaskConfig(latest.ai,'profile');if(!latest.ai.assistant?.research?.profileEnabled || JSON.stringify([model.endpoint,model.model])!==JSON.stringify(binding.profileModel))throw Error('人物整理模型设置已变化');}
   if(knowledge && knowledgeVersion!==await knowledge.handle(room,'version',{anchor:job.input.anchor}))throw Error('知识已删除或变化，旧研究已作废');
   if(relationships && binding.relationships!==relationshipEvidenceVersion(await relationships(room,job.question,graphOptions)))throw Error('人物资料已变化，本次研究已作废');
  };
  const read=async(url,signal)=>{
   if(collectAccount && new URL(url).hostname==='www.douyin.com'){
    if(ai.contextSources?.accounts===false)throw Error('公开账号上下文已关闭');
    const cached=subject && knowledge && ai.search?.rememberKnowledge!==false ? (await knowledge.handle(room,'list',{anchor:job.input.anchor})).filter(r=>r.subject===job.input.subject && r.source===url && Date.now()-r.at<86400000 && canReuseSource(job.question,r)).sort((a,b)=>b.at-a.at)[0] : null;
    if(cached)return {url,title:cached.title,text:cached.text,at:cached.at,expiresAt:cached.expiresAt,sourceId:cached.id,evidenceKind:cached.evidenceKind || 'stored-passage',publishedAt:cached.publishedAt ?? null,coverage:cached.coverage || '同一稳定账号的有效原文缓存；保留原采集时间'};
    const rows=await collectAccount(room,url,{signal}),at=Math.min(Date.now(),...rows.map(r=>r.observedAt).filter(Number.isFinite));
    return {url,title:rows[0]?.title || '抖音公开资料',...formatAccountEvidence(rows,job.question),at,expiresAt:Math.min(at+86400000,...rows.map(r=>r.expiresAt).filter(Number.isFinite))};
   }
   return readPublicPage(url,{authorized,fetch:fetcher,signal,timeout:settings.requestTimeoutSec*1000});
  };
  const agent=createResearchAgent({tier,profile:subject?.profile,request,getKey:(kind,url)=>keys.get(`${kind}:${url}`) || '',readPublicPage:read,checkpointer:store.checkpointer,guard,
   reserve:async scope=>{await store.reserve(`task:${scope}:${job.id}`,limits.modelCalls,{lifetime:true});return store.reserve(scope,settings.modelCallsPerHour);},reserveSearch:async scope=>{await store.reserve(`task-search:${scope}:${job.id}`,limits.searches,{lifetime:true});return store.reserve(`search:${scope}`,settings.searchesPerHour);},
   knowledge:async query=>ai.assistant?.memoryEnabled===false || !knowledge ? [] : retrieveSourceRecords(await knowledge.handle(room,'list',{anchor:job.input.anchor}),query,Date.now(),{subject:job.input.subject,anchor:job.input.anchor}).flatMap(r=>r.results),
   relationships:(query,options)=>ai.assistant?.memoryEnabled===false ? null : relationships?.(room,query,options)});
  const result=await agent(job,options);
  await guard();
  if(job.input.supplement){
   if(!saveSupplement)throw Error('当前宿主不支持保存补充知识');
   await options.checkpoint('knowledge:save','保存补充知识，更新人物索引与关系证据');options.signal.throwIfAborted();
   result.entries=await saveSupplement(room,result.entries,config.ai.memory.entries,{anchor:job.input.anchor,signal:options.signal});
   return {...result,knowledgeStored:true};
  }
  if(profiles && subject && config.ai.assistant?.research?.profileEnabled){
   await options.checkpoint('profile','按稳定账号原话更新人物资料，保留引用和推测边界');
   try{result.profileUpdated=Boolean(await profiles({room,anchor:job.input.anchor,subject:job.input.subject,ai:config.ai,signal:options.signal,guard}));}
   catch(error){if(options.signal.aborted)throw error;await guard();result.profileError=error.message;}
  }
  // Workbench questions retain sources on the task. Writing them into the
  // corpus here would invalidate the evidence snapshot of their own answer.
  if(knowledge && !relationshipContext?.focus && ai.search?.rememberKnowledge!==false && ai.assistant?.memoryEnabled!==false){
   const sources=subject ? result.sources : result.sources.filter(r=>new URL(r.url).hostname!=='www.douyin.com');
   try{result.knowledgeStored=false;for(let offset=0;offset<sources.length;offset+=10){const stored=await knowledge.handle(room,'remember',{anchor:job.input.anchor,...(subject ? {subject:job.input.subject,subjectEpoch:subject.epoch} : {}),sources:sources.slice(offset,offset+10),version:knowledgeVersion,lifetime:knowledgeLifetime(job.question,'stable')});result.knowledgeStored=stored || result.knowledgeStored;}}
   catch(error){result.knowledgeError=error.message;}
  }
  return result;
 };
 const harness=new AgentHarness({store,execute,resumable:Boolean(store.checkpointer),onSettled:()=>{queueMicrotask(()=>{void loop.tick().catch(()=>{});});}});
 const loop=createContinuousResearch({configs:readConfigs,read:readRecord,store,submit:job=>harness.submit({...job,input:validateAgentInput(job.input)}),
  hasPending:scope=>[...harness.jobs.values()].some(j=>j.scope===scope && ['queued','running'].includes(j.status)),
  cancelDisabled:async configs=>{for(const job of harness.jobs.values())if(['queued','running'].includes(job.status)){
   const [room,anchor]=job.scope.split(':'),config=configs[`live-assistant:config:${room}`];
   if(!config?.ai?.enabled || String(config.anchorId)!==anchor || job.id.startsWith('auto-') && !continuousEnabled(config))await harness.cancel(job.id,job.scope);
  }}});
 return {ready:harness.ready,async handle(message,room){await harness.ready;const config=await readRecord(`live-assistant:config:${room}`),anchor=String(config?.anchorId || '');if(!/^\d{1,30}$/u.test(anchor))throw new Error('请先保存主播UID和AI设置');const scope=`${room}:${anchor}`;
   if(message.type==='agent-list')return harness.list(scope);
   if(message.type==='agent-cancel')return harness.cancel(message.id,scope);
   if(!config.ai?.enabled)throw new Error('请先启用并保存AI设置');
   const input=validateAgentInput({...message.input,anchor,ai:resolveAITaskConfig(config.ai,'research')});for(const url of input.sources)validatePublicURL(url);
   if(input.subject)input.subjectEpoch=subjectEpoch((await readRecord(`live-assistant:live-memory:${room}:${anchor}`))?.audience,input.subject);
   return harness.submit({id:message.id,scope,question:message.question,input});
  },pruneProfiles:(room,anchor)=>profiles?.prune(room,anchor),wake:async()=>{await harness.ready;await loop.tick();harness.drain();},close:async()=>{await harness.close();store.close();}};
}
