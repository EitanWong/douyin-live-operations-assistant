import {AI_PIPELINE_DEFAULTS as defaults} from '../services/ai-pipeline.js';

export const AI_SERVICE_PRESETS = {
  deepseek: ['https://api.deepseek.com/chat/completions', 'deepseek-flash'],
  qwen: ['https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', 'qwen-plus'],
  doubao: ['https://ark.cn-beijing.volces.com/api/v3/chat/completions', '请填写你的接入点ID'],
  local: ['http://localhost:11434/v1/chat/completions', 'qwen2.5:7b']
};

// Curated IDs, not an account's live model list. Keep transport capabilities separate.
const recommended=id=>[id,`${id}（推荐）`];
const options=(...ids)=>ids.map(id=>[id,id]);
export const AI_MODEL_OPTIONS={
  realtime:[recommended(defaults.realtimeModel),...options('qwen3.5-omni-flash-realtime','qwen3.5-omni-plus-realtime')],
  omni:[recommended(defaults.replyModel),...options('qwen3.5-omni-flash','qwen3.5-omni-plus')],
  vision:[recommended(defaults.visionModel),...options('qwen3-vl-flash')],
  audio:[recommended(defaults.audioModel)],
  deepseek:[recommended(AI_SERVICE_PRESETS.deepseek[1]),...options('deepseek-v4-pro','deepseek-chat','deepseek-reasoner')],
  qwen:[recommended(AI_SERVICE_PRESETS.qwen[1]),...options('qwen-flash','qwen-turbo','qwen-max')],
  local:[recommended(AI_SERVICE_PRESETS.local[1]),...options('qwen3:8b','qwen3:14b','deepseek-r1:8b')],
  doubao:[]
};
export function replyModelOptions(provider){
  return AI_MODEL_OPTIONS[provider] || [...AI_MODEL_OPTIONS.deepseek,...AI_MODEL_OPTIONS.qwen,...AI_MODEL_OPTIONS.omni];
}
