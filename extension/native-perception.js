import {validateRealtimeEndpoint} from '../src/services/ai-pipeline.js';
import {roomFromURL} from '../src/browser/room-context.js';

export const NATIVE_HOST='com.douyin_live_assistant.perception';

function senderRoom(client,chrome){
  const sender=client.sender,url=new URL(sender?.tab?.url);
  if(sender.frameId!==0 || !Number.isInteger(sender.tab.id) || url.origin!=='https://live.douyin.com' || sender.id && sender.id!==chrome.runtime.id || sender.url && new URL(sender.url).href!==url.href)throw new Error();
  const room=roomFromURL(url);if(!room)throw new Error();return room;
}
function nativeSettings(message,room){
  const c=message.config;
  validateRealtimeEndpoint(c?.realtimeEndpoint);
  const videoIntervalSec=c.videoIntervalSec ?? 12;
  if(!Number.isInteger(videoIntervalSec) || videoIntervalSec<5 || videoIntervalSec>120)throw new Error();
  if(message.room!==room || c.inputSource!=='native' || c.transport!=='webrtc' || new URL(c.realtimeEndpoint).searchParams.get('model')!==c.realtimeModel || !/^[^\s]{1,1000}$/u.test(message.key || '') || !Number.isInteger(c.sessionMinutes) || c.sessionMinutes<1 || c.sessionMinutes>60 || !Number.isInteger(c.sessionTokens) || c.sessionTokens<1000 || c.sessionTokens>1000000 || !Number.isInteger(c.maxPerHour) || c.maxPerHour<1 || c.maxPerHour>1200)throw new Error();
  return {inputSource:'native',transport:c.transport,realtimeEndpoint:c.realtimeEndpoint,realtimeModel:c.realtimeModel,sessionMinutes:c.sessionMinutes,sessionTokens:c.sessionTokens,maxPerHour:c.maxPerHour,videoIntervalSec};
}

// The native connection belongs to the room, not to a page or settings module.
// A live native port keeps the MV3 worker alive while pages detach and return.
export function installNativePerceptionBridge(chrome,{onObservation,onStart=()=>null,memoryRetryMs=1000}={}){
  const rooms=new Map();
  const stopKey=room=>`live-assistant:native-stopped:${room}`;
  let stopWrites=Promise.resolve();
  const rememberStop=(room,stopped)=>{
    const write=()=>chrome.storage?.session?.set({[stopKey(room)]:stopped});
    stopWrites=stopWrites.then(write,write);void stopWrites.catch(()=>{});
  };
  const detach=channel=>{
    if(channel.closed)return;channel.closed=true;
    if(channel.session?.channel===channel)channel.session.channel=null;
    try{channel.probe?.disconnect();}catch{}
  };
  const disconnect=channel=>{detach(channel);try{channel.client.disconnect();}catch{}};
  const send=(channel,value)=>{if(channel && !channel.closed)try{channel.client.postMessage(value);}catch{disconnect(channel);}};
  const saveMemory=async session=>{
    if(session.memoryWriting || !session.pendingMemory.length)return;
    session.memoryWriting=true;
    try{
      while(session.pendingMemory.length){
        session.memoryScope ||= Promise.resolve().then(()=>onStart(session.room));
        let scope;try{scope=await session.memoryScope;}catch(error){session.memoryScope=null;throw error;}
        await onObservation(session.room,session.pendingMemory[0],scope);session.pendingMemory.shift();
      }
      session.memoryFailed=false;
    }catch{
      if(!session.memoryFailed)send(session.channel,{type:'memory-warning'});
      session.memoryFailed=true;setTimeout(()=>void saveMemory(session),memoryRetryMs);
    }finally{session.memoryWriting=false;}
  };
  const finish=(session,code)=>{
    if(session.closed)return;session.closed=true;
    // Remember a manual stop or terminal failure across reloads, without secrets.
    rooms.set(session.room,{stopped:true});
    rememberStop(session.room,true);
    try{session.host.postMessage({type:'stop'});}catch{}
    try{session.host.disconnect();}catch{}
    if(code)send(session.channel,{type:'error',code});
    if(session.channel)disconnect(session.channel);
  };
  const fail=(channel,code)=>{send(channel,{type:'error',code});disconnect(channel);};
  const subscribe=(channel,session)=>{
    if(session.channel && session.channel!==channel){fail(channel,'BUSY');return false;}
    channel.session=session;session.channel=channel;
    if(session.ready)send(channel,{type:'ready'});
    if(session.state)send(channel,session.state);
    if(session.memoryFailed)send(channel,{type:'memory-warning'});
    for(const row of session.rows)if(row.endedAt>=Date.now()-180000)send(channel,{type:'observation',row});
    return true;
  };
  const receive=(session,event)=>{
    if(session.closed)return;
    if(event?.type==='error'){
      finish(session,['RESOLVE_FAILED','DECODE_FAILED','MODEL_FAILED','LIMIT','INVALID'].includes(event.code) ? event.code : 'MODEL_FAILED');return;
    }
    if(event?.type==='ready'){session.ready=true;send(session.channel,{type:'ready'});}
    if(event?.type==='state' && ['resolving','connecting','decoding','observing','recovering','renewing','waiting'].includes(event.phase)){
      session.state={type:'state',phase:event.phase,...(Number.isFinite(event.totalTokens) ? {totalTokens:event.totalTokens} : {}),...(Number.isFinite(event.lastFinalAt) ? {lastFinalAt:event.lastFinalAt} : {})};
      send(session.channel,session.state);
    }
    const r=event?.row;
    if(event?.type==='observation' && ['audio','omni'].includes(r?.kind) && typeof r.text==='string' && r.text.length<=1800 && typeof r.id==='string' && r.id.length<=300 && Number.isFinite(r.at) && Number.isFinite(r.endedAt) && r.endedAt>=r.at){
      const row={kind:r.kind,id:r.id,at:r.at,endedAt:r.endedAt,text:r.text};
      if(onObservation){session.pendingMemory.push({...row,inputSource:'native'});void saveMemory(session);}
      session.rows.push(row);if(session.rows.length>20)session.rows.shift();
      send(session.channel,{type:'observation',row});
    }
  };
  const start=(channel,message)=>{
    let config;try{config=nativeSettings(message,channel.room);}catch{fail(channel,'INVALID');return;}
    if(rooms.get(channel.room)?.host){fail(channel,'BUSY');return;}
    try{
      const host=chrome.runtime.connectNative(NATIVE_HOST);
      const memoryScope=Promise.resolve().then(()=>onStart(channel.room));void memoryScope.catch(()=>{});
      const session={room:channel.room,host,config,channel:null,rows:[],ready:false,closed:false,pendingMemory:[],memoryWriting:false,memoryFailed:false,memoryScope};
      rooms.set(channel.room,session);subscribe(channel,session);
      rememberStop(channel.room,false);
      host.onDisconnect.addListener(()=>{void chrome.runtime.lastError;finish(session,'NOT_INSTALLED');});
      host.onMessage.addListener(event=>receive(session,event));
      host.postMessage({type:'start',room:channel.room,key:message.key,config});
    }catch{if(channel.session)finish(channel.session,'NOT_INSTALLED');else fail(channel,'NOT_INSTALLED');}
  };
  const probe=channel=>{
    if(channel.probe || channel.session){fail(channel,'INVALID');return;}
    try{
      const host=channel.probe=chrome.runtime.connectNative(NATIVE_HOST);
      host.onDisconnect.addListener(()=>{void chrome.runtime.lastError;if(!channel.closed)fail(channel,'NOT_INSTALLED');});
      host.onMessage.addListener(event=>{if(event?.type==='health' && event.ready===true)send(channel,{type:'health',ready:true});else fail(channel,'NOT_INSTALLED');});
      host.postMessage({type:'probe'});
    }catch{fail(channel,'NOT_INSTALLED');}
  };
  chrome.runtime.onConnect?.addListener(client=>{
    if(client.name!=='native-perception')return;
    let room;try{room=senderRoom(client,chrome);}catch{client.disconnect();return;}
    const channel={client,room,closed:false};
    client.onDisconnect.addListener(()=>detach(channel));
    client.onMessage.addListener(message=>{
      if(channel.closed)return;
      if(message?.type==='detach'){disconnect(channel);return;}
      if(message?.type==='stop'){if(channel.session?.channel===channel)finish(channel.session);else disconnect(channel);return;}
      if(message?.type==='status'){
        const session=rooms.get(room);
        if(session){send(channel,{type:'session',...(session.host ? {config:session.config} : {stopped:Boolean(session.stopped)})});return;}
        void stopWrites.catch(()=>{}).then(()=>chrome.storage?.session?.get(stopKey(room))).then(value=>send(channel,{type:'session',stopped:value?.[stopKey(room)]===true}),()=>fail(channel,'NOT_INSTALLED'));return;
      }
      if(message?.type==='resume'){
        const session=rooms.get(room);
        if(message.room!==room || !session?.host){fail(channel,'INVALID');return;}
        subscribe(channel,session);return;
      }
      if(message?.type==='probe'){probe(channel);return;}
      if(message?.type==='start' && !channel.session && !channel.probe){start(channel,message);return;}
      fail(channel,'INVALID');
    });
  });
}
