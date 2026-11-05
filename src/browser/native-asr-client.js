export function createNativeASRClient({connect}){
 let port,prepared=false;const pending=new Map();
 const close=()=>{prepared=false;const active=port;port=null;for(const job of [...pending.values()])job.finish(new Error('本地语音连接已关闭，请安装 SenseVoice 组件后准备模型'));active?.disconnect();};
 const call=(action,data,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new Error('本地语音已取消'));return;}
  if(!port){const active=port=connect();active.onMessage.addListener(m=>{if(port===active)pending.get(m.id)?.finish(m.error ? new Error(m.error) : null,m.value);});active.onDisconnect.addListener(()=>{if(port===active)close();});}
  if(pending.size){reject(new Error('本地语音识别忙，本次跳过'));return;}
  const id=crypto.randomUUID();let timer;
  const abort=()=>close();
  const finish=(error,value)=>{if(!pending.has(id))return;pending.delete(id);clearTimeout(timer);signal?.removeEventListener('abort',abort);error ? reject(error) : resolve(value);};
  pending.set(id,{finish:(error,value)=>{if(error)prepared=false;finish(error,value);}});signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(close,action==='prepare' ? 60000 : 4000);
  try{port.postMessage({id,action,...data});}catch(error){pending.get(id)?.finish(error);}
 });
 return {prepare:async()=>{const s=await call('prepare');prepared=s.phase==='ready';return s;},ready:async()=>prepared,
  inspect:()=>call('status'),status:async()=>prepared ? call('status') : {phase:'unprepared'},transcribe:(sample,signal)=>call('infer',{data:sample.data},signal),close};
}
