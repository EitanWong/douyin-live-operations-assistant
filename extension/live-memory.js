import {PerceptionMemory,mergeLiveMemory} from '../src/ai/live-memory.js';

export async function persistNativeMemory({room,row,scope,read,write,transaction}){
 const config=await read(`live-assistant:config:${room}`);
 if(config?.ai?.assistant?.memoryEnabled===false)return;
 const anchor=String(scope?.anchorId || config?.anchorId || ''),key=`live-assistant:live-memory:${room}:${anchor || 'unknown'}`;
 await transaction(async()=>{
  const previous=await read(key),perception=new PerceptionMemory({state:previous?.perception});
  if(!perception.observe({...row,isFinal:true}))return;
  const next={version:1,anchor,audience:previous?.audience || {version:2,anchor,viewers:[]},perception:perception.snapshot()};
  await write(key,mergeLiveMemory(previous,next));
 });
}
