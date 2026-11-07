import {z} from 'zod';
import {subjectEpoch,subjectRow,subjectKeySchema} from './audience-profile.js';
import {personProfileSchema} from './person-profile.js';
import {organizePersonProfile,profileMemoryEntry} from '../services/person-profile.js';

export const profileInsightsKey=(room,anchor)=>`live-assistant:profile-insights:${room}:${anchor}`;
const reference=z.object({id:z.string().min(1).max(200),at:z.number().finite()});
const insight=z.object({subject:subjectKeySchema,epoch:z.number().nonnegative(),refs:z.array(reference).min(1).max(16),person:personProfileSchema,at:z.number().finite()});
const snapshot=z.object({version:z.literal(1),rows:z.array(insight).max(200)});
const signature=input=>JSON.stringify([input.epoch,input.refs,input.turns]);

// Model annotations are a disposable projection over canonical statements.
// Recognition with an unknown speaker never becomes this account's self report.
function profileInput(archive,subject){
 const row=subjectRow(archive?.audience,subject);if(!row)return null;
 const epoch=subjectEpoch(archive.audience,subject),selected=[];let chars=0;
 for(const statement of (row.statements || []).toReversed()){
  if(statement.at<=epoch || statement.text.length>4000 || chars+statement.text.length>12000)continue;
  selected.unshift(statement);chars+=statement.text.length;if(selected.length===16)break;
 }
 if(!selected.length)return null;
 return {name:row.name.slice(0,40),key:subject,epoch,refs:selected.map(({id,at})=>({id,at})),turns:selected.map(({text,at})=>({text,at}))};
}
export function validProfileInsights(value,archive,now=Date.now()){
 const parsed=snapshot.safeParse(value);if(!parsed.success)return [];
 return parsed.data.rows.filter(row=>{
  if(row.person.key!==row.subject || row.epoch!==subjectEpoch(archive?.audience,row.subject) || row.at>now || now-row.at>30*86400000 || row.refs.length!==row.person.turns.length)return false;
  const current=subjectRow(archive?.audience,row.subject);
  return current && row.refs.every((ref,i)=>current.statements.some(s=>s.id===ref.id && s.at===ref.at && s.at>row.epoch && s.text===row.person.turns[i].text && s.at===row.person.turns[i].at));
 });
}
export function createProfileInsightUpdater({read,write,client,reserve=async()=>{},now=Date.now}){
 let tail=Promise.resolve();const pending=new Map();
 const serial=work=>{const result=tail.then(work);tail=result.catch(()=>{});return result;};
 const update=async({room,anchor,subject,ai,signal,guard=async()=>{}})=>{
  if(!subject || !ai.assistant?.research?.profileEnabled || ai.assistant.memoryEnabled===false || ai.contextSources?.audience===false)return null;
  const key=profileInsightsKey(room,anchor),archive=await read(`live-assistant:live-memory:${room}:${anchor}`);
  if(archive?.anchor!==anchor)return null;
  const input=profileInput(archive,subject);if(!input)return null;
  const rows=validProfileInsights(await read(key),archive,now()),old=rows.find(r=>r.subject===subject);
  if(old && signature({...old,turns:old.person.turns})===signature(input))return old;
  await guard();await reserve(`${room}:${anchor}`);
  const person=await organizePersonProfile(input,ai,client,{signal});
  await guard();if(signal?.aborted)throw Error('人物整理已取消');
  return serial(async()=>{
   const latest=await read(`live-assistant:live-memory:${room}:${anchor}`),current=profileInput(latest,subject);
   if(latest?.anchor!==anchor || !current || signature(current)!==signature(input))throw Error('人物原话已变化，旧画像未保存');
   if(signal?.aborted)throw Error('人物整理已取消');
   const result={subject,epoch:input.epoch,refs:input.refs,person,at:now()},retained=validProfileInsights(await read(key),latest,now());
   await write(key,{version:1,rows:[...retained.filter(r=>r.subject!==subject),result].slice(-200)});
   return result;
  });
 };
 const updater=input=>{
  const key=JSON.stringify([input.room,input.anchor,input.subject]);if(pending.has(key))return pending.get(key);
  const result=update(input).finally(()=>pending.delete(key));pending.set(key,result);return result;
 };
 updater.prune=(room,anchor)=>serial(async()=>{
  const key=profileInsightsKey(room,anchor),old=await read(key);if(!old)return;
  const archive=await read(`live-assistant:live-memory:${room}:${anchor}`),rows=archive?.anchor===anchor ? validProfileInsights(old,archive,now()) : [];
  if(JSON.stringify(old)!==JSON.stringify({version:1,rows}))await write(key,{version:1,rows});
 });
 return updater;
}
export function profileInsightDocuments(value,archive,now){
 return validProfileInsights(value,archive,now).map(row=>{
  const entry=profileMemoryEntry(row.person,{id:row.subject,source:'后台人物整理 · 本人账号原话，推测待核实'});
  return {id:`insight:${row.subject}`,text:entry.content,at:row.at,source:entry.source,trust:'unverified',person:row.person,personKey:row.subject,kind:'profile-insight'};
 });
}
