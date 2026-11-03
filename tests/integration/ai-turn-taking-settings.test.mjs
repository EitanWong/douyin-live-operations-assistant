import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {mergeConfig,validateConfig} from '../../src/core/engine.js';
import {aiDiagnostics} from '../../src/ai/diagnostics.js';

test('文字模式也能选择接话频率，默认克制；草稿可读回且感知配置不受影响',()=>{
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890',pretendToBeVisual:true});
 for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
 globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
 const config=mergeConfig({ai:{pipeline:{mode:'text'}}}),panel=new Panel({room:'1',config,callbacks:{}});
 try{
  panel.tab('ai');const picker=panel.node('[data-field="ai.replyFrequency"]');assert.ok(picker);
  assert.equal(picker.value,'quiet');assert.equal(picker.closest('[data-ai-section]').dataset.aiSection,'models');
  const slider=panel.node('[data-reply-slider]');assert.equal(slider.type,'range');assert.equal(slider.value,'2');
  slider.value='1';slider.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  const saved=panel.read();assert.equal(saved.ai.replyFrequency,'mentions');assert.equal(saved.ai.media.autoStart,config.ai.media.autoStart);
  assert.equal(config.ai.replyFrequency,'quiet','草稿不会提前改变运行策略');
  assert.throws(()=>validateConfig(mergeConfig({ai:{replyFrequency:'fast'}})),/接话频率/);
 }finally{panel.destroy();dom.window.close();}
});

test('诊断显示实际频率和主动互动最小值，不把持续感知当成定时发言',()=>{
 const config=mergeConfig({ai:{proactiveEnabled:true,proactiveIntervalSec:30}});
 const rows=aiDiagnostics({config,context:{context:[],mediaContext:null},mediaState:'idle',memoryCount:0,knownGaps:0}).join('\n');
 assert.match(rows,/克制陪伴/);assert.match(rows,/300 秒/);assert.match(rows,/持续感知.*持续发言/);
});
