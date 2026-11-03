import {Engine,mergeConfig,cleanMessage} from '../../src/core/engine.js';
import {createAIClient} from '../../src/services/ai.js';
import {createResilientAI} from '../../src/services/ai-resilience.js';
import {createSearchClient} from '../../src/services/search.js';
import {createWebKnowledge} from '../../src/services/web-knowledge.js';
import {createLocalAgentTasks} from '../../src/ai/local-agent.js';
import {MediaEvidence} from '../../src/services/media.js';
import {evaluateReply} from '../../src/ai/reply-evaluation.js';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {AGENT_EVAL_CASES,assessAgentResult} from './scenarios.mjs';

const flush=()=>new Promise(setImmediate);
const completion=(details,text)=>details.onload({status:200,responseText:JSON.parse(details.data).stream
 ? `data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`
 : JSON.stringify({choices:[{message:{content:text}}]})});
// The only remote boundary. No keys or request headers enter evaluation output.
export function fetchTransport(details){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),details.timeout);
 void fetch(details.url,{method:'POST',headers:details.headers,body:details.data,signal:controller.signal,redirect:'error'})
  .then(async response=>details.onload({status:response.status,responseText:await response.text()}))
  .catch(()=>details.onerror()).finally(()=>clearTimeout(timer));
 return {abort(){clearTimeout(timer);controller.abort();}};
}

export async function runAgentCase(scenario,{key,workspaceId,request=fetchTransport}={}){
 if(!key || !workspaceId)throw new Error('需要 QWEN_API_KEY 和 QWEN_WORKSPACE_ID；请勿将密钥写入评测配置。');
 if(scenario.trigger==='research')return runResearchCase(scenario,{key,workspaceId,request});
 let now=1793764800000,calls=0,searches=0,sent=0,aborted=0,late;
 const replies=[],diagnostics=[],intents=[],lookups=[];
 const sources=scenario.fixture?.sources || scenario.sources || [];
 const knowledge=createWebKnowledge({indexedDB:new IDBFactory(),IDBKeyRange,now:()=>now});
 const transport=details=>{
  calls++;
  if(scenario.fault){
   if(['cancel','late'].includes(scenario.fault)){
    late=()=>completion(details,'{"intent":"chat","reply":"迟到回答。"}');
    return {abort(){aborted++;}};
   }
   if(scenario.fault==='auth')details.onload({status:401,responseText:'{"error":{"code":"invalid_api_key"}}'});
   else completion(details,scenario.fault==='long' ? JSON.stringify({intent:'chat',reply:'长'.repeat(100)}) : '{"intent":"unknown"}');
   return;
  }
  const handle=request(details);
  return {abort(){aborted++;handle?.abort?.();}};
 };
 const search=createSearchClient({now:()=>now,getKey:()=> 'fixture-search-key',request:details=>{
  searches++;
  if(scenario.searchError)details.onload({status:429,responseText:'{}'});
  else details.onload({status:200,responseText:JSON.stringify({code:200,data:{webPages:{value:sources.map(row=>({name:row.title,url:row.url,summary:row.content}))}}})});
 }});
 const cloud=createAIClient({request:transport,getKey:()=>key,search,knowledge,onIntent:row=>intents.push(row.intent),onSearch:row=>lookups.push(row)});
 const ai=createResilientAI({cloud,now:()=>now});
 const income=scenario.income || scenario.fixture?.context?.liveContext?.income;
 const config=mergeConfig({mode:'preview',anchorId:'10001',ai:{enabled:true,chatEnabled:true,proactiveEnabled:true,
  replyFrequency:'natural',maxPerHour:100,edge:{enabled:false},
  pipeline:{mode:'omni-only',workspaceId,region:'cn-beijing'},search:{enabled:true,rememberKnowledge:true,maxResults:5},
  ...(scenario.noise ? {knowledge:'无关直播背景。'.repeat(1500)} : {})}});
 const finalConfig=mergeConfig(scenario.config || {},config);
 const media=new MediaEvidence({now:()=>now});
 const engine=new Engine({config:finalConfig,ai,now:()=>now,random:()=>0.5,
  liveData:()=>income ? {income:{...income,anchorId:'10001',roomId:'eval-room',at:scenario.stale ? now-300000 : now}} : {},
  mediaContext:()=>media.context(60),send:async()=>{sent++;throw new Error('评测禁止真实发送');},
  log:(kind,text)=>{if(kind==='preview')replies.push({text,valid:cleanMessage(text,finalConfig).ok});else diagnostics.push({kind,text});}});
 engine.setIdentity({self:{id:'eval-self',name:'场控'}});engine.start();
 engine.contextChat=(scenario.fixture?.context?.context || []).map(row=>({...row,at:now}));
 for(const text of scenario.fixture?.context?.recentReplies || [])engine.duplicates.set(text,now-20000);
 if(scenario.quota)engine.calls=Array(finalConfig.ai.maxPerHour).fill(now);
 const waitIdle=async()=>{
  const deadline=Date.now()+125000;
  do{await flush();if(Date.now()>deadline)throw new Error('Agent评测等待超时');
   if(engine.aiBusy || engine.researchAI.size)await new Promise(resolve=>setTimeout(resolve,10));
  }while(engine.aiBusy || engine.researchAI.size);
 };
 try{
  for(let turn=0;turn<(scenario.turns || 1);turn++){
   if(scenario.trigger==='speech'){
    media.add({id:'visual',kind:'omni',at:now-1000,endedAt:now,frameCount:1,text:scenario.visual});
    media.add({id:'speech',kind:'audio',at:now-500,endedAt:now,text:scenario.question,isFinal:true});
    engine.requestProactive(now);if(scenario.duplicate)engine.requestProactive(now);
   }else{
    const event={type:'chat',id:`eval-${turn}`,user:{id:`viewer-${turn}`,name:'测试提问'},text:scenario.direct===false ? scenario.question : `@场控 ${turn && scenario.followupQuestion ? scenario.followupQuestion : scenario.question}`,...(scenario.mentions ? {mentions:scenario.mentions} : {})};
    engine.ingest(event);if(scenario.duplicate)engine.ingest(event);
   }
   if(['cancel','late'].includes(scenario.fault)){
    for(let i=0;i<100 && !calls;i++)await flush();
    engine.stop();if(scenario.fault==='late')late?.();
   }
   await waitIdle();
   await engine.tick();
   if(turn+1<(scenario.turns || 1)){now+=130000;}
  }
  const result={id:scenario.id,label:scenario.label,question:scenario.question,output:replies.map(row=>row.text).join('\n'),replies,calls,searches,sent,
   pending:Number(Boolean(engine.activeAI))+engine.researchAI.size+engine.queue.length,
   aborted,faultInjected:Boolean(scenario.fault),intents,lookups,diagnostics};
  result.checks=assessAgentResult(result,scenario);
  if(scenario.criteria)result.checks.push(...evaluateReply({status:replies.length ? 'succeeded' : 'failed',answer:result.output},scenario));
  if(scenario.intents)result.checks.push({label:'意图符合问题类型',pass:intents.some(intent=>scenario.intents.includes(intent))});
  if(scenario.sources===true)result.checks.push({label:'实际查证且有有效引用',pass:lookups.some(row=>row.results?.length && /\[\d+\]/u.test(row.answer) && !row.citationWarning)});
  result.passed=result.checks.every(row=>row.pass);return result;
 }finally{engine.stop();knowledge.close();}
}

async function runResearchCase(scenario,{key,workspaceId,request}){
 const values=new Map(),room='evaluation',anchor='10001';let calls=0,searches=0;
 const config=mergeConfig({anchorId:anchor,ai:{enabled:true,pipeline:{mode:'omni-only',workspaceId},search:{enabled:true}}});
 values.set(`live-assistant:config:${room}`,config);
 const transport=details=>{
  if(details.operation!=='search'){calls++;return request(details);}
  searches++;details.onload({status:200,responseText:JSON.stringify({code:200,data:{webPages:{value:scenario.sources.map(row=>({name:row.title,url:row.url,summary:row.content}))}}})});
 };
 const tasks=createLocalAgentTasks({room,anchor:()=>anchor,request:transport,getKey:kind=>kind==='search' ? 'fixture-key' : key,
  get:(name,fallback)=>structuredClone(values.get(name) ?? fallback),set:(name,value)=>values.set(name,structuredClone(value))});
 try{
  const job={id:'evaluation-task',question:scenario.question,input:{anchor,ai:config.ai,context:{now:1793764800000},sources:[]}};
  await tasks.submit(job);if(scenario.duplicate)await tasks.submit(job);
  const deadline=Date.now()+95000;let row;
  do{row=(await tasks.list())[0];if(['succeeded','failed','cancelled','interrupted'].includes(row?.status))break;
   if(Date.now()>deadline)throw new Error('后台评测等待超时');await new Promise(resolve=>setTimeout(resolve,10));
  }while(true);
  const output=row.result?.answer || '',stored=values.get(`live-assistant:ai-tasks:${room}`) || [];
  const result={id:scenario.id,label:scenario.label,question:scenario.question,output,replies:output ? [{text:output,valid:output.length<=1000}] : [],calls,searches,sent:0,
   pending:(await tasks.list()).filter(r=>['queued','running'].includes(r.status)).length,aborted:0,faultInjected:false,taskCount:stored.length,
   secretStored:JSON.stringify(stored).includes(key),status:row.status,trace:row.trace,sources:row.result?.sources || [],diagnostics:row.error ? [{kind:'error',text:row.error}] : []};
  result.checks=[...assessAgentResult(result,scenario),{label:'后台任务持久保存成功',pass:row.status==='succeeded' && stored.length===1},
   {label:'密钥不写入任务记录',pass:!result.secretStored},{label:'来源贯通后台结果',pass:result.sources.length>0 && /\[1\]/u.test(output)}];
  result.passed=result.checks.every(r=>r.pass);return result;
 }finally{tasks.close();}
}

export default class LiveAgentProvider{
 id(){return 'douyin-live-agent';}
 async callApi(prompt){
  const scenario=AGENT_EVAL_CASES.find(row=>row.id===prompt.trim());
  if(!scenario)throw new Error('未知Agent评测场景');
  const result=await runAgentCase(scenario,{key:process.env.QWEN_API_KEY,workspaceId:process.env.QWEN_WORKSPACE_ID});
  if(process.env.AGENT_EVAL_OUTPUT){const {appendFile}=await import('node:fs/promises');await appendFile(`${process.env.AGENT_EVAL_OUTPUT}/cases.jsonl`,JSON.stringify(result)+'\n');}
  console.log(`[Agent] ${scenario.id}: ${result.passed ? 'PASS' : 'FAIL'} (${result.calls} model, ${result.searches} search)`);
  return {output:JSON.stringify(result),metadata:{scenario:scenario.id,faultInjected:result.faultInjected}};
 }
}
