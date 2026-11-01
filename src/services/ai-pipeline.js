// A preset is a projection, never a rewrite of the user's saved text connection.
export const AI_PIPELINE_DEFAULTS={mode:'custom',region:'cn-beijing',workspaceId:'',realtimeModel:'qwen3.8-omni-flash-realtime',replyModel:'qwen3.8-omni-flash',visionModel:'qwen3-vl-plus',audioModel:'qwen3-asr-flash',contextBudgetChars:48000,sessionMinutes:30,sessionTokens:100000};
export const AI_PIPELINE_MODES=[['custom','自定义 / 保留原有配置'],['text','仅文字模型'],['omni-llm','Omni 实时感知 + 现有文字模型回复'],['omni-only','Omni 实时感知 + Omni 回复'],['ali-split','阿里视觉 + 语音分段识别 + 现有文字模型回复']];
const aliModes=['omni-llm','omni-only','ali-split'];
export function pipelineConfig(ai){return {...AI_PIPELINE_DEFAULTS,...ai?.pipeline};}
export function validatePipeline(ai){
  const p=pipelineConfig(ai);
  if(!AI_PIPELINE_MODES.some(([mode])=>mode===p.mode))throw new Error('AI 组合无效');
  if(!['cn-beijing','ap-southeast-1'].includes(p.region))throw new Error('百炼地域无效');
  if(typeof p.workspaceId!=='string' || (p.workspaceId && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(p.workspaceId)) || aliModes.includes(p.mode) && !p.workspaceId)throw new Error('请填写百炼业务空间 ID（不是 API Key）');
  for(const key of ['realtimeModel','replyModel','visionModel','audioModel'])if(typeof p[key]!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/u.test(p[key]))throw new Error('百炼模型名称无效');
  for(const [key,min,max] of [['contextBudgetChars',16000,70000],['sessionMinutes',1,60],['sessionTokens',1000,1000000]])if(!Number.isInteger(p[key]) || p[key]<min || p[key]>max)throw new Error(`AI ${key} 范围为 ${min}–${max}`);
  return p;
}
export function aliEndpoints(ai){
  const p=validatePipeline(ai);if(!p.workspaceId)throw new Error('请填写百炼业务空间 ID');
  const origin=`https://${p.workspaceId}.${p.region}.maas.aliyuncs.com`;
  return {chat:`${origin}/compatible-mode/v1/chat/completions`,realtime:`${origin}/api/v1/webrtc/realtime?model=${encodeURIComponent(p.realtimeModel)}`};
}
export function resolveReplyConfig(ai){return pipelineConfig(ai).mode==='omni-only' ? {...ai,endpoint:aliEndpoints(ai).chat,model:pipelineConfig(ai).replyModel} : ai;}
export function resolveMediaConfig(ai){
  const p=pipelineConfig(ai),base={...ai.media};
  if(p.mode==='custom')return base;
  if(p.mode==='text')return {...base,videoEnabled:false,audioEnabled:false,omniEnabled:false};
  const urls=aliEndpoints(ai);
  return {...base,videoEnabled:true,audioEnabled:true,omniEnabled:p.mode!=='ali-split',transport:p.mode==='ali-split' ? 'sampled' : 'webrtc',
    visionEndpoint:urls.chat,audioEndpoint:urls.chat,visionModel:p.mode==='ali-split' ? p.visionModel : p.realtimeModel,audioModel:p.audioModel,
    realtimeEndpoint:urls.realtime,realtimeModel:p.realtimeModel,sessionMinutes:p.sessionMinutes,sessionTokens:p.sessionTokens};
}
export function validateRealtimeEndpoint(value){
  let url;try{url=new URL(value);}catch{throw new Error('实时接口地址无效');}
  if(url.protocol!=='https:' || url.username || url.password || url.port || url.hash || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com$/u.test(url.hostname)
    || url.pathname!=='/api/v1/webrtc/realtime' || [...url.searchParams.keys()].join(',')!=='model' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/u.test(url.searchParams.get('model') || ''))throw new Error('仅支持百炼业务空间 WebRTC 实时接口');
  return url.href;
}
export function validateSDP(value){if(typeof value!=='string' || value.length>100000 || !/^v=0\r?\n/u.test(value) || !/^m=(audio|video|application) /mu.test(value))throw new Error('实时会话 SDP 无效');return value;}
