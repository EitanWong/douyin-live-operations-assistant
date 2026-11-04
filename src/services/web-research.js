const livePK=text=>/(?:抖音|直播).*pk|pk.*(?:规则|机制|时长|计分|加成)|首翻|首送双倍/iu.test(text);
const clip=text=>[...text].slice(0,300).join('');
const videoMetricClaim=content=>content.split(/[。；;\n]/u).some(clause=>/播放量.*(?:翻倍|排名|计算)|(?:翻倍|排名).*播放量/u.test(clause) && !/(?:不是|并非|不按|不能|不以|不等于|并不).{0,12}播放量/u.test(clause));

// Two complementary queries share a deadline, never an open-ended research loop.
export function researchQueries(question,plan){
 if(!livePK(`${question} ${plan.query}`))return [plan.query];
 return [...new Set([
  clip(`抖音直播PK 时长 计分 首送双倍 礼物任务 加成 ${plan.query}`),
  'site:streamingtool.douyin.com PK 规则 时长 计分 加成'
 ])];
}
function sourceEvidence(row){
 let url;try{url=new URL(row.url);}catch{return {index:row.index,kind:'third-party',caution:'来源地址无效，不能证明结论。'};}
 const official=url.hostname==='streamingtool.douyin.com' && url.pathname.startsWith('/docs/');
 const userContent=/(^|\.)douyin\.com$/u.test(url.hostname) && /^\/(?:video|user|search|shipin)(?:\/|$)/u.test(url.pathname);
 return {index:row.index,kind:official ? 'official-document' : userContent ? 'user-content' : 'third-party',
  caution:official ? '官方文档也仅证明正文实际支持的玩法与操作，不能补出时长、计分或倍率。' : userContent ? '用户作品、评论或搜索聚合，不等于官方；摘要可能来自评论，发布日期不一定是该说法的日期。' : '第三方摘要，须核对对象、日期、玩法和结论，不能仅凭标题或自称官方采信。'};
}
export function reviewResearch(question,found){
 const pk=livePK(`${question} ${found.query || ''} ${found.results.map(row=>`${row.title} ${row.content}`).join(' ')}`);
 const excluded=[...(found.excluded || [])],results=[];
 for(const row of found.results){
  if(pk && videoMetricClaim(row.content)){
   excluded.push({url:row.url,title:row.title,reason:'把视频播放量当作直播PK计分，不能支持直播规则。'});
  }else results.push(row);
 }
 return {...found,topic:pk ? 'live-pk' : null,results,evidence:results.map(sourceEvidence),excluded};
}
export async function collectResearch({question,plan,config,search,signal,timeout}){
 if(signal?.aborted)throw new Error('查询已取消');
 const queries=researchQueries(question,plan);
 const settled=await Promise.allSettled(queries.map(query=>search(query,config,{signal,timeout})));
 if(signal?.aborted)throw new Error('查询已取消');
 const searches=settled.map((entry,i)=>({query:queries[i],...(entry.status==='rejected' ? {error:entry.reason?.message || '查询失败'} : {count:entry.value.results.length,...(entry.value.error ? {error:entry.value.error} : {})})}));
 const batches=settled.filter(entry=>entry.status==='fulfilled').map(entry=>entry.value);
 const seen=new Set();
 const merged=batches.flatMap(batch=>batch.results).sort((a,b)=>Number(sourceEvidence(b).kind==='official-document')-Number(sourceEvidence(a).kind==='official-document'))
  .filter(row=>{if(seen.has(row.url))return false;seen.add(row.url);return true;});
 const base=batches[0] || {};
 const reviewed=reviewResearch(question,{...base,query:plan.query,results:merged,searches});
 const results=reviewed.results.slice(0,config.maxResults).map((row,i)=>({...row,index:i+1}));
 const error=results.length ? undefined : searches.map(row=>row.error).filter(Boolean).join('；') || '搜索没有返回适用资料';
 return {...reviewed,results,evidence:results.map(sourceEvidence),error};
}
