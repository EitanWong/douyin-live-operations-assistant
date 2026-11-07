import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {mergeConfig} from '../../src/core/engine.js';
import {aiDiagnostics} from '../../src/ai/diagnostics.js';

test('设置页在本机预览待保存知识的相关片段和来源，停用后无命中，文本不执行HTML',()=>{
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890',pretendToBeVisual:true});
  for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  const panel=new Panel({room:'1',config:mergeConfig(),callbacks:{}});
  try{
    panel.tab('knowledge');panel.node('[data-memory-add]').click();
    panel.node('[data-memory-field="title"]').value='茶具保养';
    panel.node('[data-memory-field="content"]').value='陶瓷茶具使用温水清洗。<img src=x onerror=alert(1)>';
    panel.node('[data-memory-field="source"]').value='主播确认';
    panel.node('[data-memory-confirm]').click();
    panel.node('[data-memory-query]').value='茶具怎么清洗';
    panel.node('[data-memory-search]').click();
    const matches=panel.node('[data-memory-matches]');
    assert.match(matches.textContent,/命中 1 个片段/);assert.match(matches.textContent,/温水清洗/);
    assert.match(matches.textContent,/主播确认/);assert.match(matches.textContent,/核对时间/);
    assert.equal(matches.querySelector('img'),null);
    assert.deepEqual(panel.config.ai.memory.entries,[],'预览不保存待编辑的资料');
    panel.root.querySelector('[data-memory-edit]').click();panel.node('[data-memory-field="enabled"]').checked=false;panel.node('[data-memory-confirm]').click();
    panel.node('[data-memory-search]').click();assert.match(matches.textContent,/命中 0 个片段/);
  }finally{panel.destroy();dom.window.close();}
});

test('上下文诊断使用运行配置，未保存的开关和不完整草稿不妨碍检查，也不触发模型或保存',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890',pretendToBeVisual:true});
 for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
 globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
 const config=mergeConfig({ai:{enabled:true,assistant:{memoryEnabled:false}}});let calls=0,unexpected=0;
 const panel=new Panel({room:'1',config,callbacks:{diagnoseAI:async()=>{calls++;return aiDiagnostics({config,context:{context:[],mediaContext:null},mediaState:'idle',memoryCount:2,knownGaps:3});},save:()=>unexpected++,testAI:()=>unexpected++}});
 try{
  panel.node('[data-field="ai.assistant.memoryEnabled"]').checked=true;
  panel.node('[data-memory-add]').click(); // An unfinished draft cannot be validated or saved.
  const dirty=panel.dirty;panel.node('[data-ai-diagnose]').click();assert.equal(panel.node('[data-ai-diagnose]').disabled,true);
  await new Promise(setImmediate);
  assert.equal(calls,1);assert.equal(unexpected,0);assert.equal(panel.dirty,dirty);
  assert.match(panel.node('[data-ai-context-status]').textContent,/观众记忆：开启.*2/);
  assert.ok(panel.node('[data-ai-context-status]').querySelectorAll('p').length>=5,'各项诊断单独成行，不依赖产品界面会丢弃的内联样式');
  assert.match(panel.node('[data-ai-context-status]').textContent,/缺口 3/);assert.equal(panel.node('[data-ai-diagnose]').disabled,false);
 }finally{panel.destroy();dom.window.close();}
});

test('知识到期与停用原因在原资料位置提示，弹窗确认更新后检索结果一致',()=>{
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890',pretendToBeVisual:true});
 for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
 globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
 const panel=new Panel({room:'1',config:mergeConfig(),callbacks:{}});
 try{
  panel.tab('knowledge');panel.node('[data-memory-add]').click();const field=name=>panel.node(`[data-memory-field="${name}"]`);
  field('title').value='陶瓷保养';field('content').value='陶瓷茶具使用温水清洗';field('expiresOn').value='2000-01-01';
  field('expiresOn').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  panel.node('[data-memory-confirm]').click();
  assert.match(panel.root.querySelector('[data-memory-validity]').textContent,/已过期.*不参与/);
  panel.node('[data-memory-query]').value='陶瓷清洗';panel.node('[data-memory-search]').click();assert.match(panel.node('[data-memory-matches]').textContent,/命中 0/);
  panel.root.querySelector('[data-memory-edit]').click();field('expiresOn').value='';field('expiresOn').dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  panel.node('[data-memory-confirm]').click();
  assert.match(panel.root.querySelector('[data-memory-validity]').textContent,/可参与/);panel.node('[data-memory-search]').click();assert.match(panel.node('[data-memory-matches]').textContent,/命中 1/);
  panel.root.querySelector('[data-memory-edit]').click();field('enabled').checked=false;panel.node('[data-memory-confirm]').click();assert.match(panel.root.querySelector('[data-memory-validity]').textContent,/已停用/);
 }finally{panel.destroy();dom.window.close();}
});
