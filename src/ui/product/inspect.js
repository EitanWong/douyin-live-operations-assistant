import {createElement as h,createContext,useContext,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Modal} from '@mantine/core';
import {Button,useMotionPreference} from './motion.js';
import {recordText} from './collection.js';

const Inspection=createContext(null);
const EntryScope=createContext(false);
export function InspectionContents({children}) {return h(EntryScope.Provider,{value:true},children);}
export function viewLabel(node) {
  const first=node.children?.find(child=>child.tag==='h3' || child.tag==='h4' || child.tag==='strong' || child.layout==='row' && child.children?.some(part=>part.tag==='h3'));
  const heading=first?.layout==='row' ? first.children.find(part=>part.tag==='h3') : first;
  return node.label || node.caption || node.title || node.collection?.label || node.alt || (heading && recordText(heading)) || ({chart:'数据图表',svg:'数据图表',image:'图片',bars:'统计分布',distribution:'统计分布'})[node.kind] || (node.layout==='metrics' ? '数据指标' : '详细内容');
}
function findNode(node,id) {
  if(node?.id===id)return node;
  for(const child of [...node?.children || [],...node?.cells?.flatMap(row=>row.flatMap(cell=>cell.children)) || []]){const found=findNode(child,id);if(found)return found;}
  return null;
}
export function InspectButton({node,label=viewLabel(node)}) {
  const inspection=useContext(Inspection);
  const covered=useContext(EntryScope);
  if(!inspection || covered)return null;
  return h(Button,{className:'product-expand',variant:'subtle',size:'xs',title:`放大查看：${label}`,'aria-label':`放大查看：${label}`,'aria-haspopup':'dialog',onClick:()=>inspection.open(node.id)},
    h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6'})));
}
export function Inspectable({node,children,independent=false}) {
  const covered=useContext(EntryScope);
  if(covered && !independent)return children;
  return h(EntryScope.Provider,{value:false},h('div',{className:'product-inspectable'},h(InspectButton,{node}),h(InspectionContents,null,children)));
}
export function InspectionProvider({content,shadow,pageKey,disabled,render,reflow,children}) {
  const [target,setTarget]=useState(null),[opened,setOpened]=useState(false),trigger=useRef(null),body=useRef(null),reduced=useMotionPreference();
  const current=target && findNode(content,target.id),node=current || target?.node;
  const close=()=>setOpened(false);
  useEffect(()=>{if(target && (!current || target.pageKey!==pageKey || disabled))close();},[current,pageKey,disabled,target]);
  useLayoutEffect(()=>{
    if(!opened || !body.current)return;
    const element=body.current,view=shadow.host.ownerDocument.defaultView;let frame;
    const layout=()=>{view.cancelAnimationFrame(frame);frame=view.requestAnimationFrame(()=>reflow(element));};
    const observer=new view.ResizeObserver(layout);observer.observe(element);for(const child of element.querySelectorAll('.product-card-content'))observer.observe(child);layout();
    return ()=>{observer.disconnect();view.cancelAnimationFrame(frame);};
  },[opened,node,reflow,shadow]);
  const inspection={open(id){const node=findNode(content,id);if(!node)return;trigger.current=shadow.activeElement;setTarget({id,node,pageKey});setOpened(true);}};
  const restore=()=>{setTarget(null);const element=trigger.current;if(element?.isConnected)element.focus({preventScroll:true});};
  return h(Inspection.Provider,{value:inspection},children({inspecting:opened && !disabled}),
    h(Modal,{opened:opened && !disabled,onClose:close,title:node ? viewLabel(node) : '',size:'min(1120px, calc(100vw - 24px))',centered:true,withinPortal:false,lockScroll:false,returnFocus:false,closeOnEscape:false,onExitTransitionEnd:restore,
      transitionProps:{transition:'pop',duration:reduced ? 0 : 180},classNames:{root:'product-inspection-dialog',content:'product-inspection-content',body:'product-inspection-body'},closeButtonProps:{'aria-label':'关闭放大视图'},
      onKeyDown:event=>{if(event.key==='Escape' && !event.isComposing){event.preventDefault();event.stopPropagation();close();}}},
      node ? h(Inspection.Provider,{value:null},h('div',{className:'product-inspection-view product-page',ref:body},render(node))) : null));
}
