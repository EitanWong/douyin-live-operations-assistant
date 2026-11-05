// UI only submits and observes. Background research never owns the public sender.
export class AIWorkbench {
 constructor(root,{tasks,memory,perceptionMemory,saveMemory,onError=()=>{}}){Object.assign(this,{root,tasks,memory,saveMemory,onError});this.closed=false;
  const run=fn=>void Promise.resolve().then(fn).catch(onError);
  root.querySelector('[data-audience-refresh]').addEventListener('click',()=>this.refreshMemory());
  root.querySelector('[data-audience-choice]').addEventListener('change',()=>this.showMemory());
  root.querySelector('[data-audience-forget]').addEventListener('click',()=>run(async()=>{memory().forget(this.choice());await saveMemory();this.refreshMemory();}));
  root.querySelector('[data-audience-clear]').addEventListener('click',()=>run(async()=>{memory().clear();await saveMemory();this.refreshMemory();}));
  const clearPerception=root.querySelector('[data-perception-memory-clear]');
  clearPerception.hidden=!perceptionMemory;
  clearPerception.addEventListener('click',()=>run(async()=>{perceptionMemory().clear();await saveMemory();}));
  root.querySelector('[data-audience-note-save]').addEventListener('click',()=>run(async()=>{memory().annotate(this.choice(),this.node('[data-audience-note]').value);await saveMemory();this.node('[data-audience-note]').value='';this.showMemory();}));
  const submit=root.querySelector('[data-agent-submit]');
  submit.addEventListener('click',()=>{if(this.submitting)return;this.submitting=true;submit.disabled=true;run(async()=>{try{
   const question=this.node('[data-agent-question]').value.trim(),sources=this.node('[data-agent-sources]').value.split('\n').map(x=>x.trim()).filter(Boolean);if(!question)throw new Error('请填写后台研究问题');
   if(sources.length>3)throw new Error('每次最多研究3个公开链接');await tasks.submit(question,sources);await this.refreshTasks();
  }finally{this.submitting=false;submit.disabled=false;}});});
  root.querySelector('[data-agent-refresh]').addEventListener('click',()=>run(()=>this.refreshTasks()));
  this.node('[data-agent-results]').addEventListener('click',event=>{const button=event.target.closest('[data-agent-cancel]');if(button)run(async()=>{await tasks.cancel(button.dataset.agentCancel);await this.refreshTasks();});});
  this.refreshMemory();void this.refreshTasks().catch(error=>{this.node('[data-agent-results]').textContent=error.message;});this.timer=setInterval(()=>{if(this.pending)run(()=>this.refreshTasks());},3000);
 }
 node(selector){return this.root.querySelector(selector);}
 choice(){return this.node('[data-audience-choice]').value;}
 refreshMemory(){const select=this.node('[data-audience-choice]'),selected=select.value;select.replaceChildren();for(const row of this.memory().list()){const option=select.ownerDocument.createElement('option');option.value=row.key;option.textContent=row.name || '未命名观众';select.append(option);}if([...select.options].some(o=>o.value===selected))select.value=selected;this.showMemory();}
 showMemory(){
  const row=this.memory().list().find(r=>r.key===this.choice()),target=this.node('[data-audience-memory]');
  const lines=row ? [`最近观察：${new Date(row.lastAt).toLocaleString('zh-CN')}`,`说过：${row.statements.join('；') || '无记录'}`,`送礼：${row.gifts.join('、') || '无记录'}`,`核实补充：${(row.notes || []).join('；') || '无'}`] : ['尚无观众记忆。启用 AI 后，从本机采集的互动中逐步积累。'];
  target.replaceChildren(...lines.map(text=>{const p=target.ownerDocument.createElement('p');p.textContent=text;return p;}));
 }
 async refreshTasks(){const version=this.refreshVersion=(this.refreshVersion || 0)+1;let rows;
  try{rows=await this.tasks.list();}catch(error){if(this.closed || version!==this.refreshVersion)return;throw error;}
  if(this.closed || version!==this.refreshVersion)return;this.pending=rows.some(r=>['queued','running'].includes(r.status));const target=this.node('[data-agent-results]'),doc=target.ownerDocument;target.replaceChildren();
  if(!rows.length){target.textContent='暂无后台任务。';return;}
  const labels={queued:'等待执行',running:'后台执行中',succeeded:'已完成',failed:'失败',cancelled:'已取消',interrupted:'执行中断，未自动重试'};
  for(const row of rows){const item=doc.createElement('article');item.className='editor-row';const heading=doc.createElement('strong');heading.textContent=`${labels[row.status] || row.status} · ${row.question}`;item.append(heading);
   const text=doc.createElement('p');text.textContent=row.result?.answer || row.error || row.trace?.at(-1)?.detail || '已进入后台队列，前台可继续操作';item.append(text);
   for(const source of [...(row.result?.sources || []),...(row.result?.publicSources || [])]){const p=doc.createElement('p');p.textContent=source.error ? `${source.url}：${source.error}` : `${source.title || source.url} · ${source.url}`;item.append(p);}
   if(['queued','running'].includes(row.status)){const button=doc.createElement('button');button.type='button';button.dataset.agentCancel=row.id;button.textContent='取消任务';item.append(button);}target.append(item);
  }
 }
 close(){this.closed=true;clearInterval(this.timer);}
}
