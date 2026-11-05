import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {FoundationSettings} from '../../src/ui/foundation-settings.js';
import {Engine,mergeConfig} from '../../src/core/engine.js';
import {AccountContext} from '../../src/ai/account-context.js';
import {recommendDevice} from '../../src/ai/device-policy.js';
const flush=()=>new Promise(setImmediate);

test('device recommendation, local controls, selected account refresh and source switches survive real settings readback',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123',pretendToBeVisual:true}),previous={document:globalThis.document,window:globalThis.window,location:globalThis.location};
 Object.assign(globalThis,{document:dom.window.document,window:dom.window,location:dom.window.location});
 let panel,settings;const errors=[],engine=new Engine({config:mergeConfig({anchorId:'123'})});
 const d={webgpu:true,memoryGB:8,cores:8,maxBufferMB:2048,maxStorageMB:1024,storageFreeMB:6000,shaderF16:true};
 try{
  panel=new Panel({config:engine.config,callbacks:{}});
  settings=new FoundationSettings(panel.root,{edge:{detect:async()=>({device:d,recommendation:recommendDevice(d,{available:true})})},accounts:new AccountContext(),anchor:()=> '123',changed:async()=>{},dirty:()=>panel.markDirty(),getContext:()=>engine.aiContext(),targets:()=>[{name:'已观测观众',url:'https://www.douyin.com/user/known'}],onError:e=>errors.push(e)});
  await flush();assert.match(panel.root.querySelector('[data-device-status]').textContent,/1.5B/);
  const model=panel.root.querySelector('[data-field="ai.edge.textModel"]');model.value='qwen-0.5b';panel.root.querySelector('[data-edge-auto]').click();await flush();
  assert.equal(model.value,'qwen-0.5b','未连接一键准备控制器时保留草稿');
  assert.match(panel.root.querySelector('[data-edge-status]').textContent,/未启用/);model.value='auto';
  panel.root.querySelector('[data-account-targets]').click();await flush();const selected=panel.root.querySelector('[data-account-target]');selected.value='https://www.douyin.com/user/known';selected.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  panel.root.querySelector('[data-account-watch]').click();await flush();
  panel.root.querySelector('[data-field="ai.accountCollection.autoResearch"]').checked=true;
  panel.root.querySelector('[data-field="ai.accountCollection.researchLimit"]').value='5';
  panel.root.querySelector('[data-field="ai.accountCollection.minDiamonds"]').value='200';
  panel.root.querySelector('[data-field="ai.accountCollection.minChats"]').value='4';
  panel.root.querySelector('[data-field="ai.contextSources.income"]').checked=false;
  panel.root.querySelector('[data-field="ai.edge.localOnly"]').checked=true;
  const c=panel.read();assert.equal(c.ai.edge.textModel,'auto');assert.equal(c.ai.edge.autoTune,true);assert.equal(c.ai.edge.enabled,true);assert.equal(c.ai.edge.localOnly,true);assert.deepEqual(c.ai.accountCollection.urls,['https://www.douyin.com/user/known']);
  engine.update(c);panel.populate(c);assert.equal(panel.read().ai.edge.localOnly,true);assert.equal(engine.aiContext().liveContext.income,null);
  assert.equal(engine.config.ai.accountCollection.autoResearch,true);assert.equal(panel.read().ai.accountCollection.researchLimit,5);assert.equal(engine.config.ai.accountCollection.minDiamonds,200);assert.equal(engine.config.ai.accountCollection.minChats,4);
  panel.root.querySelector('[data-context-refresh]').click();await flush();assert.match(panel.root.querySelector('[data-context-overview]').textContent,/本场收入与历史账本/);assert.equal(errors.length,1);assert.match(errors[0].message,/一键启用/);assert.equal(panel.dirty,false);
 }finally{settings?.close();panel?.destroy();clearTimeout(panel?.toastTimer);dom.window.close();Object.assign(globalThis,previous);}
});
