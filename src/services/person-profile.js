import {personProfileSchema,profileOutputSchema,PROFILE_FIELDS} from '../ai/person-profile.js';
const cancelled=()=>Object.assign(Error('人物整理已取消'),{name:'AbortError'});
export async function updatePersonProfile({name,key='',profile,message,signal},config,client){
 if(signal?.aborted)throw cancelled();
 if(profile){profile=personProfileSchema.parse(profile);if(profile.name!==name || profile.key!==key)throw Error('人物已变化，请重新打开资料');}
 const turns=[...(profile?.turns || []),{text:String(message || '').trim(),at:Date.now()}];
 // Validate the complete input before any model request, including raw history.
 const base=personProfileSchema.safeParse({version:1,name,key,turns,facts:[],relationships:[],analysis:[],knowledge:[],reply:'待整理'});
 if(!base.success)throw Error('人物资料格式无效：每轮1–4000字，最多16轮、12000字；名称与账号需有效');
 const input={name,key,turns:base.data.turns};
 const raw=await client({task:{kind:'person-profile'},profileConversation:input,maxLength:2000,signal},config);
 if(signal?.aborted)throw cancelled();
 if(typeof raw!=='string' || raw.length>50000)throw Error('人物整理结果过长或无效');
 let value;try{value=profileOutputSchema.parse(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/iu,'').replace(/\s*```$/u,'')));}catch{throw Error('人物整理格式或心理解读无效，请重试；原资料已保留');}
 const parsed=personProfileSchema.safeParse({...value,version:1,name,key,turns});
 if(!parsed.success)throw Error('人物整理缺少可核对原话或当前字段存在冲突；原资料已保留');
 profileMemoryEntry(parsed.data);return parsed.data;
}
export function profileMemoryEntry(profile,{id=crypto.randomUUID(),source='用户补充 · AI整理，待核实',expiresOn='',enabled=true}={}){
 profile=personProfileSchema.parse(profile);
 const lines=[`人物：${profile.name}。`,...profile.facts.map(f=>`${PROFILE_FIELDS[f.field]}：${f.value}。`),...profile.relationships.map(r=>`${profile.name}${r.negative ? '不是' : '是'}${r.name}的${r.predicate}。`),...profile.knowledge.map(k=>`一般知识（非人物结论）：${k.text}`)];
 const content=lines.join('\n');if(content.length>2000)throw Error('整理后的当前资料超过2000字，请分次精简；对话原文已保留');
 return {id,title:`${profile.name} · 人物资料`,content,source,updatedAt:Date.now(),expiresOn,enabled,trust:'unverified',person:profile};
}
