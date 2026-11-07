import {retrieveKnowledge} from '../services/retrieval.js';

export const PERSON_FACETS=Object.freeze({biography:'人物背景',residence:'当前居住地',hometown:'家乡',occupation:'职业经历',dietLikes:'饮食喜好',dietDislikes:'不喜欢的饮食',habits:'生活习惯',experience:'本人经历',personality:'性格自述',interests:'兴趣爱好',speechStyle:'说话风格',consumption:'消费自述',gifting:'送礼习惯'});
export const PERSON_DOSSIER_POLICY='档案仅整理明确陈述和采集记录，不证明完整生平或当前状态。性格、爱好、消费和送礼习惯保留自述/运营记录来源；矛盾并列，不能自行选一方。events是原话片段，不把一起出现当成人际关系；相对日期以原记录时间理解，不猜具体日期。leads仅为该账号研究任务找到的待查材料，不能认证身份、作者或关系。礼物统计是本房30天观测下限，不能推断财富、现实消费能力或未来送礼概率。';
const categories=new Map(Object.entries(PERSON_FACETS).map(([key,label])=>[label,key]));
for(const [label,key] of [['性格特点','personality'],['性格','personality'],['兴趣','interests'],['消费习惯','consumption']])categories.set(label,key);
const categoryPattern=[...categories.keys()].join('|');
const explicit=new RegExp(`(?:^|[。！!？?\\n；;])\\s*(?:我的)?(${categoryPattern})[：:]\\s*([^。！？!?\\n；;]+)`,'gu');
const parts=text=>text.match(/[^。！？!?\n；;]+[。！？!?]?/gu) || [];
export const newPersonEvidence=()=>({records:new Map(),facets:[],analysis:[],profiles:new Set(),gifts:[],supports:[]});
export function recordPersonEvidence(node,doc,{self=false,operator=false,lead=false}={}){
 const records=node.person.records;
 if(records.has(doc.id))return;
 records.set(doc.id,{recordId:encodeURIComponent(doc.id),text:doc.person ? `${doc.text}\n\n补充原话：\n${doc.person.turns.map((t,i)=>`第${i+1}轮：${t.text}`).join('\n')}` : doc.text,at:doc.at,source:doc.source,trust:doc.trust,scope:doc.provenance,sample:doc.sample,
  kind:lead ? 'research-lead' : operator ? 'operator-record' : doc.kind || 'statement',attribution:lead ? '研究任务线索，作者与身份待核实' : self ? '本人账号原话，内容未核实' : operator ? '运营记录' : '涉及此人的原始陈述，不能当作此人自述',self});
 if(lead || !self && !operator)return;
 const add=(category,text)=>node.person.facets.push({category,text:text.trim(),recordId:encodeURIComponent(doc.id),at:doc.at,source:doc.source,trust:doc.trust,scope:doc.provenance});
 if(doc.person){
  for(const f of doc.person.facts)add(f.field,f.value);
  for(const a of doc.person.analysis)node.person.analysis.push({...a,recordId:encodeURIComponent(doc.id),at:doc.at,source:doc.source,trust:'unverified',scope:doc.provenance});
  return;
 }
 for(const sentence of parts(doc.text)){
  if(/[？?]|(?:可能|如果|假如|听说|据说)/u.test(sentence))continue;
  for(const match of sentence.matchAll(explicit))if(operator || /^\s*我的/u.test(sentence))add(categories.get(match[1]),match[2]);
  const interest=self && sentence.trim().match(/^我(?:的爱好是|喜欢|爱好)[：:]?\s*(.+?)[。！!]?$/u);
  if(interest)add('interests',interest[1]);
 }
}
function passages(records,query,limit){
 if(!records.length)return [];
 const entries=records.map((r,i)=>({id:String(i),content:r.text,title:'',updatedAt:r.at,source:r.source}));
 const chunks=query ? retrieveKnowledge(entries,query).chunks : [];
 const selected=chunks.length ? chunks.map(c=>({row:records[Number(c.entryId)],text:c.content,range:c.range})) : records.toSorted((a,b)=>b.at-a.at).map(row=>({row,text:row.text,range:{start:0,end:row.text.length}}));
 const seen=new Set(),unique=selected.filter(p=>{if(seen.has(p.row.recordId))return false;seen.add(p.row.recordId);return true;});
 return unique.slice(0,limit).map(({row,text,range})=>{const {self,...evidence}=row;return {...evidence,text:text.slice(0,600),range:{start:range.start,end:range.start+text.slice(0,600).length},originalChars:row.text.length};});
}
function giftingSummary(person){
 if(!person.supports.length)return null;
 const observed=person.supports.length===1 ? person.supports[0] : null;
 const types=new Map();for(const row of person.gifts){const current=types.get(row.name) || {name:row.name,count:0};current.count+=row.count;types.set(row.name,current);}
 return {observed,byScope:person.supports.length>1 ? person.supports.slice(0,3) : [],scopeCount:person.supports.length,types:[...types.values()].sort((a,b)=>b.count-a.count).slice(0,3),prediction:null,
  basis:'本房30天采样的送礼种类和累计件数；多房间分别列出，不作为全平台消费或未来概率'};
}
function selectFacets(facets,query){
 const entries=facets.map((f,i)=>({id:String(i),title:PERSON_FACETS[f.category],content:f.text,source:f.source,updatedAt:f.at}));
 const selected=query ? retrieveKnowledge(entries,query).chunks.map(c=>Number(c.entryId)) : [];
 const rest=facets.map((_,i)=>i).sort((a,b)=>facets[b].at-facets[a].at);
 return [...new Set([...selected,...rest])].slice(0,8).map(i=>facets[i]);
}
export function personDossier(node,query,{browse=false}={}){
 const person=node.person,records=[...person.records.values()],events=records.filter(r=>r.kind!=='research-lead'),leads=records.filter(r=>r.kind==='research-lead');
 if(!records.length && !person.supports.length && !person.profiles.size)return undefined;
 const facets=selectFacets(person.facets,query);
 const result={policy:PERSON_DOSSIER_POLICY,profiles:[...person.profiles].slice(0,2),facets,analysis:person.analysis.slice(0,3),events:passages(events,query,4),speechSamples:passages(events.filter(r=>r.self && r.kind==='chat'),query,2),leads:passages(leads,query,2),gifting:giftingSummary(person),
  missing:Object.keys(PERSON_FACETS).filter(key=>!person.facets.some(r=>r.category===key)),coverage:{records:events.length,leads:leads.length,facets:person.facets.length,selection:'相关原文片段；完整原记录仍在来源存档，未采集内容未知'}};
 for(const key of ['speechSamples','leads','events','analysis','facets'])while(JSON.stringify(result).length>(browse ? 6500 : 4000) && result[key].length)result[key].pop();
 return result;
}
