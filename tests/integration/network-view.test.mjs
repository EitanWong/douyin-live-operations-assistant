import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createNetworkView} from '../../src/ui/product/network-view.js';
import {WORKBENCH_CSS} from '../../src/ui/product/workbench-styles.js';

test('关系画布初始化沿用 Cytoscape 默认滚轮缩放，不产生硬件敏感度警告',()=>{
 const dom=new JSDOM('<div class="network-canvas"></div>',{pretendToBeVisual:true});
 dom.window.ResizeObserver=class{observe(){}disconnect(){}};
 const warnings=[],warn=console.warn;let view;
 try{
  console.warn=(...args)=>warnings.push(args.join(' '));
  view=createNetworkView(dom.window.document.querySelector('div'),{headless:true});
  view.update({entities:[{id:'a',name:'阿明'},{id:'b',name:'小雨'}],relations:[{id:'r',from:'a',to:'b',predicate:'朋友',status:'unverified'}]});
  const zoom=view.core.zoom();view.command('in');assert.ok(view.core.zoom()>zoom);
  view.command('out');assert.ok(Math.abs(view.core.zoom()-zoom)<1e-6);
  assert.equal(view.core.nodes().length,2);assert.equal(view.core.edges().length,1);
  assert.deepEqual(warnings,[]);
 }finally{view?.destroy();console.warn=warn;dom.window.close();}
});

test('关系画布自身建立定位上下文，Cytoscape UI 附件留在画布边界内',()=>{
 const dom=new JSDOM(`<style>${WORKBENCH_CSS}</style><section class="product-workbench-stage"><div class="network-canvas"></div></section>`);
 try{assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector('.network-canvas')).position,'relative');}
 finally{dom.window.close();}
});
