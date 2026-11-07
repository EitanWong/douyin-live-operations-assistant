export class PersonProfileEditor {
 constructor(library,submit){
  this.library=library;this.root=library.root;this.submit=submit;this.node=s=>this.root.querySelector(s);
  this.node('[data-person-send]').addEventListener('click',()=>{void this.send();});
 }
 cancel(){this.controller?.abort();this.controller=null;this.pending=false;}
 open(record,enabled=Boolean(record.person || record.supplement)){
  this.cancel();this.record=record;this.entryId=this.library.editing?.row ? record.id : undefined;
  this.node('[data-person-editor]').hidden=!enabled;
  for(const selector of ['[data-memory-editor]','[data-memory-confirm]','[data-memory-dialog-count]','[data-memory-instructions]'])this.node(selector).hidden=enabled;
  this.node('[data-person-message]').value='';this.node('[data-person-reply]').textContent='';this.node('[data-person-progress]').textContent='';
  this.node('[data-memory-field="content"]').readOnly=false;
  if(enabled)this.node('[data-memory-dialog-title]').textContent='AI补充知识';this.render();
 }
 render(){
  this.node('[data-person-message]').disabled=this.pending;
  this.node('[data-person-send]').disabled=this.pending;this.node('[data-person-send]').textContent=this.pending ? 'Agent正在处理…' : '交给Agent处理';
  const turns=this.record?.person?.turns || [...(this.record?.supplement?.history || []),...(this.record?.supplement ? [{text:this.record.supplement.text}] : [])];
  this.node('[data-person-history]').textContent=turns.map(t=>t.text).join('\n\n');
 }
 async send(){
  if(this.pending || !this.library.editing)return;
  const message=this.node('[data-person-message]').value.trim();
  if(!message){this.fail('请先输入要补充的知识。');return;}
  const editing=this.library.editing,controller=new AbortController();this.controller=controller;this.pending=true;this.render();
  this.node('[data-memory-dialog-error]').hidden=true;this.node('[data-person-reply]').textContent='已提交，正在查找和整理资料…';this.node('[data-person-progress]').textContent='';
  try{
   if(!this.submit)throw Error('请先启用并保存AI设置');
   const result=await this.submit({message,...(this.entryId ? {entryId:this.entryId} : {}),signal:controller.signal,onProgress:progress=>{
    if(this.controller===controller && !controller.signal.aborted)this.node('[data-person-progress]').textContent=(progress.trace || []).map(row=>row.detail || row.step).join('\n');
   }});
   if(controller.signal.aborted || this.library.editing!==editing || this.controller!==controller)return;
   this.library.applySupplement(result.entries);this.record=result.entries.find(row=>row.id===this.entryId);
   this.node('[data-person-message]').value='';this.node('[data-person-reply]').textContent=`已保存 ${result.entries.length} 条知识，人物与关系索引已更新。\n${result.answer}`;
  }catch(error){if(!controller.signal.aborted && this.library.editing===editing){this.node('[data-person-reply]').textContent='本次补充未完成，输入已保留。';this.fail(error.message);}}
  finally{if(this.controller===controller){this.pending=false;this.render();}}
 }
 fail(message){const error=this.node('[data-memory-dialog-error]');error.textContent=message;error.hidden=false;}
}
