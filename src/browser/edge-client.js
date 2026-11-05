import {semanticMessages,parseSemanticLabels} from '../analytics/ai.js';
import {makeEdgeMessages} from '../ai/edge-prompt.js';
import {currentAIPrompt,liveFactFingerprint} from '../services/ai-context.js';

export function createEdgeClient({connect,pollMs=1000}){
 let port;const pending=new Map(),observers=new Set(),watchers=new Set();
 const notify=state=>{for(const listener of observers)try{listener(state);}catch{}return state;};
 const failure=()=>{for(const job of pending.values())job.finish(new Error('端侧连接已断开，请重新准备模型'));port=null;};
 const call=(action,data={},signal,timeout=12000)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new Error('端侧请求已取消'));return;}
  if(!port){const active=port=connect();active.onMessage.addListener(m=>{if(port!==active)return;if(m.type==='edge-state'){notify(m.value);return;}const job=pending.get(m.id);if(job)job.finish(m.error ? new Error(m.error) : null,m.value);});active.onDisconnect.addListener(()=>{if(port===active)failure();});}
  const id=crypto.randomUUID();let timer;
  const finish=(error,value)=>{if(!pending.has(id))return;pending.delete(id);clearTimeout(timer);signal?.removeEventListener('abort',abort);error ? reject(error) : resolve(value);};
  const abort=()=>{if(action==='infer')port?.postMessage({action:'cancel',id});finish(new Error('端侧请求已取消'));};
  pending.set(id,{finish});signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{if(action==='infer')port?.postMessage({action:'cancel',id});finish(new Error('端侧服务响应超时，后台准备不会取消'));},timeout);
  try{port.postMessage({id,action,...data});}catch(error){finish(error);}
 });
 const status=async()=>notify(await call('status'));
 const prepare=async(kind,selection='auto')=>{
  const controller=new AbortController();watchers.add(controller);
  try{
   let state=await call('prepare',{kind,model:selection},controller.signal);
   while(['queued','loading'].includes(state?.phase)){
    await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new Error('页面已关闭，后台准备继续'));};const timer=setTimeout(()=>{controller.signal.removeEventListener('abort',abort);resolve();},pollMs);controller.signal.addEventListener('abort',abort,{once:true});if(controller.signal.aborted)abort();});
    state=(await status())[kind];
   }
   if(controller.signal.aborted)throw new Error('页面已关闭，后台准备继续');
   if(state?.phase==='error' || state?.phase==='released')throw new Error(state.error || '模型准备已停止');return state;
  }finally{watchers.delete(controller);}
 };
 return {detect:()=>call('device'),status,subscribe:listener=>{observers.add(listener);return ()=>observers.delete(listener);},ready:async kind=>{try{return (await status())?.[kind]?.phase==='ready';}catch{return false;}},
  prepare,release:()=>call('release'),
  reply:async(p,c)=>{const fresh=currentAIPrompt(p),facts=liveFactFingerprint(fresh.liveContext),limit=p.intentRouting ? 600 : Math.min(p.maxLength || 50,50);const text=await call('infer',{kind:'text',messages:makeEdgeMessages(fresh,c),maxLength:limit,intentRouting:Boolean(p.intentRouting)},p.signal);if(typeof text!=='string' || !text.trim() || [...text].length>limit)throw new Error('端侧回复未通过长度检查');if(!p.intentRouting && !p.searchResults)p.onLiveFacts?.(facts);return text.trim();},
  classify:async(text,signal)=>parseSemanticLabels(await call('infer',{kind:'text',messages:semanticMessages(text),maxLength:40},signal)),
  transcribe:(sample,signal)=>call('infer',{kind:'audio',data:sample.data},signal),
  close:()=>{for(const controller of watchers)controller.abort();watchers.clear();observers.clear();const active=port;failure();active?.disconnect();}};
}
