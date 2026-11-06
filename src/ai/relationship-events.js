import {z} from 'zod';
const actor=z.object({key:z.string().max(180),name:z.string().max(80),role:z.string().max(20)});
export const relationshipEvent=z.object({id:z.string().max(500),from:actor,to:actor,predicate:z.enum(['PK对局','同场连麦']),at:z.number().finite()});
const validId=value=>/^\d{1,30}$/u.test(String(value || ''));
const user=(id,name,role)=>({key:`uid:${id}`,name:String(name || '').slice(0,80),role});

export function observedRelationships(event,anchor,at){
 if(!validId(anchor))return [];
 let predicate,targets=[],group;
 const self=user(anchor,'主播','主播');
 if(['pk-start','pk-score','pk-end'].includes(event.type) && event.battleId){
  predicate='PK对局';group=`pk:${event.battleId}`;
  const participants=Array.isArray(event.participants) ? event.participants : [];
  self.name=String(participants.find(row=>String(row.anchorId)===anchor)?.name || '主播').slice(0,80);
  targets=participants.map(row=>user(row.anchorId,row.name,'主播'));
  if(validId(event.opponentId))targets.push(user(event.opponentId,event.opponentName,'主播'));
 }else if(['link-state','guest-link-state'].includes(event.type) && !event.channelFinished){
  predicate='同场连麦';group=`link:${event.channelId || event.id}`;
  // These protocol fields contain connected users. Invitations, layout names
  // and pending positions deliberately never enter the relationship graph.
  targets=(event.linkedUsers || []).map(row=>{const u=row.user || row;return user(u.id,u.name,'连麦账号');});
 }else return [];
 return targets.filter(row=>row.key!==self.key && validId(row.key.slice(4))).slice(0,24).flatMap(to=>{
  const parsed=relationshipEvent.safeParse({id:JSON.stringify([group,self.key,to.key]),from:self,to,predicate,at});
  return parsed.success ? [parsed.data] : [];
 });
}
