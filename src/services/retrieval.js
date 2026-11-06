import MiniSearch from 'minisearch';
import {LRUCache} from 'lru-cache';

// Source offsets and evidence selection belong to the domain; indexing and
// BM25+ ranking belong to MiniSearch. No embeddings or remote service required.
export const RETRIEVAL_LIMITS=Object.freeze({chunkChars:600,overlapChars:80,chunks:8,chars:6000});
const stopWords=new Set(['的','了','吗','呢','啊','呀','是','这','那','个','我','你','他','她','它','和','与','在','有','什么','怎么','如何','可以','一下','请问','主播','直播']);
const segmenter=new Intl.Segmenter('zh-CN',{granularity:'word'});
function tokens(value) {
  const text=String(value || '').toLowerCase(),words=[...segmenter.segment(text)].filter(part=>part.isWordLike).map(part=>part.segment);
  // Bigrams retain recall for adjacent Chinese words without applying fuzzy
  // matching to short Chinese terms (which would introduce unrelated facts).
  for(const [run] of text.matchAll(/[\p{Script=Han}]+/gu)){
    const chars=[...run];for(let i=1;i<chars.length;i++)words.push(chars[i-1]+chars[i]);
  }
  return words.filter(word=>!stopWords.has(word));
}
const safeOffset=(text,offset)=>offset>0 && /[\uDC00-\uDFFF]/u.test(text[offset] || '') && /[\uD800-\uDBFF]/u.test(text[offset-1]) ? offset-1 : offset;
function splitEntry(row) {
  const chunks=[];
  for(let start=0;start<row.content.length;){
    let end=safeOffset(row.content,Math.min(start+RETRIEVAL_LIMITS.chunkChars,row.content.length));
    const boundary=row.content.lastIndexOf('\n',end-1);
    if(end<row.content.length && boundary>start+RETRIEVAL_LIMITS.chunkChars/2)end=boundary+1;
    chunks.push({id:`${row.id}:${start}-${end}`,title:row.title,content:row.content.slice(start,end),row,range:{start,end}});
    if(end===row.content.length)break;
    start=safeOffset(row.content,end-RETRIEVAL_LIMITS.overlapChars);
  }
  return chunks;
}
function makeIndex(chunks){
  const index=new MiniSearch({fields:['title','content'],tokenize:tokens,processTerm:term=>term,searchOptions:{boost:{title:2},prefix:term=>/^[a-z0-9]{3,}$/u.test(term),fuzzy:term=>/^[a-z]{5,}$/u.test(term) ? .2 : false}});
  index.addAll(chunks);return index;
}
function rankChunks(chunks,index,query,contextQuery) {
  const scores=new Map();
  for(const [text,weight] of [[query,3],[contextQuery,1]])for(const hit of index.search(String(text || '')))scores.set(hit.id,(scores.get(hit.id) || 0)+hit.score*weight);
  return chunks.filter(chunk=>scores.has(chunk.id)).map(chunk=>({...chunk,score:scores.get(chunk.id)}))
    .sort((a,b)=>b.score-a.score || b.row.updatedAt-a.row.updatedAt || a.row.id.localeCompare(b.row.id) || a.range.start-b.range.start);
}
function retrieve(chunks,index,query,{contextQuery=''}={}) {
  const ranked=rankChunks(chunks,index,query,contextQuery),selected=[];
  let usedChars=0;
  for(const chunk of ranked){
    if(selected.some(row=>row.entryId===chunk.row.id && row.range.start<chunk.range.end && chunk.range.start<row.range.end))continue;
    if(selected.length===RETRIEVAL_LIMITS.chunks || usedChars+chunk.content.length>RETRIEVAL_LIMITS.chars)break;
    const {id,row,content,range,score}=chunk;
    selected.push({id,entryId:row.id,title:row.title,content,range,source:row.source,updatedAt:row.updatedAt,expiresOn:row.expiresOn,score:Math.round(score*1000)/1000});
    usedChars+=content.length;
  }
  return {method:'minisearch-bm25',query:String(query || ''),contextQuery,totalChunks:chunks.length,
    matchedEntries:new Set(ranked.map(chunk=>chunk.row.id)).size,usedChars,limits:RETRIEVAL_LIMITS,
    truncated:ranked.some(chunk=>!selected.some(row=>row.id===chunk.id)),chunks:selected};
}

// The key includes every source field: edits to evidence or metadata invalidate
// together. The bounded cache stores indexes, never model replies or live facts.
export function createKnowledgeRetriever({maxSize=600000}={}){
  const cache=new LRUCache({max:4,maxSize,ttl:300000,sizeCalculation:(_value,key)=>key.length*4+1024});
  const search=(entries,query,options)=>{
    const key=JSON.stringify(entries);let indexed=cache.get(key);
    if(!indexed){const chunks=entries.flatMap(splitEntry);indexed={chunks,index:makeIndex(chunks)};cache.set(key,indexed);}
    return retrieve(indexed.chunks,indexed.index,query,options);
  };
  search.clear=()=>cache.clear();return search;
}
export const retrieveKnowledge=createKnowledgeRetriever();
