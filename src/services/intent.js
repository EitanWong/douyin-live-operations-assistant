import { jsonrepair } from 'jsonrepair';

// Models behind Chat Completions gateways do not all offer native structured
// outputs. Repair JSON syntax, then validate the small intent contract strictly.
export function parseAIIntent(raw,maxLength) {
  if(typeof raw!=='string' || raw.length>12000)throw new Error('AI 意图识别结果过长');
  const value=raw.trim().replace(/^```(?:json)?\s*/iu,'').replace(/\s*```$/u,'');
  let plan;
  try {try{plan=JSON.parse(value);}catch{plan=JSON.parse(jsonrepair(value));}}catch{throw new Error('AI 意图识别格式无效，请使用支持 JSON 指令的模型');}
  if(!plan || Array.isArray(plan) || typeof plan!=='object' || Object.keys(plan).some(key=>!['intent','query','reply'].includes(key))
    || !['live-data','web-search','chat','clarify','skip'].includes(plan.intent) || typeof plan.reply!=='string' || typeof plan.query!=='string')throw new Error('AI 意图识别结果无效');
  plan.reply=plan.reply.trim();plan.query=plan.query.trim();
  if([...plan.query].length>300 || plan.intent==='web-search' && !plan.query)throw new Error('AI 搜索词无效');
  if(!['skip','web-search'].includes(plan.intent) && (!plan.reply || [...plan.reply].length>maxLength))throw new Error('AI 回复为空或超过字数限制');
  return plan;
}
