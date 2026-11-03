export class FoundationSettings {
 constructor(root,{edge,collector,accounts,anchor,changed,onError}){
  Object.assign(this,{root,edge,collector,accounts,anchor,changed,onError});this.traces=[];
  const bind=(selector,fn)=>root.querySelector(selector).addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{await fn();}catch(error){onError(error);}finally{button.disabled=false;}});
  for(const kind of ['text','audio'])bind(`[data-edge-prepare="${kind}"]`,async()=>{
   if(!edge)throw new Error('端侧推理需要 Chrome 扩展版');this.status('模型正在下载、加载与预热，首次可能需要几分钟…');
   const result=await edge.prepare(kind,root.querySelector('[data-field="ai.edge.audioBackend"]').value);this.status(result.phase==='ready' ? `${kind==='text' ? '中文回复' : '中文语音'}已就绪${result.tokensPerSecond ? ` · ${result.tokensPerSecond.toFixed(1)} token/s · 首 token ${Math.round(result.firstTokenMs)}ms` : ''}` : '设备推理速度不足，实时兜底未启用');
  });
  bind('[data-edge-release]',async()=>{await edge?.release();this.status('已释放本地模型内存；缓存权重保留');});
  bind('[data-edge-status-refresh]',async()=>{const state=await edge?.status();this.status(state ? Object.entries(state).map(([kind,s])=>`${kind==='text' ? '文字' : '语音'}：${({loading:'准备中',ready:'已就绪',slow:'设备速度不足',error:'加载失败'})[s.phase] || '未准备'}`).join(' · ') || '尚未准备模型' : '端侧推理需要 Chrome 扩展版');});
  bind('[data-account-collect]',async()=>{
   if(!collector)throw new Error('抖音原生页面采集需要 Chrome 扩展版');const url=root.querySelector('[data-account-url]').value.trim(),scope=anchor(),generation=++this.generation;
   this.accountStatus('正在读取抖音公开页面，最多等待12秒…');const rows=await collector.collect(url);
   if(scope!==anchor() || generation!==this.generation)return;
   accounts.replace(scope,url,rows);await changed();this.showAccounts();this.accountStatus(`已采集 ${rows.length} 条公开资料，24小时后不再用于回答；可刷新或删除。`);
  });
  bind('[data-account-cancel]',async()=>{this.generation++;await collector?.cancel();this.accountStatus('已取消采集');});
  bind('[data-account-clear]',async()=>{this.generation++;await collector?.cancel();accounts.forget(anchor());await changed();this.showAccounts();this.accountStatus('本主播关联的公开资料已清空');});
  bind('[data-account-refresh]',async()=>this.showAccounts());this.generation=0;this.showAccounts();
  bind('[data-account-search]',async()=>{if(!collector?.search)throw new Error('抖音原生搜索需要 Chrome 扩展版');await collector.search(root.querySelector('[data-account-query]').value.trim());});
 }
 status(text){this.root.querySelector('[data-edge-status]').textContent=text;}
 accountStatus(text){this.root.querySelector('[data-account-status]').textContent=text;}
 showAccounts(){
  const target=this.root.querySelector('[data-account-records]');target.replaceChildren();const rows=this.accounts.list(this.anchor());
  for(const r of rows){const item=target.ownerDocument.createElement('p'),a=target.ownerDocument.createElement('a');a.textContent=r.title;a.href=r.url || r.source;a.target='_blank';a.rel='noopener noreferrer';item.append(a,` · ${r.kind==='profile' ? '主页' : '作品描述'} · ${new Date(r.observedAt).toLocaleString('zh-CN')}：${r.text.slice(0,240)}`);target.append(item);}
  if(!rows.length)target.textContent='尚未采集公开资料。';
 }
 trace(row){
  this.traces.push(row);this.traces=this.traces.slice(-100);const ok=this.traces.filter(r=>r.status==='ok'),times=ok.map(r=>r.elapsedMs).sort((a,b)=>a-b);
  const target=this.root.querySelector('[data-ai-latency]');target.textContent=`最近 ${ok.length} 次完成 · 最近一次 ${row.provider==='edge' ? '端侧' : '云端'} ${row.elapsedMs}ms · ${row.status}${times.length ? ` · P95 ${times[Math.ceil(times.length*.95)-1]}ms` : ''}`;
 }
 close(){this.generation++;void Promise.resolve(this.collector?.cancel()).catch(()=>{});}
}
