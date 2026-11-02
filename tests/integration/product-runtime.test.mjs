import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {JSDOM} from 'jsdom';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createWorkspaceBridge} from '../../src/ui/product/bridge.js';

test('实际 React / Mantine 界面编辑原草稿、执行一次操作、呈现 TanStack 表格，销毁后清理',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'product-ui-')), dom=new JSDOM('<div id="host"></div>',{url:'https://live.douyin.com/123',pretendToBeVisual:true});
 const previous=Object.fromEntries(['window','document','HTMLElement','Element','getComputedStyle','MutationObserver','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,globalThis[key]]));
 let runtime,bridge;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,getComputedStyle:dom.window.getComputedStyle,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)});
  dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  dom.window.ResizeObserver=class{observe(){}disconnect(){}unobserve(){}};
  const root=document.querySelector('#host').attachShadow({mode:'open'});root.innerHTML='<div class="workspace"><button data-tab="ai" aria-label="AI 设置">AI</button><header data-workspace-toolbar><div class="foot"><button data-action="save">保存设置</button></div></header><section data-page="ai"><div class="workspace-grid"><section class="ai-card"><h3>回复模型</h3><div class="grid"><label class="field"><span>模型名</span><input value="qwen-plus"></label></div><label class="toggle"><input type="checkbox">启用 AI</label><table><thead><tr><th>观众</th><th>钻石</th></tr></thead><tbody><tr><td>甲</td><td>9</td></tr></tbody></table><details><summary>高级参数</summary><label class="field"><span>测试高级字段</span><input value="draft"></label></details></section></div></section></div>';
  let saves=0,changes=0;root.querySelector('button[data-action]').onclick=()=>saves++;root.querySelector('input').addEventListener('input',()=>changes++);
  const panel={root,host:root.host,activeTab:'ai',tab(){}};bridge=createWorkspaceBridge(panel);
  await build({entryPoints:['src/ui/product/runtime.js'],bundle:true,format:'esm',platform:'browser',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'},outfile:join(dir,'runtime.mjs')});
  const {mountProductWorkspace}=await import(pathToFileURL(join(dir,'runtime.mjs')).href);
  const container=document.createElement('div');root.append(container);runtime=mountProductWorkspace({container,bridge});
  await new Promise(resolve=>setTimeout(resolve,70));const ui=container.shadowRoot;
  assert.ok(ui.querySelector('.mantine-Stack-root > .mantine-Paper-root'));assert.ok(ui.querySelector('.mantine-SimpleGrid-root input[aria-label="模型名"]'));assert.equal(ui.querySelector('h3').textContent,'回复模型');assert.match(ui.querySelector('table').textContent,/甲9/);
  const input=ui.querySelector('input[aria-label="模型名"]');assert.ok(input);const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set;setter.call(input,'new-model');input.dispatchEvent(new dom.window.Event('input',{bubbles:true,composed:true}));
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(root.querySelector('input').value,'new-model');assert.equal(changes,1);
  [...ui.querySelectorAll('button')].find(b=>b.textContent==='保存设置').click();assert.equal(saves,1);
  ui.querySelector('input[type=checkbox]').click();assert.equal(root.querySelector('input[type=checkbox]').checked,true);
  [...ui.querySelectorAll('button')].find(b=>b.textContent.includes('高级参数')).click();await new Promise(resolve=>setTimeout(resolve,240));assert.notEqual(ui.querySelector('.product-disclosure-body').style.display,'none');
  assert.equal(document.documentElement.getAttribute('data-mantine-color-scheme'),null);assert.equal(document.body.querySelector('[data-portal]'),null);
  runtime.destroy();runtime=null;assert.equal(container.shadowRoot.childNodes.length,0);
 }finally{runtime?.destroy();bridge?.destroy();Object.assign(globalThis,previous);dom.window.close();await rm(dir,{recursive:true,force:true});}
});
