import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {mergeConfig} from '../../src/core/engine.js';

test('设置页在本机预览待保存知识的相关片段和来源，停用后无命中，文本不执行HTML',()=>{
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890',pretendToBeVisual:true});
  for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  const panel=new Panel({room:'1',config:mergeConfig(),callbacks:{}});
  try{
    panel.tab('ai');panel.node('[data-memory-add]').click();
    panel.node('[data-memory-field="title"]').value='茶具保养';
    panel.node('[data-memory-field="content"]').value='陶瓷茶具使用温水清洗。<img src=x onerror=alert(1)>';
    panel.node('[data-memory-field="source"]').value='主播确认';
    panel.node('[data-memory-query]').value='茶具怎么清洗';
    panel.node('[data-memory-search]').click();
    const matches=panel.node('[data-memory-matches]');
    assert.match(matches.textContent,/命中 1 个片段/);assert.match(matches.textContent,/温水清洗/);
    assert.match(matches.textContent,/主播确认/);assert.match(matches.textContent,/核对时间/);
    assert.equal(matches.querySelector('img'),null);
    assert.deepEqual(panel.config.ai.memory.entries,[],'预览不保存待编辑的资料');
    panel.node('[data-memory-field="enabled"]').checked=false;
    panel.node('[data-memory-search]').click();assert.match(matches.textContent,/命中 0 个片段/);
  }finally{panel.destroy();dom.window.close();}
});
