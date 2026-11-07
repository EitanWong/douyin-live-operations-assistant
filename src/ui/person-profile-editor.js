import {PROFILE_POLICY} from '../ai/person-profile.js';
export class PersonProfileEditor {
 constructor(library,turn){
  this.library=library;this.root=library.root;this.turn=turn;
  this.node=s=>this.root.querySelector(s);
  this.node('[data-person-send]').addEventListener('click',()=>{void this.send();});
 }
 cancel(){this.controller?.abort();this.controller=null;this.pending=false;}
 open(record,enabled=Boolean(record.person)){
  this.cancel();this.profile=record.person ? structuredClone(record.person) : null;
  this.node('[data-person-editor]').hidden=!enabled;
  this.node('[data-person-name]').value=this.profile?.name || '';
  this.node('[data-person-key]').value=this.profile?.key || '';
  this.node('[data-person-message]').value='';this.node('[data-person-reply]').textContent='';
  this.node('[data-memory-field="content"]').readOnly=enabled;
  if(enabled){this.node('[data-memory-dialog-title]').textContent='与AI补充人物';this.node('[data-person-policy]').textContent=PROFILE_POLICY;}
  this.render();
 }
 render(){
  for(const s of ['[data-person-name]','[data-person-key]'])this.node(s).disabled=Boolean(this.profile) || this.pending;
  this.node('[data-person-send]').disabled=this.pending;this.node('[data-person-send]').textContent=this.pending ? '正在整理…' : '发送给AI';
  this.node('[data-memory-confirm]').disabled=this.pending;
  this.node('[data-person-history]').textContent=(this.profile?.turns || []).map((t,i)=>`第${i+1}轮：${t.text}`).join('\n\n');
 }
 async send(){
  if(this.pending || !this.library.editing)return;
  const name=this.node('[data-person-name]').value.trim(),key=this.node('[data-person-key]').value.trim(),message=this.node('[data-person-message]').value.trim();
  if(!name || !message){this.fail('请填写人物名称和补充内容。');return;}
  const editing=this.library.editing,controller=new AbortController();this.controller=controller;this.pending=true;this.render();
  try{
   if(!this.turn)throw Error('请先配置AI模型后再整理人物资料');
   const profile=await this.turn({name,key,profile:this.profile,message,signal:controller.signal});
   if(controller.signal.aborted || this.library.editing!==editing || this.controller!==controller)return;
   if(this.node('[data-person-message]').value.trim()!==message)throw Error('整理期间补充内容已修改，已保留你的输入，请重新发送');
   this.profile=profile;this.library.applyPersonProfile(profile);
   this.node('[data-person-message]').value='';this.node('[data-person-reply]').textContent=profile.reply;
   this.node('[data-memory-dialog-error]').hidden=true;
  }catch(error){if(!controller.signal.aborted && this.library.editing===editing)this.fail(error.message);}
  finally{if(this.controller===controller){this.pending=false;this.render();}}
 }
 fail(message){const error=this.node('[data-memory-dialog-error]');error.textContent=message;error.hidden=false;}
}
