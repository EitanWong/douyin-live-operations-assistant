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

test('侧栏偏好由原控制器或跨窗口同步更新时，组件界面立即读取新状态',async()=>{
 const f=setup();try{
  f.panel.navigation={side:'left',collapsed:false};f.bridge.refresh();
  let updates=0;const unsubscribe=f.bridge.subscribe(()=>updates++);
  f.panel.navigation.collapsed=true;f.root.querySelector('.workspace').dataset.navCollapsed='true';
  await Promise.resolve();assert.equal(f.bridge.getSnapshot().sidebar.collapsed,true);assert.equal(updates,1);
  f.panel.navigation.side='right';f.root.querySelector('.workspace').dataset.navSide='right';
  await Promise.resolve();assert.equal(f.bridge.getSnapshot().sidebar.side,'right');assert.equal(updates,2);
  assert.equal(f.root.querySelector('input').value,'qwen-plus');unsubscribe();
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

test('分区跳转先打开祖先折叠区，隐藏页面的目标不能被打开',()=>{
 const f=setup();try{
  const page=f.root.querySelector('[data-page="ai"]');page.innerHTML='<details><summary>更多分析</summary><details><summary>高级</summary><h3>上下文预算</h3><input value="draft"></details></details>';f.bridge.refresh();
  const target=f.bridge.getSnapshot().content.children[0].children[0].children[0];
  assert.equal(f.bridge.reveal(target.id),true);assert.ok([...page.querySelectorAll('details')].every(n=>n.open));
  f.bridge.navigate('anchor');assert.equal(f.bridge.reveal(target.id),false);assert.equal(page.querySelector('input').value,'draft');
 }finally{f.close();}
});

test('成熟界面接管后暂停旧布局，渲染失败恢复兼容布局且保留草稿',async()=>{
 const {mountProductPanel}=await import('../../src/ui/product/mount.js');const f=setup();let mounted,fail;const states=[];
 try{
  const adaptive=[];f.dom.window.CSS={supports:()=>true};f.panel.workspaceLayout={grid:{setSuspended:value=>states.push(value)}};f.panel.adaptive={setSuspended:value=>adaptive.push(value)};f.panel.toast=()=>{};
  const panelElement=f.dom.window.document.createElement('div');panelElement.className='panel';f.root.append(panelElement);panelElement.append(f.root.querySelector('.workspace'));
  mounted=mountProductPanel(f.panel,{load:async()=>({mountProductWorkspace({onReady,onError}){fail=onError;onReady();return {destroy(){}};}})});
  await mounted.ready;assert.equal(states.at(-1),true);assert.equal(adaptive.at(-1),true);fail();assert.equal(states.at(-1),false);assert.equal(adaptive.at(-1),false);assert.equal(f.root.querySelector('input').value,'qwen-plus');
 }finally{mounted?.destroy();f.close();}
});

test('布局边界展开透明包装，卡片/字段/操作区各有唯一语义且保留草稿顺序',()=>{
 const f=setup();try{
  f.root.querySelector('[data-page="ai"]').innerHTML='<div class="ai-settings"><div class="workspace-grid" data-ai-section="models" role="tabpanel" aria-label="连接与模型"><section class="ai-card"><h3>组合</h3><select aria-label="组合"><option>文字</option></select></section><div class="ai-service-grid" data-workspace-contents><section class="ai-card"><h3>回复</h3><div class="grid"><label><span>服务</span><input value="draft"></label><div data-ai-modes="custom"><label><span>提示词</span><textarea>保留内容</textarea></label></div></div></section><section class="ai-card" hidden><h3>不可见服务</h3></section></div><div data-ai-modes="custom"><section class="ai-card"><h3>感知</h3></section></div><div class="ai-test-row"><button>测试</button><p>连接说明</p></div></div></div>';
  f.bridge.refresh();const section=f.bridge.getSnapshot().content.children[0];
  assert.equal(section.layout,'cards');assert.equal(section.role,'tabpanel');assert.equal(section.label,'连接与模型');
  assert.deepEqual(section.children.map(n=>n.children[0]?.children?.[0]?.text || n.children[0]?.text),['组合','回复','感知','测试']);
  assert.equal(section.children[0].span,undefined);assert.equal(section.children[1].surface,'card');
  const fields=section.children[1].children[1];assert.equal(fields.layout,'fields');assert.deepEqual(fields.children.map(n=>n.value),['draft','保留内容']);assert.equal(fields.children[1].span,'full');
  assert.equal(section.children[3].layout,'row');assert.equal(section.children[3].span,'full');
  const field=fields.children[0];f.bridge.change(field.id,'仍可编辑');assert.equal(f.root.querySelector('input').value,'仍可编辑');
  assert.doesNotMatch(JSON.stringify(section),/不可见服务|workspace-contents|ai-service-grid/);
 }finally{f.close();}
});

test('高级折叠区与配置共用列宽，仅显式通栏保留完整行',()=>{
 const f=setup();try{
  f.root.querySelector('[data-page="ai"]').innerHTML='<div class="workspace-grid"><section class="settings-group workspace-card"><h3>参与设置</h3><input value="draft"></section><details class="advanced workspace-card"><summary>定位</summary><input value="xpath"></details><details class="workspace-card"><summary>工具管理</summary><button>停用</button></details></div>';
  f.bridge.refresh();const [config,...advanced]=f.bridge.getSnapshot().content.children[0].children;
  assert.equal(config.span,undefined);assert.deepEqual(advanced.map(node=>node.span),[undefined,undefined]);assert.ok(advanced.every(node=>node.size==='tile'));
 }finally{f.close();}
});

test('重复规则独立排版，移动和删除仍作用于原规则且保留编辑内容',()=>{
 const f=setup();try{
  const page=f.root.querySelector('[data-page="ai"]');page.innerHTML='<div data-list="keywords"><div class="editor-row"><div class="row-head"><b>规则甲</b><div><button>上移</button></div></div><label><span>回复</span><textarea>甲的草稿</textarea></label></div><div class="editor-row"><label><span>回复</span><textarea>乙的草稿</textarea></label><button>删除</button></div></div>';
  const list=page.querySelector('[data-list]'),second=list.lastElementChild;
  list.querySelector('button').onclick=()=>list.prepend(second);second.querySelector('button').onclick=()=>second.remove();
  f.bridge.refresh();let group=f.bridge.getSnapshot().content.children[0];
  assert.equal(group.layout,'cards');assert.ok(group.children.every(node=>node.surface==='card' && !node.span));
  assert.equal(group.children[0].children[0].layout,'row');
  f.bridge.change(find(group.children[1],'field').id,'乙仍可编辑');f.bridge.activate(find(group.children[0],'button').id);
  group=f.bridge.getSnapshot().content.children[0];assert.equal(find(group.children[0],'field').value,'乙仍可编辑');
  f.bridge.activate(find(group.children[0],'button').id);assert.equal(list.children.length,1);assert.equal(list.querySelector('textarea').value,'甲的草稿');
 }finally{f.close();}
});

test('PK 播报开关保留无重复文案的可访问标签，间隔优先使用完整名称',()=>{
 const f=setup();try{
  f.root.querySelector('[data-page="ai"]').innerHTML='<div class="pk-broadcast-option"><div class="pk-broadcast-copy">每日任务</div><label class="pk-broadcast-interval"><span>每隔</span><input type="number" aria-label="汇报间隔 / 秒" value="300"></label><label class="switch"><input type="checkbox" aria-label="定时汇报每日任务与展馆"><span aria-hidden="true"></span></label></div>';
  f.bridge.refresh();const option=f.bridge.getSnapshot().content.children[0],[,interval,toggle]=option.children;
  assert.equal(option.layout,'row');assert.equal(interval.label,'汇报间隔 / 秒');assert.equal(toggle.labelHidden,true);assert.equal(toggle.label,'定时汇报每日任务与展馆');
  f.bridge.change(toggle.id,true);assert.equal(f.root.querySelector('input[type=checkbox]').checked,true);
 }finally{f.close();}
});


test('已有业务分页的表格明确标记搜索范围，源控制器已有搜索时不重复接管',()=>{
 const f=setup();try{
  const page=f.root.querySelector('[data-page=ai]');page.innerHTML='<details data-collection-source><summary>粉丝团成员</summary><label><span>搜索已采集成员</span><input type="search"></label><div><table><thead><tr><th>成员</th></tr></thead><tbody><tr><td>末页</td></tr></tbody></table></div><div class="anchor-pagination"><button>下一页</button></div></details>';f.bridge.refresh();
  const table=find(f.bridge.getSnapshot().content,'table');assert.equal(table.scope,'page');assert.equal(table.sourceControlled,true);assert.equal(table.caption,'粉丝团成员');
 }finally{f.close();}
});
