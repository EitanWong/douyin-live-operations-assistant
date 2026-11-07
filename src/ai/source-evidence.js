import {z} from 'zod';

export const CORPUS_REFERENCE_LIMIT=3;
const corpusPart='[a-f0-9]{64}:\\d{1,5}-\\d{1,5}';
export const corpusReferenceSchema=z.string().regex(new RegExp(`^corpus:${corpusPart}(?:,${corpusPart}){0,${CORPUS_REFERENCE_LIMIT-1}}$`,'u'));

export const evidenceProvenance=z.object({evidenceKind:z.enum(['search-snippet','public-page','stored-passage','public-data','public-media']).optional(),publishedAt:z.string().max(80).nullable().optional(),coverage:z.string().max(500).optional()});
const metadata=evidenceProvenance.extend({sourceId:z.string().regex(/^[a-f0-9]{64}$/u).optional(),at:z.number().finite().optional(),expiresAt:z.number().finite().optional(),title:z.string().max(160).optional()});
const passage=metadata.extend({start:z.number().int().nonnegative(),end:z.number().int().positive()});
export const evidenceOffset=(text,n)=>n>0 && /[\uDC00-\uDFFF]/u.test(text[n] || '') ? n-1 : n;

// Offsets belong to the exact checkpoint text. Only the joining newline can be
// outside a passage; no unqualified text may slip into disclosure or storage.
export function sourcePassages(source){
 const text=source.content ?? source.text ?? '';
 if(source.passages===undefined)return [{...metadata.parse(source),start:0,end:text.length}];
 const rows=z.array(passage).min(1).max(6000).parse(source.passages);let end=0;
 for(const [i,row] of rows.entries()){
  if(row.start!==(i ? end+1 : 0) || i && text.slice(end,row.start)!=='\n' || row.end<=row.start || row.end>text.length || evidenceOffset(text,row.start)!==row.start || evidenceOffset(text,row.end)!==row.end)throw Error('来源片段范围无效');
  end=row.end;
 }
 if(end!==text.length)throw Error('来源片段范围不完整');
 return rows;
}

export function mergeSourcePassage(old,incoming,reading=false){
 const parts=old ? sourcePassages(old).map(p=>({...p,content:old.content.slice(p.start,p.end)})) : [];
 if(!reading && incoming.evidenceKind==='search-snippet' && parts.some(p=>p.evidenceKind==='public-page'))return old;
 if(parts.some(p=>p.content.includes(incoming.content) && p.evidenceKind===incoming.evidenceKind && p.coverage===incoming.coverage && p.sourceId===incoming.sourceId))return old;
 const kept=reading ? parts.filter(p=>!['search-snippet','public-page'].includes(p.evidenceKind)) : parts;
 const contentParts=[],passages=[];let content='';
 for(const part of [...kept,incoming]){
  const start=content.length+(content ? 1 : 0),remaining=6000-start;if(remaining<=0)break;
  const text=part.content.slice(0,evidenceOffset(part.content,Math.min(part.content.length,remaining)));if(!text)continue;
  content+=(content ? '\n' : '')+text;passages.push({...metadata.parse(part),start,end:content.length});contentParts.push(part);
 }
 const expiresAt=Math.min(...passages.map(p=>p.expiresAt ?? Infinity));
 return {index:old?.index,url:incoming.url,title:incoming.title,content,passages,at:Math.min(...passages.map(p=>p.at)),
  ...(Number.isFinite(expiresAt) ? {expiresAt} : {}),publishedAt:incoming.publishedAt ?? old?.publishedAt ?? null,
  ...(contentParts.every(p=>p.evidenceKind===contentParts[0].evidenceKind) ? {evidenceKind:contentParts[0].evidenceKind} : {}),
  ...(contentParts.every(p=>p.coverage===contentParts[0].coverage) ? {coverage:contentParts[0].coverage} : {})};
}
