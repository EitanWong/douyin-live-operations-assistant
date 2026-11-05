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
export function mergeAccountRecord(old,row){return old && row.kind==='profile' ? {...row,text:row.text.length>=old.text.length ? row.text : old.text,counts:Object.fromEntries(Object.entries(row.counts).map(([key,value])=>[key,value ?? old.counts[key] ?? null]))} : row;}
export function normalizeAccountPayload(payload,source,at=Date.now()){
 if(!payload || typeof payload!=='object' || payload.status_code && payload.status_code!==0)return [];
 const rows=[],seen=new Map(),stack=[payload];let visited=0;
 const add=row=>{const key=`${row.kind}:${row.id}`,index=seen.get(key),next={...row,source:source.url,observedAt:at,expiresAt:at+86400000};if(index===undefined){seen.set(key,rows.length);rows.push(next);}else rows[index]=mergeAccountRecord(rows[index],next);};
 while(stack.length && visited++<3000 && rows.length<30){
  const value=stack.pop();if(!value || typeof value!=='object' || privateRecord(value))continue;
  if(!Array.isArray(value)){
   if(source.kind==='profile' && value.sec_uid===source.id && typeof value.nickname==='string' && !privateRecord(value)){
    add({kind:'profile',id:source.id,subject:source.id,title:text(value.nickname,80),text:[text(value.nickname,80),text(value.signature,800),value.unique_id ? `公开账号：${text(value.unique_id,100)}` : '',value.custom_verify || value.enterprise_verify_reason ? `页面认证说明：${text(value.custom_verify || value.enterprise_verify_reason,160)}` : ''].filter(Boolean).join('：').slice(0,1200),counts:{followers:count(value.follower_count),following:count(value.following_count),works:count(value.aweme_count),likes:count(value.total_favorited)}});
   }
   const workId=id(value.aweme_id),subject=id(value.author?.sec_uid);
   if(workId && subject && !privateRecord(value) && !privateRecord(value.author) && (source.kind==='profile' ? subject===source.id : workId===source.id)){
    const title=text(value.desc,900),topics=Array.isArray(value.text_extra) ? value.text_extra.slice(0,8).map(row=>text(row?.hashtag_name,40)).filter(Boolean) : [];
    if(title)add({kind:'work',id:workId,subject,title:title.slice(0,80),text:[title,topics.length ? `页面话题：${topics.join('、')}` : '',value.music?.title ? `页面配乐：${text(value.music.title,80)}` : ''].filter(Boolean).join('；').slice(0,1200),
     url:`https://www.douyin.com/${value.aweme_type===68 ? 'note' : 'video'}/${workId}`,publishedAt:Number.isSafeInteger(value.create_time) ? value.create_time*1000 : null,
     counts:{likes:count(value.statistics?.digg_count),comments:count(value.statistics?.comment_count),shares:count(value.statistics?.share_count)}});
   }
  }
  for(const child of Object.values(value).slice(0,100))if(child && typeof child==='object' && stack.length<3000)stack.push(child);
 }
 return rows;
}
const record=z.object({kind:z.enum(['profile','work']),id:z.string().min(1).max(160),subject:z.string().min(1).max(160),role:z.enum(['selected','anchor','viewer']).default('selected'),title:z.string().max(80),text:z.string().max(1200),source:z.string().max(300),observedAt:z.number().finite(),expiresAt:z.number().finite(),counts:z.partialRecord(z.enum(['followers','following','works','likes','comments','shares']),z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()),url:z.string().max(300).optional(),publishedAt:z.number().finite().nullable().optional()});
const savedRecord=record.extend({anchor:z.string().max(80)}),historyAge=180*86400000;
function parseRecords(anchor,url,input,now){
 if(typeof anchor!=='string' || !anchor || anchor.length>80)throw new Error('请先确认当前主播身份');
 const source=accountSource(url),rows=z.array(record).max(30).parse(input);
 for(const r of rows){
  if(r.url && (accountSource(r.url).kind!=='work' || accountSource(r.url).id!==r.id || accountSource(r.url).url!==r.url))throw new Error('作品来源链接无效');
  if(r.source!==source.url || (source.kind==='profile' ? r.subject!==source.id : r.kind!=='work' || r.id!==source.id) || !id(r.id) || !id(r.subject) || r.observedAt>now+1000 || r.expiresAt-r.observedAt>86400000 || r.expiresAt<r.observedAt)throw new Error('采集资料与目标账号或时效不符');
 }
 return rows.map(r=>({...r,anchor}));
}
export class AccountContext {
 constructor({now=Date.now,snapshot}={}){this.now=now;this.rows=[];this.past=[];this.invalidated=new Set();this.retriever=createKnowledgeRetriever();if(snapshot)this.restore(snapshot);}
 restore(snapshot){
  const schema=z.object({version:z.literal(2),rows:z.array(savedRecord).max(300),history:z.array(savedRecord).max(3000),invalidated:z.array(z.string().max(400)).max(400)});
  const result=schema.safeParse(Array.isArray(snapshot) ? {version:2,rows:snapshot,history:[],invalidated:[]} : snapshot);if(!result.success)return;
  const valid=rows=>rows.flatMap(r=>{try{return parseRecords(r.anchor,r.source,[r],this.now());}catch{return [];}});
  this.rows=valid(result.data.rows).filter(r=>r.expiresAt>this.now());
  this.past=valid(result.data.history).filter(r=>r.kind==='work' && this.now()-r.observedAt<=historyAge);
  this.invalidated=new Set(result.data.invalidated);this.retriever.clear();
 }
 replace(anchor,url,input,{role='selected'}={}){
  const rows=parseRecords(anchor,url,input.map(r=>({...r,role})),this.now()),source=accountSource(url).url;
  this.invalidated.delete(`${anchor}:${source}`);this.rows=this.rows.filter(r=>r.anchor!==anchor || r.source!==source).concat(rows).filter(r=>r.expiresAt>this.now()).slice(-300);
  const unique=new Map(this.past.concat(rows.filter(r=>r.kind==='work')).filter(r=>this.now()-r.observedAt<=historyAge).map(r=>[`${r.anchor}:${r.source}:${r.id}:${r.observedAt}`,r]));
  this.past=[...unique.values()].slice(-3000);this.retriever.clear();
 }
 invalidate(anchor,url){const source=accountSource(url).url;this.invalidated.add(`${anchor}:${source}`);while(this.invalidated.size>400)this.invalidated.delete(this.invalidated.values().next().value);this.rows=this.rows.filter(r=>r.anchor!==anchor || r.source!==source);this.retriever.clear();}
 forget(anchor,url){const keep=r=>r.anchor!==anchor || url && r.source!==accountSource(url).url;this.rows=this.rows.filter(keep);this.past=this.past.filter(keep);this.retriever.clear();}
 list(anchor){return structuredClone(this.rows.filter(r=>r.anchor===anchor && r.expiresAt>this.now()));}
 history(anchor){return structuredClone(this.past.filter(r=>r.anchor===anchor && this.now()-r.observedAt<=historyAge && !this.invalidated.has(`${anchor}:${r.source}`)));}
 version(anchor){return [...this.list(anchor),...this.history(anchor)].map(r=>`${r.kind}:${r.id}:${r.source}:${r.observedAt}:${r.expiresAt}:${r.role}`).join('|');}
 snapshot(){return structuredClone({version:2,rows:this.rows,history:this.past,invalidated:[...this.invalidated]});}
 context(anchor,query,{subjects,includeHistory=false}={}){
  const labels={followers:'粉丝',following:'关注',works:'作品数',likes:'点赞',comments:'评论数',shares:'分享数'};
  const rows=[...(includeHistory ? this.history(anchor) : []),...this.list(anchor)].filter(r=>subjects ? r.role==='anchor' || subjects.includes(r.subject) : r.role!=='viewer');
  const unique=new Map();for(const r of rows.sort((a,b)=>a.observedAt-b.observedAt))unique.set(`${r.kind}:${r.id}:${r.subject}`,r);
  const byId=new Map([...unique.values()].map(r=>[`${r.kind}:${r.id}:${r.subject}`,r]));
  const entries=[...byId].map(([key,r])=>({id:key,title:r.title,content:r.text+'\n页面计数（采集时）：'+Object.entries(r.counts).map(([k,v])=>`${labels[k] || k} ${v ?? '未知'}`).join('；'),source:r.url || r.source,updatedAt:r.observedAt,expiresOn:'',enabled:true}));
  const recent=[...byId].filter(([,r])=>r.kind==='work' && Number.isFinite(r.publishedAt) && r.publishedAt<=this.now()).sort((a,b)=>b[1].publishedAt-a[1].publishedAt).slice(0,2);
  const selected=new Map(this.retriever(entries,query).chunks.slice(0,2).map(r=>[r.entryId,r]));
  for(const [key] of recent)if(!selected.has(key))selected.set(key,entries.find(e=>e.id===key));
  return [...selected.values()].slice(0,4).map(r=>{const evidence=byId.get(r.entryId || r.id),historical=evidence.expiresAt<=this.now();return {kind:evidence.kind,title:r.title,content:r.content,source:r.source,observedAt:r.updatedAt,publishedAt:evidence.publishedAt ?? null,subject:evidence.subject,role:evidence.role,historical,coverage:`${historical ? '历史作品描述，不能当作当前状态；' : ''}公开页面采样；publishedAt为页面发布时间，observedAt为采集时间。作品标题不等于看过视频，不据此推断个人偏好或关系`};});
 }
}
