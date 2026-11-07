import {createElement as h,useEffect,useMemo,useRef,useState} from 'react';
import {Paper,TextInput,Select,NativeSelect,Group,Badge,Tabs,Loader} from '@mantine/core';
import {Button} from './motion.js';
import {InspectButton} from './inspect.js';
import {createNetworkView} from './network-view.js';
import {projectNetwork,relationshipPath,RELATIONSHIP_STATUS_LABELS,NETWORK_COLORS} from '../relationship-network.js';
import {networkInsights} from '../network-insights.js';
import {Overview,PersonFloat,Dossier,Relations,Questions} from './network-inspector.js';
export {Dossier} from './network-inspector.js';
const options=map=>Object.entries(map).map(([value,label])=>({value,label}));
function NetworkCanvas({graph,view,path,action,person}){
 const element=useRef(null),renderer=useRef(null),[error,setError]=useState('');
 useEffect(()=>{try{renderer.current=createNetworkView(element.current,{onSelect:selection=>action({type:'select',selection})});}catch(e){setError(e.message);}return ()=>renderer.current?.destroy();},[]);
 useEffect(()=>{renderer.current?.update(graph,{layout:view.layout,selected:view.selected,path,dimension:view.dimension});},[graph,view.layout,view.selected,path,view.dimension]);
 const command=type=>renderer.current?.command(type);
 return h('section',{className:'product-workbench-stage','aria-label':'人物关系画布'},
 h('div',{className:'network-stage-heading'},h('span',null,view.selected ? '人物聚焦' : '关系全景'),h('small',null,`${graph.entities.length} 人物 · ${graph.relations.length} 关系`)),
 h('div',{ref:element,className:'network-canvas',role:'img','aria-label':`人物关系网，${graph.entities.length}个人物，${graph.relations.length}条关系；使用人物导航和右侧证据可键盘操作。`,tabIndex:0,onKeyDown:e=>{if(['+','=','-','0'].includes(e.key)){e.preventDefault();command(e.key==='0' ? 'fit' : e.key==='-' ? 'out' : 'in');}if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();renderer.current?.pan(e.key==='ArrowLeft' ? 30 : e.key==='ArrowRight' ? -30 : 0,e.key==='ArrowUp' ? 30 : e.key==='ArrowDown' ? -30 : 0);}}}),
 !graph.entities.length || error ? h('div',{className:'network-canvas-empty'},h('strong',null,error ? '图谱暂时无法绘制' : view.query ? '没有匹配的人物或事件' : '等待第一条关系证据'),h('p',null,error ? '可继续使用人物导航与证据列表。' : '搜索已保存的人物资料，或在知识资料中补充核实内容。')) : null,
 person ? h(PersonFloat,{person,graph,people:view.people,action,onClose:()=>{action({type:'select',selection:null});element.current?.focus({preventScroll:true});}}) : null,
 h('div',{className:'network-stage-tools'},[['out','缩小'],['in','放大'],['fit','适应视图'],['layout','重新布局'],['image','保存图片']].map(([type,label])=>h(Button,{key:type,size:'xs',style:{color:'#c6dbf4'},variant:'subtle',onClick:()=>command(type)},label))),
 h('div',{className:'network-legend'},Object.entries(RELATIONSHIP_STATUS_LABELS).map(([key,label])=>h('span',{key,style:{'--network-color':NETWORK_COLORS[key]}},label))));
}
export function NetworkWorkbench({node,bridge}){
 const view=node.view,action=useMemo(()=>value=>bridge.networkAction(node.id,value),[bridge,node.id]);
 const person=view.selected?.kind==='entity' && view.graph.entities.find(n=>n.id===view.selected.id),edge=view.selected?.kind==='relation' && view.graph.relations.find(r=>r.id===view.selected.id);
 const base=useMemo(()=>projectNetwork(view.graph,{status:view.status,predicate:view.predicate}),[view.graph,view.status,view.predicate]);
 const graph=useMemo(()=>projectNetwork(base,{focus:person?.id,depth:view.pathTo ? 0 : view.depth}),[base,person?.id,view.depth,view.pathTo]);
 const path=useMemo(()=>person && view.pathTo ? relationshipPath(base,person.id,view.pathTo) : null,[base,person,view.pathTo]);
 const people=view.graph.entities.map((n,i)=>({value:n.id,label:`${n.name} · ${n.role || '人物'} · ${i+1}`}));
 const summary=useMemo(()=>networkInsights(base),[base]);
 return h(Paper,{className:'product-workbench',withBorder:true,'data-workbench':'network'},
 h('header',{className:'product-workbench-header'},h('div',{className:'network-title'},h('span',{className:'network-mark','aria-hidden':true},'◉'),h('h3',null,'人物关系图谱'),h('small',{className:'network-eyebrow'},'RELATIONSHIP EXPLORER')),h(Group,{gap:6},view.loading ? h(Loader,{size:16}) : h(Badge,{variant:'dot',color:'teal'},'证据驱动'),h(InspectButton,{node}))),
 h('div',{className:'product-workbench-body'},h('div',{className:'product-workbench-toolbar'},h('form',{onSubmit:e=>{e.preventDefault();action({type:'search'});}},h(TextInput,{'aria-label':'搜索人物、别名或事件',placeholder:'搜索人物、别名或事件…',value:view.query,maxLength:300,onChange:e=>action({type:'query',value:e.currentTarget.value})}),h(Button,{type:'submit',loading:view.loading},'检索关系'),h(Button,{variant:'light',onClick:()=>action({type:'overview'})},'全网总览')),
 h('div',{className:'product-workbench-filters'},h(NativeSelect,{'aria-label':'可信状态',value:view.status,data:[{value:'all',label:'全部状态'},...options(RELATIONSHIP_STATUS_LABELS)],onChange:e=>action({type:'status',value:e.currentTarget.value})}),h(NativeSelect,{'aria-label':'关系类型',value:view.predicate,data:[{value:'all',label:'全部关系'},...[...new Set(view.graph.relations.map(r=>r.predicate))].map(value=>({value,label:value}))],onChange:e=>action({type:'predicate',value:e.currentTarget.value})}),h(NativeSelect,{'aria-label':'布局',value:view.layout,data:options({concentric:'同心网络',cose:'力导向',breadthfirst:'层级关系'}),onChange:e=>action({type:'layout',value:e.currentTarget.value})}),h(NativeSelect,{'aria-label':'可视化维度',value:view.dimension || 'role',data:options({role:'身份角色着色',evidence:'档案覆盖着色',activity:'关系连接着色'}),onChange:e=>action({type:'dimension',value:e.currentTarget.value})}),h(Button,{variant:'subtle',onClick:()=>action({type:'export'})},'导出 JSON'))),
 h('div',{className:'network-summary','aria-label':'当前资料概览'},[['人物',summary.people],['关系',summary.relations],['来源',summary.sources],['冲突',summary.statuses.conflicted || 0]].map(([label,value])=>h('span',{key:label},h('strong',null,value),label))),
 view.error ? h('p',{role:'alert',className:'network-error'},view.error) : null,
 view.graph.ambiguities?.length ? h('p',{role:'status',className:'network-warning'},`同名待辨：${view.graph.ambiguities.map(row=>row.name).join('、')}。请核对各自来源，不能按昵称视为同一人。`) : null,
 h('div',{className:'product-workbench-columns'},h(NetworkCanvas,{graph,view,path,action,person:person && graph.entities.some(n=>n.id===person.id) ? person : null}),
 h('aside',{className:'product-workbench-inspector','aria-label':'人物与关系证据',tabIndex:0},view.original ? h('article',{className:'network-original',role:'status'},h('h4',null,'完整原文'),h('p',null,view.original.text),h('small',null,view.original.source || ''),h(Button,{variant:'subtle',size:'xs',onClick:()=>action({type:'closeOriginal'})},'收起原文')) : null,
 h(Select,{label:'人物导航',clearButtonProps:{'aria-label':'清除人物选择'},placeholder:'搜索并选择人物',searchable:true,clearable:true,comboboxProps:{withinPortal:false},value:person?.id || null,data:people,nothingFoundMessage:'没有匹配人物',onChange:id=>action({type:'select',selection:id ? {kind:'entity',id} : null})}),
 h('div',{className:'network-inspector-heading'},h('h4',null,person?.name || (edge ? `${edge.negative ? '不是' : ''}${edge.predicate}` : '关系与证据')),h('small',null,person?.role || '选择节点或连线查看来源')),
 person ? h('div',{className:'network-focus-controls'},h(NativeSelect,{label:'探索范围',value:String(view.depth),data:options({0:'完整查询结果',1:'一层直接关系',2:'两层关系邻域'}),onChange:e=>action({type:'depth',value:e.currentTarget.value})}),h(Select,{label:'查找连接路径',clearButtonProps:{'aria-label':'清除连接路径'},placeholder:'选择另一人物',searchable:true,clearable:true,comboboxProps:{withinPortal:false},value:view.pathTo || null,data:people.filter(n=>n.value!==person.id),onChange:value=>action({type:'pathTo',value:value || ''})}),view.pathTo ? h('small',null,path ? `${path.edges.length}条关系构成的资料连接，不能推断两端直接关系。` : '当前筛选下没有已知连接路径。') : null) : null,
 h(Tabs,{value:view.inspectorTab || (edge ? 'relations' : 'overview'),onChange:value=>action({type:'inspectorTab',value}),keepMounted:false},h(Tabs.List,null,h(Tabs.Tab,{value:'overview'},'画像概览'),h(Tabs.Tab,{value:'relations'},'关系证据'),h(Tabs.Tab,{value:'dossier'},'人物档案'),h(Tabs.Tab,{value:'questions'},'AI 问答')),
 h(Tabs.Panel,{value:'overview'},h(Overview,{person,graph:base,action})),h(Tabs.Panel,{value:'relations'},h(Relations,{person,edge,graph:base,action})),h(Tabs.Panel,{value:'dossier'},h(Dossier,{person,view,action})),h(Tabs.Panel,{value:'questions'},h(Questions,{view,action,person})))))),
 h('footer',{className:'product-workbench-footer'},h('span',null,`当前 ${graph.entities.length} / ${view.graph.stats?.entities ?? view.graph.entities.length} 人物 · ${graph.relations.length} / ${view.graph.stats?.relations ?? view.graph.relations.length} 关系${view.graph.stats?.truncated ? ' · 当前仅展示部分资料，请搜索具体人物' : ''}`),h('span',null,'关系有来源 · 路径不等于直接关系')));
}
