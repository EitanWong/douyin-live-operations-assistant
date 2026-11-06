import {relationshipEvidenceVersion} from '../services/relationship-query.js';
import {relationshipChartOption,RELATIONSHIP_STATUS_LABELS} from './relationship-graph.js';
import {MEMORY_LIMITS,validateMemory,retrieveMemories,beijingDate} from '../services/knowledge.js';

const fields=[['title','资料标题','text',80],['content','背景正文','textarea',MEMORY_LIMITS.content],['source','资料来源 / 确认人','text',200],['expiresOn','到期日期（可留空，当日仍有效）','date']];
const time=at=>new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const normalize=value=>String(value).normalize('NFKC').toLocaleLowerCase().trim();
const statusOf=row=>!row.enabled ? 'disabled' : row.expiresOn && row.expiresOn<beijingDate(Date.now()) ? 'expired' : 'active';
const statusLabel={active:'可用',disabled:'已停用',expired:'已过期'};

export class KnowledgeLibrary {
 constructor(root,{dirty,error,reveal,webKnowledge,relationships}){
  this.root=root;this.document=root.ownerDocument;this.dirty=dirty;this.error=error;this.reveal=reveal;this.webKnowledge=webKnowledge;this.serial=0;this.relationships=relationships;this.lastGraphAt=0;
  this.list=root.querySelector('[data-memory-list]');this.webList=root.querySelector('[data-web-knowledge-list]');
  const on=(selector,event,fn)=>root.querySelector(selector).addEventListener(event,fn);
  this.dialog=root.querySelector('[data-knowledge-dialog]');this.buildEditor();
  on('[data-memory-add]','click',()=>this.createDraft());
  on('[data-memory-confirm]','click',()=>this.confirmEditor());
  for(const selector of ['[data-memory-cancel]','[data-memory-close]'])on(selector,'click',()=>this.closeEditor());
  this.dialog.addEventListener('keydown',event=>this.editorKey(event));
  on('[data-memory-search]','click',()=>this.preview());
  on('[data-relationship-search]','click',()=>this.previewRelationships(relationships));
  on('[data-relationship-overview]','click',()=>{root.querySelector('[data-relationship-query]').value='';this.previewRelationships(relationships);});
  on('[data-relationship-status]','change',()=>this.previewRelationships(relationships));
  on('[data-relationship-selection]','change',()=>this.selectRelationship());
  on('[data-relationship-chart]','chart-select',event=>{root.querySelector('[data-relationship-selection]').value=`${event.detail.kind}:${event.detail.id}`;this.selectRelationship();});
  on('[data-relationship-export]','click',()=>this.exportRelationships());
  on('[data-relationship-query]','keydown',event=>{if(event.key==='Enter'){event.preventDefault();this.previewRelationships(relationships);}});
  on('[data-memory-filter-query]','input',()=>this.filter());
  for(const key of ['kind','status','sort'])on(`[data-knowledge-${key}]`,'change',()=>this.filter());
  on('[data-knowledge-reset]','click',()=>this.reset());
  on('[data-knowledge-expand]','click',()=>{for(const row of this.rows())if(!row.hidden)row.open=true;});
  on('[data-knowledge-collapse]','click',()=>{for(const row of this.rows())row.open=false;});
  on('[data-web-knowledge-refresh]','click',()=>{void this.refresh();});
  on('[data-web-knowledge-clear]','click',()=>{root.querySelector('[data-web-knowledge-confirm]').hidden=false;});
  on('[data-web-knowledge-cancel-clear]','click',()=>{root.querySelector('[data-web-knowledge-confirm]').hidden=true;});
  on('[data-web-knowledge-confirm-clear]','click',()=>{void this.refresh('clear');});
  const edited=event=>{if(!event.target.matches('[data-memory-field]'))return;event.target.removeAttribute('aria-invalid');this.root.querySelector('[data-memory-dialog-error]').hidden=true;this.editorCount();};
  this.dialog.addEventListener('input',edited);this.dialog.addEventListener('change',edited);
 }
 rows(){return [...this.list.children,...this.webList.children].filter(row=>row.tagName==='DETAILS');}
 value(row){return {...row.record};}
 createDraft(record={title:'',content:'',source:'用户填写',expiresOn:'',enabled:true}){
  if(this.list.children.length>=MEMORY_LIMITS.entries){this.error(new Error(`背景记忆最多${MEMORY_LIMITS.entries}条`));return;}
  this.openEditor({...record,id:crypto.randomUUID(),updatedAt:Date.now()});return this.dialog;
 }
 buildEditor(){
  const body=this.root.querySelector('[data-memory-editor]');
  for(const [name,title,type,max] of fields){
   const label=this.document.createElement('label');label.className='field';const span=this.document.createElement('span');span.textContent=title;
   const control=this.document.createElement(type==='textarea' ? 'textarea' : 'input');if(type!=='textarea')control.type=type;
   control.dataset.memoryField=name;if(max)control.maxLength=max;if(name==='title')control.autofocus=true;label.append(span,control);body.append(label);
  }
  const label=this.document.createElement('label');label.className='toggle';const enabled=this.document.createElement('input');enabled.type='checkbox';enabled.dataset.memoryField='enabled';label.append(enabled,'使用这条资料');body.append(label);
 }
 openEditor(record,row=null){
  this.editing={record:structuredClone(record),row};this.returnFocus=row?.querySelector('[data-memory-edit]') || this.root.querySelector('[data-memory-add]');
  this.dialog.querySelector('[data-memory-source-note]')?.remove();
  for(const input of this.dialog.querySelectorAll('[data-memory-field]')){if(input.type==='checkbox')input.checked=record[input.dataset.memoryField];else input.value=record[input.dataset.memoryField];input.removeAttribute('aria-invalid');}
  this.root.querySelector('[data-memory-dialog-title]').textContent=row ? '编辑知识' : '添加知识';
  this.root.querySelector('[data-memory-dialog-error]').hidden=true;
  this.dialog.hidden=false;this.editorCount();this.dialog.querySelector('input').focus();
 }
 editorValue(){const record={...this.editing.record};for(const input of this.dialog.querySelectorAll('[data-memory-field]'))record[input.dataset.memoryField]=input.type==='checkbox' ? input.checked : input.value.trim();return record;}
 editorCount(){const content=this.dialog.querySelector('[data-memory-field="content"]');if(content)this.root.querySelector('[data-memory-dialog-count]').textContent=`正文 ${content.value.length} / ${MEMORY_LIMITS.content} 字`;}
 confirmEditor(){
  if(!this.editing)return;
  let invalid=this.dialog.querySelector('[data-memory-field="content"]');
  try{
   const value=this.editorValue(),{row,record}=this.editing;
   for(const name of ['title','content'])if(!value[name]){invalid=this.dialog.querySelector(`[data-memory-field="${name}"]`);throw new Error(`请填写${name==='title' ? '资料标题' : '背景正文'}`);}
   if(!row || Object.keys(value).some(key=>value[key]!==record[key]))value.updatedAt=Date.now();
   const entries=[...this.list.children].filter(item=>item!==row).map(item=>this.value(item));entries.push(value);validateMemory({enabled:true,entries});
   if(row){row.record=value;this.renderRow(row);}else this.add(value);
   this.closeEditor();if(!row)this.reset();this.metrics();this.filter();this.dirty();
  }catch(reason){const message=this.root.querySelector('[data-memory-dialog-error]');message.textContent=reason.message;message.hidden=false;this.reveal(invalid);}
 }
 closeEditor(){this.dialog.hidden=true;this.editing=null;this.returnFocus?.focus();}
 editorKey(event){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.closeEditor();return;}
  if(event.key!=='Tab')return;
  const controls=[...this.dialog.querySelectorAll('button,input,textarea')].filter(node=>!node.disabled),index=controls.indexOf(this.root.activeElement);
  if(event.shiftKey && index===0 || !event.shiftKey && index===controls.length-1){event.preventDefault();controls[event.shiftKey ? controls.length-1 : 0].focus();}
 }
 add(record){
  const row=this.document.createElement('details');row.className='editor-row knowledge-record';row.record=structuredClone(record);row.append(this.document.createElement('summary'));
  this.list.append(row);this.renderRow(row);return row;
 }
 renderRow(row){
  row.querySelector('.knowledge-reader')?.remove();const record=row.record,body=this.document.createElement('div');body.className='knowledge-reader';row.append(body);
  const paragraph=text=>{const p=this.document.createElement('p');p.textContent=text;body.append(p);};
  paragraph(record.content);paragraph(`资料来源：${record.source || '未填写来源'}`);paragraph(`核对时间：${time(record.updatedAt)} · 到期日期：${record.expiresOn || '长期有效'}`);
  const validity=this.document.createElement('small');validity.dataset.memoryValidity='';body.append(validity);
  const actions=this.document.createElement('div');actions.className='actions';body.append(actions);
  const edit=this.document.createElement('button');edit.type='button';edit.dataset.memoryEdit='';edit.textContent='编辑知识';edit.addEventListener('click',()=>this.openEditor(row.record,row));actions.append(edit);
  const remove=this.document.createElement('button');remove.type='button';remove.dataset.memoryRemove='';remove.textContent='删除这条记忆';remove.className='danger';remove.addEventListener('click',()=>this.remove(row));actions.append(remove);this.summary(row);
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
 populate(memory){this.closeEditor();this.list.replaceChildren();this.root.querySelector('[data-memory-undo]')?.remove();for(const record of memory.entries)this.add(record);this.metrics();this.filter();}
 read(){return validateMemory({enabled:this.root.querySelector('[data-field="ai.memory.enabled"]').checked,entries:[...this.list.children].map(row=>this.value(row))});}
 destroy(){this.closed=true;this.relationshipRevision=(this.relationshipRevision || 0)+1;}
 previewRelationships(retrieve){
  if(this.closed)return;this.graphPending=false;
  const revision=this.relationshipRevision=(this.relationshipRevision || 0)+1;
  try{
   const query=this.root.querySelector('[data-relationship-query]').value.trim();
   if(!retrieve)throw new Error('当前环境没有可用的人物记忆，请在直播工作台查询');
   const result=retrieve(query,this.read(),{browse:!query,status:this.root.querySelector('[data-relationship-status]').value});this.lastGraphAt=Date.now();
   const show=result=>{if(!this.closed && this.relationshipRevision===revision && this.root.querySelector('[data-relationship-query]').value.trim()===query)this.showRelationships(result);};
   if(result?.then){this.graphPending=true;return result.then(show,reason=>{if(!this.closed && this.relationshipRevision===revision)this.error(reason);}).finally(()=>{if(this.relationshipRevision===revision)this.graphPending=false;});}
   show(result);
  }catch(reason){this.error(reason);}
 }
 tickRelationships(){
  if(!this.closed && !this.graphPending && Date.now()-this.lastGraphAt>=10000 && this.relationships && this.root.querySelector('[data-relationship-panel]').open)this.previewRelationships(this.relationships);
 }
 exportRelationships(){
  if(!this.relationshipGraph)return;
  const view=this.document.defaultView,blob=new view.Blob([JSON.stringify(this.relationshipGraph,null,2)],{type:'application/json'}),url=view.URL.createObjectURL(blob),link=this.document.createElement('a');
  link.href=url;link.download='人物关系图谱.json';link.click();view.URL.revokeObjectURL(url);
 }
 selectRelationship(){
  const target=this.root.querySelector('[data-relationship-detail]');target.replaceChildren();
  const value=this.root.querySelector('[data-relationship-selection]').value,graph=this.relationshipGraph;if(!value || !graph)return;
  const type=value.slice(0,value.indexOf(':')),id=value.slice(value.indexOf(':')+1);
  const row=(type==='entity' ? graph.entities : graph.relations).find(row=>row.id===id);if(!row)return;
  const p=this.document.createElement('p');p.textContent=type==='entity' ? `${row.name} · ${row.role || '人物提及'}` : `${graph.entities.find(n=>n.id===row.from)?.name} ${row.negative ? '不是' : '是'} ${graph.entities.find(n=>n.id===row.to)?.name}的${row.predicate} · ${RELATIONSHIP_STATUS_LABELS[row.status]}`;target.append(p);
  for(const evidence of row.evidence || []){const p=this.document.createElement('p');p.textContent=`${evidence.text} · ${evidence.source} · ${time(evidence.at)}${evidence.scope ? ` · 房间${evidence.scope.room}/主播${evidence.scope.anchor}` : ''}`;target.append(p);}
 }
 showRelationships(result){
   this.relationshipGraph=result;
   const signature=relationshipEvidenceVersion(result);
   const canvas=this.root.querySelector('[data-relationship-chart]');
   if(this.graphSignature!==signature){canvas.chartOption=relationshipChartOption(result);canvas.replaceChildren(this.document.createTextNode(`关系网：${result.entities.length}个人物，${result.relations.length}条关系`));this.graphSignature=signature;}
   const selection=this.root.querySelector('[data-relationship-selection]'),previous=selection.value;selection.replaceChildren();
   const add=(value,text)=>{const option=this.document.createElement('option');option.value=value;option.textContent=text;selection.append(option);};add('','选择图中节点或关系');
   for(const node of result.entities)add(`entity:${node.id}`,`${node.name} · ${node.role || '人物'}`);
   const namesForSelection=new Map(result.entities.map(n=>[n.id,n.name]));
   for(const edge of result.relations)add(`relation:${edge.id}`,`${namesForSelection.get(edge.from)} → ${namesForSelection.get(edge.to)} · ${edge.negative ? '不是' : ''}${edge.predicate} · ${RELATIONSHIP_STATUS_LABELS[edge.status]}`);
   if([...selection.options].some(o=>o.value===previous))selection.value=previous;this.selectRelationship();
   const target=this.root.querySelector('[data-relationship-results]');target.replaceChildren();
   const paragraph=text=>{const p=this.document.createElement('p');p.textContent=text;target.append(p);};
   const names=new Map(result.entities.map(row=>[row.id,row.name]));
   if(result.stats)paragraph(`已积累 ${result.stats.entities} 个人物、${result.stats.relations} 条关系；当前展示 ${result.relations.length} 条${result.stats.truncated ? '，更多关系可按人物检索' : ''}。`);
   paragraph(`找到 ${result.entities.length} 个人物节点、${result.relations.length} 条关系陈述；仅展示相关资料，不代表完整关系网。`);
   for(const node of result.entities){
    paragraph(`${node.name}${node.aliases?.length ? `（别名：${node.aliases.join('、')}）` : ''}${node.role ? ` · ${node.role}` : ''}`);
    for(const evidence of node.evidence || [])paragraph(`${evidence.text} · ${evidence.source}${evidence.scope ? ` · 房间${evidence.scope.room} / 主播${evidence.scope.anchor}` : ''} · ${time(evidence.at)}`);
   }
   for(const row of result.relations){
    const description=row.status==='observed' ? `${names.get(row.from)} ↔ ${names.get(row.to)} · ${row.predicate}` : `${names.get(row.from)} ${row.negative ? '不是' : '是'} ${names.get(row.to)}的${row.predicate}`;
    paragraph(`${description} · ${({verified:'运营核实',unverified:'待核实',conflicted:'存在冲突',observed:'已观察互动'})[row.status]}`);
    for(const evidence of row.evidence)paragraph(`原话：${evidence.text} · ${evidence.source}${evidence.scope ? ` · 房间${evidence.scope.room} / 主播${evidence.scope.anchor}` : ''} · ${time(evidence.at)} · ${({verified:'核实资料',observed:'互动记录',unverified:'未核实陈述'})[evidence.trust]}`);
   }
   for(const row of result.ambiguities)paragraph(`“${row.name}”有多个候选身份，请补充账号或更多上下文。`);
   if(!result.relations.length)paragraph('没有找到明确关系陈述；持续运行会从已启用的对话与公开资料积累证据，也可添加核实知识；不按昵称或互动猜测关系。');
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
   status.textContent=`${this.webKnowledge.persistent ? '本机已保存' : '当前环境仅临时保存，刷新后丢失'} · ${rows.length}/${this.webKnowledge.capacity || 100}条有效资料；停用后停止保存与复用。`;
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
  if(draft && content.length>MEMORY_LIMITS.content){const note=this.document.createElement('p');note.className='hint';note.dataset.memorySourceNote='';note.textContent=`来源内容较长，已截取前${MEMORY_LIMITS.content}字；请打开原文核对并整理后启用。`;draft.querySelector('[data-memory-editor]').prepend(note);}
 }
}
