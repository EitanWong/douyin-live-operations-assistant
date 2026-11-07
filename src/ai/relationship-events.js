import {z} from 'zod';
import {preferAccountName} from './account-names.js';
export const relationshipActor=z.object({key:z.string().max(180),name:z.string().max(80),role:z.string().max(20),identities:z.array(z.string().regex(/^(?:sec:[\w-]{8,160}|room:[1-9]\d{0,29})$/u)).max(16).optional()});
export const relationshipEvent=z.object({id:z.string().max(500),from:relationshipActor,to:relationshipActor,predicate:z.enum(['PK对局','同场连麦']),at:z.number().finite()});
const validId=value=>/^[1-9]\d{0,29}$/u.test(String(value || ''));
const user=(id,name,role,secUid,room)=>{
 const identities=[...(/^[\w-]{8,160}$/u.test(secUid || '') ? [`sec:${secUid}`] : []),...(validId(room) ? [`room:${room}`] : [])];
 return {key:`uid:${id}`,name:String(name || '').slice(0,80),role,...(identities.length ? {identities} : {})};
};
export const relationshipActorKeys=actor=>[actor.key,...(actor.identities || [])];
export function mergeRelationshipActor(previous,incoming){
 if(!previous)return incoming;if(!incoming)return previous;
 if(previous.key!==incoming.key)return incoming;
 const identities=[...new Set([...(previous.identities || []),...(incoming.identities || [])])].slice(-16);
 return {...incoming,name:preferAccountName(previous.name,incoming.name) ? incoming.name : previous.name,...(identities.length ? {identities} : {})};
}
export const mergeRelationshipEvent=(previous,incoming)=>({...incoming,from:mergeRelationshipActor(previous?.from,incoming.from),to:mergeRelationshipActor(previous?.to,incoming.to)});

export function observedMention(event){
 const target=event.atUser;if(!target)return null;
 const name=String(target.name || '被提及账号').slice(0,80);
 if(validId(target.id))return user(target.id,name,'被提及账号',target.secUid);
 return /^[\w-]{8,160}$/u.test(target.secUid || '') ? {key:`sec:${target.secUid}`,name,role:'被提及账号'} : null;
}

export function observedRelationships(event,anchor,at){
 if(!validId(anchor))return [];
 let predicate,targets=[],group;
 let self=user(anchor,'主播','主播');
 if(['pk-start','pk-score','pk-end'].includes(event.type) && event.battleId){
  predicate='PK对局';group=`pk:${event.battleId}`;
  const participants=Array.isArray(event.participants) ? event.participants : [];
  const own=participants.find(row=>String(row.anchorId)===anchor);
  self=user(anchor,own?.name || '主播','主播',own?.secUid,own?.roomId);
  targets=participants.map(row=>user(row.anchorId,row.name,'主播',row.secUid,row.roomId));
  if(validId(event.opponentId))targets.push(user(event.opponentId,event.opponentName,'主播'));
 }else if(['link-state','guest-link-state'].includes(event.type) && !event.channelFinished){
  predicate='同场连麦';group=`link:${event.channelId || event.id}`;
  // These protocol fields contain connected users. Invitations, layout names
  // and pending positions deliberately never enter the relationship graph.
  targets=(event.linkedUsers || []).map(row=>{const u=row.user || row;return user(u.id,u.name,'连麦账号',u.secUid);});
 }else return [];
 return targets.filter(row=>row.key!==self.key && validId(row.key.slice(4))).slice(0,24).flatMap(to=>{
  const parsed=relationshipEvent.safeParse({id:JSON.stringify([group,self.key,to.key]),from:self,to,predicate,at});
  return parsed.success ? [parsed.data] : [];
 });
}
