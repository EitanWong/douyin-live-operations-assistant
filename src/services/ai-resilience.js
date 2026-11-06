import {circuitBreaker,handleWhen,ConsecutiveBreaker} from 'cockatiel';

export const LATENCY_DEFAULTS=Object.freeze({cloudMs:8000,totalMs:16000,edgeDelayMs:1500});
export const RESEARCH_TIMEOUT_MS=120000;
export const EDGE_DEFAULTS=Object.freeze({enabled:true,audioEnabled:true,visionEnabled:true,audioBackend:'auto',textModel:'auto',autoTune:true,localOnly:false,maxPerHour:1200});
const cancelled=()=>Object.assign(new Error('AI 请求已取消'),{name:'AbortError'});
export function withDeadline(run,{signal,timeout=16000}={}){
 const controller=new AbortController(),started=Date.now();let timer,listener;
 const interrupt=new Promise((_,reject)=>{
  listener=()=>{reject(cancelled());controller.abort();};
  if(signal?.aborted){listener();return;}
  signal?.addEventListener('abort',listener,{once:true});
  const schedule=()=>{
   const remaining=(typeof timeout==='function' ? timeout() : timeout)-(Date.now()-started);
   if(remaining>0){timer=setTimeout(schedule,remaining);return;}
   reject(Object.assign(new Error('AI 请求超时'),{code:'TIMEOUT'}));controller.abort();
  };
  if(!signal?.aborted)schedule();
 });
 let work;try{work=signal?.aborted ? interrupt : run(controller.signal);}catch(error){work=Promise.reject(error);}
 return Promise.race([interrupt,work])
  .finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',listener);});
}
export function createResilientAI({cloud,edge,onTrace=()=>{},now=Date.now}){
 const circuits=new Map(),quotaPauses=new Map();
 const breaker=config=>{
  const key=JSON.stringify([config.endpoint,config.model]);
  if(!circuits.has(key)){
   if(circuits.size===8)circuits.delete(circuits.keys().next().value);
   circuits.set(key,circuitBreaker(handleWhen(e=>e.name!=='AbortError' && ![400,401,402,403,404].includes(e.status)),{halfOpenAfter:30000,breaker:new ConsecutiveBreaker(2)}));
  }
  return circuits.get(key);
 };
 return async(prompt,config)=>{
  let researching=false;
  const onLookup=record=>{researching=true;prompt.onLookup?.(record);};
  const started=now(),limits={...LATENCY_DEFAULTS,...config.latency,...(config.edge?.autoTune ? edge?.tuning?.() : {})},current=()=>!prompt.signal?.aborted && (!prompt.isCurrent || prompt.isCurrent());
  const trace=(provider,status)=>{try{onTrace({provider,status,elapsedMs:now()-started,kind:prompt.task?.kind || 'ai',at:now()});}catch{}};
  const cloudSignal=new AbortController(),edgeSignal=new AbortController();
  const abort=()=>{cloudSignal.abort();edgeSignal.abort();};
  prompt.signal?.addEventListener('abort',abort,{once:true});
  const provider=JSON.stringify([config.pipeline?.mode,config.pipeline?.workspaceId,config.pipeline?.region,config.endpoint,config.model,config.pipeline?.replyModel]);
  const cloudWork=async()=>{
   if(prompt.cloudAllowed===false || config.edge?.localOnly || (quotaPauses.get(provider) || 0)>now())throw new Error('云端额度暂停或使用本地模式，需要已准备的端侧模型');
   try{return await breaker(config).execute(()=>withDeadline(signal=>cloud({...prompt,signal,onLookup},config,{signal}),{signal:cloudSignal.signal,timeout:()=>researching ? RESEARCH_TIMEOUT_MS : config.edge?.enabled ? limits.cloudMs : limits.totalMs}));}
   catch(error){if(error.aiQuota || error.status===402){if(quotaPauses.size>=8)quotaPauses.delete(quotaPauses.keys().next().value);quotaPauses.set(provider,now()+300000);}throw error;}
  };
  try{
   if(prompt.signal?.aborted)throw cancelled();
   let result;
   try{result={output:await cloudWork(),provider:'cloud'};}
   catch(error){
    if(!current())throw cancelled();
    // Cloud owns the request until it fails or reaches its deadline.
    if(researching || !config.edge?.enabled || !edge || !await edge.ready('text'))throw error;
    if(!current())throw cancelled();
    if(prompt.reserveLocal && !prompt.reserveLocal())throw new Error('本地推理调用额度已达上限');
    const beforeLocal=now()-started,remaining=limits.totalMs-beforeLocal;
    if(remaining<=0)throw new Error('AI 请求超时');
    const output=await withDeadline(signal=>edge.reply({...prompt,signal,onLookup},config),{signal:edgeSignal.signal,timeout:()=> (researching ? RESEARCH_TIMEOUT_MS : limits.totalMs)-beforeLocal});
    result={output,provider:'edge'};
   }
   if(!current())throw cancelled();
   trace(result.provider,'ok');return result.output;
  }catch(error){if(!current())throw cancelled();trace('cloud',error.code==='TIMEOUT' ? 'timeout' : 'unavailable');throw error;}
  finally{prompt.signal?.removeEventListener('abort',abort);abort();}
 };
}
