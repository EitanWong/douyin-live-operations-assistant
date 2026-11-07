import {validateEndpoint} from './ai.js';

// Accept common SDK/gateway JSON and KEY=value exports. Only a connection is
// imported; unknown fields never become executable options or saved secrets.
export function parseAIConnection(text){
 if(typeof text!=='string' || text.length>64000)throw Error('连接配置最多64000字');
 let value;
 try{value=JSON.parse(text);}catch{
  value=Object.fromEntries(text.split(/\r?\n/u).flatMap(line=>{
   const match=line.match(/^\s*(?:export\s+)?([\w]+)\s*=\s*(.*?)\s*$/u);if(!match)return [];
   return [[match[1],match[2].replace(/^(['"])(.*)\1$/u,'$2')]];
  }));
 }
 if(!value || typeof value!=='object' || Array.isArray(value))throw Error('请导入一个 API 连接对象');
 const config=value.env && typeof value.env==='object' ? {...value,...value.env} : value;
 const string=(...keys)=>{const selected=keys.map(key=>config[key]).find(item=>typeof item==='string' && item.trim());return selected?.trim() || '';};
 let endpoint=string('endpoint','base_url','baseURL','OPENAI_BASE_URL','OPENAI_API_BASE');
 const model=string('model','OPENAI_MODEL'),key=string('api_key','apiKey','OPENAI_API_KEY');
 const api=string('api','wire_api','protocol');
 if(!endpoint || !model || model.length>200)throw Error('配置需要 base_url（或 endpoint）和 model');
 if(!/\/(?:responses|chat\/completions)\/?$/u.test(endpoint))endpoint=endpoint.replace(/\/+$/u,'')+(api==='responses' ? '/responses' : '/chat/completions');
 endpoint=validateEndpoint(endpoint.replace(/\/$/u,''));
 if(key.length>1000 || /\s/u.test(key))throw Error('API Key 格式无效');
 const reasoningEffort=string('reasoning_effort','reasoningEffort','model_reasoning_effort') || 'auto';
 if(!['auto','low','medium','high','xhigh','max'].includes(reasoningEffort))throw Error('推理深度无效，请使用 auto、low、medium、high、xhigh 或 max');
 return {endpoint,model,key,reasoningEffort};
}
