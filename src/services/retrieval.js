// Local lexical RAG. Offsets refer to the original UTF-16 string saved by the
// operator; no model call or external embedding service is needed.
export const RETRIEVAL_LIMITS=Object.freeze({chunkChars:600,overlapChars:80,chunks:8,chars:6000});
const stopWords=new Set(['的','了','吗','呢','啊','呀','是','这','那','个','我','你','他','她','它','和','与','在','有','什么','怎么','如何','可以','一下','请问','主播','直播']);

function tokens(value) {
  const runs=String(value || '').toLowerCase().match(/[a-z0-9]+|[\p{Script=Han}]+/gu) || [];
  return runs.flatMap(run=>{
    if(/^[a-z0-9]/u.test(run))return [run];
    const chars=[...run];
    const words=chars.length===1 ? chars : chars.slice(1).map((char,index)=>chars[index]+char);
    return words.filter(word=>!stopWords.has(word));
  });
}

function splitEntry(row) {
  const chunks=[];
  for(let start=0;start<row.content.length;){
    let end=Math.min(start+RETRIEVAL_LIMITS.chunkChars,row.content.length);
    // Prefer a paragraph boundary without discarding or rewriting source text.
    const boundary=row.content.lastIndexOf('\n',end-1);
    if(end<row.content.length && boundary>start+RETRIEVAL_LIMITS.chunkChars/2)end=boundary+1;
    const content=row.content.slice(start,end);
    const words=tokens(`${row.title} ${row.title} ${content}`),counts=new Map();
    for(const word of words)counts.set(word,(counts.get(word) || 0)+1);
    chunks.push({row,content,range:{start,end},counts,length:words.length});
    if(end===row.content.length)break;
    start=end-RETRIEVAL_LIMITS.overlapChars;
  }
  return chunks;
}

function rankChunks(chunks,query,contextQuery) {
  const primary=new Set(tokens(query)),secondary=new Set(tokens(contextQuery));
  const terms=new Set([...primary,...secondary]);
  const frequency=new Map([...terms].map(term=>[term,chunks.filter(chunk=>chunk.counts.has(term)).length]));
  const average=chunks.reduce((sum,chunk)=>sum+chunk.length,0)/(chunks.length || 1);
  return chunks.map(chunk=>{
    let score=0;
    for(const term of terms){
      const count=chunk.counts.get(term) || 0;if(!count)continue;
      const docs=frequency.get(term),idf=Math.log(1+(chunks.length-docs+0.5)/(docs+0.5));
      score+=(primary.has(term) ? 3 : 1)*idf*count*2.2/(count+1.2*(0.25+0.75*chunk.length/(average || 1)));
    }
    return {...chunk,score};
  }).filter(chunk=>chunk.score>0).sort((a,b)=>b.score-a.score || b.row.updatedAt-a.row.updatedAt || a.row.id.localeCompare(b.row.id) || a.range.start-b.range.start);
}

export function retrieveKnowledge(entries,query,{contextQuery=''}={}) {
  const chunks=entries.flatMap(splitEntry),ranked=rankChunks(chunks,query,contextQuery),selected=[];
  let usedChars=0;
  for(const chunk of ranked){
    // Overlapping windows are alternatives, not independent evidence.
    if(selected.some(row=>row.entryId===chunk.row.id && row.range.start<chunk.range.end && chunk.range.start<row.range.end))continue;
    if(selected.length===RETRIEVAL_LIMITS.chunks || usedChars+chunk.content.length>RETRIEVAL_LIMITS.chars)break;
    const {row,content,range,score}=chunk;
    selected.push({id:`${row.id}:${range.start}-${range.end}`,entryId:row.id,title:row.title,content,range,
      source:row.source,updatedAt:row.updatedAt,expiresOn:row.expiresOn,score:Math.round(score*1000)/1000});
    usedChars+=content.length;
  }
  return {method:'local-bm25',query:String(query || ''),contextQuery,totalChunks:chunks.length,
    matchedEntries:new Set(ranked.map(chunk=>chunk.row.id)).size,usedChars,limits:RETRIEVAL_LIMITS,
    truncated:ranked.some(chunk=>!selected.some(row=>row.entryId===chunk.row.id && row.range.start===chunk.range.start)),chunks:selected};
}
