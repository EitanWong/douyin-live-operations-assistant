import {validateRealtimeEndpoint} from '../src/services/ai-pipeline.js';
import {roomFromURL} from '../src/browser/room-context.js';

export const NATIVE_HOST='com.douyin_live_assistant.perception';
export function installNativePerceptionBridge(chrome){
  const rooms=new Set();
  chrome.runtime.onConnect?.addListener(client=>{
    if(client.name!=='native-perception')return;
    const sender=client.sender;let room;
    try{
      const url=new URL(sender?.tab?.url);
      if(sender.frameId!==0 || !Number.isInteger(sender.tab.id) || url.origin!=='https://live.douyin.com' || sender.id && sender.id!==chrome.runtime.id || sender.url && new URL(sender.url).href!==url.href)throw new Error();
      room=roomFromURL(url);if(!room)throw new Error();
    }catch{client.disconnect();return;}
    let host,closed=false,started=false;
    const send=value=>{if(!closed)try{client.postMessage(value);}catch{close();}};
    const close=()=>{if(closed)return;closed=true;if(started)rooms.delete(room);try{host?.postMessage({type:'stop'});}catch{}try{host?.disconnect();}catch{}};
    const fail=code=>{send({type:'error',code});close();try{client.disconnect();}catch{}};
    client.onDisconnect.addListener(close);
    client.onMessage.addListener(message=>{
      if(closed)return;
      if(message?.type==='stop'){close();return;}
      if(message?.type==='probe' && !host){
        try{
          host=chrome.runtime.connectNative(NATIVE_HOST);
          host.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(!closed)fail('NOT_INSTALLED');});
          host.onMessage.addListener(event=>{if(event?.type==='health' && event.ready===true)send({type:'health',ready:true});else fail('NOT_INSTALLED');});
          host.postMessage({type:'probe'});
        }catch{fail('NOT_INSTALLED');}
        return;
      }
      if(host || started || message?.type!=='start' || message.room!==room){fail('INVALID');return;}
      try{
        const c=message.config;
        validateRealtimeEndpoint(c?.realtimeEndpoint);
        if(c.inputSource!=='native' || c.transport!=='webrtc' || new URL(c.realtimeEndpoint).searchParams.get('model')!==c.realtimeModel || !/^[^\s]{1,1000}$/u.test(message.key || '') || !Number.isInteger(c.sessionMinutes) || c.sessionMinutes<1 || c.sessionMinutes>60 || !Number.isInteger(c.sessionTokens) || c.sessionTokens<1000 || c.sessionTokens>1000000 || !Number.isInteger(c.maxPerHour) || c.maxPerHour<1 || c.maxPerHour>1200)throw new Error();
        if(rooms.has(room)){fail('BUSY');return;}
        host=chrome.runtime.connectNative(NATIVE_HOST);started=true;rooms.add(room);
        host.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(!closed)fail('NOT_INSTALLED');});
        host.onMessage.addListener(event=>{
          if(closed)return;
          if(event?.type==='error'){fail(['RESOLVE_FAILED','DECODE_FAILED','MODEL_FAILED','LIMIT','INVALID'].includes(event.code) ? event.code : 'MODEL_FAILED');return;}
          if(event?.type==='ready')send({type:'ready'});
          if(event?.type==='state' && ['resolving','connecting','decoding','observing','recovering'].includes(event.phase))send({type:'state',phase:event.phase,...(Number.isFinite(event.totalTokens) ? {totalTokens:event.totalTokens} : {}),...(Number.isFinite(event.lastFinalAt) ? {lastFinalAt:event.lastFinalAt} : {})});
          const r=event?.row;
          if(event?.type==='observation' && ['audio','omni'].includes(r?.kind) && typeof r.text==='string' && r.text.length<=1800 && typeof r.id==='string' && r.id.length<=300)send({type:'observation',row:{kind:r.kind,id:r.id,at:r.at,endedAt:r.endedAt,text:r.text}});
        });
        host.postMessage({type:'start',room,key:message.key,config:c});
      }catch{fail('NOT_INSTALLED');}
    });
  });
}
