import {knowledgeLifetime,canReuseSource} from '../src/services/web-knowledge.js';
import {relationshipEvidenceVersion} from '../src/services/relationship-query.js';
import {AgentHarness} from '../src/ai/harness.js';
import {createAgentTaskStore} from '../src/ai/task-store.js';
import {createResearchAgent,validateAgentInput} from '../src/ai/agent.js';
import {RESEARCH_BUDGETS,subjectEpoch,audienceProfile} from '../src/ai/audience-profile.js';
import {resolveResearchProfile,checkResearchProfile} from '../src/ai/research-profile.js';
import {readPublicPage,validatePublicURL} from '../src/ai/public-sources.js';
import {validateEndpoint} from '../src/services/ai.js';
import {validateSearchEndpoint,validateSearchBody} from '../src/services/search.js';
import {resolveReplyConfig} from '../src/services/ai-pipeline.js';
import {validateWeatherURL} from '../src/services/weather.js';
import {validatePublicDataURL} from '../src/services/public-data.js';
import {retrieveSourceRecords} from '../src/services/automatic-knowledge.js';
import {formatAccountEvidence} from '../src/ai/account-evidence.js';
import {continuousEnabled,createContinuousResearch} from '../src/ai/continuous-research.js';
import {collectionPolicy} from '../src/core/collection-policy.js';
import {makeCollectionAnalysisRequest,parseCollectionAnalysis,validCollectionAnalyses} from '../src/ai/collection-analysis.js';
import {requestJSON} from '../src/services/search.js';
export function createBackgroundAI({chrome,readRecord,readConfigs=async()=>({}),relationships,knowledge,collectAccount,saveAnalysis,fetch:fetcher=globalThis.fetch,store=createAgentTaskStore()}){
 const authorized=origin=>chrome.permissions.contains({origins:[`${origin}/*`]});
 const request=details=>{
  const controller=new AbortController();let timeout;
  void (async()=>{try{
   const searching=details.operation==='search',weather=['weather','public-data'].includes(details.operation),provider=details.searchProvider;
   const url=weather ? details.operation==='weather' ? validateWeatherURL(details.url) : validatePublicDataURL(details.url) : searching ? validateSearchEndpoint(details.url,provider) : validateEndpoint(details.url);
   if(!await authorized(new URL(url).origin))throw new Error('请先在扩展图标中授权模型或搜索域名');
   if(controller.signal.aborted)throw new Error('请求已取消');
   if(!weather && (typeof details.data!=='string' || details.data.length>100000))throw new Error('后台请求超过容量');
   if(searching)validateSearchBody(provider==='searxng' ? Object.fromEntries(new URLSearchParams(details.data)) : JSON.parse(details.data),provider);
   timeout=setTimeout(()=>controller.abort(),Math.min(details.timeout || 25000,searching ? 30000 : 25000));
   const response=await fetcher(url,{method:weather ? 'GET' : 'POST',credentials:'omit',redirect:'error',signal:controller.signal,headers:weather ? {} : details.headers,body:weather ? undefined : details.data});
   const text=await response.text();if(text.length>200000)throw new Error('后台模型响应超过容量');details.onload({status:response.status,responseText:text,finalUrl:response.url});
  }catch(error){details.onerror?.(error);}finally{clearTimeout(timeout);}})();
  return {abort(){controller.abort();details.onabort?.();}};
 };
 const execute=async(job,options)=>{
  const config=collectionPolicy(await readRecord(`live-assistant:config:${job.scope.split(':')[0]}`));
  if(!config?.ai?.enabled || String(config.anchorId)!==job.input.anchor)throw new Error('AI已关闭或主播已变化，请核对后重新提交');
  const ai=resolveReplyConfig(config.ai);job.input.ai=ai;
  if(job.input.collection){
   if(!saveAnalysis)throw Error('当前环境没有连接后台原文整理存储');
   const room=job.scope.split(':')[0],version=JSON.stringify(ai),key=await readRecord(`live-assistant:api-key:${new URL(ai.endpoint).origin}`) || await readRecord(`live-assistant:media-key:${new URL(ai.endpoint).origin}`) || '';
   const local=['localhost','127.0.0.1','[::1]'].includes(new URL(ai.endpoint).hostname);
   if(ai.edge?.localOnly && !local)throw Error('仅本地模式需要本机兼容接口，未向远程服务发送原文');
   if(!local && !key)throw Error('请先保存后台整理模型的 API Key');
   const source=await readRecord(`live-assistant:live-memory:${room}:${job.input.anchor}`);
   if(!validCollectionAnalyses({...source,analyses:[{id:job.id,at:Date.now(),records:job.input.collection,people:[]}]}).length)throw Error('原话已删除或变化，未向模型发送旧资料');
   const viewer=source.audience?.viewers?.find(v=>v.key===job.input.collection[0].subject);
   const observed=viewer ? {gifts:audienceProfile(viewer,job.input.anchor,Date.now()).gifts,statements:viewer.statements?.length || 0,basis:'本房已采集互动和30天礼物观测下限；不代表全平台消费、收入、资产或送礼概率'} : null;
   await options.checkpoint('collection','按原文整理人物、明确关系和待核实行为假设');
   await store.reserve(job.scope);
   const body=makeCollectionAnalysisRequest(job.input.collection,ai,observed);
   const result=await requestJSON(request,{url:ai.endpoint,key,body,signal:options.signal});
   const row=parseCollectionAnalysis(result.choices?.[0]?.message?.content,job.input.collection,{id:job.id});
   const latest=collectionPolicy(await readRecord(`live-assistant:config:${room}`));
   if(options.signal.aborted || !latest?.ai?.enabled || String(latest.anchorId)!==job.input.anchor || JSON.stringify(resolveReplyConfig(latest.ai))!==version)throw Error('AI设置或主播已变化，整理结果已作废');
   const memory=await readRecord(`live-assistant:live-memory:${room}:${job.input.anchor}`);
   if(!validCollectionAnalyses({...memory,analyses:[row]}).length)throw Error('原话已删除或变化，整理结果已作废');
   await saveAnalysis(room,job.input.anchor,row);
   return {answer:`已整理 ${row.records.length} 段原文、${row.people.length} 位人物；行为解读均为待核实假设。`,at:row.at,modelCalls:1,runtime:'collection-analysis',coverage:'bounded original statements; unknown speakers remain unbound; no public posting'};
  }
  const room=job.scope.split(':')[0],subject=await resolveResearchProfile({room,anchor:job.input.anchor,subject:job.input.subject,epoch:job.input.subjectEpoch,ai,question:job.question,read:readRecord}),tier=subject?.tier || 'standard',limits=RESEARCH_BUDGETS[tier],graph=relationships ? await relationships(room,job.question) : null;
  if(subject && config.ai.contextSources?.accounts!==false && config.ai.accountCollection?.enabled!==false)job.input.sources=[...new Set([...subject.sources,...job.input.sources])].slice(0,3);
  if(relationships){job.input.context ||= {};job.input.context.relationshipContext=graph;}
  const keys=new Map();for(const [kind,endpoint] of [['ai',ai.endpoint],['search',ai.search?.enabled ? ai.search.endpoint : null]])if(endpoint){const origin=new URL(endpoint).origin;keys.set(`${kind}:${endpoint}`,await readRecord(`live-assistant:${kind==='ai'?'api-key':'search-key'}:${origin}`) || (kind==='ai' ? await readRecord(`live-assistant:media-key:${origin}`) : '') || '');}
  const knowledgeVersion=knowledge ? await knowledge.handle(room,'version',{anchor:job.input.anchor}) : undefined;
  const binding={profile:subject?.binding,tier,ai:validateAgentInput(job.input).ai,knowledgeVersion,relationships:relationshipEvidenceVersion(graph)};
  await options.bind?.(binding);
  const guard=async()=>{
   const latest=collectionPolicy(await readRecord(`live-assistant:config:${room}`));
   if(!latest?.ai?.enabled || String(latest.anchorId)!==job.input.anchor || job.id.startsWith('auto-') && !continuousEnabled(latest))throw Error('AI或持续研究已关闭，或主播已变化');
   await checkResearchProfile({room,anchor:job.input.anchor,subject:job.input.subject,binding:subject?.binding,read:readRecord});
   const current=validateAgentInput({...job.input,ai:resolveReplyConfig(latest.ai)}).ai;
   if(JSON.stringify(current)!==JSON.stringify(binding.ai))throw Error('AI设置已变化，请重新提交研究');
   if(knowledge && knowledgeVersion!==await knowledge.handle(room,'version',{anchor:job.input.anchor}))throw Error('知识已删除或变化，旧研究已作废');
   if(relationships && binding.relationships!==relationshipEvidenceVersion(await relationships(room,job.question)))throw Error('人物资料已变化，本次研究已作废');
  };
  const read=async(url,signal)=>{
   if(collectAccount && new URL(url).hostname==='www.douyin.com'){
    if(ai.contextSources?.accounts===false)throw Error('公开账号上下文已关闭');
    const cached=subject && knowledge && ai.search?.rememberKnowledge!==false ? (await knowledge.handle(room,'list',{anchor:job.input.anchor})).filter(r=>r.subject===job.input.subject && r.source===url && Date.now()-r.at<86400000 && canReuseSource(job.question,r)).sort((a,b)=>b.at-a.at)[0] : null;
    if(cached)return {url,title:cached.title,text:cached.text,at:cached.at,expiresAt:cached.expiresAt,sourceId:cached.id,evidenceKind:cached.evidenceKind || 'stored-passage',publishedAt:cached.publishedAt ?? null,coverage:cached.coverage || '同一稳定账号的有效原文缓存；保留原采集时间'};
    const rows=await collectAccount(room,url,{signal}),at=Math.min(Date.now(),...rows.map(r=>r.observedAt).filter(Number.isFinite));
    return {url,title:rows[0]?.title || '抖音公开资料',...formatAccountEvidence(rows,job.question),at,expiresAt:Math.min(at+86400000,...rows.map(r=>r.expiresAt).filter(Number.isFinite))};
   }
   return readPublicPage(url,{authorized,fetch:fetcher,signal});
  };
  const agent=createResearchAgent({tier,profile:subject?.profile,request,getKey:(kind,url)=>keys.get(`${kind}:${url}`) || '',readPublicPage:read,checkpointer:store.checkpointer,guard,
   reserve:async scope=>{await store.reserve(`task:${scope}:${job.id}`,limits.modelCalls,{lifetime:true});return store.reserve(scope);},reserveSearch:async scope=>{await store.reserve(`task-search:${scope}:${job.id}`,limits.searches,{lifetime:true});return store.reserve(`search:${scope}`,20);},
   knowledge:async query=>ai.assistant?.memoryEnabled===false || !knowledge ? [] : retrieveSourceRecords(await knowledge.handle(room,'list',{anchor:job.input.anchor}),query,Date.now(),{subject:job.input.subject,anchor:job.input.anchor}).flatMap(r=>r.results),
   relationships:query=>ai.assistant?.memoryEnabled===false ? null : relationships?.(room,query)});
  const result=await agent(job,options);
  await guard();
  if(knowledge && ai.search?.rememberKnowledge!==false && ai.assistant?.memoryEnabled!==false){
   const sources=subject ? result.sources : result.sources.filter(r=>new URL(r.url).hostname!=='www.douyin.com');
   try{result.knowledgeStored=await knowledge.handle(room,'remember',{anchor:job.input.anchor,...(subject ? {subject:job.input.subject,subjectEpoch:subject.epoch} : {}),sources,version:knowledgeVersion,lifetime:knowledgeLifetime(job.question,'stable')});}
   catch(error){result.knowledgeError=error.message;}
  }
  return result;
 };
 const harness=new AgentHarness({store,execute,resumable:Boolean(store.checkpointer)});
 const loop=createContinuousResearch({configs:readConfigs,read:readRecord,store,collect:Boolean(saveAnalysis),jobStatus:id=>harness.jobs.get(id)?.status,submit:job=>harness.submit({...job,input:validateAgentInput(job.input)}),
  hasPending:scope=>harness.list(scope).some(j=>['queued','running'].includes(j.status)),
  cancelDisabled:async configs=>{for(const job of harness.jobs.values())if(['queued','running'].includes(job.status)){
   const [room,anchor]=job.scope.split(':'),config=configs[`live-assistant:config:${room}`];
   if(!config?.ai?.enabled || String(config.anchorId)!==anchor || job.id.startsWith('auto-') && !continuousEnabled(config))await harness.cancel(job.id,job.scope);
  }}});
 return {ready:harness.ready,async handle(message,room){await harness.ready;const config=collectionPolicy(await readRecord(`live-assistant:config:${room}`)),anchor=String(config?.anchorId || '');if(!/^\d{1,30}$/u.test(anchor))throw new Error('请先保存主播UID和AI设置');const scope=`${room}:${anchor}`;
   if(message.type==='agent-list')return harness.list(scope);
   if(message.type==='agent-cancel')return harness.cancel(message.id,scope);
   if(!config.ai?.enabled)throw new Error('请先启用并保存AI设置');
   const input=validateAgentInput({...message.input,anchor,ai:resolveReplyConfig(config.ai)});for(const url of input.sources)validatePublicURL(url);
   if(input.subject)input.subjectEpoch=subjectEpoch((await readRecord(`live-assistant:live-memory:${room}:${anchor}`))?.audience,input.subject);
   return harness.submit({id:message.id,scope,question:message.question,input});
  },wake:async()=>{await harness.ready;await loop.tick();harness.drain();},close:async()=>{await harness.close();store.close();}};
}
