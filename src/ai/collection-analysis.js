import {z} from 'zod';
import {profileMemoryEntry} from '../services/person-profile.js';
import {personProfileSchema,profileOutputSchema,makePersonProfileRequest,PROFILE_POLICY} from './person-profile.js';

const record=z.strictObject({id:z.string().max(300),kind:z.enum(['chat','audio','omni']),at:z.number().finite(),start:z.number().int().nonnegative(),text:z.string().min(1).max(4000),subject:z.string().max(210).default(''),name:z.string().max(40).default('')});
export const collectionRecordsSchema=z.array(record).min(1).max(16).refine(rows=>rows.reduce((n,r)=>n+r.text.length,0)<=12000);
export const collectionAnalysisSchema=z.strictObject({id:z.string().max(100),at:z.number().finite(),records:collectionRecordsSchema,people:z.array(personProfileSchema).max(6)});
const identity=row=>JSON.stringify(row);

function sourceRecords(memory){
 const sources=[];
 for(const viewer of memory?.audience?.viewers || [])for(const row of viewer.statements || [])sources.push({...row,kind:'chat',subject:viewer.key,name:viewer.name || ''});
 for(const row of memory?.audience?.unattributed || [])sources.push({...row,kind:'chat'});
 for(const row of memory?.perception?.observations || [])if(['audio','omni'].includes(row.kind))sources.push(row);
 const records=[];
 for(const row of sources)for(let start=0;start<row.text.length;start+=3500){
  const parsed=record.safeParse({id:String(row.id),kind:row.kind,at:row.at,start,text:row.text.slice(start,start+3500),subject:/^(?:uid:\d{1,40}|sec:[A-Za-z0-9_-]{1,200})$/u.test(row.subject || '') ? row.subject : '',name:row.name?.slice(0,40) || ''});
  if(parsed.success)records.push(parsed.data);
 }
 return records.sort((a,b)=>a.at-b.at || a.id.localeCompare(b.id) || a.start-b.start);
}
export function validCollectionAnalyses(memory){
 const sources=new Set(sourceRecords(memory).map(identity));
 return (memory?.analyses || []).flatMap(value=>{const parsed=collectionAnalysisSchema.safeParse(value);return parsed.success && parsed.data.records.every(row=>sources.has(identity(row))) ? [parsed.data] : [];});
}
export function nextCollectionBatch(memory){
 const completed=new Set(validCollectionAnalyses(memory).flatMap(row=>row.records.map(identity))),rows=sourceRecords(memory).filter(row=>!completed.has(identity(row)));
 if(!rows.length)return [];
 const batch=[];let size=0;
 for(const row of rows){
  if(row.subject!==rows[0].subject)continue;
  if(batch.length>=16 || size+row.text.length>12000)break;
  batch.push(row);size+=row.text.length;
 }
 return batch;
}
export function makeCollectionAnalysisRequest(records,config,observed=null){
 records=collectionRecordsSchema.parse(records);
 const template=makePersonProfileRequest({},config),instruction=template.messages[0].content;
 return {...template,max_tokens:6000,messages:[{role:'system',content:instruction+'\n这是持续采集的后台整理任务，只输出JSON {"people":[人物对象]}，最多6人。人物对象包含name及facts、relationships、analysis、knowledge、reply，格式沿用上述规则。没有足够依据时people为空。'+
  '\n只处理本批原文；说话人未知的语音不能把“我”、主播或画面中的人绑定到主播账号，只整理明确点名的人物及关系。已知账号弹幕只整理该账号，不把所谈他人的经历归给说话人。每条依据turn对应records的顺序。分析仅描述有原话支持的交流偏好、明确自述意愿和可纠正的行为假设；不推断收入、资产、财富、送礼概率、疾病或心理弱点，不生成个人诱导消费话术。不将模型推测写入事实。'+PROFILE_POLICY},
  {role:'user',content:JSON.stringify({records,observed})}]};
}
export function parseCollectionAnalysis(raw,records,{id,now=Date.now()}={}){
 records=collectionRecordsSchema.parse(records);
 if(typeof raw!=='string' || raw.length>50000)throw Error('后台整理未返回有效文本');
 const output=z.strictObject({people:z.array(profileOutputSchema.safeExtend({name:z.string().trim().min(1).max(40)})).max(6)}).parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/iu,'').replace(/\s*```$/u,'')));
 const subject=records[0].subject,turns=records.map(row=>({text:row.text,at:row.at}));
 const people=output.people.map(value=>{
  if(subject && value.name!==records[0].name)throw Error('后台人物归属与原始账号不一致');
  if(!subject && /^(?:我|主播|说话人|未知|他|她)$/u.test(value.name))throw Error('未知说话人不能绑定人物身份');
  if(!subject && !records.some(row=>row.text.includes(value.name)))throw Error('语音原文未明确点名该人物');
  const person=personProfileSchema.parse({...value,version:1,key:subject,turns});profileMemoryEntry(person);return person;
 });
 return collectionAnalysisSchema.parse({id,at:now,records,people});
}
