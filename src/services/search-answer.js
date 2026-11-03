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

export function unavailableCurrentAnswer(found,maxLength=50){
 const disabled=/未启用/u.test(found.error || ''),reason=/429|限流/u.test(found.error || '') ? '搜索限流' : disabled ? '联网未启用' : '查询未成功';
 const next=disabled ? '请启用联网搜索。' : '请稍后重试。';
 const render=query=>`暂未查到“${query}”的实时资料，${reason}，${next}`;
 const room=maxLength-[...render('')].length;
 return room>0 ? render([...found.query].slice(0,Math.min(22,room)).join('')) : [...'实时资料未获取，请稍后重试。'].slice(0,maxLength).join('');
}
