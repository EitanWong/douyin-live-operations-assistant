export const isResponsesEndpoint=endpoint=>new URL(endpoint).pathname.endsWith('/responses');
export const AI_REQUEST_LIMIT=1000000;
export const AI_RESPONSE_LIMIT=2000000;

export function responsesRequest(body){
 const {messages,max_tokens,max_completion_tokens,reasoning_effort,temperature,stream,modalities,thinking,...rest}=body;
 return {...rest,input:messages,stream:false,store:false,
  ...((max_completion_tokens || max_tokens) ? {max_output_tokens:max_completion_tokens || max_tokens} : {}),
  ...(reasoning_effort ? {reasoning:{effort:reasoning_effort}} : {})};
}

export function responsesResult(data){
 if(data.error || data.status && data.status!=='completed')throw Error(`Responses 研究未完成：${data.incomplete_details?.reason || data.error?.message || data.status}`);
 const content=typeof data.output_text==='string' ? data.output_text : (data.output || []).filter(row=>row.type==='message' && row.role==='assistant').flatMap(row=>row.content || []).filter(row=>row.type==='output_text').map(row=>row.text).join('');
 if(!content)throw Error('Responses 模型没有返回最终文本');
 return {...data,choices:[{message:{content}}]};
}
