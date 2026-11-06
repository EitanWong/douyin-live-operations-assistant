import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
test('真实ECharts图谱隐藏挂载、展开、再收起和销毁不崩溃，节点及来源可交互',async()=>{
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
  const {createChartView}=await import('../../src/ui/product/chart.js');const {relationshipChartOption}=await import('../../src/ui/relationship-graph.js');
  view=createChartView(element);view.update(relationshipChartOption({entities:[{id:'a',name:'阿明'},{id:'b',name:'小雨'}],relations:[{id:'r',from:'a',to:'b',predicate:'朋友',status:'unverified'}]}));
  assert.doesNotThrow(()=>resize());width=600;height=220;assert.doesNotThrow(()=>resize());
  assert.equal(element.querySelector('svg').getAttribute('width'),'600');assert.match(element.querySelector('svg').textContent,/阿明/);assert.ok(element.querySelectorAll('path').length>=3);
  width=0;height=0;assert.doesNotThrow(()=>resize());view.destroy();view=null;assert.equal(disconnected,true);assert.equal(element.querySelector('svg'),null);
 }finally{view?.destroy();for(const [key,descriptor] of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}dom.window.close();}
});
