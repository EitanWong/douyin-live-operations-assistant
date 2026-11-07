import {z} from 'zod';
const day=86400000;
export const subjectKeySchema=z.string().regex(/^(?:uid:\d{1,30}|sec:[\w-]{8,160})$/u);
const level=z.object({value:z.number().int().min(0).max(200),at:z.number().finite()});
export const platformSchema=z.object({honor:level.nullable().default(null),fan:level.nullable().default(null)});
export const PROFILE_POLICY=Object.freeze({honor:40,fan:15,diamonds:1000,giftCount:100,levelAge:day,giftAge:30*day});
export const RESEARCH_BUDGETS=Object.freeze({standard:Object.freeze({modelCalls:0,searches:0,reads:0,sources:0}),deep:Object.freeze({modelCalls:0,searches:0,reads:0,sources:0})});
const recent=(at,now,age)=>Number.isFinite(at) && at<=now && now-at<=age;
export function observePlatform(previous,user,anchor,at){
 const next={honor:previous?.honor ?? null,fan:previous?.fan ?? null};
 for(const [key,value] of [['honor',user?.wealthLevel],['fan',user?.fanClubs?.find(r=>String(r.anchorId)===String(anchor))?.level]]){
  if(Number.isInteger(value) && value>=0 && value<=200 && at>=(next[key]?.at ?? 0))next[key]={value,at};
 }return next;
}
export function observedSupport(rows,now){
 const groups=new Map();
 for(const row of rows || []){
  if(!row.key || !recent(row.at,now,PROFILE_POLICY.giftAge) || !Number.isSafeInteger(row.count) || row.count<1 || row.count>1e9)continue;
  const old=groups.get(row.key),unit=Number.isFinite(row.unitDiamonds) && row.unitDiamonds>=0 && row.unitDiamonds<=1e9 ? row.unitDiamonds : null;
  groups.set(row.key,{count:Math.max(old?.count || 0,row.count),unitDiamonds:old && old.at>row.at ? old.unitDiamonds ?? unit : unit ?? old?.unitDiamonds ?? null,at:Math.max(old?.at || 0,row.at)});
 }
 let count=0,known=0,priced=0,unknown=0,overflow=false;
 for(const row of groups.values()){
  if(!Number.isSafeInteger(count+row.count)){overflow=true;continue;}count+=row.count;
  const value=row.count*row.unitDiamonds;
  if(row.unitDiamonds===null || !Number.isSafeInteger(value) || !Number.isSafeInteger(known+value)){unknown+=row.count;continue;}
  known+=value;priced+=row.count;
 }
 return {count,knownDiamonds:priced ? known : null,unknownPriceCount:unknown,partial:unknown>0 || overflow,from:now-PROFILE_POLICY.giftAge,through:now,basis:'deduplicated observed gifts in this room over 30 days; lower bound, not lifetime spending'};
}
export function audienceProfile(row,anchor,now=Date.now()){
 const platform=Object.fromEntries(['honor','fan'].map(key=>[key,recent(row.platform?.[key]?.at,now,PROFILE_POLICY.levelAge) ? row.platform[key] : null]));
 const gifts=observedSupport(row.gifts,now),role=row.key===`uid:${anchor}` ? 'anchor' : 'viewer';
 const reasons=[...(role==='anchor' ? ['current-anchor'] : []),...(platform.honor?.value>=PROFILE_POLICY.honor || platform.fan?.value>=PROFILE_POLICY.fan ? ['observed-level'] : []),...(gifts.knownDiamonds>=PROFILE_POLICY.diamonds || gifts.count>=PROFILE_POLICY.giftCount ? ['observed-support'] : [])];
 return {key:row.key,role,platform,gifts,chatCount:new Set((row.statements || []).filter(r=>r.id && recent(r.at,now,PROFILE_POLICY.giftAge)).map(r=>r.id)).size,
  research:{tier:reasons.length ? 'deep' : 'standard',priority:role==='anchor' ? 3 : reasons.length ? 2 : gifts.count ? 1 : 0,reasons},
  coverage:'Local observed identity and activity only; statements remain self-reports. No wealth, personality or private relationship inference.'};
}
export function subjectEpoch(state,key){return Math.max(state?.forgetBefore || 0,...(state?.forgotten || []).filter(r=>r.key===key).map(r=>r.at));}
export function subjectRow(state,key){return subjectKeySchema.safeParse(key).success ? state?.viewers?.find(r=>r.key===key && r.lastAt>subjectEpoch(state,key)) : undefined;}
export function profileSources(row,viewers){
 const ids=[...new Set([...(row.secUids || []),...(row.key.startsWith('sec:') ? [row.key.slice(4)] : [])])];
 if(ids.length!==1 || viewers.some(r=>r.key!==row.key && (r.secUids || []).includes(ids[0])))return [];
 return [`https://www.douyin.com/user/${ids[0]}`];
}
// The room profile is the existing authority for an anchor who has never chatted.
// It shares the audience deletion clock and must have been observed after it.
export function researchSubject(state,subject,{room,anchor,profile}={}){
 if(!subjectKeySchema.safeParse(subject).success)return null;
 const epoch=subjectEpoch(state,subject),row=subjectRow(state,subject);
 if(row)return {epoch,row,sources:profileSources(row,state.viewers)};
 if(state?.anchor!==anchor || subject!==`uid:${anchor}` || String(profile?.room)!==room || String(profile?.anchorId)!==anchor ||
  !subjectKeySchema.safeParse(`sec:${profile?.secUid}`).success || !Number.isFinite(profile?.updatedAt) || profile.updatedAt<=epoch ||
  state.viewers.some(viewer=>viewer.key!==subject && (viewer.secUids || []).includes(profile.secUid)))return null;
 return {epoch,name:profile.name || '',sources:[`https://www.douyin.com/user/${profile.secUid}`]};
}
