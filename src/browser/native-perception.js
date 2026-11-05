import {validateRealtimeEndpoint} from '../services/ai-pipeline.js';

const messages={NOT_INSTALLED:'未连接本地感知组件。请按“本地组件安装”说明安装后重试。',RESOLVE_FAILED:'无法解析本房原始直播流，请检查直播状态、本地网络或本地组件的 Cookie 配置。',DECODE_FAILED:'原始流无法连续解码，已停止；请检查本地 FFmpeg 和直播状态。',MODEL_FAILED:'Omni 实时连接失败，请检查百炼地域、业务空间、模型权限和密钥。',LIMIT:'实时识别额度或会话时长已用完，已停止。',BUSY:'此直播间已有原生识别任务，请先停止另一页面的识别。',INVALID:'本地感知配置无效，请选择 Omni 实时组合并检查配置。'};
export function readNativeSession(connect){
  return new Promise((resolve,reject)=>{
    let port,done=false;
    const finish=(value,error)=>{if(done)return;done=true;clearTimeout(timer);try{port?.disconnect();}catch{}error ? reject(error) : resolve(value);};
    const timer=setTimeout(()=>finish(null,new Error(messages.NOT_INSTALLED)),5000);
    try{
      port=connect();port.onDisconnect.addListener(()=>finish(null,new Error(messages.NOT_INSTALLED)));
      port.onMessage.addListener(event=>{if(event?.type==='session')finish(event);});
      port.postMessage({type:'status'});
    }catch(error){finish(null,error);}
  });
}
export function checkNativeComponent(connect){
  return new Promise((resolve,reject)=>{
    let port,done=false;
    const finish=error=>{if(done)return;done=true;clearTimeout(timer);try{port?.disconnect();}catch{}error ? reject(error) : resolve('本地感知组件已就绪 · StreamGet + FFmpeg + Omni WebSocket');};
    const timer=setTimeout(()=>finish(new Error(messages.NOT_INSTALLED)),10000);
    try{
      if(!connect)throw new Error(messages.NOT_INSTALLED);
      port=connect();port.onDisconnect.addListener(()=>finish(new Error(messages.NOT_INSTALLED)));
      port.onMessage.addListener(e=>{if(e?.type==='health' && e.ready===true)finish();else if(e?.type==='error')finish(new Error(messages.NOT_INSTALLED));});
      port.postMessage({type:'probe'});
    }catch{finish(new Error(messages.NOT_INSTALLED));}
  });
}
export function createNativeCapture({connect,getKey,room,now=Date.now,setupTimeoutMs=90000,onMemoryWarning=()=>{}}){
  return ({config,signal,isCurrent=()=>true,onObservation,onProgress=()=>{},onError=()=>{},onEnded=()=>{}})=>new Promise((resolve,reject)=>{
    let port,closed=false,ready=false,timer;
    const active=()=>!closed && isCurrent();
    const close=(error,detach=false)=>{
      if(closed)return;closed=true;clearTimeout(timer);signal?.removeEventListener('abort',stop);
      try{port?.postMessage({type:detach ? 'detach' : 'stop'});}catch{}try{port?.disconnect();}catch{}
      if(!ready)reject(error);
    };
    const stop=()=>close(new Error('原生直播感知已停止'),signal?.reason==='detach');
    const fail=code=>{if(!active())return;const error=new Error(messages[code] || messages.MODEL_FAILED);const running=ready;close(error);if(running){onError(error);onEnded();}};
    try{
      if(signal?.aborted){stop();return;}
      if(typeof connect!=='function')throw new Error('原生直播感知仅支持已安装本地组件的 Chrome 扩展；油猴和演示可选择浏览器直连。');
      const endpoint=validateRealtimeEndpoint(config.realtimeEndpoint),key=getKey(`${new URL(endpoint).origin}/compatible-mode/v1/chat/completions`);
      if(!key && !config.resume)throw new Error('请填写百炼 API Key');
      port=connect();
      port.onDisconnect.addListener(()=>fail('NOT_INSTALLED'));
      port.onMessage.addListener(event=>{
        if(!active())return;
        if(event?.type==='memory-warning'){onMemoryWarning('感知记忆保存失败，原文保留待重试；请检查本地存储空间。');return;}
        if(event?.type==='error'){fail(event.code);return;}
        if(event?.type==='ready' && !ready){ready=true;clearTimeout(timer);resolve({stop});return;}
        if(event?.type==='state')onProgress({phase:event.phase,totalTokens:event.totalTokens,lastFinalAt:event.lastFinalAt});
        const r=event?.row;
        if(event?.type==='observation' && ready && ['audio','video','omni'].includes(r?.kind) && typeof r.text==='string' && r.text.length<=1800 && typeof r.id==='string' && r.id.length<=300 && Number.isFinite(r.at) && Number.isFinite(r.endedAt) && r.endedAt>=r.at && r.at>=now()-180000 && r.endedAt<=now()+5000){
          onObservation({kind:r.kind,id:r.id,at:r.at,endedAt:r.endedAt,receivedAt:now(),text:r.text,isFinal:true,model:config.realtimeModel,transport:'websocket',inputSource:'native'});
        }
      });
      signal?.addEventListener('abort',stop,{once:true});
      timer=setTimeout(()=>fail('NOT_INSTALLED'),setupTimeoutMs);
      port.postMessage(config.resume ? {type:'resume',room} : {type:'start',room,key,config:{inputSource:'native',transport:config.transport,realtimeEndpoint:endpoint,realtimeModel:config.realtimeModel,sessionMinutes:config.sessionMinutes,sessionTokens:config.sessionTokens,maxPerHour:config.maxPerHour,videoIntervalSec:config.videoIntervalSec ?? 12}});
    }catch(error){close(error);}
  });
}
