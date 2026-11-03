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
 const navigatorDescriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 let runtime,bridge;
 try{
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,getComputedStyle:dom.window.getComputedStyle,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
  dom.window.HTMLElement.prototype.scrollTo=()=>Promise.resolve(); // Modern CSSOM scrolling can return a completion promise; effects must not return it.
  dom.window.scrollTo=()=>{}; // jsdom has no scrolling layout; Motion measures auto heights in the real browser.
  const reducedQuery=new dom.window.EventTarget();reducedQuery.matches=false;
  dom.window.matchMedia=query=>query.includes('prefers-reduced-motion') ? reducedQuery : {matches:false,addEventListener(){},removeEventListener(){}};
  dom.window.document.fonts=new dom.window.EventTarget(); // jsdom does not implement FontFaceSet.
  dom.window.ResizeObserver=class{observe(){}disconnect(){}unobserve(){}};
  const root=document.querySelector('#host').attachShadow({mode:'open'});root.innerHTML='<div class="workspace"><button data-tab="ai" aria-label="AI 设置">AI</button><header data-workspace-toolbar><div class="foot"><small>未保存草稿</small><button data-action="save">保存设置</button></div></header><div data-workspace-views><button role="tab" aria-selected="true">模型设置</button><button role="tab" aria-selected="false">额度设置</button></div><section data-page="ai"><div class="workspace-grid"><div class="ai-service-grid" data-workspace-contents><section class="ai-card"><h3>回复模型</h3><div class="grid"><label class="field"><span>模型名</span><input value="qwen-plus"><small>模型名称按服务商提供的完整 ID 填写。</small></label></div><label class="toggle"><input type="checkbox">启用 AI</label><label class="field"><span>接话频率</span><input type="range" min="0" max="4" step="1" value="2" aria-valuetext="克制陪伴"></label><table><thead><tr><th>观众</th><th>钻石</th></tr></thead><tbody><tr><td>甲</td><td>9</td></tr></tbody></table><details><summary>高级参数</summary><label class="field"><span>测试高级字段</span><input value="draft"></label></details></section></div></div></section></div>';
  let saves=0,changes=0;root.querySelector('button[data-action]').onclick=()=>saves++;root.querySelector('input').addEventListener('input',()=>changes++);
  let sections=0;for(const button of root.querySelectorAll('[data-workspace-views] button'))button.onclick=()=>{sections++;for(const sibling of button.parentElement.children)sibling.setAttribute('aria-selected',String(sibling===button));};
  const toggle=document.createElement('button');toggle.dataset.sidebarToggle='';toggle.setAttribute('aria-label','折叠侧边栏');toggle.innerHTML='<svg viewBox="0 0 24 24"><path d="M9 3v18"/></svg>';root.querySelector('.workspace').prepend(toggle);
  const panel={root,host:root.host,activeTab:'ai',navigation:{side:'left',collapsed:false},tab(){}};
  toggle.onclick=()=>{panel.navigation.collapsed=!panel.navigation.collapsed;root.querySelector('.workspace').dataset.navCollapsed=String(panel.navigation.collapsed);toggle.setAttribute('aria-label',panel.navigation.collapsed ? '展开侧边栏' : '折叠侧边栏');};bridge=createWorkspaceBridge(panel);
  await build({entryPoints:['src/ui/product/runtime.js'],bundle:true,format:'esm',platform:'browser',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'},outfile:join(dir,'runtime.mjs')});
  const {mountProductWorkspace}=await import(pathToFileURL(join(dir,'runtime.mjs')).href);
  const container=document.createElement('div');root.append(container);runtime=mountProductWorkspace({container,bridge});
  await new Promise(resolve=>setTimeout(resolve,70));const ui=container.shadowRoot;
  const sidebarToggle=ui.querySelector('.product-nav-toggle button');assert.equal(sidebarToggle.getAttribute('aria-expanded'),'true');assert.equal(ui.getElementById(sidebarToggle.getAttribute('aria-controls'))?.getAttribute('aria-label'),'功能导航');
  sidebarToggle.click();await new Promise(resolve=>setTimeout(resolve,25));assert.equal(ui.querySelector('.product-shell').dataset.sidebarCollapsed,'true');assert.equal(sidebarToggle.getAttribute('aria-expanded'),'false');assert.equal(sidebarToggle.getAttribute('title'),'展开侧边栏');assert.ok(sidebarToggle.querySelector('svg'));sidebarToggle.click();await new Promise(resolve=>setTimeout(resolve,25));assert.equal(panel.navigation.collapsed,false);
  assert.ok(ui.querySelector('.mantine-SimpleGrid-root[data-layout=cards] [data-surface=card]'));assert.equal(ui.querySelectorAll('[data-layout=fields] input[aria-label="模型名"]').length,1);assert.ok(ui.querySelector('.mantine-SimpleGrid-root input[aria-label="模型名"]'));assert.equal(ui.querySelector('h3').textContent,'回复模型');assert.match(ui.querySelector('table').textContent,/甲9/);assert.match(ui.querySelector('.product-status').textContent,/未保存草稿/);assert.doesNotMatch(ui.querySelector('.product-toolbar').textContent,/未保存草稿/);
  const slider=ui.querySelector('.mantine-Slider-root [role=slider]');assert.ok(slider,'组件界面使用真正的Mantine滑块，不将range包成文本框');assert.equal(slider.getAttribute('aria-valuetext'),'克制陪伴');slider.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'End',bubbles:true}));await new Promise(resolve=>setTimeout(resolve,25));assert.equal(root.querySelector('input[type=range]').value,'4');
  const tabs=[...ui.querySelectorAll('[role=tab]')];assert.deepEqual(tabs.map(n=>n.textContent),['模型设置','额度设置']);tabs[0].dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await new Promise(resolve=>setTimeout(resolve,25));assert.equal(sections,1);assert.equal(ui.querySelector('[role=tab][aria-selected=true]').textContent,'额度设置');
  const input=ui.querySelector('input[aria-label="模型名"]');assert.ok(input);const description=input.closest('.mantine-InputWrapper-root').querySelector('.mantine-InputWrapper-description');assert.ok(input.compareDocumentPosition(description) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING,'说明位于输入框之后，不使同排输入框错位');const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set;setter.call(input,'new-model');input.dispatchEvent(new dom.window.Event('input',{bubbles:true,composed:true}));
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(root.querySelector('input').value,'new-model');assert.equal(changes,1);
  [...ui.querySelectorAll('button')].find(b=>b.textContent==='保存设置').click();assert.equal(saves,1);
  ui.querySelector('input[type=checkbox]').click();assert.equal(root.querySelector('input[type=checkbox]').checked,true);
  const disclosure=[...ui.querySelectorAll('button')].find(b=>b.textContent.includes('高级参数'));
  const reveal=ui.getElementById(disclosure.getAttribute('aria-controls'));
  assert.equal(reveal.getAttribute('aria-hidden'),'true');assert.ok(reveal.hasAttribute('inert'));
  disclosure.click();await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(disclosure.getAttribute('aria-expanded'),'true');assert.equal(reveal.hasAttribute('inert'),false);
  reducedQuery.matches=true;reducedQuery.dispatchEvent(new dom.window.Event('change'));
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(Number(reveal.style.opacity),1,'运行中开启减少动态效果应立即结束内容淡入');
  reducedQuery.matches=false;reducedQuery.dispatchEvent(new dom.window.Event('change'));
  const draft=reveal.querySelector('input');setter.call(draft,'retained-draft');draft.dispatchEvent(new dom.window.Event('input',{bubbles:true,composed:true}));
  await new Promise(resolve=>setTimeout(resolve,25));
  // Reverse before the spring settles: keep the same editable node and draft.
  disclosure.click();await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(reveal.getAttribute('aria-hidden'),'true');assert.ok(reveal.hasAttribute('inert'));
  disclosure.click();await new Promise(resolve=>setTimeout(resolve,20));
  disclosure.click();await new Promise(resolve=>setTimeout(resolve,20));
  disclosure.click();await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(disclosure.getAttribute('aria-expanded'),'true');assert.equal(reveal.hasAttribute('inert'),false);
  assert.equal(reveal.querySelector('input'),draft);assert.equal(draft.value,'retained-draft');
  assert.equal(root.querySelector('details input').value,'retained-draft');
  // Large projected datasets must stay bounded and keep original action ownership.
  const dataset=document.createElement('section');dataset.innerHTML='<h3>互动记录</h3><table aria-label="互动记录"><thead><tr><th>观众</th><th>状态</th><th>钻石</th><th>操作</th></tr></thead><tbody></tbody></table>';
  const rows=dataset.querySelector('tbody');let acted=-1;
  for(let i=0;i<63;i++){const row=rows.insertRow();row.innerHTML=`<td>${i===61?'青山 ＡＢＣ':'观众'+i}</td><td>${i%2?'已确认':'待确认'}</td><td>${i*10}</td><td><button>查看 ${i}</button></td>`;row.querySelector('button').onclick=()=>{acted=i;};}
  root.querySelector('[data-page=ai]').append(dataset);bridge.refresh();await new Promise(resolve=>setTimeout(resolve,30));
  const collection=[...ui.querySelectorAll('.product-data-set')].find(n=>n.querySelector('table')?.textContent.includes('观众0'));
  assert.ok(collection,'表格使用统一的数据浏览区');
  assert.equal(collection.querySelectorAll('tbody tr').length,20);
  const next=()=>[...collection.querySelectorAll('button')].find(b=>b.textContent==='下一页');
  next().click();await new Promise(resolve=>setTimeout(resolve,25));
  assert.match(collection.querySelector('tbody').textContent,/观众20/);
  [...collection.querySelectorAll('tbody button')].find(b=>b.textContent==='查看 20').click();assert.equal(acted,20,'分页操作必须映射回原始行');
  const search=collection.querySelector('input[type=search]');assert.ok(search);
  setter.call(search,'青山 abc');search.dispatchEvent(new dom.window.Event('input',{bubbles:true,composed:true}));await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(collection.querySelectorAll('tbody tr').length,1);assert.match(collection.querySelector('tbody').textContent,/青山 ＡＢＣ/);
  collection.querySelector('tbody button').click();assert.equal(acted,61,'搜索后的操作不能错用结果索引');
  setter.call(search,'');search.dispatchEvent(new dom.window.Event('input',{bubbles:true,composed:true}));await new Promise(resolve=>setTimeout(resolve,25));
  const category=collection.querySelector('select[aria-label="筛选状态"]');assert.ok(category);assert.equal(collection.querySelector('select[aria-label="筛选钻石"]'),null);
  category.value='已确认';category.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,25));
  assert.ok([...collection.querySelectorAll('tbody tr')].every(row=>row.cells[1].textContent==='已确认'));
  next().click();await new Promise(resolve=>setTimeout(resolve,25));
  rows.replaceChildren(rows.firstElementChild);bridge.refresh();await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(collection.querySelector('input[type=search]'),search,'实时刷新不能重建搜索输入或丢失焦点');
  assert.equal(collection.querySelector('select[aria-label="筛选状态"]')?.value,'已确认','刷新后仍应如实展示已生效的筛选条件');
  assert.match(collection.textContent,/没有匹配/);
  [...collection.querySelectorAll('button')].find(b=>b.textContent==='重置筛选').click();await new Promise(resolve=>setTimeout(resolve,25));
  assert.match(collection.querySelector('tbody').textContent,/观众0/);assert.equal(root.querySelector('details input').value,'retained-draft');
  // Record lists share paging/search, while editable rule drafts remain mounted.
  const records=document.createElement('div');records.dataset.profiles='';let profileAction=-1;
  for(let i=0;i<45;i++){const item=document.createElement('div');item.innerHTML=`<b>${i===44?'末页主播':'主播'+i}</b><button>打开主播 ${i}</button>`;item.querySelector('button').onclick=()=>{profileAction=i;};records.append(item);}
  root.querySelector('[data-page=ai]').append(records);bridge.refresh();await new Promise(resolve=>setTimeout(resolve,30));
  const recordBrowser=ui.querySelector('.product-data-set[aria-label="主播列表"]');assert.ok(recordBrowser);
  assert.equal(recordBrowser.querySelectorAll('.product-record-scroll button').length,20);
  const recordSearch=recordBrowser.querySelector('input[type=search]');setter.call(recordSearch,'末页');recordSearch.dispatchEvent(new dom.window.Event('input',{bubbles:true,composed:true}));await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(recordBrowser.querySelectorAll('.product-record-scroll button').length,1);recordBrowser.querySelector('.product-record-scroll button').click();assert.equal(profileAction,44);
  const drafts=document.createElement('div');drafts.dataset.list='keywords';drafts.innerHTML=Array.from({length:30},(_,i)=>`<div class="editor-row"><label><span>规则 ${i}</span><textarea>草稿 ${i}</textarea></label></div>`).join('');root.querySelector('[data-page=ai]').append(drafts);bridge.refresh();await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(ui.querySelector('.product-edit-scroll').querySelectorAll('textarea').length,30,'编辑集合用内部滚动保留全部草稿');
  // Dialogs render through Mantine in this shadow root and edit the original controls.
  const dialog=document.createElement('div');dialog.dataset.knowledgeDialog='';dialog.hidden=true;
  dialog.innerHTML='<h3 data-memory-dialog-title>添加知识</h3><div data-knowledge-dialog-body><label class="field"><span>资料标题</span><input autofocus value="初稿"></label><button data-memory-cancel>取消</button><button data-confirm>确定</button></div>';
  const add=document.createElement('button');add.textContent='添加知识';add.onclick=()=>{dialog.hidden=false;};
  let committed='';dialog.querySelector('[data-memory-cancel]').onclick=()=>{dialog.hidden=true;};dialog.querySelector('[data-confirm]').onclick=()=>{committed=dialog.querySelector('input').value;dialog.hidden=true;};
  root.querySelector('[data-page=ai]').append(add,dialog);bridge.refresh();await new Promise(resolve=>setTimeout(resolve,30));
  [...ui.querySelectorAll('button')].find(b=>b.textContent==='添加知识').click();await new Promise(resolve=>setTimeout(resolve,40));
  const popup=ui.querySelector('[role="dialog"]');assert.ok(popup);assert.match(popup.textContent,/添加知识/);
  const popupInput=popup.querySelector('input');setter.call(popupInput,'已核对的资料');popupInput.dispatchEvent(new dom.window.Event('input',{bubbles:true,composed:true}));await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(dialog.querySelector('input').value,'已核对的资料');
  [...popup.querySelectorAll('button')].find(b=>b.textContent==='确定').click();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(committed,'已核对的资料');assert.equal(ui.querySelector('[role="dialog"]'),null);
  [...ui.querySelectorAll('button')].find(b=>b.textContent==='添加知识').click();await new Promise(resolve=>setTimeout(resolve,30));
  [...ui.querySelector('[role="dialog"]').querySelectorAll('button')].find(b=>b.textContent==='取消').click();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(ui.querySelector('[role="dialog"]'),null);
  assert.equal(document.documentElement.getAttribute('data-mantine-color-scheme'),null);assert.equal(document.body.querySelector('[data-portal]'),null);
  runtime.destroy();runtime=null;assert.equal(container.shadowRoot.childNodes.length,0);
 }finally{runtime?.destroy();bridge?.destroy();Object.assign(globalThis,previous);if(navigatorDescriptor)Object.defineProperty(globalThis,'navigator',navigatorDescriptor);else delete globalThis.navigator;dom.window.close();await rm(dir,{recursive:true,force:true});}
});
