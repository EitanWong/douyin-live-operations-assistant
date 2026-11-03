import {semanticMessages,parseSemanticLabels} from '../analytics/ai.js';
import {makeEdgeMessages} from '../ai/edge-prompt.js';
import {currentAIPrompt,liveFactFingerprint} from '../services/ai-context.js';
import {prepareRecommendedText} from '../ai/device-policy.js';

export function createEdgeClient({connect}){
 let port;const pending=new Map();
 const failure=()=>{for(const job of pending.values())job.finish(new Error('端侧连接已断开，请重新准备模型'));port=null;};
 const call=(action,data={},signal,timeout=12000)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new Error('端侧请求已取消'));return;}
  if(!port){const active=port=connect();active.onMessage.addListener(m=>{if(port!==active)return;const job=pending.get(m.id);if(job)job.finish(m.error ? new Error(m.error) : null,m.value);});active.onDisconnect.addListener(()=>{if(port===active)failure();});}
  const id=crypto.randomUUID();let timer;
  const finish=(error,value)=>{if(!pending.has(id))return;pending.delete(id);clearTimeout(timer);signal?.removeEventListener('abort',abort);error ? reject(error) : resolve(value);};
  const abort=()=>{port?.postMessage({action:'cancel',id});finish(new Error('端侧请求已取消'));};
  pending.set(id,{finish});signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>{port?.postMessage({action:'cancel',id});finish(new Error('端侧推理超时'));},timeout);
  try{port.postMessage({id,action,...data});}catch(error){finish(error);}
 });
 return {detect:()=>call('device'),status:()=>call('status'),ready:async kind=>{try{return (await call('status'))?.[kind]?.phase==='ready';}catch{return false;}},
  prepare:async(kind,selection='auto')=>kind==='text' ? prepareRecommendedText(selection,await call('device'),model=>call('prepare',{kind,model},undefined,240000)) : call('prepare',{kind},undefined,240000),release:()=>call('release'),
  reply:async(p,c)=>{const fresh=currentAIPrompt(p),facts=liveFactFingerprint(fresh.liveContext);const text=await call('infer',{kind:'text',messages:makeEdgeMessages(fresh,c),maxLength:Math.min(p.maxLength || 50,50)},p.signal);if(typeof text!=='string' || !text.trim() || [...text].length>(p.maxLength || 50))throw new Error('端侧回复未通过长度检查');p.onLiveFacts?.(facts);return text.trim();},
  classify:async(text,signal)=>parseSemanticLabels(await call('infer',{kind:'text',messages:semanticMessages(text),maxLength:40},signal)),
  transcribe:(sample,signal)=>call('infer',{kind:'audio',data:sample.data},signal),
  close:()=>{const active=port;failure();active?.disconnect();}};
}
