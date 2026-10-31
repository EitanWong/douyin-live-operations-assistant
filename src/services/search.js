export const SEARCH_PROVIDERS = {bocha:{label:'博查',endpoint:'https://api.bochaai.com/v1/web-search'},tavily:{label:'Tavily',endpoint:'https://api.tavily.com/search'},searxng:{label:'SearXNG（自建）',endpoint:'http://localhost:8080/search'}};
export const SEARCH_DEFAULTS = {enabled:false,provider:'bocha',endpoint:SEARCH_PROVIDERS.bocha.endpoint,maxResults:3,maxPerHour:60};

export function validateSearchEndpoint(value, provider) {
  let url; try {url=new URL(value);} catch {throw new Error('搜索接口地址无效');}
  const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  const suffix=provider==='bocha' ? '/web-search' : ['tavily','searxng'].includes(provider) ? '/search' : null;
  if ((url.protocol!=='https:' && !(local && url.protocol==='http:')) || url.username || url.password || url.search || url.hash
    || (suffix ? !url.pathname.endsWith(suffix) : !url.pathname.endsWith('/search') && !url.pathname.endsWith('/web-search'))) throw new Error('请使用 HTTPS 的博查 /web-search 或 Tavily、SearXNG /search 地址（本地可用 HTTP），不要包含账号或查询参数');
  return url.href;
}

export function validateSearchBody(body,provider='tavily') {
  const query=provider==='searxng' ? body?.q : body?.query;
  if (typeof query!=='string' || !query.trim() || [...query].length>300)throw new Error('搜索请求无效');
  if(provider==='searxng'){
    if(body.format!=='json' || String(body.pageno)!=='1' || Object.keys(body).some(key=>!['q','format','pageno'].includes(key)))throw new Error('搜索请求无效');
    return body;
  }
  const bocha=provider==='bocha',count=bocha ? body.count : body.max_results;
  const keys=bocha ? ['query','count','summary','freshness'] : ['query','max_results','search_depth','include_answer','include_raw_content'];
  if (!['bocha','tavily'].includes(provider) || !Number.isInteger(count) || count<1 || count>5
    || (bocha ? body.summary!==true || body.freshness!=='noLimit' : body.search_depth!=='basic' || body.include_answer!==false || body.include_raw_content!==false)
    || Object.keys(body).some(key=>!keys.includes(key))) throw new Error('搜索请求无效');
  return body;
}

function parseResponse(response,url) {
  if(!response || typeof response!=='object')throw new Error('服务响应状态无效');
  if(response.error)throw new Error(response.error);
  if(!Number.isInteger(response.status))throw new Error('服务响应状态无效');
  if(response.status<200 || response.status>=300)throw new Error(`HTTP ${response.status}，请检查接口、余额和模型名`);
  if(response.finalUrl) {
    let finalURL;
    try {finalURL=new URL(response.finalUrl);} catch {throw new Error('服务响应地址无效');}
    if(finalURL.origin!==new URL(url).origin)throw new Error('服务跳转到了其他域名，请改用直接接口地址');
  }
  try {return JSON.parse(response.responseText);} catch {throw new Error('服务响应不是有效 JSON');}
}

export function requestJSON(request, {url,key,body,timeout=25000,operation='ai',provider,form=false}) {
  return new Promise((resolve,reject)=>{
    let settled=false, handle;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);if(error)reject(error);else resolve(value);};
    const timer=setTimeout(()=>{finish(new Error(operation==='search' ? '联网搜索超时' : 'AI 请求超时'));try {handle?.abort?.();} catch {}},timeout);
    try {
      handle=request({method:'POST',url,operation,searchProvider:provider,anonymous:true,timeout,responseType:'text',
        headers:{'Content-Type':form ? 'application/x-www-form-urlencoded' : 'application/json',...(key ? {Authorization:`Bearer ${key}`} : {})},data:form ? new URLSearchParams(body).toString() : JSON.stringify(body),
        onload:response=>{
          try {finish(null,parseResponse(response,url));} catch(error) {finish(error);}
        },
        ontimeout:()=>finish(new Error('请求超时（25 秒内）')),onerror:()=>finish(new Error('网络失败或未授权服务域名')),onabort:()=>finish(new Error('请求已取消'))
      });
    } catch(error) {finish(error);}
  });
}

export function createSearchClient({request,getKey,now=Date.now}) {
  let calls=[];
  return async(query,config,{timeout=8000}={})=>{
    if(!config?.enabled)throw new Error('联网搜索未启用');
    const provider=config.provider || 'bocha',endpoint=validateSearchEndpoint(config.endpoint,provider),key=getKey(endpoint);
    if(!key && provider!=='searxng')throw new Error('请先填写搜索服务的 API Key');
    const body=validateSearchBody(provider==='searxng' ? {q:String(query).trim(),format:'json',pageno:1} : provider==='bocha' ? {query:String(query).trim(),count:config.maxResults,summary:true,freshness:'noLimit'}
      : {query:String(query).trim(),max_results:config.maxResults,search_depth:'basic',include_answer:false,include_raw_content:false},provider);
    calls=calls.filter(at=>now()-at<3600000);
    if(calls.length>=config.maxPerHour)throw new Error('联网搜索每小时额度已用完');
    calls.push(now());
    const data=await requestJSON(request,{url:endpoint,key,body,timeout,operation:'search',provider,form:provider==='searxng'});
    if(!data || typeof data!=='object' || Array.isArray(data))throw new Error('搜索服务未返回有效结果');
    if(provider==='bocha' && data.code!==undefined && data.code!==200)throw new Error(`博查搜索失败（${String(data.code).slice(0,12)}）`);
    const rows=provider==='bocha' ? data.data?.webPages?.value : data.results;
    if(!Array.isArray(rows))throw new Error('搜索服务未返回有效结果');
    const seen=new Set(),results=[];
    for(const row of rows){
      let url;try{url=new URL(row.url);}catch{continue;}
      if(!['https:','http:'].includes(url.protocol) || url.username || url.password || seen.has(url.href))continue;
      seen.add(url.href);
      results.push({index:results.length+1,title:String(row.name || row.title || url.hostname).slice(0,160),url:url.href.slice(0,2000),content:String(row.summary || row.content || row.snippet || '').slice(0,1200),publishedAt:typeof row.datePublished==='string' ? row.datePublished.slice(0,80) : null});
      if(results.length===config.maxResults)break;
    }
    return {provider,query:body.query || body.q,searchedAt:now(),results};
  };
}
