import { DouyinAdapter } from '../src/browser/adapter.js';
import { DEFAULTS, copy } from '../src/core/engine.js';
import { RoomContext } from '../src/browser/room-context.js';

// MAIN remains page-owned. Publish only native observations captured in closure;
// the public facade cannot enqueue an event or supply a request result.
const roomContext=new RoomContext(window),room=roomContext.room;
if(room && !Object.hasOwn(window,'__douyinAssistantPageV2')) {
  const events=[],priority=[],captures=[],jobs=new Map(),canceled=new Set();let eventBytes=0,captureBytes=0,bridgeGaps=0,captureGaps=0;
  const enqueue=(queue,value,capture=false)=>{
    let bytes;
    try {bytes=JSON.stringify(value).length*2;} catch {bytes=null;}
    if(bytes==null || (capture?captures.length>=256 || captureBytes+bytes>8*1024*1024:events.length+priority.length>=4096 || eventBytes+bytes>8*1024*1024)) {
      if(capture)captureGaps++;else bridgeGaps++;return;
    }
    queue.push({value,bytes});if(capture)captureBytes+=bytes;else eventBytes+=bytes;
  };
  const take=(queue,limit,capture=false)=>{
    const result=[];let bytes=0;
    while(queue.length && result.length<limit && (result.length===0 || bytes+queue[0].bytes<=1024*1024)) {
      const item=queue.shift();result.push(item.value);bytes+=item.bytes;
      if(capture)captureBytes-=item.bytes;else eventBytes-=item.bytes;
    }
    return result;
  };
  const adapter=new DouyinAdapter({page:window,getConfig:()=>copy(DEFAULTS),onLog:()=>{},onStatus:()=>{},
    onCapture:record=>enqueue(captures,record,true),onPK:event=>enqueue(priority,event),
    onEvent:event=>{if(!event.type.startsWith('pk-'))enqueue(events,event);}});
  const send=async command=>{
    const {operation,channel,token,text,action,target,count,sequence,id}=command,sender=adapter.requestSender;
    if(typeof id!=='string' || id.length>64 || jobs.has(id) || jobs.size>=128)throw new Error('请求标识无效');
    if(canceled.delete(id))return operation.startsWith('prepare')?{available:false}:{submitted:false};
    const controller=new AbortController();jobs.set(id,controller);
    try {
      if(operation==='prepare-like')return await sender.prepareLike({signal:controller.signal});
      if(operation==='prepare-moderation')return await sender.prepareModeration(action,target);
      if(operation==='prepare')return await sender.prepare(channel);
      if(typeof token!=='string' || token.length>64)return {submitted:false};
      if(operation==='commit-like')return await sender.commitLike(token,count,sequence,{signal:controller.signal});
      if(operation==='stop-like')return await sender.stopLike(token);
      if(operation==='commit-moderation')return await sender.commitModeration(token);
      if(operation==='commit' && typeof text==='string' && text.length<=200)return await sender.commit(token,text);
      return {submitted:false,reason:'请求参数无效'};
    } finally {jobs.delete(id);}
  };
  const call=command=>{
    if(!roomContext.current())throw new Error('直播间已切换');
    if(command.type==='drain')return {events:command.paused?[]:take(events,128),priority:take(priority,128),captures:take(captures,32,true),
      more:(!command.paused && events.length>0)||priority.length>0||captures.length>0,
      status:{...adapter.status,bridgeGaps,bridgePending:events.length+priority.length,captureBridgeGaps:captureGaps,captureBridgePending:captures.length}};
    if(command.type==='cancel'){
      if(jobs.has(command.id))jobs.get(command.id).abort();
      else {canceled.add(command.id);if(canceled.size>128)canceled.delete(canceled.values().next().value);}
      return true;
    }
    if(command.type==='send-api')return send(command);
    if(command.type==='collection-pulse'){adapter.collectionGuard?.tick();return adapter.status.collection?.active===true;}
    if(command.type==='collection-stop'){adapter.collectionGuard?.stop();return true;}
    throw new Error('页面调用类型无效');
  };
  Object.defineProperty(window,'__douyinAssistantPageV2',{value:Object.freeze({room,call}),writable:false,configurable:false});
  window.addEventListener('pagehide',()=>{for(const controller of jobs.values())controller.abort();});
  adapter.hook();
}
