import {jsonrepair} from 'jsonrepair';
import {z} from 'zod';

const base={query:z.string().trim(),reply:z.string().trim()};
const empty=z.string().trim().max(0);
// Model intent determines the legal payload, rather than independent flags.
export const intentSchema=z.discriminatedUnion('intent',[
 z.strictObject({intent:z.literal('web-search'),query:z.string().trim().min(1),reply:empty}),
 z.strictObject({intent:z.literal('skip'),query:empty,reply:empty}),
 ...['live-data','chat','clarify'].map(intent=>z.strictObject({...base,intent:z.literal(intent),query:empty}))
]);
export function parseAIIntent(raw,maxLength){
 if(typeof raw!=='string' || raw.length>12000)throw new Error('AI 意图识别结果过长');
 const value=raw.trim().replace(/^```(?:json)?\s*/iu,'').replace(/\s*```$/u,'');let input;
 try{try{input=JSON.parse(value);}catch{input=JSON.parse(jsonrepair(value));}}catch{throw new Error('AI 意图识别格式无效，请使用支持 JSON 指令的模型');}
 const parsed=intentSchema.safeParse(input);if(!parsed.success)throw new Error('AI 意图识别结果无效');
 const plan=parsed.data;
 if([...plan.query].length>300)throw new Error('AI 搜索词无效');
 if(!['skip','web-search'].includes(plan.intent) && (!plan.reply || [...plan.reply].length>maxLength))throw new Error('AI 回复为空或超过字数限制');
 return plan;
}
