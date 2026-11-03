import {createElement as h,useEffect,useMemo,useRef,useState} from 'react';
import {TextInput,NativeSelect} from '@mantine/core';
import {Button} from './motion.js';
import {DATA_PAGE_SIZE,matchingRows,categoryFilters} from './collection.js';

export function useDataBrowser(rows,headers=[],scope='loaded') {
  const [query,setQuery]=useState(''),[filters,setFilters]=useState({}),[page,setPage]=useState(0),scroll=useRef(null);
  const matches=useMemo(()=>matchingRows(rows,query,filters),[rows,query,filters]);
  const facets=useMemo(()=>categoryFilters(headers,rows,filters),[headers,rows,filters]);
  const pages=scope==='page' ? 1 : Math.max(1,Math.ceil(matches.length/DATA_PAGE_SIZE));
  const current=Math.min(page,pages-1),indices=scope==='page' ? matches : matches.slice(current*DATA_PAGE_SIZE,(current+1)*DATA_PAGE_SIZE);
  const filterKey=JSON.stringify(filters);
  useEffect(()=>setPage(value=>Math.min(value,pages-1)),[pages]);
  useEffect(()=>{scroll.current?.scrollTo?.({top:0});},[current,query,filterKey]);
  const active=Boolean(query || Object.values(filters).some(Boolean));
  return {query,filters,facets,scroll,current,pages,indices,total:rows.length,count:matches.length,active,
    searchable:rows.length>8 || active,
    search:value=>{setQuery(value);setPage(0);},
    filter:(column,value)=>{setFilters(previous=>({...previous,[column]:value}));setPage(0);},
    reset:()=>{setQuery('');setFilters({});setPage(0);},
    go:page=>setPage(Math.max(0,Math.min(page,pages-1)))};
}
export function DataBrowserTools({browser,label,scope}) {
  if(!browser.searchable && !browser.facets.length)return null;
  const searchLabel=`搜索${label}${scope==='page' ? '（当前页）' : ''}`;
  return h('div',{className:'product-data-tools'},
    browser.searchable ? h(TextInput,{type:'search','aria-label':searchLabel,placeholder:searchLabel,value:browser.query,onChange:e=>browser.search(e.currentTarget.value),className:'product-data-search'}) : null,
    browser.facets.map(facet=>h(NativeSelect,{key:facet.column,'aria-label':`筛选${facet.label}`,value:browser.filters[facet.column] || '',data:[{value:'',label:`全部${facet.label}`},...facet.values.map(value=>({value,label:value}))],onChange:e=>browser.filter(facet.column,e.currentTarget.value)})),
    browser.active ? h(Button,{variant:'subtle',size:'xs',onClick:browser.reset},'重置筛选') : null);
}
export function DataBrowserFooter({browser,label,scope}) {
  if(browser.total<=8 && !browser.active)return null;
  return h('div',{className:'product-data-footer'},
    h('span',{'aria-live':'polite'},`${scope==='page' ? '当前页' : '已加载'} ${browser.total} 条${browser.active ? ` · 匹配 ${browser.count} 条` : ''}${browser.pages>1 ? ` · ${browser.current+1} / ${browser.pages} 页` : ''}`),
    browser.pages>1 ? h('nav',{'aria-label':`${label}翻页`},
      h(Button,{variant:'subtle',size:'xs',disabled:browser.current===0,onClick:()=>browser.go(browser.current-1)},'上一页'),
      h(Button,{variant:'subtle',size:'xs',disabled:browser.current>=browser.pages-1,onClick:()=>browser.go(browser.current+1)},'下一页')) : null);
}
