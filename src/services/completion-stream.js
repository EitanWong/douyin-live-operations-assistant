import {createParser} from 'eventsource-parser';
import {z} from 'zod';
// Providers may include usage, reasoning and audio metadata. Only text from
// choice 0 is reply evidence; unknown provider metadata is deliberately ignored.
const choiceSchema=z.object({index:z.number().int().optional(),delta:z.object({content:z.string().nullable().optional()}).optional(),finish_reason:z.string().nullable().optional()});
const chunkSchema=z.object({choices:z.array(choiceSchema).optional(),error:z.unknown().optional()});
export function parseCompletionStream(text){
  let content='',done=false,finishReason=null;
  const parser=createParser({onEvent(event){
    if(done)throw new Error('媒体服务流式响应结束后仍有数据');
    if(event.data.trim()==='[DONE]'){done=true;return;}
    let chunk;try{chunk=chunkSchema.parse(JSON.parse(event.data));}catch{throw new Error('媒体服务流式响应无效');}
    if(chunk.error!==undefined)throw new Error('媒体服务流式响应无效');
    const choice=chunk.choices?.find(c=>(c.index ?? 0)===0);
    content+=choice?.delta?.content || '';
    if(choice?.finish_reason)finishReason=choice.finish_reason;
  }});
  parser.feed(String(text).replace(/^\uFEFF/u,''));
  if(!done || finishReason!=='stop')throw new Error('媒体服务流式响应未完整结束，可能被截断或过滤');
  return {choices:[{message:{content}}]};
}
