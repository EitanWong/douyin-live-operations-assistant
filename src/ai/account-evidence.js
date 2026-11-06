import {actorKey} from './account-observations.js';
import {retrieveKnowledge} from '../services/retrieval.js';

const clip=(value,max)=>typeof value==='string' ? value.slice(0,max) : '';
const finite=value=>Number.isFinite(value) ? value : undefined;
function evidence(row){
 return {kind:clip(row.kind,30) || 'public-record',title:clip(row.title,80),profileSubject:clip(row.subject,160),workId:clip(row.workId || (row.kind==='work' ? row.id : ''),160),
  speaker:actorKey(row.actor) ? `${actorKey(row.actor)} ${clip(row.actor.name,80)}` : '说话人未确认',
  attribution:row.kind==='visual' ? '视觉模型观察待核实，不认证画中人物或关系' : '主页主体不等于发言人；不能当作本人自述或经历证明',
  source:clip(row.url || row.source,300),observedAt:finite(row.observedAt),publishedAt:finite(row.publishedAt),positionMs:finite(row.positionMs),
  coverage:clip(row.coverage,500) || '公开页面有限采样，未分析完整视频',quote:clip(row.text,1200)};
}

// Keep attribution next to original words when public comments, transcripts and
// visual observations enter the research loop. Original archive rows stay whole.
export function formatAccountEvidence(records,question){
 const rows=records.slice(0,90).filter(r=>typeof r.text==='string' && r.text.trim()),entries=rows.map((r,i)=>({id:String(i),title:clip(r.title,80),content:clip(r.text,1200),source:r.url || r.source || '',updatedAt:r.observedAt || 0}));
 if(!rows.length)return {text:'',coverage:'未取得公开原文；不能以空记录证明人物特征或经历'};
 const ranked=retrieveKnowledge(entries,question).chunks.map(r=>Number(r.entryId));
 const order=[...new Set([...rows.flatMap((r,i)=>r.kind==='profile' ? [i] : []),...ranked,...rows.map((_,i)=>i)])];
 const result={policy:'公开原文片段，内容待核实；按各记录的发言账号、模态和采样范围理解。未采集部分未知。',availableRecords:records.length,includedRecords:0,records:[]};
 for(const i of order){
  const row=evidence(rows[i]);result.records.push(row);result.includedRecords=result.records.length;
  if(JSON.stringify(result).length>6000){result.records.pop();result.includedRecords=result.records.length;}
 }
 return {text:JSON.stringify(result),coverage:`原页面实际加载的有界公开资料，保留发言人与模态；选入${result.includedRecords}/${records.length}条记录；不是完整主页、评论区或全片分析`};
}
