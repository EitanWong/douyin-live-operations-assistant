import {createElement as h,useEffect,useMemo,useRef,useState} from 'react';
import {Paper,TextInput,Select,NativeSelect,Group,Badge,Tabs,Loader} from '@mantine/core';
import {Button} from './motion.js';
import {InspectButton} from './inspect.js';
import {createNetworkView} from './network-view.js';
import {projectNetwork,relationshipPath,RELATIONSHIP_STATUS_LABELS,NETWORK_COLORS} from '../relationship-network.js';
import {Overview,PersonFloat,Dossier,Relations,Questions} from './network-inspector.js';
export {Dossier} from './network-inspector.js';
const options=map=>Object.entries(map).map(([value,label])=>({value,label}));
function Filters({view,action}){
 return h('div',{className:'network-filter-fields'},
 h(NativeSelect,{label:'可信状态',value:view.status,data:[{value:'all',label:'全部状态'},...options(RELATIONSHIP_STATUS_LABELS)],onChange:e=>action({type:'status',value:e.currentTarget.value})}),
 h(NativeSelect,{label:'关系类型',value:view.predicate,data:[{value:'all',label:'全部关系'},...[...new Set(view.graph.relations.map(r=>r.predicate))].map(value=>({value,label:value}))],onChange:e=>action({type:'predicate',value:e.currentTarget.value})}),
 h(NativeSelect,{label:'布局',value:view.layout,data:options({concentric:'同心网络',cose:'力导向',breadthfirst:'层级关系'}),onChange:e=>action({type:'layout',value:e.currentTarget.value})}),
 h(NativeSelect,{label:'可视化维度',value:view.dimension || 'role',data:options({role:'身份角色着色',evidence:'档案覆盖着色',activity:'关系连接着色'}),onChange:e=>action({type:'dimension',value:e.currentTarget.value})}),
 h(Button,{variant:'light',onClick:()=>action({type:'export'})},'导出 JSON'));
}
function NetworkToolbar({view,person,people,action,onFilters,filtersOpen}){
 return h('div',{className:'network-map-toolbar'},
 h('form',{onSubmit:e=>{e.preventDefault();action({type:'search'});}},h(TextInput,{'aria-label':'搜索人物、别名或事件',placeholder:'搜索人物、别名或事件…',value:view.query,maxLength:300,onChange:e=>action({type:'query',value:e.currentTarget.value})}),h(Button,{type:'submit',loading:view.loading},'检索关系')),
 h(Select,{'aria-label':'定位图中人物',clearButtonProps:{'aria-label':'清除人物选择'},placeholder:'定位图中人物',searchable:true,clearable:true,comboboxProps:{withinPortal:false},value:person?.id || null,data:people,nothingFoundMessage:'没有匹配人物',onChange:id=>action({type:'select',selection:id ? {kind:'entity',id} : null})}),
 h(Group,{gap:4},h(Button,{variant:'light',loading:view.loading,onClick:()=>action({type:'deduplicate'})},'自动去重'),h(Button,{variant:'light',onClick:()=>action({type:'overview'})},'全网总览'),h(Button,{variant:'light','aria-expanded':filtersOpen,onClick:onFilters},'筛选与布局'),h(Button,{variant:'light',onClick:()=>action({type:'inspectorTab',value:'overview'})},'资料概览'),h(Button,{variant:'light',onClick:()=>{action({type:'questionScope',value:'global'});action({type:'inspectorTab',value:'questions'});}},'全局问答')));
}
function NetworkInspector({view,person,edge,graph,path,people,action,onClose}){
 const close=useRef(null);useEffect(()=>{close.current?.focus({preventScroll:true});},[]);
 return h('section',{className:'network-map-panel',role:'dialog','aria-modal':false,'aria-label':'人物与关系详情',onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}}},
 h('header',{className:'network-panel-header'},h('div',null,h('strong',null,person?.name || (edge ? `${edge.negative ? '不是' : ''}${edge.predicate}` : '全局人物与关系')),h('small',null,person?.role || '资料、证据与 AI 问答')),h(Button,{ref:close,variant:'subtle','aria-label':'关闭图内详情',onClick:onClose},'×')),
 h('div',{className:'network-panel-body',tabIndex:0,'aria-label':'图内详情正文'},
 view.original ? h('article',{className:'network-original',role:'status'},h('h4',null,'完整原文'),h('p',null,view.original.text),h('small',null,view.original.source || ''),h(Button,{variant:'subtle',size:'xs',onClick:()=>action({type:'closeOriginal'})},'收起原文')) : null,
 person ? h('div',{className:'network-focus-controls'},h(NativeSelect,{label:'探索范围',value:String(view.depth),data:options({0:'完整查询结果',1:'一层直接关系',2:'两层关系邻域'}),onChange:e=>action({type:'depth',value:e.currentTarget.value})}),h(Select,{label:'查找连接路径',clearButtonProps:{'aria-label':'清除连接路径'},placeholder:'选择另一人物',searchable:true,clearable:true,comboboxProps:{withinPortal:false},value:view.pathTo || null,data:people.filter(n=>n.value!==person.id),onChange:value=>action({type:'pathTo',value:value || ''})}),view.pathTo ? h('small',null,path ? `${path.edges.length}条关系构成的资料连接，不能推断两端直接关系。` : '当前筛选下没有已知连接路径。') : null) : null,
 h(Tabs,{value:view.inspectorTab || (edge ? 'relations' : 'overview'),onChange:value=>action({type:'inspectorTab',value}),keepMounted:false},h(Tabs.List,null,h(Tabs.Tab,{value:'overview'},'画像概览'),h(Tabs.Tab,{value:'relations'},'关系证据'),h(Tabs.Tab,{value:'dossier'},'人物档案'),h(Tabs.Tab,{value:'questions'},'AI 问答')),
 h(Tabs.Panel,{value:'overview'},h(Overview,{person,graph,action})),h(Tabs.Panel,{value:'relations'},h(Relations,{person,edge,graph,action})),h(Tabs.Panel,{value:'dossier'},h(Dossier,{person,view,action})),h(Tabs.Panel,{value:'questions'},h(Questions,{view,action,person})))));
}
function NetworkCanvas({graph,view,path,action,person,toolbar,children,detailsOpen,onDetailsClose}){
 const element=useRef(null),renderer=useRef(null),[error,setError]=useState('');
 useEffect(()=>{try{renderer.current=createNetworkView(element.current,{onSelect:selection=>action({type:'select',selection})});}catch(e){setError(e.message);}return ()=>renderer.current?.destroy();},[]);
 useEffect(()=>{renderer.current?.update(graph,{layout:view.layout,selected:view.selected,path,dimension:view.dimension});},[graph,view.layout,view.selected,path,view.dimension]);
 const command=type=>renderer.current?.command(type);
 return h('section',{className:'product-workbench-stage','aria-label':'人物关系画布',onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(detailsOpen)onDetailsClose();else{action({type:'select',selection:null});element.current?.focus({preventScroll:true});}}}},
 h('div',{ref:element,className:'network-canvas',role:'img','aria-label':`人物关系网，${graph.entities.length}个人物，${graph.relations.length}条关系；可使用图内定位搜索选择人物，按加减号缩放、方向键平移。`,tabIndex:0,onKeyDown:e=>{if(['+','=','-','0'].includes(e.key)){e.preventDefault();command(e.key==='0' ? 'fit' : e.key==='-' ? 'out' : 'in');}if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();renderer.current?.pan(e.key==='ArrowLeft' ? 30 : e.key==='ArrowRight' ? -30 : 0,e.key==='ArrowUp' ? 30 : e.key==='ArrowDown' ? -30 : 0);}}}),
 !graph.entities.length || error ? h('div',{className:'network-canvas-empty'},h('strong',null,error ? '图谱暂时无法绘制' : view.query ? '没有匹配的人物或事件' : '等待第一条关系证据'),h('p',null,error ? '可继续使用图内定位搜索与证据浮窗。' : '搜索已保存的人物资料，或在知识资料中补充核实内容。')) : null,
 toolbar,
 h('div',{className:'network-map-overlay-area'},children,
 person && !detailsOpen ? h(PersonFloat,{person,graph,people:view.people,action,onClose:()=>{action({type:'select',selection:null});element.current?.focus({preventScroll:true});}}) : null),
 h('div',{className:'network-stage-bottom'},h('div',{className:'network-stage-tools'},[['out','缩小'],['in','放大'],['fit','适应视图'],['layout','重新布局'],['image','保存图片']].map(([type,label])=>h(Button,{key:type,size:'xs',style:{color:'#c6dbf4'},variant:'subtle',onClick:()=>command(type)},label))),
 h('div',{className:'network-legend'},Object.entries(RELATIONSHIP_STATUS_LABELS).map(([key,label])=>h('span',{key,style:{'--network-color':NETWORK_COLORS[key]}},label)))));
}
export function NetworkWorkbench({node,bridge}){
 const view=node.view,host=useRef(null),returnFocus=useRef(null),[filtersOpen,setFiltersOpen]=useState(false);
 const action=useMemo(()=>value=>{if(['select','inspectorTab'].includes(value.type))setFiltersOpen(false);if(value.type==='inspectorTab' && !host.current?.querySelector('.network-map-panel')?.contains(host.current.getRootNode().activeElement))returnFocus.current=host.current?.getRootNode().activeElement;bridge.networkAction(node.id,value);},[bridge,node.id]);
 const person=view.selected?.kind==='entity' && view.graph.entities.find(n=>n.id===view.selected.id),edge=view.selected?.kind==='relation' && view.graph.relations.find(r=>r.id===view.selected.id);
 const base=useMemo(()=>projectNetwork(view.graph,{status:view.status,predicate:view.predicate}),[view.graph,view.status,view.predicate]);
 const graph=useMemo(()=>projectNetwork(base,{focus:person?.id,depth:view.pathTo ? 0 : view.depth}),[base,person?.id,view.depth,view.pathTo]);
 const path=useMemo(()=>person && view.pathTo ? relationshipPath(base,person.id,view.pathTo) : null,[base,person,view.pathTo]);
 const people=view.graph.entities.map((n,i)=>({value:n.id,label:`${n.name} · ${n.role || '人物'} · ${i+1}`}));
 const detailsOpen=view.inspectorOpen ?? !!edge;
 const closeDetails=()=>{action({type:'closeInspector'});const target=returnFocus.current;const quickView=host.current?.querySelector('.network-person-float button');if(target?.isConnected)target.focus({preventScroll:true});else (quickView || host.current?.querySelector('.network-canvas'))?.focus({preventScroll:true});};
 return h(Paper,{ref:host,className:'product-workbench',withBorder:true,'data-workbench':'network'},
 h('header',{className:'product-workbench-header'},h('div',{className:'network-title'},h('span',{className:'network-mark','aria-hidden':true},'◉'),h('h3',null,'人物关系图谱')),h(Group,{gap:6},view.loading ? h(Loader,{size:16}) : h(Badge,{variant:'dot',color:'teal'},'证据驱动'),h(InspectButton,{node}))),
 h(NetworkCanvas,{graph,view,path,action,person:person && graph.entities.some(n=>n.id===person.id) ? person : null,detailsOpen:detailsOpen || filtersOpen,onDetailsClose:()=>{if(filtersOpen)setFiltersOpen(false);else closeDetails();},toolbar:h(NetworkToolbar,{view,person,people,action,filtersOpen,onFilters:()=>{setFiltersOpen(open=>!open);if(detailsOpen)action({type:'closeInspector'});}})},
 h('div',{className:'network-map-notices','aria-live':'polite'},view.error ? h('p',{role:'alert',className:'network-error'},view.error) : null,view.graph.deduplication ? h('p',{className:'network-warning'},`${view.deduplicationStatus || '自动去重已开启。'}已归并 ${view.graph.deduplication.mergedProfiles} 条未绑定资料，统一 ${view.graph.deduplication.resolvedMentions} 处提及。原始资料与待核实状态保留，归档不代表身份认证。`) : null,view.graph.ambiguities?.length ? h('p',{className:'network-warning'},`同名记录：${view.graph.ambiguities.map(row=>row.name).join('、')}。存在多个账号或归属不明，已分别保留；请在知识资料中补充对应账号标识后再次去重。`) : null),
 filtersOpen ? h('section',{className:'network-map-panel',role:'dialog','aria-modal':false,'aria-label':'图谱筛选与布局',onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setFiltersOpen(false);host.current?.querySelector('[aria-expanded]')?.focus({preventScroll:true});}}},h('header',{className:'network-panel-header'},h('strong',null,'筛选与布局'),h(Button,{variant:'subtle','aria-label':'关闭图谱筛选',onClick:()=>setFiltersOpen(false)},'×')),h('div',{className:'network-panel-body'},h(Filters,{view,action}))) : null,
 detailsOpen ? h(NetworkInspector,{view,person,edge,graph:base,path,people,action,onClose:closeDetails}) : null),
 h('footer',{className:'product-workbench-footer'},h('span',null,`当前 ${graph.entities.length} / ${view.graph.stats?.entities ?? view.graph.entities.length} 人物 · ${graph.relations.length} / ${view.graph.stats?.relations ?? view.graph.relations.length} 关系${view.graph.stats?.truncated ? ' · 当前仅展示部分资料，请搜索具体人物' : ''}`),h('span',null,'关系有来源 · 路径不等于直接关系')));
}
