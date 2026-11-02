import {assign,createActor,createMachine,fromCallback} from 'xstate';

// The active actor owns the stream and cancellation token for both connecting
// and running. Leaving active always releases them, including late acquisition.
export function createMediaSession(owner){
  const capture=fromCallback(({input:session,sendBack})=>{
    let closed=false,source;
    const current=()=>!closed;
    const options={config:session.config,signal:session.controller.signal,isCurrent:current,
      onObservation:row=>{if(current())owner.onObservation(row);},
      onProgress:value=>{if(current())owner.onState({state:owner.state,skipped:owner.skipped,errors:owner.errors,...value});},
      onSample:sample=>owner.sample(sample,session.config,session),
      onEnded:()=>{if(current())sendBack({type:'STOP'});},
      onError:error=>{if(current())owner.error(error,'capture',session);},
      onSkip:()=>{if(current()){owner.skipped++;owner.notify();}}};
    try{
      const factory=session.config.transport==='webrtc' ? owner.realtimeCapture : owner.capture;
      if(!factory)throw new Error('实时识别服务未初始化');
      Promise.resolve(factory(options)).then(value=>{
        if(closed){value?.stop();return;}
        if(typeof value?.stop!=='function'){sendBack({type:'FAILED',error:new Error('识别服务未返回可释放的采集器')});return;}
        source=value;sendBack({type:'READY'});
      },error=>{if(current())sendBack({type:'FAILED',error});});
    }catch(error){sendBack({type:'FAILED',error});}
    return ()=>{closed=true;session.controller.abort();source?.stop();};
  });
  const machine=createMachine({id:'live-perception',initial:'idle',context:{session:null},states:{
    idle:{on:{START:{target:'active',actions:assign({session:({event})=>event.session})}}},
    active:{invoke:{src:capture,input:({context})=>context.session},initial:'starting',
      on:{STOP:{target:'idle',actions:({context})=>{context.session.resolve();owner.busy.clear();}},FAILED:{target:'idle',actions:({context,event})=>{context.session.reject(event.error);owner.busy.clear();owner.onError(event.error);}}},
      states:{starting:{on:{READY:{target:'running',actions:({context})=>context.session.resolve()}}},running:{}}}
  }});
  return createActor(machine).start();
}
