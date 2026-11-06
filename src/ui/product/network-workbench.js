import {createElement as h,useEffect,useMemo,useRef,useState} from 'react';
import {Paper,TextInput,Textarea,Select,NativeSelect,Group,Badge,Tabs,Loader} from '@mantine/core';
import {Button} from './motion.js';
import {InspectButton} from './inspect.js';
import {createNetworkView} from './network-view.js';
import {projectNetwork,relationshipPath,RELATIONSHIP_STATUS_LABELS,NETWORK_COLORS} from '../relationship-network.js';
import {PERSON_FACETS} from '../../ai/person-dossier.js';
const at=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const options=map=>Object.entries(map).map(([value,label])=>({value,label}));
const empty=text=>h('p',{className:'product-workbench-empty'},text);
function Evidence({rows=[],action}){
 return h('div',{className:'network-evidence'},rows.length ? rows.map((row,i)=>h('article',{key:`${row.recordId || 'evidence'}:${i}`},h('div',{className:'network-evidence-meta'},h(Badge,{variant:'light',color:row.trust==='verified' ? 'teal' : row.trust==='observed' ? 'blue' : 'yellow'},RELATIONSHIP_STATUS_LABELS[row.trust] || '待核实'),h('small',null,`${row.source} · ${at(row.at)}${row.scope ? ` · 房间${row.scope.room}` : ''}`)),h('p',null,row.text),row.attribution ? h('small',null,row.attribution) : null,row.recordId ? h(Button,{variant:'subtle',size:'xs',onClick:()=>action({type:'original',recordId:row.recordId})},'查看完整原文') : null)) : empty('尚无对应原话，保留未知。'));
}
function Dossier({person,view,action}){
 const dossier=person?.dossier;if(!person)return empty('选择人物后查看有来源的档案。');
 if(!dossier)return empty('此人物尚无可展示档案，可先查看关系证据。');
 return h('div',{className:'network-dossier'},dossier.profiles.map(url=>h('a',{key:url,href:url,target:'_blank',rel:'noopener noreferrer'},'抖音公开主页 ↗')),
 dossier.facets.map((r,i)=>h('article',{key:i},h('small',null,PERSON_FACETS[r.category]),h('p',null,r.text),h('small',null,`${RELATIONSHIP_STATUS_LABELS[r.trust]} · ${r.source} · ${at(r.at)}`))),
 dossier.gifting ? h('article',null,h('h4',null,'送礼观测'),[...(dossier.gifting.observed ? [dossier.gifting.observed] : []),...(dossier.gifting.byScope || [])].map((r,i)=>h('p',{key:i},`房间 ${r.room || r.scope?.room || '当前'} · 30天观测 ${r.count} 件`)),h('small',null,`${dossier.gifting.basis}；未来送礼概率未知。`)) : null,
 h('h4',null,'事件与记忆'),h(Evidence,{rows:dossier.events,action}),dossier.speechSamples.length ? h('section',null,h('h4',null,'说话样本'),h(Evidence,{rows:dossier.speechSamples,action})) : null,
 dossier.leads.length ? h('section',null,h('h4',null,'待核实公开线索'),h(Evidence,{rows:dossier.leads,action})) : null,
 dossier.missing.length ? h('small',null,`资料缺口：${dossier.missing.map(key=>PERSON_FACETS[key]).join('、')}`) : null,
 null);
}
function Relations({person,edge,graph,action}){
 const names=new Map(graph.entities.map(n=>[n.id,n.name]));
 if(edge)return h('div',null,h(Group,{gap:6},[edge.from,edge.to].map(id=>h(Button,{key:id,variant:'subtle',onClick:()=>action({type:'select',selection:{kind:'entity',id}})},names.get(id)))),h('h4',null,`${edge.negative ? '不是' : ''}${edge.predicate} · ${RELATIONSHIP_STATUS_LABELS[edge.status]}`),h(Evidence,{rows:edge.evidence,action}));
 if(!person)return empty('点选一个人物查看直接关系，或点选连线核对原话。');
 const edges=graph.relations.filter(r=>r.from===person.id || r.to===person.id);
 return h('div',{className:'network-relation-list'},edges.length ? edges.map(r=>h(Button,{key:r.id,variant:'light',fullWidth:true,onClick:()=>action({type:'select',selection:{kind:'relation',id:r.id}})},h('span',null,h('strong',null,`${names.get(r.from)} → ${names.get(r.to)}`),h('small',null,`${r.negative ? '不是' : ''}${r.predicate} · ${RELATIONSHIP_STATUS_LABELS[r.status]} · ${r.evidence?.length || 0} 条证据`)))) : empty('当前筛选下没有明确的直接关系。'),h(Evidence,{rows:person.evidence,action}));
}
function Questions({view,action,person}){
 return h('div',{className:'network-questions'},h('small',null,person ? `围绕「${person.name}」梳理，按来源区分事实与线索。` : '根据当前人物资料回答，缺少证据时保留未知。'),
 h(Group,{gap:6},['梳理直接关系','有哪些矛盾或未知'].map(text=>h(Button,{key:text,size:'xs',variant:'light',onClick:()=>action({type:'question',value:text})},text))),
 h(Textarea,{label:'关系问题',placeholder:'例如：他和小雨是什么关系，有什么依据？',value:view.question,maxLength:1000,autosize:true,minRows:2,maxRows:5,onChange:e=>action({type:'question',value:e.currentTarget.value})}),
 h(Group,{gap:6},h(Button,{onClick:()=>action({type:'ask'}),loading:view.answering,disabled:!view.question.trim()},'根据证据回答'),view.answering ? h(Button,{variant:'subtle',onClick:()=>action({type:'cancel'})},'取消') : null),
 h('p',{role:'status',className:'network-question-status'},view.questionStatus),
 view.answer ? h('article',{className:'network-answer'},h('small',null,at(view.answer.at)),h('h4',null,view.answer.question),h('p',null,view.answer.answer),h('h4',null,'本次提供的关系依据'),h(Evidence,{rows:view.answer.relations.flatMap(r=>r.evidence || []),action})) : null);
}
function NetworkCanvas({graph,view,path,action}){
 const element=useRef(null),renderer=useRef(null),[error,setError]=useState('');
 useEffect(()=>{try{renderer.current=createNetworkView(element.current,{onSelect:selection=>action({type:'select',selection})});}catch(e){setError(e.message);}return ()=>renderer.current?.destroy();},[]);
 useEffect(()=>{renderer.current?.update(graph,{layout:view.layout,selected:view.selected,path});},[graph,view.layout,view.selected,path]);
 const command=type=>renderer.current?.command(type);
 return h('section',{className:'product-workbench-stage','aria-label':'人物关系画布'},
 h('div',{className:'network-stage-heading'},h('span',null,view.selected ? '人物聚焦' : '关系全景'),h('small',null,`${graph.entities.length} 人物 · ${graph.relations.length} 关系`)),
 h('div',{ref:element,className:'network-canvas',role:'img','aria-label':`人物关系网，${graph.entities.length}个人物，${graph.relations.length}条关系；使用人物导航和右侧证据可键盘操作。`,tabIndex:0,onKeyDown:e=>{if(['+','=','-','0'].includes(e.key)){e.preventDefault();command(e.key==='0' ? 'fit' : e.key==='-' ? 'out' : 'in');}if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();renderer.current?.pan(e.key==='ArrowLeft' ? 30 : e.key==='ArrowRight' ? -30 : 0,e.key==='ArrowUp' ? 30 : e.key==='ArrowDown' ? -30 : 0);}}}),
 !graph.entities.length || error ? h('div',{className:'network-canvas-empty'},h('strong',null,error ? '图谱暂时无法绘制' : view.query ? '没有匹配的人物或事件' : '等待第一条关系证据'),h('p',null,error ? '可继续使用人物导航与证据列表。' : '搜索已保存的人物资料，或在知识资料中补充核实内容。')) : null,
 h('div',{className:'network-stage-tools'},[['out','缩小'],['in','放大'],['fit','适应视图'],['layout','重新布局'],['image','保存图片']].map(([type,label])=>h(Button,{key:type,size:'xs',variant:'subtle',onClick:()=>command(type)},label))),
 h('div',{className:'network-legend'},Object.entries(RELATIONSHIP_STATUS_LABELS).map(([key,label])=>h('span',{key,style:{'--network-color':NETWORK_COLORS[key]}},label))));
}
export function NetworkWorkbench({node,bridge}){
 const view=node.view,action=useMemo(()=>value=>bridge.networkAction(node.id,value),[bridge,node.id]);
 const person=view.selected?.kind==='entity' && view.graph.entities.find(n=>n.id===view.selected.id),edge=view.selected?.kind==='relation' && view.graph.relations.find(r=>r.id===view.selected.id);
 const base=useMemo(()=>projectNetwork(view.graph,{status:view.status,predicate:view.predicate}),[view.graph,view.status,view.predicate]);
 const graph=useMemo(()=>projectNetwork(base,{focus:person?.id,depth:view.pathTo ? 0 : view.depth}),[base,person?.id,view.depth,view.pathTo]);
 const path=useMemo(()=>person && view.pathTo ? relationshipPath(base,person.id,view.pathTo) : null,[base,person,view.pathTo]);
 const people=view.graph.entities.map((n,i)=>({value:n.id,label:`${n.name} · ${n.role || '人物'} · ${i+1}`}));
 return h(Paper,{className:'product-workbench',withBorder:true,'data-workbench':'network'},
 h('header',{className:'product-workbench-header'},h('div',{className:'network-title'},h('span',{className:'network-mark','aria-hidden':true},'◉'),h('h3',null,'人物关系图谱'),h('small',{className:'network-eyebrow'},'RELATIONSHIP EXPLORER')),h(Group,{gap:6},view.loading ? h(Loader,{size:16}) : h(Badge,{variant:'dot',color:'teal'},'证据驱动'),h(InspectButton,{node}))),
 h('div',{className:'product-workbench-toolbar'},h('form',{onSubmit:e=>{e.preventDefault();action({type:'search'});}},h(TextInput,{'aria-label':'搜索人物、别名或事件',placeholder:'搜索人物、别名或事件…',value:view.query,maxLength:300,onChange:e=>action({type:'query',value:e.currentTarget.value})}),h(Button,{type:'submit',loading:view.loading},'检索关系'),h(Button,{variant:'light',onClick:()=>action({type:'overview'})},'全网总览')),
 h('div',{className:'product-workbench-filters'},h(NativeSelect,{'aria-label':'可信状态',value:view.status,data:[{value:'all',label:'全部状态'},...options(RELATIONSHIP_STATUS_LABELS)],onChange:e=>action({type:'status',value:e.currentTarget.value})}),h(NativeSelect,{'aria-label':'关系类型',value:view.predicate,data:[{value:'all',label:'全部关系'},...[...new Set(view.graph.relations.map(r=>r.predicate))].map(value=>({value,label:value}))],onChange:e=>action({type:'predicate',value:e.currentTarget.value})}),h(NativeSelect,{'aria-label':'布局',value:view.layout,data:options({concentric:'同心网络',cose:'力导向',breadthfirst:'层级关系'}),onChange:e=>action({type:'layout',value:e.currentTarget.value})}),h(Button,{variant:'subtle',onClick:()=>action({type:'export'})},'导出 JSON'))),
 view.error ? h('p',{role:'alert',className:'network-error'},view.error) : null,
 h('div',{className:'product-workbench-columns'},h(NetworkCanvas,{graph,view,path,action}),
 h('aside',{className:'product-workbench-inspector','aria-label':'人物与关系证据',tabIndex:0},view.original ? h('article',{className:'network-original',role:'status'},h('h4',null,'完整原文'),h('p',null,view.original.text),h('small',null,view.original.source || ''),h(Button,{variant:'subtle',size:'xs',onClick:()=>action({type:'closeOriginal'})},'收起原文')) : null,
 h(Select,{label:'人物导航',clearButtonProps:{'aria-label':'清除人物选择'},placeholder:'搜索并选择人物',searchable:true,clearable:true,comboboxProps:{withinPortal:false},value:person?.id || null,data:people,nothingFoundMessage:'没有匹配人物',onChange:id=>action({type:'select',selection:id ? {kind:'entity',id} : null})}),
 h('div',{className:'network-inspector-heading'},h('h4',null,person?.name || (edge ? `${edge.negative ? '不是' : ''}${edge.predicate}` : '关系与证据')),h('small',null,person?.role || '选择节点或连线查看来源')),
 person ? h('div',{className:'network-focus-controls'},h(NativeSelect,{label:'探索范围',value:String(view.depth),data:options({0:'完整查询结果',1:'一层直接关系',2:'两层关系邻域'}),onChange:e=>action({type:'depth',value:e.currentTarget.value})}),h(Select,{label:'查找连接路径',clearButtonProps:{'aria-label':'清除连接路径'},placeholder:'选择另一人物',searchable:true,clearable:true,comboboxProps:{withinPortal:false},value:view.pathTo || null,data:people.filter(n=>n.value!==person.id),onChange:value=>action({type:'pathTo',value:value || ''})}),view.pathTo ? h('small',null,path ? `${path.edges.length}条关系构成的资料连接，不能推断两端直接关系。` : '当前筛选下没有已知连接路径。') : null) : null,
 h(Tabs,{defaultValue:'relations',keepMounted:false},h(Tabs.List,null,h(Tabs.Tab,{value:'relations'},'关系证据'),h(Tabs.Tab,{value:'dossier'},'人物档案'),h(Tabs.Tab,{value:'questions'},'AI 问答')),
 h(Tabs.Panel,{value:'relations'},h(Relations,{person,edge,graph:base,action})),h(Tabs.Panel,{value:'dossier'},h(Dossier,{person,view,action})),h(Tabs.Panel,{value:'questions'},h(Questions,{view,action,person}))))),
 h('footer',{className:'product-workbench-footer'},h('span',null,`当前 ${graph.entities.length} / ${view.graph.stats?.entities ?? view.graph.entities.length} 人物 · ${graph.relations.length} / ${view.graph.stats?.relations ?? view.graph.relations.length} 关系`),h('span',null,'关系有来源 · 路径不等于直接关系')));
}
