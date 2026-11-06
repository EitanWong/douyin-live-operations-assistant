import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
test('真实ECharts图谱隐藏挂载、展开、再收起和销毁不崩溃，节点及来源可交互',async()=>{
 const dom=new JSDOM('<div id="chart"></div>',{pretendToBeVisual:true});
 const previous={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document});
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
 }finally{view?.destroy();Object.assign(globalThis,previous);dom.window.close();}
});
