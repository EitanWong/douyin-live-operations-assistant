// Shared by the ordinary panel and dedicated read-only collection pages.
// Persist every chunk before acknowledging MAIN; retries reuse record IDs/time.
export function createDataCapture(message,{now=Date.now}={}){
 let pending=null,lastCoverage=0;
 return async batch=>{
  const events=[...(batch.priority || []),...(batch.events || [])],captures=batch.captures || [];
  if(!events.length && !captures.length && now()-lastCoverage<5000)return;
  if(!pending || pending.batchId!==batch.batchId || pending.completed && batch.batchId==null)pending={batchId:batch.batchId,at:now()};
  const at=pending.at,prefix=batch.batchId==null?`pulse:${at}`:`batch:${batch.batchId}`,records=[];
  events.forEach((event,i)=>records.push({id:`${prefix}:event:${i}`,kind:'event',receivedAt:at,payload:event}));
  captures.forEach((frame,i)=>{
   const {rawBase64,...meta}=frame,raw=typeof rawBase64==='string'?rawBase64:'';
   const chunks=Math.max(1,Math.ceil(raw.length/240000));
   for(let part=0;part<chunks;part++)records.push({id:`${prefix}:frame:${i}:${part}`,kind:'protocol',receivedAt:at,payload:{...meta,part,parts:chunks,...(raw?{rawBase64:raw.slice(part*240000,(part+1)*240000)}:{})}});
  });
  // Payload is deliberately limited to known counters, with no page URLs/keys.
  const status=batch.status || {};
  records.push({id:`${prefix}:coverage`,kind:'coverage',receivedAt:at,payload:{connected:status.connected===true,
   bridgeGaps:status.bridgeGaps || 0,frameGaps:status.frameGaps || 0,captureBridgeGaps:status.captureBridgeGaps || 0,
   gaps:(status.bridgeGaps || 0)+(status.frameGaps || 0)+(status.captureBridgeGaps || 0),lastFrame:status.lastFrame || 0}});
  let chunk=[],size=0;
  for(const row of records){
   const bytes=new TextEncoder().encode(JSON.stringify(row)).length;
   if(chunk.length && (size+bytes>600000 || chunk.length>=32)){await message({type:'data-records',records:chunk});chunk=[];size=0;}
   chunk.push(row);size+=bytes;
  }
  if(chunk.length)await message({type:'data-records',records:chunk});lastCoverage=at;pending.completed=true;
 };
}

export async function runReadOnlyCollector({message,window,document,room}){
 const archive=createDataCapture(message);let ack,timer,stopped=false,busy=false;
 const title=document.title;
 const drain=async()=>{
  if(stopped || busy)return;busy=true;
  try{
   const context=await message({type:'data-context'});
   if(!context?.readOnly)throw Error('采集页归属尚未确认，请从扩展菜单重新打开');
   const batch=await message({type:'page-command',command:{type:'drain',ack}});
   await archive(batch);ack=batch.batchId;
   const active=await message({type:'page-command',command:{type:'collection-pulse'}});
   await message({type:'collection-state',active:active===true});
   document.title=`[只读采集 ${room}] ${title}`;
  }catch(error){document.title=`[采集等待] ${error.message}`;}
  finally{busy=false;if(!stopped)timer=window.setTimeout(drain,1000);}
 };
 const stop=()=>{stopped=true;window.clearTimeout(timer);void message({type:'collection-state',active:false}).catch(()=>{});};
 window.addEventListener('pagehide',stop);
 window.addEventListener('pageshow',event=>{if(event.persisted){stopped=false;void drain();}});
 // Same shared keeper can wake this page without booting any automation.
 return {start:()=>void drain(),wake:()=>{void drain();return {active:!stopped};},stop};
}
