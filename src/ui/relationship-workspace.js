import {relationshipEvidenceVersion,relationshipAnswerContext} from '../services/relationship-query.js';
const emptyGraph=()=>({entities:[],relations:[],ambiguities:[],paths:[]});
const abortError=error=>error?.name==='AbortError';
export class RelationshipWorkspace {
 constructor(root,{retrieve,readMemory,now=Date.now}){
  Object.assign(this,{root,retrieve,readMemory,now});this.host=root.querySelector('[data-relationship-workspace]');this.revision=0;this.questionRevision=0;this.lastAt=0;
  this.state={graph:emptyGraph(),query:'',loadedQuery:'',status:'all',predicate:'all',depth:0,layout:'concentric',dimension:'role',inspectorTab:'overview',inspectorOpen:false,questionScope:'single',people:[],selected:null,pathTo:'',question:'',trace:[],answer:null,answering:false,loading:false,error:'',questionStatus:'选择人物后提问，或选择多人、全局问答。',original:null};
  this.onAction=e=>{void this.dispatch(e.detail);};this.host.addEventListener('network-action',this.onAction);this.publish({});
 }
 publish(patch){if(this.closed)return;this.state={...this.state,...patch};this.host.networkView=this.state;this.host.dispatchEvent(new this.root.ownerDocument.defaultView.Event('network-update',{bubbles:true}));}
 setVisible(visible){this.visible=visible;if(!visible){this.revision++;this.cancel();this.publish({loading:false});}else void this.refresh();}
 async refresh({rebuild=false}={}){
  if(this.closed)return;const revision=++this.revision,query=this.state.query.trim();this.lastAt=this.now();this.publish({loading:true,error:''});
  try{
   if(!this.retrieve)throw Error('当前环境尚未连接人物记忆。');
   const graph=await this.retrieve(query,this.readMemory(),{browse:true,deduplicate:true,...(rebuild ? {rebuild:true} : {})});
   if(this.closed || revision!==this.revision || query!==this.state.query.trim())return;
   const changed=relationshipEvidenceVersion(graph)!==relationshipEvidenceVersion(this.state.graph);
   if(changed)this.cancel();
   const alias=id=>graph.deduplication?.aliases?.find(row=>row.from===id)?.to || id;
   const previous=this.state.selected,selected=previous?.kind==='entity' && alias(previous.id)!==previous.id ? {...previous,id:alias(previous.id)} : previous,rows=selected?.kind==='entity' ? graph.entities : graph.relations;
   this.publish({graph:changed ? graph : this.state.graph,loadedQuery:query,loading:false,people:[...new Set(this.state.people.map(alias))].filter(id=>graph.entities.some(n=>n.id===id)),selected:selected && rows.some(r=>r.id===selected.id) ? selected : null,...(rebuild ? {deduplicationStatus:'已重新核对全部已保存资料，自动去重结果已更新。'} : {}),...(changed ? {original:null,answer:null} : {})});
  }catch(error){if(!this.closed && revision===this.revision)this.publish({loading:false,error:error.message});}
 }
 tick(){if(this.visible && !this.state.loading && this.now()-this.lastAt>=10000)void this.refresh();}
 select(selection){
  const rows=selection?.kind==='entity' ? this.state.graph.entities : selection?.kind==='relation' ? this.state.graph.relations : [];
  if(selection && !rows.some(r=>r.id===selection.id))return;
  this.cancel();this.publish({selected:selection,inspectorOpen:selection?.kind==='relation',inspectorTab:selection?.kind==='relation' ? 'relations' : this.state.inspectorTab,pathTo:'',original:null,answer:null,trace:[]});
 }
 async original(recordId){
  const revision=this.revision,selection=this.state.selected;
  try{const graph=await this.retrieve(this.state.loadedQuery,this.readMemory(),{browse:true,deduplicate:true,recordId});if(!this.closed && revision===this.revision && selection===this.state.selected)this.publish({original:graph.record || {text:'原记录已删除或不再可用。'}});}
  catch(error){if(!this.closed && revision===this.revision)this.publish({error:error.message});}
 }
 cancel(){this.questionRevision++;this.controller?.abort();this.controller=null;if(this.state.answering)this.publish({answering:false,questionStatus:'问答已取消。'});}
 async ask(){
  if(this.state.answering || this.closed)return;
  const question=this.state.question.trim();if(!question)return this.publish({questionStatus:'请先填写关系问题。'});
  if(!this.service)return this.publish({questionStatus:'请在 AI 设置保存可用的回复模型后再提问。'});
  const selected=this.state.selected,person=selected?.kind==='entity' && this.state.graph.entities.find(n=>n.id===selected.id),edge=selected?.kind==='relation' && this.state.graph.relations.find(r=>r.id===selected.id);
  const scope=this.state.questionScope,focus=scope==='global' ? [] : scope==='group' ? this.state.people : person ? [person.id] : edge ? [edge.from,edge.to] : [];
  if(scope!=='global' && !focus.length)return this.publish({questionStatus:'请先选择要提问的人物。'});
  const names=this.state.graph.entities.filter(n=>focus.includes(n.id)).map(n=>n.name);
  const query=[...names,question].join(' ').slice(0,1300),revision=++this.questionRevision,controller=this.controller=new AbortController();
  this.publish({answering:true,answer:null,trace:[],questionStatus:'正在提交后台研究并核对人物证据…'});
  const current=()=>!this.closed && !controller.signal.aborted && revision===this.questionRevision;
  try{
   const options={browse:true,deduplicate:true,entityIds:focus,overview:scope==='global'},graph=await this.retrieve(query,this.readMemory(),options);if(!current())return;
   const result=await this.service.run({question,mode:'relationships',relationshipContext:relationshipAnswerContext(graph,{scope,entityIds:focus,names}),signal:controller.signal,onProgress:progress=>{if(current())this.publish({trace:progress?.trace || [],questionStatus:progress?.trace?.at(-1)?.detail || '正在检索档案、关系与公开来源…'});}});
   if(!current())return;
   if(result.status!=='succeeded')throw Error(result.error || '本次没有生成可用回答，请补充具体人物与问题。');
   const latest=await this.retrieve(query,this.readMemory(),options);if(!current())return;
   if(relationshipEvidenceVersion(graph)!==relationshipEvidenceVersion(latest))throw Error('人物证据已变化，本次回答已作废，请重新提问。');
   this.publish({trace:result.trace || [],answer:{question,answer:result.answer,at:this.now(),scope,names,entities:graph.entities,relations:graph.relations,sources:result.sources || [],stopReason:result.stopReason,runtime:result.runtime},questionStatus:result.stopReason==='budget' ? '本次达到研究预算，尚有未完成查证；请缩小问题继续。' : '回答已完成，可核对原话、检索步骤和来源。'});
  }catch(error){if(current() && !abortError(error))this.publish({questionStatus:error.message});}
  finally{if(current()){this.controller=null;this.publish({answering:false});}}
 }
 export(){const view=this.root.ownerDocument.defaultView,url=view.URL.createObjectURL(new view.Blob([JSON.stringify(this.state.graph,null,2)],{type:'application/json'})),link=this.root.ownerDocument.createElement('a');link.href=url;link.download='人物关系图谱.json';link.click();view.URL.revokeObjectURL(url);}
 dispatch(action){
  if(this.closed || !action || typeof action.type!=='string')return;
  if(action.type==='query' && typeof action.value==='string'){this.revision++;this.publish({query:action.value.slice(0,300),loading:false});}
  if(action.type==='question' && typeof action.value==='string')this.publish({question:action.value.slice(0,1000)});
  if(action.type==='inspectorTab' && ['overview','relations','dossier','questions'].includes(action.value))this.publish({inspectorTab:action.value,inspectorOpen:true});
  if(action.type==='closeInspector')this.publish({inspectorOpen:false});
  if(action.type==='dimension' && ['role','evidence','activity'].includes(action.value))this.publish({dimension:action.value});
  if(action.type==='questionScope' && ['single','group','global'].includes(action.value) && action.value!==this.state.questionScope){this.cancel();this.publish({questionScope:action.value,answer:null,trace:[]});}
  if(action.type==='people' && Array.isArray(action.value)){this.cancel();this.publish({people:[...new Set(action.value)].filter(id=>this.state.graph.entities.some(n=>n.id===id)).slice(0,6),answer:null,trace:[]});}
  if(action.type==='search')return this.refresh();
  if(action.type==='deduplicate')return this.refresh({rebuild:true});
  if(action.type==='overview'){this.publish({query:'',status:'all',predicate:'all',depth:0,selected:null,inspectorOpen:false,pathTo:''});return this.refresh();}
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
