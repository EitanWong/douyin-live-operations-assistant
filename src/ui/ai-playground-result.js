const statusLabels={running:'正在处理',succeeded:'已回答',skipped:'选择不回复',failed:'失败',cancelled:'已取消'};
export const intents={'live-data':'直播数据','web-search':'联网查询',knowledge:'复用知识',chat:'日常对话',clarify:'澄清条件',skip:'不回复'};
export function append(parent,tag,text,className){const node=parent.ownerDocument.createElement(tag);node.textContent=text;if(className)node.className=className;parent.append(node);return node;}
function renderTrace(item,trace){
 const section=append(item,'section','','ai-result-section');append(section,'h4','处理链路');
 const list=append(section,'ol','','ai-trace');list.setAttribute('aria-label','处理链路');list.setAttribute('role','list');
 for(const [index,event] of trace.entries()){
  const step=append(list,'li','',`ai-trace-step is-${event.status}`);step.setAttribute('role','listitem');
  append(step,'span',String(index+1),'ai-trace-number');
  append(step,'strong',event.label);append(step,'small',`${{running:'调用开始',succeeded:'已完成',warning:'需核对',failed:'失败',cancelled:'已取消'}[event.status] || ''} · 开始后 ${event.elapsedMs}ms`);
  if(event.detail)append(step,'p',event.stage==='intent' ? intents[event.detail] || event.detail : event.detail);
 }
 if(!trace.length)append(section,'p','此记录没有处理步骤。','hint');
}
function renderSources(item,row){
 const details=append(item,'details','','ai-result-sources');details.dataset.playgroundSources='';
 append(details,'summary',`来源与依据 · ${row.sources?.length || 0} 条`);
 if(row.query)append(details,'p',`搜索词：${row.query}`);
 if(row.searchedAt)append(details,'p',`资料采集：${new Date(row.searchedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`);
 for(const source of row.sources || []){
  const block=append(details,'div','','ai-source');append(block,'strong',`[${source.index}] ${source.title || '来源'}${row.citationIndices?.includes(source.index) ? ' · 已用于答案' : ''}`);
  try{const url=new URL(source.url);if(['http:','https:'].includes(url.protocol) && !url.username && !url.password){const link=append(block,'a',url.href);link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';}}catch{}
  append(block,'p',source.content || source.snippet || '没有正文摘要');
 }
 if(!row.sources?.length)append(details,'p','本次没有外部来源；请结合问题与已用上下文核对。','hint');
}
export function renderPlaygroundResult(parent,row,{latest=false}={}){
 const item=append(parent,'article','','ai-result');if(latest)item.dataset.playgroundLatest='';
 const heading=append(item,'div','','ai-result-heading');append(heading,'span',statusLabels[row.status] || row.status,`ai-result-status is-${row.status}`);append(heading,'h4',row.question);
 const answer=append(item,'section','','ai-final-answer');answer.setAttribute('aria-label','最终答案');
 append(answer,'h4',row.status==='skipped' ? '本次不回复' : row.status==='failed' || row.status==='cancelled' ? '本次未生成答案' : '最终答案');
 const text=append(answer,'p',row.status==='running' ? '正在处理，最终答案将在这里显示。' : row.answer==='[SKIP]' ? '模型判断当前不需要回复。' : row.answer || row.error || '未生成回复','ai-answer-text');text.dataset.playgroundAnswer='';
 const meta=append(item,'div','','ai-result-meta');
 for(const value of [`${row.provider==='edge' ? '本地' : row.provider==='cloud' ? '云端' : '执行中'} · ${row.model || '模型待确认'}`,`${row.elapsedMs || 0}ms`,`云端 ${row.calls?.cloud || 0} / 本地 ${row.calls?.local || 0} 次`,intents[row.intent] || '意图待识别'])append(meta,'span',value);
 if(row.cached)append(meta,'span','复用有效历史缓存');
 if(row.controlled)append(item,'p','固定资料评测 · 非真实天气或直播数据','hint');
 if(row.searchError)append(item,'p',`查询提示：${row.searchError}`,'ai-result-warning');
 if(row.citationWarning)append(item,'p',row.citationWarning,'ai-result-warning');
 renderTrace(item,row.trace || []);
 const checks=append(item,'details','','ai-result-checks');checks.dataset.playgroundChecks='';
 append(checks,'summary',`检查结果 · ${(row.checks || []).filter(check=>check.pass).length}/${row.checks?.length || 0} 通过`);
 for(const check of row.checks || [])append(checks,'p',`${check.pass ? '✓ 通过' : '! 需核对'}：${check.label}`);
 if(row.context)append(checks,'p',`已用上下文：${row.context.chat}条对话 · ${row.context.media}条音画观察 · 知识库${row.context.knowledge ? '开启' : '关闭'}`);
 renderSources(item,row);
 return item;
}
