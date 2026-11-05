import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {CardFlow,layoutCardFlows} from '../../src/ui/product/card-flow.js';

test('展开、收起与密度测量更新占用高度，原字段与焦点不移动，销毁取消重排',()=>{
 const dom=new JSDOM('<div class="product-card-run" data-card-run="cards"><div class="product-card-slot" style="padding-bottom:16px"><section><input value="草稿"></section></div><div class="product-card-slot" style="padding-bottom:16px"><section>相邻卡片</section></div></div>',{pretendToBeVisual:true});
 const view=dom.window,run=view.document.querySelector('.product-card-run'),slots=[...run.children];
 let heights=[100,80],notify,frame,disconnected=false,cancelled=false;
 Object.defineProperty(run,'clientWidth',{value:600});
 slots.forEach((slot,i)=>slot.firstElementChild.getBoundingClientRect=()=>({height:heights[i]}));
 view.ResizeObserver=class{constructor(callback){notify=callback;}observe(){}disconnect(){disconnected=true;}};
 view.requestAnimationFrame=callback=>{frame=callback;return 1;};view.cancelAnimationFrame=()=>{frame=null;cancelled=true;};
 const input=run.querySelector('input');input.focus();
 const flow=new CardFlow(run);
 try{
  assert.equal(slots[0].style.gridRowEnd,'span 116');assert.equal(slots[1].style.gridRowEnd,'span 96');
  heights[0]=300;notify();frame();assert.equal(slots[0].style.gridRowEnd,'span 316');assert.equal(slots[1].style.gridRowEnd,'span 96');
  heights[0]=100;slots[0].style.paddingBottom='8px';layoutCardFlows(view.document);
  assert.equal(slots[0].style.gridRowEnd,'span 108','密度探测同步重排，不读取上一尺寸的网格高度');
  assert.equal(run.querySelector('input'),input);assert.equal(view.document.activeElement,input);assert.equal(input.value,'草稿');
  notify();flow.destroy();assert.equal(disconnected,true);assert.equal(cancelled,true);assert.equal(frame,null);
 }finally{flow.destroy();dom.window.close();}
});
