import {z} from 'zod';
import {validateEndpoint} from './ai.js';
import {pipelineConfig,resolveReplyConfig} from './ai-pipeline.js';

export const AI_TASK_MODELS=Object.freeze({research:'后台研究',profile:'人物整理'});
export const BACKGROUND_MODEL_TEMPLATE=Object.freeze({endpoint:'https://api.openai.com/v1/responses',model:'gpt-6.1-terra',reasoningEffort:'high'});
export const AI_TASK_DEFAULTS=Object.freeze({research:Object.freeze({enabled:false,...BACKGROUND_MODEL_TEMPLATE})});
const configured=connection=>Boolean(connection?.enabled && connection.endpoint?.trim() && connection.model?.trim());
export const taskSecretKey=(kind,endpoint)=>`live-assistant:task-key:${kind}:${new URL(endpoint).origin}`;
export function taskModelSecret(ai,kind){
 const selected=configured(ai.taskModels?.research) ? 'research' : null;
 return selected ? taskSecretKey(selected,ai.taskModels[selected].endpoint) : ai.taskKind===kind ? ai.taskCredential || null : null;
}
export const REASONING_EFFORTS=[['auto','服务商默认（兼容所有模型）'],['high','高 · 深度推理'],['xhigh','更高（模型需支持）'],['max','最高（模型需支持）'],['medium','中'],['low','低']];
const connection=z.strictObject({enabled:z.boolean(),endpoint:z.string().trim().max(2000),model:z.string().trim().max(200),reasoningEffort:z.enum(REASONING_EFFORTS.map(([key])=>key))});
export function validateTaskModels(ai){
 const result={};
 for(const kind of Object.keys(AI_TASK_DEFAULTS)){
  const parsed=connection.safeParse({...AI_TASK_DEFAULTS[kind],...ai?.taskModels?.[kind]});
  try{
   if(!parsed.success)throw Error(`${AI_TASK_MODELS[kind]}模型配置无效`);
   const value=parsed.data;
   if(configured(value))value.endpoint=validateEndpoint(value.endpoint);
   result[kind]=value;
  }catch(error){error.field=`ai.taskModels.${kind}.${parsed.success && parsed.data.model ? 'endpoint' : 'model'}`;throw error;}
 }
 return result;
}

// Resolve once at each task boundary. The text projection prevents an Omni
// reply preset from subsequently overriding a selected background connection.
export function resolveAITaskConfig(ai,kind='reply'){
 if(kind==='reply')return resolveReplyConfig(ai);
 if(!Object.hasOwn(AI_TASK_MODELS,kind))throw Error('AI 任务类型无效');
 const models=validateTaskModels(ai),selected=configured(models.research) ? models.research : resolveReplyConfig(ai);
 const endpoint=validateEndpoint(selected.endpoint),credential=taskModelSecret(ai,kind) || `live-assistant:${pipelineConfig(ai).mode==='omni-only' ? 'media-key' : 'api-key'}:${new URL(endpoint).origin}`;
 return {...ai,endpoint,model:selected.model,reasoningEffort:selected.reasoningEffort || 'auto',taskKind:kind,taskCredential:credential,pipeline:{...ai.pipeline,mode:'text'}};
}
