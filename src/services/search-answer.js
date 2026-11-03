import {z} from 'zod';

const answerSchema=z.strictObject({answer:z.string().trim().min(1).max(10000),sources:z.array(z.number().int().positive()).max(5)});
export function searchAnswer(output,found){
 let normalized=output.replace(/[【［](\d+)[】］]/gu,'[$1]');
 const json=normalized.trim().replace(/^```(?:json)?\s*/iu,'').replace(/\s*```$/u,'');
 if(json.startsWith('{') || /^\[\s*\{/u.test(json)){
  let parsed;try{parsed=answerSchema.parse(JSON.parse(json));}catch{throw new Error('AI 来源回答格式无效，请重试或更换支持JSON的回复模型');}
  normalized=parsed.answer.replace(/\[(\d+)\]/gu,'')+[...new Set(parsed.sources)].map(index=>`[${index}]`).join('');
 }
 const citations=[...normalized.matchAll(/\[(\d+)\]/gu)].map(match=>Number(match[1]));
 const valid=index=>found.results.some(row=>row.index===index);
 return {answer:normalized.replace(/\[(\d+)\]/gu,(match,index)=>valid(Number(index)) ? match : '').trim(),
  grounded:normalized!=='[SKIP]' && citations.length>0 && citations.every(valid)};
}
