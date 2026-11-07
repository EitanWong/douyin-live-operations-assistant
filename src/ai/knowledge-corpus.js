import {z} from 'zod';
import {subjectKeySchema} from './audience-profile.js';
import {validatePublicURL} from './public-sources.js';
import {evidenceProvenance as provenance,sourcePassages} from './source-evidence.js';
const DAY=86400000;
export const KNOWLEDGE_CORPUS_LIMITS=Object.freeze({rows:1000,chars:400000,sourceChars:12000});
function bounded(rows){let size=0;return rows.toSorted((a,b)=>b.at-a.at || b.id.localeCompare(a.id)).filter(r=>{if(size+r.text.length>KNOWLEDGE_CORPUS_LIMITS.chars)return false;size+=r.text.length;return true;}).slice(0,KNOWLEDGE_CORPUS_LIMITS.rows).reverse();}
const row=provenance.extend({subject:subjectKeySchema.optional(),subjectEpoch:z.number().int().nonnegative().optional(),id:z.string().max(100),source:z.string().max(2000),title:z.string().max(160),text:z.string().min(1).max(12000),at:z.number().finite(),expiresAt:z.number().finite(),trust:z.literal('unverified')});
const pending=z.object({room:z.string(),anchor:z.string(),rows:z.array(row).max(10),retained:z.array(z.string()).max(1000),revision:z.number().int(),sequence:z.number().int(),at:z.number().finite()});
const snapshot=z.object({version:z.literal(1),revision:z.number().int().nonnegative(),sequence:z.number().int().nonnegative().default(0),rows:z.array(row).max(1000),pending:pending.optional(),queued:z.array(row).max(1000).optional()});
export const corpusKey=(room,anchor)=>`live-assistant:knowledge:${room}:${anchor}`;
export function parseKnowledgeCorpus(value,now=Date.now()){
 const parsed=snapshot.safeParse(value);if(!parsed.success)return {version:1,revision:0,sequence:0,rows:[]};
 return {...parsed.data,rows:bounded(parsed.data.rows.filter(r=>r.expiresAt>now && r.at<=now && now-r.at<=180*DAY && r.expiresAt<=r.at+180*DAY).filter(r=>{try{validatePublicURL(r.source);return true;}catch{return false;}}))};
}
function originalPassages(input){
 return input.flatMap(source=>{
  if(!source || source.passages===undefined)return [source];
  const text=source.content ?? source.text;
  if(typeof text!=='string' || text.length>6000)throw Error('来源片段原文无效');
  return sourcePassages(source).map(({start,end,...metadata})=>({url:source.url,title:source.title,...metadata,text:text.slice(start,end)}));
 });
}
// One background writer owns revisions. Raw public sources are stored, never
// the model's inferred answer; retrieval is a rebuildable index over these rows.
export function createKnowledgeCorpus({read,write,archive=async()=>{},now=Date.now}){
 let tail=Promise.resolve();
 const load=async(room,anchor)=>parseKnowledgeCorpus(await read(corpusKey(room,anchor)),now());
 const sync=async(room,anchor,saved)=>{
  let current=saved;
  while(current.pending){
   await archive(current.pending);const {pending,queued=[],...clean}=current;
   const remaining=queued.filter(r=>clean.rows.some(kept=>kept.id===r.id));
   if(remaining.length){clean.sequence++;clean.pending={...pending,sequence:clean.sequence,rows:remaining.slice(0,10)};if(remaining.length>10)clean.queued=remaining.slice(10);}
   await write(corpusKey(room,anchor),clean);current=clean;
  }
  return current;
 };
 const serial=work=>{const result=tail.then(work);tail=result.catch(()=>{});return result;};
 const scope=(room,anchor)=>{if(!/^\d{1,30}$/u.test(room) || !/^\d{1,40}$/u.test(anchor))throw Error('知识库范围无效');};
 return {
  list(room,anchor){return serial(async()=>{scope(room,anchor);return (await sync(room,anchor,await load(room,anchor))).rows;});},
  version(room,anchor){return serial(async()=>{scope(room,anchor);return (await sync(room,anchor,await load(room,anchor))).revision;});},
  remember(room,anchor,input,{version,lifetime=7*DAY,subject,subjectEpoch=0}={}){return serial(async()=>{
   scope(room,anchor);if(subject!==undefined){subjectKeySchema.parse(subject);if(!Number.isSafeInteger(subjectEpoch) || subjectEpoch<0)throw Error('人物记忆版本无效');}if(!Array.isArray(input) || input.length>10)throw Error('公开来源批次无效');
   const previous=await sync(room,anchor,await load(room,anchor));if(version!==undefined && previous.revision!==version)return false;
   const at=now(),incoming=new Map();let referenced=false;
   for(const source of originalPassages(input)){if(!source || typeof (source.text ?? source.content)!=='string' || !source.url)continue;
    const url=validatePublicURL(source.url),text=(source.text ?? source.content).replace(/\u0000/gu,'').trim().slice(0,12000);if(!text)continue;
    // Retrieved canonical passages are references, never new observations. In
    // particular, anchor evidence must not be reassigned to an audience subject.
    if(source.sourceId!==undefined){
     if(!/^[a-f0-9]{64}$/u.test(source.sourceId))throw Error('来源引用无效');
     referenced ||= previous.rows.some(r=>r.id===source.sourceId && r.source===url && r.text.includes(text));continue;
    }
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${url}\n${text}${subject ? `\n${subject}:${subjectEpoch}` : ''}`));
    const id=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
    const observedAt=source.at ?? at;if(!Number.isFinite(observedAt) || observedAt>at || at-observedAt>180*DAY)continue;
    const expiresAt=Math.min(observedAt+Math.min(180*DAY,Math.max(60000,lifetime)),Number.isFinite(source.expiresAt) ? source.expiresAt : Infinity);if(expiresAt<=at)continue;
    const value=row.parse({...provenance.parse(source),... (subject ? {subject,subjectEpoch} : {}),id,source:url,title:String(source.title || new URL(url).hostname).slice(0,160),text,at:observedAt,expiresAt,trust:'unverified'});
    const old=incoming.get(id) || previous.rows.find(r=>r.id===id);
    if(old){
     for(const key of ['evidenceKind','coverage'])if(old[key]!==undefined && value[key]!==undefined && old[key]!==value[key])throw Error('同一原文来源范围冲突，请核对原记录');
     continue;
    }
    incoming.set(id,value);
   }
   if(!incoming.size)return referenced;
   // Persist all original rows before the first acknowledgement. Restart drains
   // the remaining batches through the unchanged ten-row native protocol.
   const merged=new Map(previous.rows.map(r=>[r.id,r]));for(const r of incoming.values())merged.set(r.id,r);
   const next={version:1,revision:previous.revision,sequence:previous.sequence+1,rows:bounded([...merged.values()])};
   const retained=new Set(next.rows.map(r=>r.id)),rows=[...incoming.values()].filter(r=>retained.has(r.id));
   next.pending={room,anchor,rows:rows.slice(0,10),retained:[...retained],revision:next.revision,sequence:next.sequence,at};
   if(rows.length>10)next.queued=rows.slice(10);
   await write(corpusKey(room,anchor),next);await sync(room,anchor,next);
   return true;
  });},
  remove(room,anchor,id){return prune(room,anchor,id);},
  clear(room,anchor){return prune(room,anchor);}
 };
 function prune(room,anchor,id){return serial(async()=>{scope(room,anchor);const old=await load(room,anchor),rows=id ? old.rows.filter(r=>r.id!==id) : [];const next={version:1,revision:old.revision+1,sequence:old.sequence+1,rows};next.pending={room,anchor,rows:(old.pending?.rows || []).filter(r=>rows.some(kept=>kept.id===r.id)),retained:rows.map(r=>r.id),revision:next.revision,sequence:next.sequence,at:now()};const queued=(old.queued || []).filter(r=>rows.some(kept=>kept.id===r.id));if(queued.length)next.queued=queued;await write(corpusKey(room,anchor),next);await sync(room,anchor,next);});}
}
