import React,{createElement as h,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {MantineProvider,Switch,Input,Slider,TextInput,Textarea,NativeSelect,Select,Paper,Table,Alert,Progress,SimpleGrid,Stack,Group,Tabs} from '@mantine/core';
import {m as motion,LazyMotion,domAnimation} from 'motion/react';
import {Button,MotionIcon,Chevron,Reveal,PageEntrance,MotionPreferences,useMotionTarget,springs,fade} from './motion.js';
import {useTable,tableFeatures} from '@tanstack/react-table';
import mantineCss from '@mantine/core/styles.css';
import {PRODUCT_CSS} from './styles.js';
import {createChartView} from './chart.js';
import {gridOptions} from './layout.js';
import {recordText} from './collection.js';
import {useDataBrowser,DataBrowserTools,DataBrowserFooter} from './data-browser.js';
import {componentTheme,componentVariables,paletteScale} from '../theme-palette.js';

const features=tableFeatures({});
const icon=html=>html ? h(MotionIcon,{html}) : null;
function Control({node,bridge}) {
  const common={label:node.labelHidden ? undefined : node.label,'aria-label':node.label,description:node.description || undefined,disabled:node.disabled,error:node.invalid ? '请检查此项设置' : undefined,'data-control-id':node.id};
  const edit=value=>bridge.change(node.id,value);
  if(node.type==='checkbox')return h(Switch,{...common,checked:node.value,onChange:e=>edit(e.currentTarget.checked),className:'product-switch'});
  if(node.type==='range')return h(Input.Wrapper,common,h(Slider,{value:Number(node.value),min:Number(node.min),max:Number(node.max),step:Number(node.step || 1),onChange:edit,disabled:node.disabled || node.readOnly,thumbLabel:node.label,thumbValueText:node.valueText || node.label,label:node.label,mt:10,mb:10,marks:Array.from({length:Math.min(21,Math.floor((Number(node.max)-Number(node.min))/Number(node.step || 1))+1)},(_,i)=>({value:Number(node.min)+i*Number(node.step || 1)}))}));
  common.inputWrapperOrder=['label','input','description','error'];
  if(node.type==='select'){
    const props={...common,value:node.value,data:node.options,onChange:edit,allowDeselect:false,comboboxProps:{withinPortal:false},searchable:node.options.length>10,nothingFoundMessage:'没有匹配项'};
    if(node.appearance==='palette'){
      const swatch=value=>h('span',{className:'product-color-swatch',style:{backgroundColor:value==='original' ? '#e31d47' : paletteScale(value)[8]},'aria-hidden':true});
      props.leftSection=swatch(node.value);props.renderOption=({option})=>h('span',{className:'product-color-option'},swatch(option.value),option.label);
    }
    // Short native lists remain fast with keyboard and mobile system pickers.
    return node.options.length>10 ? h(Select,props) : h(NativeSelect,{...common,value:node.value,data:node.options,onChange:e=>edit(e.currentTarget.value)});
  }
  const props={...common,type:node.type,value:node.value,placeholder:node.placeholder,min:node.min,max:node.max,step:node.step,maxLength:node.maxLength,readOnly:node.readOnly,onChange:e=>edit(e.currentTarget.value)};
  if(node.type==='textarea')return h(Textarea,{...props,type:undefined,autosize:true,minRows:3,maxRows:12});
  if(node.type==='file')return h(Button,{variant:'light',onClick:()=>bridge.activate(node.id)},node.label || '选择文件');
  return h(TextInput,props);
}
function DataTable({node,bridge}) {
  const browser=useDataBrowser(node.rows,node.headers,node.scope),label=node.caption || '数据表格';
  const columns=useMemo(()=>node.headers.map((title,i)=>({id:String(i),accessorFn:row=>row.values[i],header:title})),[node.headers.join('\0')]);
  const table=useTable({features,columns,data:browser.indices.map(index=>({index,values:node.rows[index]}))});
  return h('section',{className:'product-data-set','aria-label':label},
    node.sourceControlled ? null : h(DataBrowserTools,{browser,label,scope:node.scope}),
    h('div',{className:'product-table-scroll',ref:browser.scroll,tabIndex:0,'aria-label':`${label}，可滚动`},
    h(Table,{striped:true,highlightOnHover:true,withTableBorder:false,verticalSpacing:'sm',horizontalSpacing:'md'},
      node.caption ? h('caption',null,node.caption) : null,
      h(Table.Thead,null,h(Table.Tr,null,table.getAllColumns().map(col=>h(Table.Th,{key:col.id},col.columnDef.header)))),
      h(Table.Tbody,null,browser.count ? table.getRowModel().rows.map(row=>h(Table.Tr,{key:row.original.index},(node.cells[row.original.index] || []).map((cell,i)=>h(Table.Td,{key:i,colSpan:cell.colSpan},renderChildren(cell.children,bridge))))) : h(Table.Tr,null,h(Table.Td,{colSpan:Math.max(1,node.headers.length)},'没有匹配的数据，请调整搜索或筛选'))))),
    node.sourceControlled ? null : h(DataBrowserFooter,{browser,label,scope:node.scope}));
}
function RecordCollection({node,bridge}) {
  const rows=useMemo(()=>node.children.map(child=>[recordText(child)]),[node.children]);
  const browser=useDataBrowser(rows),label=node.collection.label;
  return h('section',{className:'product-data-set','aria-label':label},
    h(DataBrowserTools,{browser,label}),
    h('div',{className:'product-record-scroll',ref:browser.scroll,tabIndex:0,'aria-label':`${label}，可滚动`},browser.count ? h(View,{node:{...node,collection:undefined,children:browser.indices.map(index=>node.children[index])},bridge}) : h('p',{className:'empty'},'没有匹配的记录')),
    h(DataBrowserFooter,{browser,label}));
}
function Disclosure({node,bridge}) {
  // The bridge is the only expansion owner, including section jumps and errors.
  const open=node.open,body=useRef(null);
  const invalid=JSON.stringify(node.children).includes('"invalid":true');
  useEffect(()=>{if(invalid && !open)bridge.toggle(node.id,true);},[invalid,open,bridge,node.id]);
  useEffect(()=>{if(open && invalid){const input=body.current?.querySelector('[aria-invalid="true"]');input?.focus();input?.scrollIntoView?.({block:'center'});}},[open,invalid]);
  return h(Paper,{withBorder:true,className:'product-disclosure','data-surface':node.surface,'data-view-id':node.id},h(Button,{variant:'subtle',fullWidth:true,justify:'space-between','aria-expanded':open,'aria-controls':`detail-${node.id}`,onClick:()=>bridge.toggle(node.id,!open),rightSection:h(Chevron,{open})},node.title),h(Reveal,{open,id:`detail-${node.id}`},h(Stack,{className:'product-disclosure-body',gap:'sm',ref:body},renderChildren(node.children,bridge))));
}
function Chart({node}) {
  const element=useRef(null),chart=useRef(null);
  useEffect(()=>{chart.current=createChartView(element.current);return ()=>chart.current.destroy();},[]);
  useEffect(()=>{chart.current.update(node.option);},[node.option]);
  return h('div',{ref:element,className:'product-chart',role:'img','aria-label':node.label || '直播数据图表'});
}
function renderChildren(nodes,bridge){return nodes.map((node,i)=>node.span==='full' ? h('div',{key:node.id || i,className:'product-full'},h(View,{node,bridge})) : h(View,{node,bridge,key:node.id || i}));}
function View({node,bridge}) {
  if(!node)return null;
  if(node.kind==='text')return node.text;
  if(node.kind==='field')return h(Control,{node,bridge});
  if(node.kind==='button')return h(Button,{size:'sm',variant:node.primary || node.selected ? 'filled' : 'light',color:node.danger ? 'red' : undefined,disabled:node.disabled,loading:node.busy,'aria-label':node.label,'aria-pressed':node.selected || undefined,onClick:()=>bridge.activate(node.id),leftSection:icon(node.icon)},node.text);
  if(node.kind==='details')return h(Disclosure,{node,bridge});
  if(node.kind==='table')return h(DataTable,{node,bridge});
  if(node.collection?.mode==='records')return h(RecordCollection,{node,bridge});
  if(node.kind==='chart')return h(Chart,{node});
  if(node.kind==='progress')return node.value===null ? h('small',null,node.label) : h(Progress,{value:node.value,'aria-label':node.label});
  if(node.kind==='bars')return h('div',{className:'product-stat-bars','aria-label':node.label},node.items.map((item,i)=>h('div',{key:i,title:item.label},h('small',null,item.label),h(Progress,{value:item.scale,'aria-label':item.label}))));
  if(node.kind==='distribution'){const total=node.parts.reduce((sum,part)=>sum+part.value,0);return h(Progress.Root,{'aria-label':node.label},node.parts.map((part,i)=>h(Progress.Section,{key:i,value:part.value/total*100,color:({win:'teal',loss:'red',draw:'gray',pending:'orange'})[part.outcome],'aria-label':part.label},h(Progress.Label,null,part.label))));}
  if(node.kind==='svg')return h('div',{className:'product-graphic',role:'img','aria-label':node.label || '数据图表',dangerouslySetInnerHTML:{__html:node.html}});
  if(node.kind==='image')return h('img',{src:node.src,alt:node.alt,loading:'lazy',className:'product-image'});
  if(node.kind==='break')return h('br');
  if(node.kind==='link')return h('a',{href:node.href,target:'_blank',rel:'noopener noreferrer'},node.text);
  const props={className:[node.classes,node.layout ? 'product-layout' : '',node.collection?.mode==='scroll' ? 'product-edit-scroll' : ''].filter(Boolean).join(' '),'data-view-id':node.id,'data-layout':node.layout,'data-surface':node.surface,'aria-label':node.label,role:node.role,tabIndex:node.tag==='h3' ? -1 : undefined};
  const content=renderChildren(node.children,bridge);
  if(['cards','fields','metrics'].includes(node.layout))return h(SimpleGrid,{...props,...gridOptions(node),type:'container',spacing:node.layout==='cards' ? 'var(--product-section-gap)' : 'var(--product-gap)'},content);
  if(node.layout==='scoreboard')return h('div',props,content);
  if(node.surface==='card')return h(Paper,{...props,component:Stack,gap:'var(--product-gap)',withBorder:true,p:'var(--product-card-padding)',radius:'md'},content);
  if(node.layout==='row')return h(Group,{...props,gap:'var(--product-gap)',wrap:'wrap',align:'center'},content);
  if(node.layout==='stack')return h(Stack,{...props,gap:'var(--product-gap)'},content);
  return h(node.tag || 'div',props,renderChildren(node.children,bridge));
}
function Workspace({bridge,shadow,onReady}) {
  const state=useSyncExternalStore(bridge.subscribe,bridge.getSnapshot),[menu,setMenu]=useState(false),[jump,setJump]=useState(null),main=useRef(null),[systemDark,setSystemDark]=useState(()=>shadow.host.ownerDocument.defaultView.matchMedia('(prefers-color-scheme: dark)').matches);
  const [compact,setCompact]=useState(()=>shadow.host.getBoundingClientRect().width<=660);
  useEffect(()=>{
    const observer=new shadow.host.ownerDocument.defaultView.ResizeObserver(entries=>setCompact(entries[0].contentRect.width<=660));
    observer.observe(shadow.host);return ()=>observer.disconnect();
  },[shadow]);
  const sidebarWidth=useMotionTarget({'--product-sidebar-width':state.sidebar.collapsed ? '64px' : '184px'},springs.layout);
  const sidebarReveal=useMotionTarget({height:compact ? menu ? 'auto' : 0 : '100%',opacity:compact && !menu ? 0 : 1},{...springs.disclosure,opacity:fade});
  const groupReveal=useMotionTarget({height:state.sidebar.collapsed && !compact ? 0 : 24,opacity:state.sidebar.collapsed && !compact ? 0 : 1},{...springs.layout,opacity:fade});
  const selectedView=state.subviews.find(node=>node.selected)?.id;
  useEffect(()=>{const query=shadow.host.ownerDocument.defaultView.matchMedia('(prefers-color-scheme: dark)'),change=()=>setSystemDark(query.matches);query.addEventListener('change',change);return ()=>query.removeEventListener('change',change);},[shadow]);
  useEffect(()=>{main.current?.scrollTo?.({top:0});setMenu(false);},[state.key,selectedView]);
  useEffect(()=>{onReady?.();},[onReady]);
  useEffect(()=>{if(!jump)return;const heading=shadow.querySelector(`[data-view-id="${jump.id}"]`);heading?.focus?.({preventScroll:true});heading?.scrollIntoView?.({block:'start',behavior:'instant'});},[jump,shadow]);
  useEffect(()=>{if(!state.focus)return;const field=shadow.querySelector(`[data-control-id="${state.focus.id}"]`);const input=field?.matches('input,textarea,select') ? field : field?.querySelector('input,textarea,select');input?.focus();input?.scrollIntoView?.({block:'center'});},[state.focus,shadow]);
  const dark=state.theme==='dark' || state.theme==='system' && systemDark;
  const groups=[...new Set(state.nav.map(n=>n.group))];
  const headings=[];function walk(node){if(node?.tag==='h3')headings.push({value:node.id,label:node.children.filter(n=>n.kind==='text').map(n=>n.text).join('').trim()});for(const child of node?.children || [])walk(child);}walk(state.content);
  const nav=h('nav',{id:'product-navigation',className:'product-nav','aria-label':'功能导航'},groups.map(group=>h('div',{key:group,className:'product-nav-group'},h(motion.div,{className:'product-nav-label',initial:false,'aria-hidden':state.sidebar.collapsed && !compact,animate:groupReveal},group),state.nav.filter(n=>n.group===group).map(item=>h(Button,{key:item.key,className:'product-nav-button',variant:state.key===item.key ? 'light' : 'subtle',fullWidth:true,'aria-label':item.label,title:item.label,'aria-current':state.key===item.key ? 'page' : undefined,onClick:()=>bridge.navigate(item.key),leftSection:icon(item.icon)},item.label)))));
  return h(MantineProvider,{forceColorScheme:dark ? 'dark' : 'light',getRootElement:()=>shadow.host,cssVariablesSelector:':host',deduplicateCssVariables:false,withGlobalClasses:false,cssVariablesResolver:componentVariables,theme:componentTheme(state.palette,dark)},
    h(motion.div,{initial:false,animate:sidebarWidth,className:'product-shell','data-menu-open':menu,'data-sidebar-side':state.sidebar.side,'data-sidebar-collapsed':state.sidebar.collapsed,'data-material':state.material,'data-mantine-color-scheme':dark ? 'dark' : 'light'},
      h(motion.aside,{className:'product-sidebar','aria-label':'功能侧边栏',initial:false,inert:compact && !menu,'aria-hidden':compact && !menu,animate:sidebarReveal},h('div',{className:'product-sidebar-inner'},state.sidebar.toggle ? h('div',{className:'product-nav-toggle'},h(Button,{className:'product-nav-button',variant:'subtle',fullWidth:true,'aria-label':state.sidebar.toggle.label,title:state.sidebar.toggle.label,'aria-expanded':!state.sidebar.collapsed,'aria-controls':'product-navigation',onClick:()=>bridge.activate(state.sidebar.toggle.id),leftSection:icon(state.sidebar.toggle.icon)},state.sidebar.toggle.label)) : null,nav)),
      h('div',{className:'product-main'},
        h('header',{className:'product-toolbar'},h('div',{className:'product-heading'},h(Button,{className:'product-menu-button',size:'xs',variant:'light',onClick:()=>setMenu(!menu),'aria-expanded':menu},h(Chevron,{open:menu}),menu ? '收起菜单' : '功能菜单'),h('h2',null,state.title)),h('div',{className:'product-toolbar-actions'},renderChildren(state.toolbar.filter(node=>node.kind==='button'),bridge))),
        h('div',{className:'product-subviews'},state.subviews.length ? h(Tabs,{id:'product-sections',value:selectedView,variant:'pills',className:'product-subview-tabs',onChange:value=>{if(value)bridge.activate(value);}},h(Tabs.List,{'aria-label':`${state.title}分类`},state.subviews.map(node=>h(Tabs.Tab,{key:node.id,value:node.id,disabled:node.disabled},node.text)))) : null,headings.length>2 ? h(NativeSelect,{'aria-label':'跳转到本页分区',size:'xs',value:'',data:[{value:'',label:'跳转到分区…'},...headings.filter(n=>n.label)],onChange:e=>{const id=e.currentTarget.value;if(bridge.reveal(id))setJump({id});}}) : null),
        h('main',{className:'product-content',ref:main,key:state.key,id:selectedView ? `product-sections-panel-${selectedView}` : undefined,'aria-label':state.title,'aria-labelledby':selectedView ? `product-sections-tab-${selectedView}` : undefined},h(PageEntrance,{key:`${state.key}:${selectedView || ''}`},h(View,{node:state.content,bridge}))),
        h('footer',{className:'product-status'},h('div',{className:'product-state'},h('span',null,state.status || '已暂停'),h('span',null,renderChildren(state.toolbar.filter(node=>node.kind!=='button'),bridge))),state.messages.length ? h('div',{className:'product-messages','aria-live':'polite'},state.messages.map((message,i)=>h(PageEntrance,{key:message.id || i,distance:3},h(Alert,{variant:'light',color:message.error ? 'red' : 'brand'},h(View,{node:message,bridge}))))) : null))));
}
class WorkspaceBoundary extends React.Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onError?.();}
  render(){return this.state.failed ? null : this.props.children;}
}
export function mountProductWorkspace({container,bridge,onReady,onError}) {
  const shadow=container.attachShadow({mode:'open'}),style=container.ownerDocument.createElement('style'),mount=container.ownerDocument.createElement('div');
  style.textContent=mantineCss+'\n'+PRODUCT_CSS;shadow.append(style,mount);const root=createRoot(mount);root.render(h(WorkspaceBoundary,{onError},h(LazyMotion,{features:domAnimation,strict:true},h(MotionPreferences,{view:container.ownerDocument.defaultView},h(Workspace,{bridge,shadow,onReady})))));
  return {destroy(){root.unmount();shadow.replaceChildren();}};
}
