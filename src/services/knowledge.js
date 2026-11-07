import {retrieveKnowledge} from './retrieval.js';
import {personProfileSchema} from '../ai/person-profile.js';
import {supplementRecordSchema} from '../ai/knowledge-supplement.js';

export const MEMORY_DEFAULTS = {enabled:true,entries:[]};
export const MEMORY_LIMITS = {entries:40,content:2000,total:20000,selected:8};
export const beijingDate = at => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
const dateValid=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const textValid=(value,max)=>typeof value==='string' && Boolean(value.trim()) && value.length<=max;
export const memoryEntrySize=row=>row.content.length+(row.person ? JSON.stringify(row.person).length : 0)+(row.supplement ? JSON.stringify(row.supplement).length : 0);

export function validateMemory(memory,now=Date.now()) {
  if(!memory || typeof memory.enabled!=='boolean' || !Array.isArray(memory.entries) || memory.entries.length>MEMORY_LIMITS.entries)throw new Error('背景记忆最多40条，开关和条目格式必须有效');
  const ids=new Set();let size=0;
  for(const row of memory.entries){
    if(!row || !textValid(row.id,100) || ids.has(row.id) || !textValid(row.title,80) || !textValid(row.content,MEMORY_LIMITS.content)
      || typeof row.source!=='string' || row.source.length>200 || typeof row.enabled!=='boolean'
      || !Number.isSafeInteger(row.updatedAt) || row.updatedAt<=0 || row.updatedAt>now+300000
      || row.expiresOn!=='' && !dateValid(row.expiresOn))throw new Error('背景记忆需要唯一ID、标题、正文、有效核对时间和到期日期（YYYY-MM-DD）');
    ids.add(row.id);size+=memoryEntrySize(row);
    if(row.trust!==undefined && !['verified','unverified'].includes(row.trust))throw Error('人物资料可信状态无效');
    if(row.person){const parsed=personProfileSchema.safeParse(row.person);if(!parsed.success)throw Error('人物资料或对话原文格式无效');}
    if(row.supplement && !supplementRecordSchema.safeParse(row.supplement).success)throw Error('知识补充原话或来源格式无效');
  }
  if(size>MEMORY_LIMITS.total)throw new Error('背景记忆正文及人物对话资料总计最多20000字');
  return memory;
}

export function retrieveMemories(memory,query,now=Date.now(),options={}) {
  const today=beijingDate(now);
  const entries=memory?.enabled ? memory.entries.filter(row=>row.enabled && (!row.expiresOn || row.expiresOn>=today)) : [];
  return retrieveKnowledge(entries,query,options);
}

export function selectMemories(memory,query,now=Date.now()) {
  const result=retrieveMemories(memory,query,now);
  return [...new Set(result.chunks.map(chunk=>chunk.entryId))].map(id=>({...memory.entries.find(row=>row.id===id)}));
}
