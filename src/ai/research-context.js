import {retrieveKnowledge} from '../services/retrieval.js';
import {sourcePassages,evidenceOffset as offset} from './source-evidence.js';

export const snapshotResearchContext=value=>Object.fromEntries(['persona','knowledge','context','recentReplies','liveContext','mediaContext','accountContext','relationshipContext','now'].filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));

export const RESEARCH_CONTEXT_LIMITS=Object.freeze({workingChars:32000,passages:12,expandedChars:6000});
const size=value=>JSON.stringify(value).length;

// Extractive compaction: canonical source text stays in the checkpoint. No
// generated summary becomes evidence, and each disclosed passage has offsets.
export function compactResearchState(state,question){
 const sources=state.sources || [],history=state.observations || [],latest=history.at(-1);
 const view={catalog:[],catalogPage:{offset:0,total:sources.length,shown:0,nextOffset:null},evidence:[],
  progress:{completedTools:history.length,modelCalls:state.modelCalls,searches:state.searches,reads:state.reads,
   recent:history.slice(-3).map(r=>({action:r.action,query:r.query.slice(0,120),...(r.output?.error ? {error:r.output.error.slice(0,160)} : {})}))},
  lastTool:latest ? {action:latest.action,output:size(latest.output ?? null)<=1800 ? latest.output : {omitted:true,reason:'结果过长；请缩小检索问题，原始结果仍保留在任务检查点'}} : null,
  disclosure:{method:'minisearch-bm25-extractive',limit:RESEARCH_CONTEXT_LIMITS.workingChars,omittedPassages:true,instruction:'catalog只是分页索引，不是事实证据；默认显示最新来源。catalog动作按offset从0浏览全部目录，evidence是原文片段，inspect按编号和offset展开，read按source编号读取网页。省略不等于不存在，未读部分不能补造。'}};
 // Reserve space for original evidence even when source metadata is hostile.
 const metadataLimit=RESEARCH_CONTEXT_LIMITS.workingChars/2;
 if(size(view)>metadataLimit)view.lastTool={omitted:true,reason:'结果过长，请缩小检索问题'};
 while(size(view)>metadataLimit && view.progress.recent.length)view.progress.recent.shift();
 const explicit=Number.isInteger(state.catalogOffset),start=explicit ? Math.min(state.catalogOffset,sources.length) : 0;
 const catalog=(explicit ? sources.slice(start) : sources.toReversed()).map(s=>({index:s.index,title:s.title,host:new URL(s.url).hostname,chars:s.content.length,at:s.at,...(s.expiresAt ? {expiresAt:s.expiresAt} : {}),
  ...(s.evidenceKind ? {evidenceKind:s.evidenceKind} : {}),...(s.publishedAt ? {publishedAt:s.publishedAt} : {}),...(s.coverage ? {coverage:s.coverage.slice(0,200)} : {})}));
 for(const key of ['coverage','publishedAt','title','host'])if(size(view)+size(catalog)>metadataLimit)for(const row of catalog)delete row[key];
 for(const row of catalog){
  if(explicit)view.catalog.push(row);else view.catalog.unshift(row);
  if(size(view)>metadataLimit){if(explicit)view.catalog.pop();else view.catalog.shift();break;}
 }
 const shown=view.catalog.length,catalogOffset=explicit ? start : sources.length-shown;
 view.catalogPage={offset:catalogOffset,total:sources.length,shown,nextOffset:catalogOffset+shown<sources.length ? catalogOffset+shown : null};
 const add=(source,passage,start,end)=>{
  if(view.evidence.length>=RESEARCH_CONTEXT_LIMITS.passages)return;
  start=Math.max(start,passage.start);end=Math.min(end,passage.end);if(end<=start)return;
  start=offset(source.content,start);end=offset(source.content,end);
  if(view.evidence.some(r=>r.index===source.index && r.start<end && start<r.end))return;
  // A passage and its scope are one piece of evidence. Optional catalog labels
  // may disappear, but compaction must not turn a sample into an unqualified fact.
  const row={index:source.index,start,end,content:source.content.slice(start,end),
   ...(passage.evidenceKind ? {evidenceKind:passage.evidenceKind} : {}),...(passage.coverage ? {coverage:passage.coverage} : {})};
  view.evidence.push(row);
  while(size(view)>RESEARCH_CONTEXT_LIMITS.workingChars && row.end>row.start){row.end=offset(source.content,row.start+Math.floor((row.end-row.start)/2));row.content=source.content.slice(row.start,row.end);}
  if(!row.content)view.evidence.pop();
 };
 const fragments=sources.flatMap(source=>sourcePassages(source).map((passage,i)=>({source,passage,id:`${source.index}:${i}`})));
 if(state.focus){for(const {source,passage} of fragments)if(source.index===state.focus.source)add(source,passage,state.focus.offset,state.focus.offset+RESEARCH_CONTEXT_LIMITS.expandedChars);}
 const entries=fragments.map(({source:s,passage:p,id})=>({id,title:p.title || s.title,content:s.content.slice(p.start,p.end),source:s.url,updatedAt:p.at ?? s.at,expiresOn:''}));
 const found=retrieveKnowledge(entries,question,{contextQuery:latest?.query || ''});
 for(const chunk of found.chunks){
  if(view.evidence.length>=RESEARCH_CONTEXT_LIMITS.passages)break;
  const {source,passage}=fragments.find(s=>s.id===chunk.entryId);
  add(source,passage,passage.start+chunk.range.start,passage.start+chunk.range.end);
 }
 view.disclosure.omittedPassages=sources.some(s=>!view.evidence.some(r=>r.index===s.index && r.start===0 && r.end===s.content.length));
 return view;
}
