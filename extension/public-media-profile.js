import {subjectEpoch,researchSubject} from '../src/ai/audience-profile.js';
import {resolveResearchProfile} from '../src/ai/research-profile.js';

// Reuse canonical audience/room identity, deletion epoch and research tier.
export function createPublicMediaProfileResolver(read){
 return async({room,anchor,author,subject,ai})=>{
  const archive=await read(`live-assistant:live-memory:${room}:${anchor}`),state=archive?.anchor===anchor ? archive.audience : null;
  const profile=await read(`live-assistant:profile:${room}`),identity=key=>researchSubject(state,key,{room,anchor,profile});
  const url=`https://www.douyin.com/user/${author}`;
  if(!subject){
   const candidates=[...new Set([...(state?.viewers || []).map(row=>row.key),`uid:${anchor}`])].filter(key=>identity(key)?.sources.includes(url));
   if(candidates.length!==1)return {epoch:0,binding:null};
   subject=candidates[0];
  }
  const epoch=subjectEpoch(state,subject);
  if(!identity(subject)?.sources.includes(url))return {epoch,binding:null};
  try{return await resolveResearchProfile({room,anchor,subject,epoch,ai,question:'公开作品音轨',read});}
  catch{return {epoch,binding:null};}
 };
}
