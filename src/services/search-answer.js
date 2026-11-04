import {z} from 'zod';

const answerSchema=z.strictObject({answer:z.string().trim().min(1).max(10000),sources:z.array(z.number().int().positive()).max(5)});
const citationPattern=/[【［\[]\^?(\d+(?:\s*[,，、]\s*\d+)*)[】］\]]/gu;
export const spokenAnswer=output=>output.replace(citationPattern,'').trim();
export function searchAnswer(output,found){
 let normalized=output;
 let citationIndices=[...output.matchAll(citationPattern)].flatMap(match=>match[1].split(/[,，、]/u).map(Number));
 const json=normalized.trim().replace(/^```(?:json)?\s*/iu,'').replace(/\s*```$/u,'');
 if(json.startsWith('{') || /^\[\s*\{/u.test(json)){
  let parsed;try{parsed=answerSchema.parse(JSON.parse(json));}catch{throw new Error('AI 来源回答格式无效，请重试或更换支持JSON的回复模型');}
  normalized=parsed.answer;citationIndices=parsed.sources;
 }
 citationIndices=[...new Set(citationIndices)];
 const valid=index=>found.results.some(row=>row.index===index);
 const answer=spokenAnswer(normalized);
 return {answer,citationIndices,grounded:Boolean(answer) && answer!=='[SKIP]' && citationIndices.length>0 && citationIndices.every(valid)};
}

export function unavailableCurrentAnswer(found,maxLength=50){
 const render=query=>`“${query}”的资料暂时没查到，还不能确定。`;
 const room=maxLength-[...render('')].length;
 return room>0 ? render([...found.query].slice(0,Math.min(22,room)).join('')) : [...'暂时没查到，还不能确定。'].slice(0,maxLength).join('');
}
