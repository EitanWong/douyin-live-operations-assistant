import {DEFAULTS} from '../core/engine.js';

export const AI_SECRET_PREFIXES=['api-key','search-key','media-key','task-key'].map(kind=>`live-assistant:${kind}:`);
export const isAISecretKey=key=>AI_SECRET_PREFIXES.some(prefix=>key.startsWith(prefix));

// Only connection/model choices belong here. Runtime switches, prompts, cadence,
// sampling, budgets and context preferences remain owned by each room.
export const AI_SERVICE_GROUPS={
 reply:['endpoint','model'],
 research:['taskModels.research.enabled','taskModels.research.endpoint','taskModels.research.model'],
 profile:['taskModels.profile.enabled','taskModels.profile.endpoint','taskModels.profile.model'],
 pipeline:['pipeline.region','pipeline.workspaceId','pipeline.realtimeModel','pipeline.replyModel','pipeline.visionModel','pipeline.audioModel','pipeline.localVisionEndpoint','pipeline.localVisionModel'],
 vision:['media.visionEndpoint','media.visionModel'],
 audio:['media.audioEndpoint','media.audioModel'],
 search:['search.provider','search.endpoint']
};
const clone=value=>structuredClone(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const at=(ai,path)=>path.split('.').reduce((value,key)=>value?.[key],ai);
const group=(ai,paths)=>Object.fromEntries(paths.map(path=>[path,at(ai,path) ?? at(DEFAULTS.ai,path)]));
export const selectAIServices=config=>Object.fromEntries(Object.entries(AI_SERVICE_GROUPS).map(([name,paths])=>[name,group(config.ai,paths)]));
export function migrateAIServices(configs){
 const result={};
 for(const [name,paths] of Object.entries(AI_SERVICE_GROUPS)){
  const defaults=group(DEFAULTS.ai,paths);
  result[name]=configs.map(config=>group(config.ai,paths)).find(value=>!same(value,defaults)) || defaults;
 }
 return result;
}
export function projectSharedAIServices(config,services){
 const result=clone(config);if(!services)return result;
 result.ai ||= {};
 for(const values of Object.values(services))for(const [path,value] of Object.entries(values)){
  const keys=path.split('.'),key=keys.pop();let target=result.ai;
  for(const part of keys)target=target[part] ||= {};
  target[key]=clone(value);
 }
 return result;
}
export function mergeSharedAIServices(current,config,base){
 const next=clone(current);
 for(const [name,paths] of Object.entries(AI_SERVICE_GROUPS)){
  const before=group(base.ai,paths),incoming=group(config.ai,paths);
  if(same(before,incoming))continue;
  if(!same(current[name],before) && !same(current[name],incoming))throw Error('其他窗口已更正同一项 AI 服务连接，请保留草稿并重新载入后核对');
  next[name]=incoming;
 }
 return next;
}
