import {z} from 'zod';

export const PUBLIC_MEDIA_SOURCE_TTL=300000;
const source=z.strictObject({workId:z.string().regex(/^\d{1,30}$/u),author:z.string().regex(/^[\w-]{8,160}$/u),authorUid:z.string().regex(/^\d{1,30}$/u).nullable(),
 url:z.string().max(2000),durationMs:z.number().int().positive().max(10800000),observedAt:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),expiresAt:z.number().int().positive().max(Number.MAX_SAFE_INTEGER)});

// Transient download input, never a biography or an original-text source.
export function parsePublicMediaSource(value,{workId,author,subject,epoch=0,now=Date.now()}={}){
 const parsed=source.safeParse(value);if(!parsed.success)return null;
 const row=parsed.data;if(workId!==undefined && row.workId!==workId || author!==undefined && row.author!==author || subject?.startsWith('uid:') && row.authorUid!==subject.slice(4) || subject?.startsWith('sec:') && row.author!==subject.slice(4))return null;
 if(row.observedAt<=epoch || row.observedAt>now || row.expiresAt<=now || row.expiresAt<=row.observedAt || row.expiresAt-row.observedAt>PUBLIC_MEDIA_SOURCE_TTL)return null;
 try{
  const url=new URL(row.url);
  if(url.protocol!=='https:' || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+douyinvod\.com$/u.test(url.hostname) || url.username || url.password || url.port || url.hash || /\s/u.test(row.url) ||
   JSON.stringify(url.searchParams.getAll('__vid'))!==JSON.stringify([row.workId]))return null;
 }catch{return null;}
 return row;
}
