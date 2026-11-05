// One capture owns the source; replacement provider sessions borrow its tracks.
// This keeps display sharing inside the original user activation.
export function createRenewingCapture({capture,sourceFactory,env=globalThis,now=Date.now,renewDelayMs=1000}){
 return options=>new Promise((resolve,reject)=>{
  const {config,signal,onObservation,onProgress=()=>{},onError=()=>{},onEnded=()=>{},isCurrent=()=>true}=options;
  let closed=false,source,timer,child,active,generation=0,ready=false;
  const tracks=[];
  const accept=()=>{if(!ready){ready=true;resolve({stop});}};
  const stop=error=>{
   if(closed)return;closed=true;generation++;clearTimeout(timer);child?.abort();active?.stop();
   signal?.removeEventListener('abort',stop);for(const track of tracks)track.removeEventListener('ended',ended);source?.stop();
   if(!ready)reject(error instanceof Error ? error : new Error('实时识别已停止'));
  };
  const fail=error=>{if(closed)return;const running=ready;stop(error);if(running){onError(error);onEnded();}};
  const ended=()=>{if(!closed){stop();onEnded();}};
  const run=()=>{
   if(closed || !isCurrent()){stop();return;}
   const token=++generation;child=new AbortController();
   const current=()=>!closed && generation===token && isCurrent();
   const recover=error=>{
    if(!current())return;
    if(!['session','hour'].includes(error.mediaRenewal)){fail(error);return;}
    generation++;child.abort();active?.stop();active=null;
    const delay=error.mediaRenewal==='hour' ? Math.max(renewDelayMs,(error.retryAt || now()+60000)-now()) : renewDelayMs;
    onProgress({phase:error.mediaRenewal==='hour' ? 'waiting' : 'renewing',retryAt:now()+delay});accept();
    timer=setTimeout(run,delay);
   };
   Promise.resolve().then(()=>capture({...options,config:{...config,inputSource:'direct'},sharedSource:{stream:source.stream,source:source.source,stop(){}},signal:child.signal,isCurrent:current,
    onObservation:row=>{if(current())onObservation(row);},onProgress:state=>{if(current())onProgress(state);},onError:recover,
    onEnded:()=>{if(current()){stop();onEnded();}}
   })).then(handle=>{if(!current()){handle?.stop();return;}active=handle;accept();onProgress({phase:'observing'});},recover);
  };
  signal?.addEventListener('abort',stop,{once:true});
  if(signal?.aborted || !isCurrent()){stop();return;}
  try{
   const acquisition=config.inputSource!=='display' && sourceFactory ? sourceFactory({...options,onError:fail,onEnded:ended}) : env.navigator.mediaDevices.getDisplayMedia({video:true,audio:true,preferCurrentTab:true,systemAudio:'exclude'}).then(stream=>({stream,source:'display',stop:()=>{for(const track of stream.getTracks())track.stop();}}));
   Promise.resolve(acquisition).then(value=>{source=value;if(closed){source.stop();return;}for(const track of source.stream.getTracks?.() || []){tracks.push(track);track.addEventListener('ended',ended,{once:true});}run();},fail);
  }catch(error){fail(error);}
 });
}
