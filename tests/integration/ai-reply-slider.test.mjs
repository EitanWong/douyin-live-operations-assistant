import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createWorkspaceBridge} from '../../src/ui/product/bridge.js';
import {Panel} from '../../src/ui/panel.js';
import {mergeConfig} from '../../src/core/engine.js';
test('接话滑块显示当前档位、实时反馈、保存刷新与导入保持一致',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890',pretendToBeVisual:true});
 for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
 globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
 let saved,panel=new Panel({room:'1',config:mergeConfig(),callbacks:{save:async c=>saved=c}});
 try{
  const slider=()=>panel.node('[data-reply-slider]'),status=()=>panel.node('[data-reply-frequency-status]');
  assert.equal(slider().type,'range');assert.equal(slider().min,'0');assert.equal(slider().max,'4');assert.equal(slider().value,'2');assert.match(status().textContent,/克制/);
  const bridge=createWorkspaceBridge(panel);panel.tab('ai');bridge.refresh();
  const projected=JSON.stringify(bridge.getSnapshot().content);assert.doesNotMatch(projected,/\"type\":\"hidden\"/);bridge.destroy();
  assert.ok(slider().getAttribute('aria-describedby'));assert.match(slider().getAttribute('aria-valuetext'),/克制/);
  slider().value='4';slider().dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.equal(panel.dirty,true);assert.match(status().textContent,/每句都接/);assert.equal(panel.read().ai.replyFrequency,'every');assert.equal(panel.config.ai.replyFrequency,'quiet','编辑后等待保存');
  panel.node('[data-action=save]').click();await new Promise(setImmediate);assert.equal(saved.ai.replyFrequency,'every');panel.destroy();panel=new Panel({room:'1',config:saved,callbacks:{}});assert.equal(slider().value,'4');
  for(const [replyFrequency,value] of [['mentions','1'],['quiet','2'],['natural','3'],['off','0']]){panel.populate(mergeConfig({ai:{replyFrequency}}));assert.equal(slider().value,value);assert.equal(panel.read().ai.replyFrequency,replyFrequency);}
  slider().value='4';slider().dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(panel.read().ai.replyFrequency,'every');
 }finally{panel.destroy();dom.window.close();}
});
