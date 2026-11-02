import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {AdaptiveLayout} from '../../src/ui/adaptive-layout.js';

test('可见组件接管后旧宽度观察器不再改折叠状态，回退时恢复默认行为',()=>{
 const dom=new JSDOM('<div id="host"></div>'),root=dom.window.document.querySelector('div').attachShadow({mode:'open'});
 root.innerHTML='<div class="floating-panel"><details data-adaptive-details><summary>分析</summary><input value="草稿"></details></div>';
 const layout=new AdaptiveLayout(root),detail=root.querySelector('details');
 try{
  layout.update(1000);assert.equal(detail.open,true);
  layout.setSuspended(true);layout.update(400);assert.equal(detail.open,true);
  layout.apply();assert.equal(detail.open,true);
  layout.setSuspended(false);assert.equal(detail.open,false);assert.equal(detail.querySelector('input').value,'草稿');
 }finally{layout.destroy();dom.window.close();}
});
