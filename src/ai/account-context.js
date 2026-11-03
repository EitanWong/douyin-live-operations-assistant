import {z} from 'zod';
import {createKnowledgeRetriever} from '../services/retrieval.js';

const id=value=>typeof value==='string' && /^[A-Za-z0-9_.=-]{1,160}$/u.test(value) ? value : null;
const text=(value,max)=>typeof value==='string' ? value.replace(/[\u0000-\u001f]/gu,' ').trim().slice(0,max) : '';
const count=value=>Number.isSafeInteger(value) && value>=0 ? value : null;
export function accountSource(value){
 const u=new URL(value);
 if(u.origin!=='https://www.douyin.com' || u.username || u.password || u.port)throw new Error('请填写抖音公开主页、视频或图文链接');
 const match=u.pathname.match(/^\/(user|video|note)\/([A-Za-z0-9_.=-]{1,160})\/?$/u);
 if(!match)throw new Error('请使用 www.douyin.com 的 user、video 或 note 链接');
 return {url:`${u.origin}/${match[1]}/${match[2]}`,kind:match[1]==='user' ? 'profile' : 'work',id:match[2]};
}
const privateRecord=row=>Boolean(row?.secret || row?.is_private || row?.status?.is_private || row?.status?.is_delete || row?.is_deleted);
export function normalizeAccountPayload(payload,source,at=Date.now()){
 if(!payload || typeof payload!=='object' || payload.status_code && payload.status_code!==0)return [];
 const rows=[],seen=new Set(),stack=[payload];let visited=0;
 const add=row=>{const key=`${row.kind}:${row.id}`;if(!seen.has(key)){seen.add(key);rows.push({...row,source:source.url,observedAt:at,expiresAt:at+86400000});}};
 while(stack.length && visited++<3000 && rows.length<30){
  const value=stack.pop();if(!value || typeof value!=='object' || privateRecord(value))continue;
  if(!Array.isArray(value)){
   if(source.kind==='profile' && value.sec_uid===source.id && typeof value.nickname==='string' && !privateRecord(value)){
    add({kind:'profile',id:source.id,subject:source.id,title:text(value.nickname,80),text:[text(value.nickname,80),text(value.signature,1000)].filter(Boolean).join('：'),counts:{followers:count(value.follower_count),following:count(value.following_count),works:count(value.aweme_count),likes:count(value.total_favorited)}});
   }
   const workId=id(value.aweme_id),subject=id(value.author?.sec_uid);
   if(workId && subject && !privateRecord(value) && !privateRecord(value.author) && (source.kind==='profile' ? subject===source.id : workId===source.id)){
    const title=text(value.desc,1000);if(title)add({kind:'work',id:workId,subject,title:title.slice(0,80),text:title,
     url:`https://www.douyin.com/${value.aweme_type===68 ? 'note' : 'video'}/${workId}`,publishedAt:Number.isSafeInteger(value.create_time) ? value.create_time*1000 : null,
     counts:{likes:count(value.statistics?.digg_count),comments:count(value.statistics?.comment_count),shares:count(value.statistics?.share_count)}});
   }
  }
  for(const child of Object.values(value).slice(0,100))if(child && typeof child==='object' && stack.length<3000)stack.push(child);
 }
 return rows;
}
const record=z.object({kind:z.enum(['profile','work']),id:z.string().min(1).max(160),subject:z.string().min(1).max(160),title:z.string().max(80),text:z.string().max(1200),source:z.string().max(300),observedAt:z.number().finite(),expiresAt:z.number().finite(),counts:z.partialRecord(z.enum(['followers','following','works','likes','comments','shares']),z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()),url:z.string().max(300).optional(),publishedAt:z.number().finite().nullable().optional()});
export class AccountContext {
 constructor({now=Date.now,snapshot}={}){this.now=now;this.rows=[];this.retriever=createKnowledgeRetriever();if(snapshot)this.restore(snapshot);}
 restore(snapshot){
  const result=z.array(record.extend({anchor:z.string().max(80)})).max(300).safeParse(snapshot);
  if(result.success){
   this.rows=[];
   for(const r of result.data)try{if(r.expiresAt>this.now())this.replace(r.anchor,r.source,[...this.rows.filter(v=>v.anchor===r.anchor && v.source===r.source),r].slice(-30));}catch{}
  }
 }
 replace(anchor,url,input){
  if(typeof anchor!=='string' || !anchor || anchor.length>80)throw new Error('请先确认当前主播身份');
  const source=accountSource(url),rows=z.array(record).max(30).parse(input);
  for(const r of rows){
   if(r.url && (accountSource(r.url).kind!=='work' || accountSource(r.url).id!==r.id || accountSource(r.url).url!==r.url))throw new Error('作品来源链接无效');
   if(r.source!==source.url || (source.kind==='profile' ? r.subject!==source.id : r.kind!=='work' || r.id!==source.id) || !id(r.id) || !id(r.subject) || r.observedAt>this.now()+1000 || r.expiresAt-r.observedAt>86400000 || r.expiresAt<r.observedAt)throw new Error('采集资料与目标账号或时效不符');
  }
  this.forget(anchor,url);this.rows.push(...rows.map(r=>({...r,anchor})));this.rows=this.rows.filter(r=>r.expiresAt>this.now()).slice(-300);this.retriever.clear();
 }
 forget(anchor,url){this.rows=this.rows.filter(r=>r.anchor!==anchor || url && r.source!==accountSource(url).url);this.retriever.clear();}
 list(anchor){return structuredClone(this.rows.filter(r=>r.anchor===anchor && r.expiresAt>this.now()));}
 version(anchor){const now=this.now();return this.rows.filter(r=>r.anchor===anchor && r.expiresAt>now).map(r=>`${r.kind}:${r.id}:${r.source}:${r.observedAt}:${r.expiresAt}`).join('|');}
 snapshot(){return structuredClone(this.rows);}
 context(anchor,query){
  const labels={followers:'粉丝',following:'关注',works:'作品数',likes:'点赞',comments:'评论数',shares:'分享数'};
  const unique=new Map();for(const r of this.list(anchor).sort((a,b)=>a.observedAt-b.observedAt))unique.set(`${r.kind}:${r.id}`,r);
  const entries=[...unique.values()].map(r=>({id:`${r.kind}:${r.id}`,title:r.title,content:r.text+'\n页面计数（采集时）：'+Object.entries(r.counts).map(([k,v])=>`${labels[k] || k} ${v ?? '未知'}`).join('；'),source:r.url || r.source,updatedAt:r.observedAt,expiresOn:'',enabled:true}));
  return this.retriever(entries,query).chunks.slice(0,4).map(r=>({title:r.title,content:r.content,source:r.source,observedAt:r.updatedAt,coverage:'公开页面采样；作品标题不等于看过视频，不据此推断个人偏好或关系'}));
 }
}
