import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createWorkspaceBridge} from '../../src/ui/product/bridge.js';

function setup(){
  const dom=new JSDOM('<div id="host"></div>',{pretendToBeVisual:true,url:'https://live.douyin.com/123'}),root=dom.window.document.querySelector('#host').attachShadow({mode:'open'});
  root.innerHTML='<div class="workspace"><button data-tab="ai" aria-label="AI 设置" aria-selected="true">AI</button><button data-tab="anchor" aria-label="主播数据">主播</button><header data-workspace-toolbar><h2>AI 设置</h2><div class="foot"><small>未保存</small><button data-action="save">保存设置</button></div></header><div class="scroll"><section data-page="ai"><section class="workspace-card"><h3>模型</h3><label class="field"><span>模型名</span><input data-field="ai.model" value="qwen-plus"><small>填写完整 ID</small></label><label class="toggle"><input type="checkbox" data-field="ai.enabled">启用 AI</label><button data-action="test-ai">测试连接</button><div hidden><input value="不可见"></div></section></section><section data-page="anchor" hidden></section></div><footer data-workspace-status><div class="shell-status">已暂停</div><div class="workspace-message-list"><div class="toast" hidden></div></div></footer></div>';
  const panel={root,host:root.host,activeTab:'ai',tab(key){this.activeTab=key;for(const page of root.querySelectorAll('[data-page]'))page.hidden=page.dataset.page!==key;}};
  const bridge=createWorkspaceBridge(panel);return {dom,root,panel,bridge,close(){bridge.destroy();dom.window.close();}};
}
const find=(node,kind)=>node?.kind===kind ? node : node?.children?.map(n=>find(n,kind)).find(Boolean);

test('成熟 UI 适配层仅使用一份表单状态，编辑保留数值并派发原事件一次',()=>{
 const f=setup();try{let changes=0;const source=f.root.querySelector('[data-field="ai.model"]');source.addEventListener('input',()=>changes++);
 const field=find(f.bridge.getSnapshot().content,'field');assert.equal(field.label,'模型名');assert.equal(field.value,'qwen-plus');f.bridge.change(field.id,'custom-model');assert.equal(source.value,'custom-model');assert.equal(changes,1);assert.equal(find(f.bridge.getSnapshot().content,'field').value,'custom-model');
 assert.doesNotMatch(JSON.stringify(f.bridge.getSnapshot().content),/不可见/);
 }finally{f.close();}
});
test('操作通过原控制器执行一次，导航不重置草稿，服务消息可被新界面读取',async()=>{
 const f=setup();try{let calls=0;const button=f.root.querySelector('[data-action="test-ai"]');button.addEventListener('click',()=>calls++);const action=find(f.bridge.getSnapshot().content,'button');f.bridge.activate(action.id);assert.equal(calls,1);
 f.bridge.navigate('anchor');assert.equal(f.panel.activeTab,'anchor');f.bridge.navigate('ai');assert.equal(f.root.querySelector('input').value,'qwen-plus');
 const toast=f.root.querySelector('.toast');toast.hidden=false;toast.textContent='连接失败';await Promise.resolve();assert.match(JSON.stringify(f.bridge.getSnapshot().messages),/连接失败/);
 }finally{f.close();}
});
test('表格快照保留列与行、数字排序值及导出边界，移除的控件不能被旧操作执行',()=>{
 const f=setup();try{const page=f.root.querySelector('[data-page="ai"]');page.innerHTML='<table><thead><tr><th>观众</th><th>钻石</th></tr></thead><tbody><tr><td>甲</td><td>9</td></tr><tr><td>乙</td><td>1,200</td></tr></tbody></table>';f.bridge.refresh();const table=find(f.bridge.getSnapshot().content,'table');assert.deepEqual(table.headers,['观众','钻石']);assert.equal(table.rows[1][1],'1,200');
 const old=f.bridge.getSnapshot().toolbar.find(n=>n.kind==='button');f.root.querySelector('[data-action="save"]').remove();assert.equal(f.bridge.activate(old.id),false);
 }finally{f.close();}
});

test('日期筛选触发原 change 处理器一次，禁用项不接受编辑，错误保留字段焦点',async()=>{
 const f=setup();try{const page=f.root.querySelector('[data-page="ai"]');page.innerHTML='<label class="field"><span>统计月份</span><input type="month" value="2026-10"></label>';let calls=0;const input=page.querySelector('input');input.addEventListener('change',()=>calls++);f.bridge.refresh();const field=find(f.bridge.getSnapshot().content,'field');f.bridge.change(field.id,'2026-11');assert.equal(calls,1);input.disabled=true;assert.equal(f.bridge.change(field.id,'2026-12'),false);assert.equal(input.value,'2026-11');input.setAttribute('aria-invalid','true');await Promise.resolve();assert.equal(f.bridge.getSnapshot().focus.id,field.id);
 }finally{f.close();}
});

test('组件加载失败恢复兼容界面，销毁早于加载完成时不再挂载',async()=>{
 const {mountProductPanel}=await import('../../src/ui/product/mount.js');
 const f=setup();let disposed;
 try{
  f.dom.window.CSS={supports:()=>true};let errors=0;f.panel.toast=()=>errors++;
  disposed=mountProductPanel(f.panel,{load:()=>Promise.reject(new Error('missing'))});assert.equal(await disposed.ready,false);assert.equal(errors,1);assert.equal(f.root.querySelector('.workspace').hasAttribute('aria-hidden'),false);assert.equal(f.panel.host.dataset.productStatus,'fallback');disposed.destroy();
  let finish;const lazy=new Promise(resolve=>{finish=resolve;});disposed=mountProductPanel(f.panel,{load:()=>lazy});disposed.destroy();finish({mountProductWorkspace(){throw new Error('不应加载');}});assert.equal(await disposed.ready,false);assert.equal(f.root.querySelector('.product-surface'),null);
 }finally{disposed?.destroy();f.close();}
});

test('展开诊断详情沿用原 toggle 处理器，日志加载后进入可见快照',async()=>{
 const f=setup();try{const page=f.root.querySelector('[data-page="ai"]');page.innerHTML='<details><summary>运行日志</summary><p>尚未加载</p></details>';let calls=0;const detail=page.querySelector('details');detail.addEventListener('toggle',()=>{calls++;detail.querySelector('p').textContent='队列已启动';});f.bridge.refresh();const disclosure=find(f.bridge.getSnapshot().content,'details');f.bridge.toggle(disclosure.id,true);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(detail.open,true);assert.equal(calls,1);assert.match(JSON.stringify(f.bridge.getSnapshot().content),/队列已启动/);
 }finally{f.close();}
});
