import React,{createElement as h,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {MantineProvider,Button,Switch,TextInput,Textarea,NativeSelect,Select,Paper,Table,Alert,Collapse,Progress} from '@mantine/core';
import {useTable,tableFeatures} from '@tanstack/react-table';
import mantineCss from '@mantine/core/styles.css';
import {PRODUCT_CSS} from './styles.js';
import {createChartView} from './chart.js';
import {componentTheme,componentVariables,paletteScale} from '../theme-palette.js';

const features=tableFeatures({});
const icon=html=>html ? h('span',{className:'product-icon',dangerouslySetInnerHTML:{__html:html},'aria-hidden':true}) : null;
function Control({node,bridge}) {
  const common={label:node.label,'aria-label':node.label,description:node.description || undefined,disabled:node.disabled,error:node.invalid ? '请检查此项设置' : undefined,'data-control-id':node.id};
  const edit=value=>bridge.change(node.id,value);
  if(node.type==='checkbox')return h(Switch,{...common,checked:node.value,onChange:e=>edit(e.currentTarget.checked),className:'product-switch'});
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
  const columns=useMemo(()=>node.headers.map((title,i)=>({id:String(i),accessorFn:row=>row[i],header:title})),[node.headers.join('\0')]);
  const table=useTable({features,columns,data:node.rows});
  return h('div',{className:'product-table-scroll',tabIndex:0,'aria-label':node.caption || '数据表格，可横向滚动'},
    h(Table,{striped:true,highlightOnHover:true,withTableBorder:false,verticalSpacing:'sm',horizontalSpacing:'md'},
      node.caption ? h('caption',null,node.caption) : null,
      h(Table.Thead,null,h(Table.Tr,null,table.getAllColumns().map(col=>h(Table.Th,{key:col.id},col.columnDef.header)))),
      h(Table.Tbody,null,table.getRowModel().rows.map(row=>h(Table.Tr,{key:row.id},(node.cells[row.index] || []).map((cell,i)=>h(Table.Td,{key:i,colSpan:cell.colSpan},renderChildren(cell.children,bridge))))))));
}
function Disclosure({node,bridge}) {
  // Expansion belongs to the visible view, independent of adaptive source DOM.
  const [open,setOpen]=useState(node.open),body=useRef(null);
  const invalid=JSON.stringify(node.children).includes('"invalid":true');
  useEffect(()=>{if(invalid)setOpen(true);},[invalid]);
  useEffect(()=>{if(open && invalid){const input=body.current?.querySelector('[aria-invalid="true"]');input?.focus();input?.scrollIntoView?.({block:'center'});}},[open,invalid]);
  return h(Paper,{withBorder:true,className:'product-disclosure'},h(Button,{variant:'subtle',fullWidth:true,justify:'space-between','aria-expanded':open,'aria-controls':`detail-${node.id}`,onClick:()=>{setOpen(!open);bridge.toggle(node.id,!open);},rightSection:open ? '−' : '+'},node.title),h(Collapse,{expanded:open,transitionDuration:0,keepMountedMode:'display-none'},h('div',{className:'product-disclosure-body',id:`detail-${node.id}`,ref:body},renderChildren(node.children,bridge))));
}
function Chart({node}) {
  const element=useRef(null),chart=useRef(null);
  useEffect(()=>{chart.current=createChartView(element.current);return ()=>chart.current.destroy();},[]);
  useEffect(()=>{chart.current.update(node.option);},[node.option]);
  return h('div',{ref:element,className:'product-chart',role:'img','aria-label':node.label || '直播数据图表'});
}
function renderChildren(nodes,bridge){return nodes.map((node,i)=>h(View,{node,bridge,key:node.id || i}));}
function View({node,bridge}) {
  if(!node)return null;
  if(node.kind==='text')return node.text;
  if(node.kind==='field')return h(Control,{node,bridge});
  if(node.kind==='button')return h(Button,{size:'xs',variant:node.primary || node.selected ? 'filled' : 'light',color:node.danger ? 'red' : undefined,disabled:node.disabled,loading:node.busy,'aria-label':node.label,'aria-pressed':node.selected || undefined,onClick:()=>bridge.activate(node.id),leftSection:icon(node.icon)},node.text);
  if(node.kind==='details')return h(Disclosure,{node,bridge});
  if(node.kind==='table')return h(DataTable,{node,bridge});
  if(node.kind==='chart')return h(Chart,{node});
  if(node.kind==='progress')return node.value===null ? h('small',null,node.label) : h(Progress,{value:node.value,'aria-label':node.label});
  if(node.kind==='bars')return h('div',{className:'product-stat-bars','aria-label':node.label},node.items.map((item,i)=>h('div',{key:i,title:item.label},h('small',null,item.label),h(Progress,{value:item.scale,'aria-label':item.label}))));
  if(node.kind==='distribution'){const total=node.parts.reduce((sum,part)=>sum+part.value,0);return h(Progress.Root,{'aria-label':node.label},node.parts.map((part,i)=>h(Progress.Section,{key:i,value:part.value/total*100,color:({win:'teal',loss:'red',draw:'gray',pending:'orange'})[part.outcome],'aria-label':part.label},h(Progress.Label,null,part.label))));}
  if(node.kind==='svg')return h('div',{className:'product-graphic',role:'img','aria-label':node.label || '数据图表',dangerouslySetInnerHTML:{__html:node.html}});
  if(node.kind==='image')return h('img',{src:node.src,alt:node.alt,loading:'lazy',className:'product-image'});
  if(node.kind==='break')return h('br');
  if(node.kind==='link')return h('a',{href:node.href,target:'_blank',rel:'noopener noreferrer'},node.text);
  const props={className:node.classes,'data-view-id':node.id,'aria-label':node.label};
  if(/(^| )(workspace-card|settings-group|ai-card|anchor-section|pk-visual|giveaway-config|giveaway-live)( |$)/u.test(node.classes))return h(Paper,{...props,withBorder:true,p:'md',radius:'md'},renderChildren(node.children,bridge));
  return h(node.tag || 'div',props,renderChildren(node.children,bridge));
}
function Workspace({bridge,shadow,onReady}) {
  const state=useSyncExternalStore(bridge.subscribe,bridge.getSnapshot),[menu,setMenu]=useState(false),main=useRef(null),[systemDark,setSystemDark]=useState(()=>shadow.host.ownerDocument.defaultView.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(()=>{const query=shadow.host.ownerDocument.defaultView.matchMedia('(prefers-color-scheme: dark)'),change=()=>setSystemDark(query.matches);query.addEventListener('change',change);return ()=>query.removeEventListener('change',change);},[shadow]);
  useEffect(()=>{main.current?.scrollTo?.({top:0});setMenu(false);},[state.key]);
  useEffect(()=>{onReady?.();},[onReady]);
  useEffect(()=>{if(!state.focus)return;const field=shadow.querySelector(`[data-control-id="${state.focus.id}"]`);const input=field?.matches('input,textarea,select') ? field : field?.querySelector('input,textarea,select');input?.focus();input?.scrollIntoView?.({block:'center'});},[state.focus,shadow]);
  const dark=state.theme==='dark' || state.theme==='system' && systemDark;
  const groups=[...new Set(state.nav.map(n=>n.group))];
  const headings=[];function walk(node){if(node?.tag==='h3')headings.push({value:node.id,label:node.children.filter(n=>n.kind==='text').map(n=>n.text).join('').trim()});for(const child of node?.children || [])walk(child);}walk(state.content);
  const nav=h('nav',{className:'product-nav','aria-label':'功能导航'},groups.map(group=>h('div',{key:group,className:'product-nav-group'},h('div',{className:'product-nav-label'},group),state.nav.filter(n=>n.group===group).map(item=>h(Button,{key:item.key,variant:state.key===item.key ? 'light' : 'subtle',justify:'start',fullWidth:true,'aria-label':item.label,title:item.label,'aria-current':state.key===item.key ? 'page' : undefined,onClick:()=>bridge.navigate(item.key),leftSection:icon(item.icon)},item.label)))));
  return h(MantineProvider,{forceColorScheme:dark ? 'dark' : 'light',getRootElement:()=>shadow.host,cssVariablesSelector:':host',deduplicateCssVariables:false,withGlobalClasses:false,cssVariablesResolver:componentVariables,theme:componentTheme(state.palette,dark)},
    h('div',{className:'product-shell','data-menu-open':menu,'data-sidebar-side':state.sidebar.side,'data-sidebar-collapsed':state.sidebar.collapsed,'data-material':state.material,'data-mantine-color-scheme':dark ? 'dark' : 'light'},
      h('div',{className:'product-sidebar'},state.sidebar.toggle ? h('div',{className:'product-nav-toggle'},h(View,{node:state.sidebar.toggle,bridge})) : null,nav),
      h('div',{className:'product-main'},
        h('header',{className:'product-toolbar'},h('div',{className:'product-heading'},h(Button,{className:'product-menu-button',size:'xs',variant:'light',onClick:()=>setMenu(!menu),'aria-expanded':menu},menu ? '收起菜单' : '功能菜单'),h('h2',null,state.title)),h('div',{className:'product-toolbar-actions'},renderChildren(state.toolbar,bridge))),
        h('div',{className:'product-subviews'},renderChildren(state.subviews,bridge),headings.length>2 ? h(NativeSelect,{'aria-label':'跳转到本页分区',size:'xs',value:'',data:[{value:'',label:'跳转到分区…'},...headings.filter(n=>n.label)],onChange:e=>{const heading=shadow.querySelector(`[data-view-id="${e.currentTarget.value}"]`);heading?.scrollIntoView?.({block:'start',behavior:'instant'});}}) : null),
        h('main',{className:'product-content',ref:main,key:state.key,'aria-label':state.title},h(View,{node:state.content,bridge})),
        h('footer',{className:'product-status'},h('div',{className:'product-state'},state.status || '已暂停'),state.messages.length ? h('div',{className:'product-messages','aria-live':'polite'},state.messages.map((message,i)=>h(Alert,{key:message.id || i,variant:'light',color:message.error ? 'red' : 'blue'},h(View,{node:message,bridge})))) : null))));
}
class WorkspaceBoundary extends React.Component {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){this.props.onError?.();}
  render(){return this.state.failed ? null : this.props.children;}
}
export function mountProductWorkspace({container,bridge,onReady,onError}) {
  const shadow=container.attachShadow({mode:'open'}),style=container.ownerDocument.createElement('style'),mount=container.ownerDocument.createElement('div');
  style.textContent=mantineCss+'\n'+PRODUCT_CSS;shadow.append(style,mount);const root=createRoot(mount);root.render(h(WorkspaceBoundary,{onError},h(Workspace,{bridge,shadow,onReady})));
  return {destroy(){root.unmount();shadow.replaceChildren();}};
}
