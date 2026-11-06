import {z} from 'zod';
export const RESEARCH_DEFAULTS=Object.freeze({enabled:false,intervalSec:180,maxPerHour:3});
export const researchSettingsSchema=z.strictObject({enabled:z.boolean(),intervalSec:z.number().int().min(60).max(3600),maxPerHour:z.number().int().min(1).max(10)});
export const continuousEnabled=config=>Boolean(config?.ai?.enabled && config.ai.assistant?.memoryEnabled!==false && config.ai.assistant?.research?.enabled);
const normalize=text=>text.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase();
function observations(memory,now){
 const rows=[...(memory.audience?.viewers || []).flatMap(v=>(v.statements || []).map(r=>({...r,kind:'chat'}))),...(memory.perception?.observations || []).filter(r=>r.kind!=='video')];
 return rows.filter(r=>typeof r.text==='string' && r.text.trim().length>=6 && Number.isFinite(r.at) && r.at<=now && now-r.at<300000)
  .sort((a,b)=>b.at-a.at).slice(0,30);
}
async function digest(text){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');}

// Alarm-driven work discovery. No timer or long model request holds the page.
// Stable task IDs bridge the crash window between submission and watermark save.
export function createContinuousResearch({configs,read,store,submit,cancelDisabled,hasPending,now=Date.now}){
 let pending;
 const tick=async()=>{
  const values=await configs();await cancelDisabled(values);
  for(const [key,config] of Object.entries(values)){
   if(!/^live-assistant:config:\d+$/u.test(key) || !continuousEnabled(config))continue;
   const room=key.split(':').at(-1),anchor=String(config.anchorId),scope=`${room}:${anchor}`,parsed=researchSettingsSchema.safeParse({...RESEARCH_DEFAULTS,...config.ai.assistant.research});
   if(!parsed.success)continue;const settings=parsed.data;
   if(!/^\d{1,30}$/u.test(anchor) || hasPending(scope))continue;
   const at=now(),old=await store.readLoop(scope) || {scope,seen:[],calls:[],nextAt:0};
   const calls=old.calls.filter(t=>t<=at && at-t<3600000);if(old.nextAt>at || calls.length>=settings.maxPerHour)continue;
   const memory=await read(`live-assistant:live-memory:${room}:${anchor}`);if(memory?.anchor!==anchor)continue;
   const seen=old.seen.filter(r=>at-r.at<86400000);let candidate,hash;
   for(const row of observations(memory,at)){const key=await digest(normalize(row.text));if(!seen.some(r=>r.key===key)){candidate=row;hash=key;break;}}
   if(!candidate)continue;
   const id=`auto-${(await digest(`${scope}:${hash}:${Math.floor(candidate.at/86400000)}`)).slice(0,64)}`;
   await submit({id,scope,question:candidate.text.trim().slice(0,1000),input:{anchor,ai:config.ai,sources:[],context:{now:at,persona:config.ai.persona,knowledge:config.ai.knowledge,
    context:[{text:candidate.text.slice(0,1000),at:candidate.at,source:candidate.kind,identity:'unverified sampled conversation'}]}}});
   await store.writeLoop({scope,updatedAt:at,seen:[...seen,{key:hash,at}].slice(-100),calls:[...calls,at],nextAt:at+settings.intervalSec*1000});
  }
 };
 return {tick(){if(!pending)pending=tick().finally(()=>{pending=null;});return pending;}};
}
