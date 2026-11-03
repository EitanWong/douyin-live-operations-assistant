import {withDeadline} from './ai-resilience.js';
// Explicit requests only. Local chat does not send every viewer statement to a search service.
const needsSearch=text=>/联网|搜索|搜一下|搜一搜|查一下.{0,20}(?:天气|新闻|最新|价格|资料)|最新.{0,12}(?:新闻|消息|政策|版本)/u.test(text || '');
export function createLocalReply({edge,search}){
 return async(prompt,config)=>{
  if(!needsSearch(prompt.target?.text))return edge.reply(prompt,config);
  if(!config.search?.enabled || !search)return '联网搜索尚未启用，暂时无法查询。';
  let found;
  try{found=await withDeadline(signal=>search(prompt.target.text.slice(0,300),config.search,{signal,timeout:1800}),{signal:prompt.signal,timeout:1800});}
  catch(error){if(prompt.signal?.aborted)throw error;return '联网搜索暂不可用，暂时无法确认。';}
  if(prompt.signal?.aborted)throw new Error('联网查询已取消');
  if(!found.results?.length)return '暂时没查到可靠资料。';
  const result=await edge.reply({...prompt,searchResults:found},config),citations=[...result.matchAll(/\[(\d+)\]/gu)].map(m=>Number(m[1]));
  return result==='[SKIP]' || citations.length && citations.every(index=>found.results.some(row=>row.index===index)) ? result : '搜索资料不足，暂时无法确认。';
 };
}
