import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
test('关系图移出后真实ECharts统计图仍支持隐藏挂载、展开、再收起和销毁',async()=>{
 const dom=new JSDOM('<div id="chart"></div>',{pretendToBeVisual:true});
 const browserGlobals={window:dom.window,document:dom.window.document,navigator:dom.window.navigator};
 const previous=Object.fromEntries(Object.keys(browserGlobals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const [key,value] of Object.entries(browserGlobals))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 dom.window.HTMLCanvasElement.prototype.getContext=()=>({measureText:text=>({width:text.length*12})});
 let resize,disconnected=false,width=0,height=0;
 dom.window.ResizeObserver=class{constructor(cb){resize=cb;}observe(){}disconnect(){disconnected=true;}};
 const element=dom.window.document.querySelector('#chart');Object.defineProperties(element,{clientWidth:{get:()=>width},clientHeight:{get:()=>height}});
 let view;
 try{
  const {createChartView}=await import('../../src/ui/product/chart.js');
  view=createChartView(element);view.update({xAxis:{type:'category',data:['阿明','小雨']},yAxis:{type:'value'},series:[{type:'bar',data:[5,8]}]});
  assert.doesNotThrow(()=>resize());width=600;height=220;assert.doesNotThrow(()=>resize());
  assert.equal(element.querySelector('svg').getAttribute('width'),'600');assert.match(element.querySelector('svg').textContent,/2.*4.*6/);assert.ok(element.querySelectorAll('path').length>=3);
  width=0;height=0;assert.doesNotThrow(()=>resize());view.destroy();view=null;assert.equal(disconnected,true);assert.equal(element.querySelector('svg'),null);
 }finally{view?.destroy();for(const [key,descriptor] of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}dom.window.close();}
});
