import {validateMemory} from './knowledge.js';
import {migrateAIServices,projectSharedAIServices,mergeSharedAIServices} from './shared-ai-services.js';

export const SHARED_KNOWLEDGE_KEY='live-assistant:knowledge:global';
const clone=value=>structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const shared=config=>({entries:config?.ai?.memory?.entries || [],knowledge:config?.ai?.knowledge || ''});
const stripped=config=>{
 const result=clone(config);
 if(result.ai?.knowledge)result.ai.knowledge='';
 if(result.ai?.memory?.entries)result.ai.memory.entries=[];
 return result;
};
export function projectSharedKnowledge(config,state){
 const result=projectSharedAIServices(config,state.services);
 return {...result,ai:{...result.ai,knowledge:state.knowledge,memory:{enabled:config?.ai?.memory?.enabled!==false,entries:clone(state.entries)}}};
}

// Background owns this state. Commit the shared record and room configuration
// atomically. Three-way entry deltas preserve concurrent unrelated edits.
export function createSharedKnowledge({read,all,commit}){
 let tail=Promise.resolve();
 const serial=work=>{const result=tail.then(work);tail=result.catch(()=>{});return result;};
 async function ensure(){
  const saved=await read(SHARED_KNOWLEDGE_KEY);if(saved?.services)return saved;
  const values=Object.fromEntries(Object.entries(await all()).filter(([key])=>/^live-assistant:config:\d+$/u.test(key)).sort(([a],[b])=>a.localeCompare(b)));
  const services=migrateAIServices(Object.values(values));
  if(saved){const next={...saved,services};await commit([[SHARED_KNOWLEDGE_KEY,next]]);return next;}
  const state={version:1,entries:[],knowledge:'',services},rooms=[];
  for(const [key,config] of Object.entries(values).sort(([a],[b])=>a.localeCompare(b))){
   if(!/^live-assistant:config:\d+$/u.test(key))continue;
   const room=key.split(':').at(-1);
   for(const row of shared(config).entries){
    const old=state.entries.find(r=>r.id===row.id);
    if(old && same({...old,origin:undefined},{...row,origin:undefined}))continue;
    let id=row.id;
    for(let i=1;state.entries.some(r=>r.id===id);i++)id=`${row.id.slice(0,65)}:${room}:${i}`;
    state.entries.push({...row,id,origin:row.origin || {room,anchor:String(config.anchorId || '')}});
   }
   const knowledge=shared(config).knowledge;
   if(knowledge && !state.knowledge.includes(knowledge))state.knowledge+=(state.knowledge ? '\n\n' : '')+`[原直播间 ${room} / 主播 ${config.anchorId || '未绑定'}]\n${knowledge}`;
   rooms.push([key,stripped(config)]);
  }
  validate(state);await commit([[SHARED_KNOWLEDGE_KEY,state],...rooms]);return state;
 }
 function validate(state){validateMemory({enabled:true,entries:state.entries});if(state.knowledge.length>12000)throw Error('共享背景资料超过12000字，请先整理原资料');}
 return {
  ensure:()=>serial(ensure),
  config:room=>serial(async()=>projectSharedKnowledge(await read(`live-assistant:config:${room}`) || {},await ensure())),
  save:(room,config,base)=>serial(async()=>{
   const current=await ensure(),next=clone(current),before=shared(base),incoming=shared(config);
   for(const id of new Set([...before.entries,...incoming.entries].map(r=>r.id))){
    const old=before.entries.find(r=>r.id===id),value=incoming.entries.find(r=>r.id===id);
    if(same(old,value))continue;
    const present=next.entries.find(r=>r.id===id);
    if(!same(old,present) && !same(value,present))throw Error('其他窗口已更正同一条共享资料，请保留草稿并重新载入后核对');
    next.entries=next.entries.filter(r=>r.id!==id);
    if(value)next.entries.push({...value,origin:present?.origin || value.origin || {room,anchor:String(config.anchorId || '')}});
   }
   if(before.knowledge!==incoming.knowledge){
    if(current.knowledge!==before.knowledge && current.knowledge!==incoming.knowledge)throw Error('其他窗口已更正共享背景资料，请保留草稿并重新载入后核对');
    next.knowledge=incoming.knowledge;
   }
   next.services=mergeSharedAIServices(current.services,config,base);
   validate(next);
   await commit([[SHARED_KNOWLEDGE_KEY,next],[`live-assistant:config:${room}`,stripped(config)]]);
   return projectSharedKnowledge(config,next);
  }),
  // Identity/runtime settings never write a stale copy of shared knowledge.
  saveRoom:(key,config)=>serial(async()=>{await ensure();await commit([[key,stripped(config)]]);})
 };
}
