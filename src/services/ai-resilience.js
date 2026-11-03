import {circuitBreaker,handleWhen,ConsecutiveBreaker} from 'cockatiel';

export const LATENCY_DEFAULTS=Object.freeze({cloudMs:8000,totalMs:16000,edgeDelayMs:1500});
export const EDGE_DEFAULTS=Object.freeze({enabled:false,audioEnabled:false,audioBackend:'native-sensevoice'});
const cancelled=()=>Object.assign(new Error('AI 请求已取消'),{name:'AbortError'});
export function withDeadline(run,{signal,timeout=16000}={}){
 const controller=new AbortController();let timer,listener;
 const interrupt=new Promise((_,reject)=>{
  listener=()=>{reject(cancelled());controller.abort();};
  if(signal?.aborted){listener();return;}
  signal?.addEventListener('abort',listener,{once:true});
  timer=setTimeout(()=>{reject(Object.assign(new Error('AI 请求超时'),{code:'TIMEOUT'}));controller.abort();},Math.max(1,timeout));
 });
 let work;try{work=signal?.aborted ? interrupt : run(controller.signal);}catch(error){work=Promise.reject(error);}
 return Promise.race([interrupt,work])
  .finally(()=>{clearTimeout(timer);signal?.removeEventListener('abort',listener);});
}
export function createResilientAI({cloud,edge,onTrace=()=>{},now=Date.now}){
 const circuits=new Map();
 const breaker=config=>{
  const key=JSON.stringify([config.endpoint,config.model]);
  if(!circuits.has(key)){
   if(circuits.size===8)circuits.delete(circuits.keys().next().value);
   circuits.set(key,circuitBreaker(handleWhen(e=>e.name!=='AbortError' && ![400,401,402,403,404].includes(e.status)),{halfOpenAfter:30000,breaker:new ConsecutiveBreaker(2)}));
  }
  return circuits.get(key);
 };
 return async(prompt,config)=>{
  const started=now(),limits={...LATENCY_DEFAULTS,...config.latency},current=()=>!prompt.signal?.aborted && (!prompt.isCurrent || prompt.isCurrent());
  const trace=(provider,status)=>{try{onTrace({provider,status,elapsedMs:now()-started,kind:prompt.task?.kind || 'ai',at:now()});}catch{}};
  const cloudSignal=new AbortController(),edgeSignal=new AbortController();let delayTimer;
  const abort=()=>{cloudSignal.abort();edgeSignal.abort();};
  prompt.signal?.addEventListener('abort',abort,{once:true});
  const cloudWork=()=>breaker(config).execute(()=>withDeadline(signal=>cloud({...prompt,signal},config,{signal}),{signal:cloudSignal.signal,timeout:limits.cloudMs}));
  try{
   if(prompt.signal?.aborted)throw cancelled();
   const remote=cloudWork().then(output=>({output,provider:'cloud'}));let cloudFailure;
   const failed=remote.catch(error=>{cloudFailure=error;return null;});
   const local=(async()=>{
    const prepared=config.edge?.enabled && edge && await edge.ready('text');
    if(!prepared){await failed;throw cloudFailure || new Error('端侧未准备');}
    const completed=await Promise.race([failed,new Promise(resolve=>{delayTimer=setTimeout(()=>resolve(null),limits.edgeDelayMs);})]);
    if(completed)throw new Error('云端已完成');
    clearTimeout(delayTimer);if(!current() || edgeSignal.signal.aborted)throw cancelled();
    const remaining=limits.totalMs-(now()-started);if(remaining<=0)throw new Error('AI 请求超时');
    const output=await withDeadline(signal=>edge.reply({...prompt,signal},config),{signal:edgeSignal.signal,timeout:remaining});
    return {output,provider:'edge'};
   })();
   let winner;try{winner=await Promise.any([remote,local]);}catch{throw cloudFailure || new Error('AI 服务与端侧推理均不可用');}
   if(!current())throw cancelled();
   if(winner.provider==='edge')cloudSignal.abort();else edgeSignal.abort();
   trace(winner.provider,'ok');return winner.output;
  }catch(error){if(!current())throw cancelled();trace('cloud',error.code==='TIMEOUT' ? 'timeout' : 'unavailable');throw error;}
  finally{clearTimeout(delayTimer);prompt.signal?.removeEventListener('abort',abort);abort();}
 };
}
