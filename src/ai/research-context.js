import {retrieveKnowledge} from '../services/retrieval.js';

export const RESEARCH_CONTEXT_LIMITS=Object.freeze({workingChars:6500,passages:3,expandedChars:1600});
const size=value=>JSON.stringify(value).length;
const offset=(text,n)=>n>0 && /[\uDC00-\uDFFF]/u.test(text[n] || '') ? n-1 : n;

// Extractive compaction: canonical source text stays in the checkpoint. No
// generated summary becomes evidence, and each disclosed passage has offsets.
export function compactResearchState(state,question){
 const sources=state.sources || [],history=state.observations || [],latest=history.at(-1);
 const view={catalog:sources.map(s=>({index:s.index,title:s.title,host:new URL(s.url).hostname,chars:s.content.length,at:s.at,...(s.expiresAt ? {expiresAt:s.expiresAt} : {}),
  ...(s.evidenceKind ? {evidenceKind:s.evidenceKind} : {}),...(s.publishedAt ? {publishedAt:s.publishedAt} : {}),...(s.coverage ? {coverage:s.coverage.slice(0,200)} : {})})),evidence:[],
  progress:{completedTools:history.length,modelCalls:state.modelCalls,searches:state.searches,reads:state.reads,
   recent:history.slice(-3).map(r=>({action:r.action,query:r.query.slice(0,120),...(r.output?.error ? {error:r.output.error.slice(0,160)} : {})}))},
  lastTool:latest ? {action:latest.action,output:size(latest.output ?? null)<=1800 ? latest.output : {omitted:true,reason:'结果过长；请缩小检索问题，原始结果仍保留在任务检查点'}} : null,
  disclosure:{method:'minisearch-bm25-extractive',limit:RESEARCH_CONTEXT_LIMITS.workingChars,omittedPassages:true,instruction:'catalog只是索引，不是事实证据；evidence是原文片段。inspect按编号和offset展开，read按source编号读取网页。省略不等于不存在，未读部分不能补造。'}};
 // Reserve space for original evidence even when source metadata is hostile.
 for(const key of ['coverage','publishedAt','title','host'])if(size(view)>3500)for(const row of view.catalog)delete row[key];
 if(size(view)>3500)view.lastTool={omitted:true,reason:'结果过长，请缩小检索问题'};
 while(size(view)>3500 && view.progress.recent.length)view.progress.recent.shift();
 const add=(source,start,end)=>{
  start=offset(source.content,start);end=offset(source.content,end);
  if(view.evidence.some(r=>r.index===source.index && r.start<end && start<r.end))return;
  // A passage and its scope are one piece of evidence. Optional catalog labels
  // may disappear, but compaction must not turn a sample into an unqualified fact.
  const row={index:source.index,start,end,content:source.content.slice(start,end),
   ...(source.evidenceKind ? {evidenceKind:source.evidenceKind} : {}),...(source.coverage ? {coverage:source.coverage} : {})};
  view.evidence.push(row);
  while(size(view)>RESEARCH_CONTEXT_LIMITS.workingChars && row.end>row.start){row.end=offset(source.content,row.start+Math.floor((row.end-row.start)/2));row.content=source.content.slice(row.start,row.end);}
  if(!row.content)view.evidence.pop();
 };
 if(state.focus){const source=sources.find(r=>r.index===state.focus.source);if(source)add(source,state.focus.offset,Math.min(source.content.length,state.focus.offset+RESEARCH_CONTEXT_LIMITS.expandedChars));}
 const entries=sources.map(s=>({id:String(s.index),title:s.title,content:s.content,source:s.url,updatedAt:s.at,expiresOn:''}));
 const found=retrieveKnowledge(entries,question,{contextQuery:latest?.query || ''});
 for(const chunk of found.chunks){
  if(view.evidence.length>=RESEARCH_CONTEXT_LIMITS.passages)break;
  const source=sources.find(s=>String(s.index)===chunk.entryId);
  if(view.evidence.some(r=>r.index===source.index))continue;
  add(source,chunk.range.start,chunk.range.end);
 }
 view.disclosure.omittedPassages=sources.some(s=>!view.evidence.some(r=>r.index===s.index && r.start===0 && r.end===s.content.length));
 return view;
}
