import {isMaskedName} from './account-names.js';

const stableKey=/^(?:uid:[1-9]\d{0,39}|sec:[A-Za-z0-9_.=-]{1,200}|room:[1-9]\d{0,39})$/u;

function sourceProfileAliases(entities,canonical){
 const names=new Map(),aliases=new Map();
 for(const row of entities){
  if(!stableKey.test(row.key) || !row.scope || isMaskedName(row.name))continue;
  const name=JSON.stringify([row.scope,row.name]),keys=names.get(name) || new Set();
  keys.add(canonical(row.key));names.set(name,keys);
 }
 for(const row of entities){
  if(!row.key.startsWith('manual:') || !row.origin || isMaskedName(row.name))continue;
  const scope=JSON.stringify([row.origin.room,row.origin.anchor]),keys=names.get(JSON.stringify([scope,row.name]));
  const host=canonical(`uid:${row.origin.anchor}`);
  // Shared profiles retain their original room/host context. Reuse that host's
  // unique observed node in the projection; never write an inferred account key.
  if(keys?.size===1 && keys.has(host))aliases.set(row.key,host);
 }
 return aliases;
}

// A component may contain several room/secUID aliases, but never two UIDs.
// Keep conflicting components separate until their source records are corrected.
export function identityResolver(entities){
 const links=new Map(),aliases=new Map(),visited=new Set();
 for(const row of entities)for(const other of row.identities || []){
  if(!stableKey.test(row.key) || !stableKey.test(other) || row.key===other)continue;
  for(const [a,b] of [[row.key,other],[other,row.key]]){
   if(!links.has(a))links.set(a,new Set());links.get(a).add(b);
  }
 }
 for(const start of links.keys()){
  if(visited.has(start))continue;
  const component=[],pending=[start];visited.add(start);
  while(pending.length){
   const key=pending.pop();component.push(key);
   for(const other of links.get(key))if(!visited.has(other)){visited.add(other);pending.push(other);}
  }
  const uids=component.filter(key=>key.startsWith('uid:')),secs=component.filter(key=>key.startsWith('sec:'));
  if(uids.length>1 || !uids.length && secs.length>1)continue;
  const key=uids[0] || secs[0] || component.toSorted()[0];
  for(const id of component)aliases.set(id,key);
 }
 const canonical=key=>aliases.get(key) || key,profiles=sourceProfileAliases(entities,canonical);
 return key=>profiles.get(key) || canonical(key);
}

// Read only explicit fields in operator-verified records. Source room and
// arbitrary public/self-reported prose do not identify the person being named.
export function operatorIdentity(document){
 if(document.trust!=='verified')return null;
 const name=document.text.match(/(?:^|[。\n])人物[：:]\s*([^；;。\n]{1,40})/u)?.[1]?.trim();
 if(!name)return null;
 const fields=[...document.text.matchAll(/(?:^|[；;。\n])\s*(UID|secUID|直播间号)[：:]\s*([A-Za-z0-9_.=-]+)\s*(?=[；;。\n]|$)/giu)];
 const identities=[...new Set(fields.map(([,field,id])=>`${field.toLowerCase()==='uid' ? 'uid' : field.toLowerCase()==='secuid' ? 'sec' : 'room'}:${id}`).filter(key=>stableKey.test(key)))];
 if(!identities.length || ['uid:','sec:','room:'].some(prefix=>identities.filter(key=>key.startsWith(prefix)).length>1))return null;
 const key=identities.find(id=>id.startsWith('uid:')) || identities.find(id=>id.startsWith('sec:')) || identities[0];
 return {key,name,identities};
}
