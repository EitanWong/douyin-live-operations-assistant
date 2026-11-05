import {createElement as h,Fragment,useEffect,useMemo,useRef,useState} from 'react';
import {Button} from './motion.js';
import {useDataBrowser,DataBrowserTools,DataBrowserFooter} from './data-browser.js';

// Navigation and filtering are display state. Records and actions still come
// from the live controller snapshot, including while a detail is open.
export function RecordBrowserContents({node,render}) {
 const [selected,setSelected]=useState(null),heading=useRef(null),list=useRef(null),returnKey=useRef(null);
 const records=node.children,rows=useMemo(()=>records.map(record=>[record.title]),[records]);
 const browser=useDataBrowser(rows),record=records.find(row=>row.recordKey===selected);
 const back=()=>{returnKey.current=selected;setSelected(null);};
 useEffect(()=>{
  if(selected && !record){setSelected(null);return;}
  if(record)heading.current?.focus({preventScroll:true});
  else if(returnKey.current!==null){[...list.current?.querySelectorAll('[data-record-open]') || []].find(button=>button.dataset.recordOpen===returnKey.current)?.focus({preventScroll:true});returnKey.current=null;}
 },[selected,Boolean(record)]);
 return h('section',{className:'product-record-browser','aria-label':node.label,onKeyDown:event=>{
  if(record && event.key==='Escape' && !event.isComposing){event.preventDefault();event.stopPropagation();back();}
 }},record ? h('div',{className:'product-record-detail'},
  h(Button,{variant:'subtle',size:'sm',onClick:back},`返回${node.label}`),
  h('h3',{ref:heading,tabIndex:-1,'data-record-detail-heading':''},record.title),
  record.children.map((child,index)=>h(Fragment,{key:child.id || index},render(child)))) : h('div',{ref:list,className:'product-record-list'},
  h(DataBrowserTools,{browser,label:node.label}),
  h('div',{className:'product-record-list-items',ref:browser.scroll,tabIndex:0,'aria-label':`${node.label}，可滚动`},browser.indices.length ? browser.indices.map(index=>{
   const record=records[index];return h(Button,{key:record.recordKey,'data-record-open':record.recordKey,variant:'light',fullWidth:true,onClick:()=>setSelected(record.recordKey)},record.title);
  }) : h('p',null,browser.active ? '没有匹配的记录' : '尚无记录，开始第一轮后可在这里查看。')),
  h(DataBrowserFooter,{browser,label:node.label})));
}
