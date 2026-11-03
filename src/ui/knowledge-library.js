import {MEMORY_LIMITS,validateMemory,retrieveMemories,beijingDate} from '../services/knowledge.js';

const fields=[['title','资料标题','text',80],['content','背景正文','textarea',MEMORY_LIMITS.content],['source','资料来源 / 确认人','text',200],['expiresOn','到期日期（可留空，当日仍有效）','date']];
const time=at=>new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const normalize=value=>String(value).normalize('NFKC').toLocaleLowerCase().trim();
const statusOf=row=>!row.enabled ? 'disabled' : row.expiresOn && row.expiresOn<beijingDate(Date.now()) ? 'expired' : 'active';
const statusLabel={active:'可用',disabled:'已停用',expired:'已过期'};

export class KnowledgeLibrary {
 constructor(root,{dirty,error,reveal,webKnowledge}){
  this.root=root;this.document=root.ownerDocument;this.dirty=dirty;this.error=error;this.reveal=reveal;this.webKnowledge=webKnowledge;this.serial=0;
  this.list=root.querySelector('[data-memory-list]');this.webList=root.querySelector('[data-web-knowledge-list]');
  const on=(selector,event,fn)=>root.querySelector(selector).addEventListener(event,fn);
  on('[data-memory-add]','click',()=>this.createDraft());
  on('[data-memory-search]','click',()=>this.preview());
  on('[data-memory-filter-query]','input',()=>this.filter());
  for(const key of ['kind','status','sort'])on(`[data-knowledge-${key}]`,'change',()=>this.filter());
  on('[data-knowledge-reset]','click',()=>this.reset());
  on('[data-knowledge-expand]','click',()=>{for(const row of this.rows())if(!row.hidden)row.open=true;});
  on('[data-knowledge-collapse]','click',()=>{for(const row of this.rows())row.open=false;});
  on('[data-web-knowledge-refresh]','click',()=>{void this.refresh();});
  on('[data-web-knowledge-clear]','click',()=>{root.querySelector('[data-web-knowledge-confirm]').hidden=false;});
  on('[data-web-knowledge-cancel-clear]','click',()=>{root.querySelector('[data-web-knowledge-confirm]').hidden=true;});
  on('[data-web-knowledge-confirm-clear]','click',()=>{void this.refresh('clear');});
  const edited=event=>{if(!event.target.matches('[data-memory-field]'))return;const row=event.target.closest('details');this.summary(row);this.metrics();this.dirty();event.target.removeAttribute('aria-invalid');};
  root.addEventListener('input',edited);root.addEventListener('change',edited);
 }
 rows(){return [...this.list.children,...this.webList.children].filter(row=>row.tagName==='DETAILS');}
 value(row){const result={...row.record};for(const input of row.querySelectorAll('[data-memory-field]'))result[input.dataset.memoryField]=input.type==='checkbox' ? input.checked : input.value.trim();return result;}
 createDraft(record={title:'',content:'',source:'用户填写',expiresOn:'',enabled:true}){
  if(this.list.children.length>=MEMORY_LIMITS.entries){this.error(new Error(`背景记忆最多${MEMORY_LIMITS.entries}条`));return;}
  this.reset();const row=this.add({...record,id:crypto.randomUUID(),updatedAt:Date.now()});row.open=true;this.metrics();this.filter();this.dirty();row.querySelector('input').focus();return row;
 }
 add(record){
  const row=this.document.createElement('details');row.className='editor-row knowledge-record';row.record=structuredClone(record);
  const summary=this.document.createElement('summary');row.append(summary);
  const body=this.document.createElement('div');body.className='knowledge-editor';row.append(body);
  for(const [name,title,type,max] of fields){
   const label=this.document.createElement('label');label.className='field';const span=this.document.createElement('span');span.textContent=title;
   const control=this.document.createElement(type==='textarea' ? 'textarea' : 'input');if(type!=='textarea')control.type=type;
   control.dataset.memoryField=name;control.value=record[name];if(max)control.maxLength=max;label.append(span,control);body.append(label);
  }
  const label=this.document.createElement('label');label.className='toggle';const enabled=this.document.createElement('input');enabled.type='checkbox';enabled.dataset.memoryField='enabled';enabled.checked=record.enabled;label.append(enabled,'使用这条资料');body.append(label);
  const checked=this.document.createElement('small');checked.textContent=`核对时间：${time(record.updatedAt)}`;body.append(checked);
  const validity=this.document.createElement('small');validity.dataset.memoryValidity='';body.append(validity);
  const button=this.document.createElement('button');button.type='button';button.dataset.memoryRemove='';button.textContent='删除这条记忆';button.className='danger';
  button.addEventListener('click',()=>this.remove(row));body.append(button);this.list.append(row);this.summary(row);return row;
 }
 remove(row){
  const next=row.nextSibling;row.remove();this.metrics();this.filter();this.dirty();
  let undo=this.root.querySelector('[data-memory-undo]');if(!undo){undo=this.document.createElement('button');undo.type='button';undo.dataset.memoryUndo='';this.list.after(undo);}
  undo.textContent='撤销上次删除';undo.onclick=()=>{if(this.list.children.length>=MEMORY_LIMITS.entries){this.error(new Error(`背景记忆最多${MEMORY_LIMITS.entries}条`));return;}this.list.insertBefore(row,next?.parentNode===this.list ? next : null);undo.remove();this.reset();this.metrics();this.dirty();};
 }
 summary(row){
  const value=this.value(row),status=statusOf(value);
  row.querySelector('summary').textContent=`${value.title || '未命名知识'} · ${statusLabel[status]} · ${value.content.length}字 · ${value.source.slice(0,48) || '未填写来源'}`;
  row.querySelector('[data-memory-validity]').textContent=status==='active' ? '可参与检索，按问题相关性选择片段' : `${statusLabel[status]}，不参与检索`;
 }
 metrics(){
  const entries=[...this.list.children].map(row=>this.value(row));
  const text=(selector,value)=>{this.root.querySelector(selector).textContent=value;};
  text('[data-knowledge-manual-count]',`${entries.length} / ${MEMORY_LIMITS.entries}`);text('[data-knowledge-active-count]',entries.filter(row=>statusOf(row)==='active').length);
  text('[data-knowledge-chars]',`${entries.reduce((sum,row)=>sum+row.content.length,0)} / ${MEMORY_LIMITS.total}`);
  this.root.querySelector('[data-memory-empty]').hidden=Boolean(entries.length);
 }
 reset(){this.root.querySelector('[data-memory-filter-query]').value='';for(const key of ['kind','status'])this.root.querySelector(`[data-knowledge-${key}]`).value='all';this.filter();}
 filter(){
  const query=normalize(this.root.querySelector('[data-memory-filter-query]').value),kind=this.root.querySelector('[data-knowledge-kind]').value,status=this.root.querySelector('[data-knowledge-status]').value,sort=this.root.querySelector('[data-knowledge-sort]').value;
  for(const [list,type] of [[this.list,'manual'],[this.webList,'web']]){
   const rows=[...list.children].filter(row=>row.tagName==='DETAILS');
   rows.sort((a,b)=>sort==='title' ? (type==='manual' ? this.value(a).title : a.record.query).localeCompare(type==='manual' ? this.value(b).title : b.record.query,'zh-CN') : (b.record.updatedAt || b.record.searchedAt)-(a.record.updatedAt || a.record.searchedAt));
   for(const row of rows){
    const value=type==='manual' ? this.value(row) : row.record;
    const text=type==='manual' ? `${value.title}\n${value.content}\n${value.source}` : `${value.query}\n${value.results.map(source=>`${source.title}\n${source.content}\n${source.url}`).join('\n')}`;
    const rowStatus=type==='manual' ? statusOf(value) : value.expiresAt>Date.now() ? 'active' : 'expired';
    row.hidden=(kind!=='all' && kind!==type) || (status!=='all' && status!==rowStatus) || !normalize(text).includes(query);
    list.append(row);
   }
  }
  const rows=this.rows(),count=rows.filter(row=>!row.hidden).length;
  this.root.querySelector('[data-knowledge-result-count]').textContent=`显示 ${count} / ${rows.length} 条知识`;
  this.root.querySelector('[data-knowledge-no-results]').hidden=count>0 || !rows.length;
  this.root.querySelector('[data-knowledge-manual]').hidden=kind==='web';this.root.querySelector('[data-knowledge-web]').hidden=kind==='manual';
 }
 populate(memory){this.list.replaceChildren();this.root.querySelector('[data-memory-undo]')?.remove();for(const record of memory.entries)this.add(record);this.metrics();this.filter();}
 read(){
  const entries=[...this.list.children].map(row=>{
   const result=this.value(row);
   for(const name of ['title','content'])if(!result[name]){this.reset();this.reveal(row.querySelector(`[data-memory-field="${name}"]`));throw new Error(`请填写${name==='title' ? '资料标题' : '背景正文'}`);}
   if(Object.keys(result).some(key=>result[key]!==row.record[key]))result.updatedAt=Date.now();return result;
  });
  return validateMemory({enabled:this.root.querySelector('[data-field="ai.memory.enabled"]').checked,entries});
 }
 preview(){
  try{
   const query=this.root.querySelector('[data-memory-query]').value.trim();if(!query)throw new Error('请先输入要检索的问题');
   const result=retrieveMemories(this.read(),query),target=this.root.querySelector('[data-memory-matches]');target.replaceChildren();
   const summary=this.document.createElement('p');summary.textContent=`命中 ${result.chunks.length} 个片段，原文 ${result.usedChars} 字${result.truncated ? '（已按预算与去重规则筛选）' : ''}。`;target.append(summary);
   for(const chunk of result.chunks){const item=this.document.createElement('p');item.textContent=`${chunk.title} · ${chunk.source || '未填写来源'} · 核对时间 ${time(chunk.updatedAt)} · 原文位置 ${chunk.range.start}–${chunk.range.end}：${chunk.content}`;target.append(item);}
  }catch(reason){this.error(reason);}
 }
 async refresh(action,id){
  const serial=++this.serial,status=this.root.querySelector('[data-web-knowledge-status]');
  if(!this.webKnowledge){status.textContent='当前环境没有可用的联网知识存储。';return;}
  this.root.querySelector('[data-web-knowledge-confirm]').hidden=true;
  try{
   if(action==='clear')await this.webKnowledge.clear();if(action==='remove')await this.webKnowledge.remove(id);
   const rows=await this.webKnowledge.list();if(serial!==this.serial)return;
   status.textContent=`${this.webKnowledge.persistent ? '本机已保存' : '当前环境仅临时保存，刷新后丢失'} · ${rows.length}/100条有效资料；停用后停止保存与复用。`;
   this.webList.replaceChildren();
   for(const row of rows)this.addWeb(row);
   if(!rows.length){const p=this.document.createElement('p');p.className='empty';p.textContent='没有有效的自动联网知识。';this.webList.append(p);}
   this.root.querySelector('[data-knowledge-web-count]').textContent=rows.length;this.filter();
  }catch(reason){if(serial===this.serial)status.textContent=`知识存储不可用：${reason.message}`;}
 }
 addWeb(record){
  const details=this.document.createElement('details');details.className='knowledge-record';details.record=record;
  const summary=this.document.createElement('summary');summary.textContent=`${record.query} · 联网来源 · ${record.results.length}个来源`;details.append(summary);
  const body=this.document.createElement('div');body.className='knowledge-editor';details.append(body);
  const date=this.document.createElement('p');date.className='hint';date.textContent=`采集 ${time(record.searchedAt)} · 到期 ${time(record.expiresAt)}`;body.append(date);
  for(const source of record.results){
   const p=this.document.createElement('p');p.textContent=source.content;body.append(p);
   let url;try{url=new URL(source.url);}catch{continue;}if(!['http:','https:'].includes(url.protocol) || url.username || url.password)continue;
   const link=this.document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent=`[${source.index}] ${source.title}`;body.append(link);
  }
  const actions=this.document.createElement('div');actions.className='actions';body.append(actions);
  const copy=this.document.createElement('button');copy.type='button';copy.dataset.webKnowledgeCopy='';copy.textContent='整理为手工知识';copy.addEventListener('click',()=>this.copyWeb(record));actions.append(copy);
  const remove=this.document.createElement('button');remove.type='button';remove.dataset.webKnowledgeRemove='';remove.textContent='删除这条联网知识';remove.addEventListener('click',()=>{void this.refresh('remove',record.id);});actions.append(remove);
  this.webList.append(details);
 }
 copyWeb(record){
  const source=record.results[0],content=record.results.map(row=>`${row.title}\n${row.url}\n${row.content}`).join('\n\n');
  const draft=this.createDraft({title:record.query.slice(0,80),content:content.slice(0,MEMORY_LIMITS.content),source:source.url.length<=200 ? source.url : source.title.slice(0,200),expiresOn:beijingDate(record.expiresAt),enabled:false});
  if(draft && content.length>MEMORY_LIMITS.content){const note=this.document.createElement('p');note.className='hint';note.textContent=`来源内容较长，已截取前${MEMORY_LIMITS.content}字；请打开原文核对并整理后启用。`;draft.querySelector('.knowledge-editor').prepend(note);}
 }
}
