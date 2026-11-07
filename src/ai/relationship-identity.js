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

// A display dossier can collect unbound material without asserting an account
// identity. Never use a name to join two stable accounts or masked placeholders.
function displayProfileAliases(entities,canonical){
 const names=new Map(),aliases=new Map(),conflicts=[],targets=new Map();
 for(const row of entities){
  if(isMaskedName(row.name) || ['主播','公开账号'].includes(row.name))continue;
  const group=names.get(row.name) || {accounts:new Set(),profiles:new Set()};
  if(stableKey.test(row.key))group.accounts.add(canonical(row.key));
  else if(row.key.startsWith('manual:'))group.profiles.add(row.key);
  names.set(row.name,group);
 }
 for(const [name,{accounts,profiles}] of names){
  if(accounts.size>1){conflicts.push({name,accounts:accounts.size});continue;}
  const target=[...accounts][0] || [...profiles].toSorted()[0];
  for(const key of profiles){const values=targets.get(key) || new Set();values.add(target);targets.set(key,values);}
 }
 for(const [key,values] of targets)if(values.size===1 && !values.has(key))aliases.set(key,[...values][0]);
 return {aliases,conflicts:conflicts.toSorted((a,b)=>a.name.localeCompare(b.name))};
}

// A component may contain several room/secUID aliases, but never two UIDs.
// Keep conflicting components separate until their source records are corrected.
export function identityResolver(entities,{deduplicate=false}={}){
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
 const canonical=key=>aliases.get(key) || key;
 const projection=deduplicate ? displayProfileAliases(entities,canonical) : {aliases:sourceProfileAliases(entities,canonical),conflicts:[]};
 const resolve=key=>projection.aliases.get(key) || canonical(key);
 return Object.assign(resolve,{profileAliases:projection.aliases,conflicts:projection.conflicts});
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
