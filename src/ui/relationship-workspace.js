import {relationshipEvidenceVersion,relationshipAnswerContext} from '../services/relationship-query.js';
const emptyGraph=()=>({entities:[],relations:[],ambiguities:[],paths:[]});
const abortError=error=>error?.name==='AbortError';
export class RelationshipWorkspace {
 constructor(root,{retrieve,readMemory,now=Date.now}){
  Object.assign(this,{root,retrieve,readMemory,now});this.host=root.querySelector('[data-relationship-workspace]');this.revision=0;this.questionRevision=0;this.lastAt=0;
  this.state={graph:emptyGraph(),query:'',loadedQuery:'',status:'all',predicate:'all',depth:0,layout:'concentric',selected:null,pathTo:'',question:'',answer:null,answering:false,loading:false,error:'',questionStatus:'选择人物后提问，或直接输入关系问题。',original:null};
  this.onAction=e=>{void this.dispatch(e.detail);};this.host.addEventListener('network-action',this.onAction);this.publish({});
 }
 publish(patch){if(this.closed)return;this.state={...this.state,...patch};this.host.networkView=this.state;this.host.dispatchEvent(new this.root.ownerDocument.defaultView.Event('network-update',{bubbles:true}));}
 setVisible(visible){this.visible=visible;if(!visible){this.revision++;this.cancel();this.publish({loading:false});}else void this.refresh();}
 async refresh(){
  if(this.closed)return;const revision=++this.revision,query=this.state.query.trim();this.lastAt=this.now();this.publish({loading:true,error:''});
  try{
   if(!this.retrieve)throw Error('当前环境尚未连接人物记忆。');
   const graph=await this.retrieve(query,this.readMemory(),{browse:true});
   if(this.closed || revision!==this.revision || query!==this.state.query.trim())return;
   const changed=relationshipEvidenceVersion(graph)!==relationshipEvidenceVersion(this.state.graph);
   if(changed)this.cancel();
   const selected=this.state.selected,rows=selected?.kind==='entity' ? graph.entities : graph.relations;
   this.publish({graph:changed ? graph : this.state.graph,loadedQuery:query,loading:false,selected:selected && rows.some(r=>r.id===selected.id) ? selected : null,...(changed ? {original:null,answer:null} : {})});
  }catch(error){if(!this.closed && revision===this.revision)this.publish({loading:false,error:error.message});}
 }
 tick(){if(this.visible && !this.state.loading && this.now()-this.lastAt>=10000)void this.refresh();}
 select(selection){
  const rows=selection?.kind==='entity' ? this.state.graph.entities : selection?.kind==='relation' ? this.state.graph.relations : [];
  if(selection && !rows.some(r=>r.id===selection.id))return;
  this.cancel();this.publish({selected:selection,pathTo:'',original:null,answer:null});
 }
 async original(recordId){
  const revision=this.revision,selection=this.state.selected;
  try{const graph=await this.retrieve(this.state.loadedQuery,this.readMemory(),{browse:true,recordId});if(!this.closed && revision===this.revision && selection===this.state.selected)this.publish({original:graph.record || {text:'原记录已删除或不再可用。'}});}
  catch(error){if(!this.closed && revision===this.revision)this.publish({error:error.message});}
 }
 cancel(){this.questionRevision++;this.controller?.abort();this.controller=null;if(this.state.answering)this.publish({answering:false,questionStatus:'问答已取消。'});}
 async ask(){
  if(this.state.answering || this.closed)return;
  const question=this.state.question.trim();if(!question)return this.publish({questionStatus:'请先填写关系问题。'});
  if(!this.service)return this.publish({questionStatus:'请在 AI 设置保存可用的回复模型后再提问。'});
  const selected=this.state.selected,person=selected?.kind==='entity' && this.state.graph.entities.find(n=>n.id===selected.id),edge=selected?.kind==='relation' && this.state.graph.relations.find(r=>r.id===selected.id);
  const focus=person ? [person.id] : edge ? [edge.from,edge.to] : [],names=this.state.graph.entities.filter(n=>focus.includes(n.id)).map(n=>n.name);
  const query=[...names,question].join(' ').slice(0,1300),revision=++this.questionRevision,controller=this.controller=new AbortController();
  this.publish({answering:true,answer:null,questionStatus:'正在核对人物证据…'});
  const current=()=>!this.closed && !controller.signal.aborted && revision===this.questionRevision;
  try{
   const graph=await this.retrieve(query,this.readMemory(),{browse:true});if(!current())return;
   const result=await this.service.run({question,mode:'relationships',relationshipContext:relationshipAnswerContext(graph,{entityIds:focus,names}),signal:controller.signal,onProgress:()=>{if(current())this.publish({questionStatus:'正在依据关系原文整理回答…'});}});
   if(!current())return;
   if(result.status!=='succeeded')throw Error(result.error || '本次没有生成可用回答，请补充具体人物与问题。');
   const latest=await this.retrieve(query,this.readMemory(),{browse:true});if(!current())return;
   if(relationshipEvidenceVersion(graph)!==relationshipEvidenceVersion(latest))throw Error('人物证据已变化，本次回答已作废，请重新提问。');
   this.publish({answer:{question,answer:result.answer,at:this.now(),entities:graph.entities,relations:graph.relations},questionStatus:'回答已完成，可在下方核对本次提供的关系原文。'});
  }catch(error){if(current() && !abortError(error))this.publish({questionStatus:error.message});}
  finally{if(current()){this.controller=null;this.publish({answering:false});}}
 }
 export(){const view=this.root.ownerDocument.defaultView,url=view.URL.createObjectURL(new view.Blob([JSON.stringify(this.state.graph,null,2)],{type:'application/json'})),link=this.root.ownerDocument.createElement('a');link.href=url;link.download='人物关系图谱.json';link.click();view.URL.revokeObjectURL(url);}
 dispatch(action){
  if(this.closed || !action || typeof action.type!=='string')return;
  if(action.type==='query' && typeof action.value==='string'){this.revision++;this.publish({query:action.value.slice(0,300),loading:false});}
  if(action.type==='question' && typeof action.value==='string')this.publish({question:action.value.slice(0,1000)});
  if(action.type==='search')return this.refresh();
  if(action.type==='overview'){this.publish({query:'',status:'all',predicate:'all',depth:0,selected:null,pathTo:''});return this.refresh();}
  if(action.type==='select')this.select(action.selection);
  if(action.type==='status' && ['all','verified','observed','unverified','conflicted'].includes(action.value))this.publish({status:action.value});
  if(action.type==='predicate' && (action.value==='all' || this.state.graph.relations.some(r=>r.predicate===action.value)))this.publish({predicate:action.value});
  if(action.type==='depth' && [0,1,2].includes(Number(action.value)))this.publish({depth:Number(action.value)});
  if(action.type==='layout' && ['concentric','cose','breadthfirst'].includes(action.value))this.publish({layout:action.value});
  if(action.type==='pathTo' && (action.value==='' || this.state.graph.entities.some(n=>n.id===action.value)))this.publish({pathTo:action.value});
  if(action.type==='original' && typeof action.recordId==='string')return this.original(action.recordId);
  if(action.type==='closeOriginal')this.publish({original:null});
  if(action.type==='ask')return this.ask();if(action.type==='cancel')this.cancel();if(action.type==='export')this.export();
 }
 destroy(){this.cancel();this.closed=true;this.revision++;this.host.removeEventListener('network-action',this.onAction);}
}
