import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {AdaptiveLayout} from '../../src/ui/adaptive-layout.js';

function fixture() {
  const dom=new JSDOM('<body><div id="host"></div>',{pretendToBeVisual:true});
  const root=dom.window.document.querySelector('#host').attachShadow({mode:'open'});
  root.innerHTML='<div class="floating-panel"><details data-adaptive-details><summary>分析</summary><input value="草稿"></details><button>完成</button></div>';
  const layout=new AdaptiveLayout(root),detail=root.querySelector('details');
  return {dom,root,layout,detail,close(){layout.destroy();dom.window.close();}};
}

test('宽窗口展开分析，紧凑窗口折叠；各尺寸记住手动选择且不重建表单',()=>{
  const f=fixture();
  try {
    const input=f.root.querySelector('input');
    f.layout.update(1100);assert.equal(f.detail.open,true);
    f.detail.querySelector('summary').click();assert.equal(f.detail.open,false);
    f.layout.update(1000);assert.equal(f.detail.open,false);
    f.layout.update(0);assert.equal(f.layout.mode,'wide');
    f.layout.update(360);assert.equal(f.detail.open,false);
    f.detail.querySelector('summary').click();assert.equal(f.detail.open,true);
    f.layout.update(1200);assert.equal(f.detail.open,false);
    f.layout.update(360);assert.equal(f.detail.open,true);
    assert.equal(f.root.querySelector('input'),input);assert.equal(input.value,'草稿');
  } finally {f.close();}
});

test('缩小窗口不隐藏正在操作的内容，离开内容后采用紧凑默认值',async()=>{
  const f=fixture();
  try {
    f.layout.update(1000);f.root.querySelector('input').focus();
    f.layout.update(400);assert.equal(f.detail.open,true);
    f.root.querySelector('button').focus();await Promise.resolve();
    assert.equal(f.detail.open,false);
    f.layout.destroy();f.root.querySelector('button').blur();
  } finally {f.close();}
});
