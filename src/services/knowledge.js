export const MEMORY_DEFAULTS = {enabled:true,entries:[]};
export const MEMORY_LIMITS = {entries:40,content:2000,total:20000,selected:8};
export const beijingDate = at => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
const dateValid=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const textValid=(value,max)=>typeof value==='string' && Boolean(value.trim()) && value.length<=max;

export function validateMemory(memory,now=Date.now()) {
  if(!memory || typeof memory.enabled!=='boolean' || !Array.isArray(memory.entries) || memory.entries.length>MEMORY_LIMITS.entries)throw new Error('背景记忆最多40条，开关和条目格式必须有效');
  const ids=new Set();let size=0;
  for(const row of memory.entries){
    if(!row || !textValid(row.id,100) || ids.has(row.id) || !textValid(row.title,80) || !textValid(row.content,MEMORY_LIMITS.content)
      || typeof row.source!=='string' || row.source.length>200 || typeof row.enabled!=='boolean'
      || !Number.isSafeInteger(row.updatedAt) || row.updatedAt<=0 || row.updatedAt>now+300000
      || row.expiresOn!=='' && !dateValid(row.expiresOn))throw new Error('背景记忆需要唯一ID、标题、正文、有效核对时间和到期日期（YYYY-MM-DD）');
    ids.add(row.id);size+=row.content.length;
  }
  if(size>MEMORY_LIMITS.total)throw new Error('背景记忆正文总计最多20000字');
  return memory;
}

function terms(value) {
  const words=String(value || '').toLowerCase().match(/[a-z0-9]+|[\p{Script=Han}]/gu) || [];
  return new Set([...words,...words.slice(1).map((word,index)=>words[index]+word)]);
}

export function selectMemories(memory,query,now=Date.now()) {
  if(!memory?.enabled)return [];
  const today=beijingDate(now),keys=terms(query);
  return memory.entries.filter(row=>row.enabled && (!row.expiresOn || row.expiresOn>=today))
    .map((row,index)=>({row,index,score:[...terms(`${row.title} ${row.content}`)].filter(word=>keys.has(word)).length}))
    .sort((a,b)=>b.score-a.score || b.row.updatedAt-a.row.updatedAt || a.index-b.index)
    .slice(0,MEMORY_LIMITS.selected).map(({row})=>({...row}));
}
