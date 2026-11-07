import {z} from 'zod';
const stable=z.string().regex(/^[A-Za-z0-9_.=-]{1,160}$/u);
export const accountActor=z.object({uid:z.string().regex(/^\d{1,30}$/u).optional(),secUid:stable.optional(),room:z.string().regex(/^[1-9]\d{0,39}$/u).optional(),name:z.string().max(80)}).refine(a=>a.uid || a.secUid);
const clean=(value,max)=>typeof value==='string' ? value.replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max) : '';
export function publicActor(user){
 if(!user || user.secret || user.is_private)return undefined;
 const value=typeof user.uid==='string' ? user.uid : Number.isSafeInteger(user.uid) ? String(user.uid) : '';
 const uid=/^[1-9]\d{0,29}$/u.test(value) ? value : undefined;
 const room=typeof user.web_rid==='string' && /^[1-9]\d{0,39}$/u.test(user.web_rid) ? user.web_rid : undefined;
 const parsed=accountActor.safeParse({uid,secUid:typeof user.sec_uid==='string' ? user.sec_uid : undefined,room,name:clean(user.nickname,80)});
 return parsed.success ? parsed.data : undefined;
}
export const actorKey=actor=>/^[1-9]\d{0,29}$/u.test(actor?.uid || '') ? `uid:${actor.uid}` : actor?.secUid ? `sec:${actor.secUid}` : undefined;

export function publicInteractions(payload,source,at,{work}={}){
 if(source.kind!=='work' || !work || source.id!==work.id || !stable.safeParse(work.subject).success)return [];
 const rows=[],url=source.url;
 const add=(kind,row,recordId,value,actor,target)=>{
  if(Number.isSafeInteger(recordId))recordId=String(recordId);
  const recordText=clean(value,1200);if(!recordText || !stable.safeParse(recordId).success || row?.is_deleted || row?.status===2 || row?.aweme_id && String(row.aweme_id)!==work.id)return;
  rows.push({kind,id:recordId,subject:work.subject,workId:work.id,title:clean(actor?.name || (kind==='comment' ? '公开评论' : '作品弹幕'),80),text:recordText,actor,target,url,source:url,
   observedAt:at,expiresAt:at+86400000,publishedAt:Number.isSafeInteger(row.create_time) ? row.create_time*1000 : null,
   ...(kind==='danmaku' && Number.isSafeInteger(row.offset_time) && row.offset_time>=0 ? {positionMs:row.offset_time} : {}),counts:{},coverage:kind==='comment' ? '页面实际加载的评论/回复采样；不是完整评论区' : '页面实际加载的作品弹幕采样；位置不等于发布时间'});
 };
 for(const row of (Array.isArray(payload.comments) ? payload.comments : []).filter(row=>row && typeof row==='object').slice(0,30))add('comment',row,row.cid,row.text,publicActor(row.user),publicActor(row.reply_comment?.user || (row.reply_to_user_id ? {uid:row.reply_to_user_id,sec_uid:row.reply_to_sec_uid,nickname:row.reply_to_username} : undefined)));
 for(const row of (Array.isArray(payload.danmaku_list) ? payload.danmaku_list : []).filter(row=>row && typeof row==='object').slice(0,30))add('danmaku',row,row.danmaku_id,row.text,publicActor(row.user));
 return rows.slice(0,30);
}
