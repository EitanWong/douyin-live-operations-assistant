import {jsonrepair} from 'jsonrepair';
import {z} from 'zod';
import {weatherPlanSchema} from './weather.js';
import {DEFAULT_TIME_ZONE,validTimeZone} from './current-facts.js';
import {publicDataIntentSchema} from './public-data.js';
import {corpusReferenceSchema} from '../ai/source-evidence.js';

const empty=z.string().trim().max(0);
const base={query:empty.default(''),reply:z.string().trim()};
// Model intent determines the legal payload, rather than independent flags.
export const intentSchema=z.discriminatedUnion('intent',[
 weatherPlanSchema,
 publicDataIntentSchema,
 z.strictObject({intent:z.literal('clock'),timeZone:z.string().refine(validTimeZone).default(DEFAULT_TIME_ZONE)}),
 z.strictObject({intent:z.literal('web-search'),query:z.string().trim().min(1).refine(value=>!/corpus:/iu.test(value)),reply:empty.default(''),freshness:z.enum(['realtime','rules','stable','short']).optional()}),
 z.strictObject({intent:z.literal('research'),query:z.string().trim().min(1).max(300),reply:empty.default('')}),
 z.strictObject({intent:z.literal('knowledge'),query:z.union([z.string().uuid(),corpusReferenceSchema]),reply:z.string().trim().min(1),sources:z.array(z.number().int().positive()).max(5).optional()}),
 z.strictObject({intent:z.literal('skip'),query:empty.default(''),reply:empty.default('')}),
 ...['live-data','chat','clarify'].map(intent=>z.strictObject({...base,intent:z.literal(intent)}))
]);
export function parseAIIntent(raw,maxLength,{chatReply}={}){
 if(typeof raw!=='string' || raw.length>12000)throw new Error('AI 意图识别结果过长');
 const value=raw.trim().replace(/^```(?:json)?\s*/iu,'').replace(/\s*```$/u,'');let input;
 try{try{input=JSON.parse(value);}catch{input=JSON.parse(jsonrepair(value));}}catch{throw new Error('AI 意图识别格式无效，请使用支持 JSON 指令的模型');}
 const parsed=intentSchema.safeParse(input);if(!parsed.success)throw new Error('AI 意图识别结果无效');
 const plan=parsed.data;
 if(plan.intent==='chat' && chatReply)plan.reply=chatReply;
 if(plan.query && [...plan.query].length>300)throw new Error('AI 搜索词无效');
 if(!['skip','web-search','research','weather','clock','public-data'].includes(plan.intent) && (!plan.reply || [...plan.reply].length>maxLength))throw new Error('AI 回复为空或超过字数限制');
 return plan;
}
