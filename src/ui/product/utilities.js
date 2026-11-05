import {createElement as h,useEffect,useRef,useState} from 'react';
import {Modal} from '@mantine/core';
import {Button,useMotionPreference} from './motion.js';
import {InspectionContents} from './inspect.js';
import {icon} from '../icons.js';

const entries=[{kind:'manage',label:'工具管理',icon:'sliders-horizontal'},{kind:'help',label:'使用说明',icon:'library'}];

// The host owns these two entries. Plugins supply content and original actions.
export function PageUtilities({utilities,shadow,pageKey,title,disabled,render,children}) {
 const [target,setTarget]=useState(null),[opened,setOpened]=useState(false),trigger=useRef(null),reduced=useMotionPreference();
 const sections=utilities?.[target?.kind] || [],label=entries.find(entry=>entry.kind===target?.kind)?.label || '';
 const active=opened && !disabled && target?.pageKey===pageKey;
 const close=()=>setOpened(false);
 useEffect(()=>{if(target && (target.pageKey!==pageKey || disabled || !sections.length))close();},[pageKey,disabled,sections.length,target]);
 const restore=()=>{setTarget(null);if(trigger.current?.isConnected)trigger.current.focus({preventScroll:true});};
 const actions=h('div',{className:'product-utility-actions',role:'group','aria-label':'页面工具'},entries.map(entry=>h(Button,{key:entry.kind,className:'product-utility-button',variant:'subtle',size:'xs','aria-label':entry.label,title:utilities?.[entry.kind]?.length ? entry.label : `本页暂无${entry.label}`,'aria-haspopup':'dialog',disabled:!utilities?.[entry.kind]?.length,onClick:()=>{trigger.current=shadow.activeElement;setTarget({kind:entry.kind,pageKey});setOpened(true);}},h('span',{'aria-hidden':true,dangerouslySetInnerHTML:{__html:icon(entry.icon)}}))));
 return h('div',{className:'product-utility-host'},children({utilityOpen:active,utilityActions:actions}),
  h(Modal,{opened:active,onClose:close,title:`${title} · ${label}`,size:'min(880px, calc(100vw - 24px))',centered:true,withinPortal:false,lockScroll:false,returnFocus:false,closeOnEscape:false,onExitTransitionEnd:restore,
   transitionProps:{transition:'pop',duration:reduced ? 0 : 180},classNames:{root:'product-inspection-dialog',content:'product-inspection-content',body:'product-inspection-body'},closeButtonProps:{'aria-label':`关闭${label}`},
   onKeyDown:event=>{if(event.key==='Escape' && !event.isComposing){event.preventDefault();event.stopPropagation();close();}}},
   h(InspectionContents,null,h('div',{className:'product-utility-view product-inspection-view product-page'},sections.map(section=>h('section',{key:section.id,className:'product-utility-section'},h('h3',null,section.title),render(section.children)))))));
}
