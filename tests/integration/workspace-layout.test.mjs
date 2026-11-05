import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {copy,DEFAULTS} from '../../src/core/engine.js';
import {createWorkspaceBridge} from '../../src/ui/product/bridge.js';
import {cardRuns} from '../../src/ui/product/layout.js';

function fixture(){
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123',pretendToBeVisual:true});
  for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  const config=copy(DEFAULTS);for(const key of ['gift','welcome','like','keyword','bot'])config[key].enabled=true;config.timersEnabled=true;
  const panel=new Panel({room:'123',config,callbacks:{}});
  return {dom,panel,change(node,value){node.value=value;node.dispatchEvent(new dom.window.Event('change',{bubbles:true}));},close(){panel.destroy();dom.window.close();}};
}

test('所有页面共用固定工具栏，切页和缩放保留输入与唯一操作按钮',()=>{
  const f=fixture(),p=f.panel;
  try{
    const toolbar=p.node('[data-workspace-toolbar]');assert.ok(toolbar);assert.equal(p.node('.scroll').contains(toolbar),false);
    assert.equal(toolbar.contains(p.node('[data-action="save"]')),true);assert.equal(toolbar.contains(p.node('[data-action="start"]')),true);
    assert.equal(p.root.querySelectorAll('[data-action="save"]').length,1);
    const field=p.node('[data-field="welcome.minWealth"]');field.value='42';field.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
    for(const tab of p.root.querySelectorAll('[data-tab]')){if(tab.hidden)continue;p.tab(tab.dataset.tab);assert.equal(p.node('[data-workspace-title]').textContent,p.node(`[data-page="${tab.dataset.tab}"] h2`).textContent);}
    p.navigation.update(900);assert.equal(p.navigation.layout,'sidebar');p.navigation.update(380);assert.equal(p.navigation.layout,'top');
    assert.equal(p.node('[data-field="welcome.minWealth"]'),field);assert.equal(field.value,'42');assert.equal(p.dirty,true);
  }finally{f.close();}
});

test('紧凑导航按分类选择页面，禁用功能不出现且切换导航不标记修改',()=>{
  const f=fixture(),p=f.panel;
  try{
    p.navigation.update(380);const category=p.node('[data-nav-category]'),page=p.node('[data-nav-page]');assert.ok(category);assert.ok(page);
    f.change(category,'settings');assert.equal(p.activeTab,'features');f.change(page,'ai');assert.equal(p.activeTab,'ai');assert.equal(p.dirty,false);
    const first=p.node('[data-subnav=interaction] [data-tab]:not([hidden])').dataset.tab;
    f.change(category,'interaction');assert.equal(p.activeTab,first);
    const welcome=p.node('[data-field="welcome.enabled"]');welcome.checked=false;welcome.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));
    assert.ok(![...page.options].some(o=>o.value==='welcome'));assert.ok([...page.options].some(o=>o.value==='gift'));
  }finally{f.close();}
});

test('互动设置与独立工具按有名分区组织，开关保留表单语义',()=>{
  const f=fixture(),p=f.panel;
  try{
    for(const key of ['gift','welcome','likes','keywords','timers','auto-like','auto-gift','giveaway','rewards','diagnostics','features','runtime','profiles','bot','moderation','ai','appearance','anchor']){
      const page=p.node(`[data-page="${key}"]`);assert.ok(page);assert.ok(page.querySelector('h3,legend,details>summary'),key+' 缺少分组标题');
    }
    assert.ok(p.node('[data-page=anchor] [data-anchor-content=pk]').querySelector('h3'));
    const input=p.node('[data-field="welcome.requireFan"]');assert.equal(input.getAttribute('role'),'switch');
    const before=input.checked;input.closest('label').click();assert.equal(input.checked,!before);assert.equal(p.dirty,true);
  }finally{f.close();}
});

test('连接诊断按账号摘要、三组诊断和高级折叠区排列，发送反馈紧随连接操作',()=>{
  const f=fixture(),p=f.panel;let bridge;
  try{
    p.tab('diagnostics');
    const page=p.node('[data-page=diagnostics]'),identity=page.querySelector('.identity');
    assert.ok(identity.contains(p.node('[data-manual-identity]')),'账号识别与手动补充共用一个区域');
    const connection=p.node('[data-action=diagnose]').closest('.workspace-card');
    assert.ok(connection.contains(p.node('[data-deliveries]')),'发送反馈不单独占一列');
    for(const selector of ['[data-import-income-file]','[data-import-file]'])assert.equal(p.node(selector).hidden,true,'导入按钮调用原文件控件，文件控件不重复展示');
    bridge=createWorkspaceBridge(p);
    const body=bridge.getSnapshot().content.children.find(node=>node.classes?.split(/\s/u).includes('workspace-grid'));
    const runs=cardRuns(body.children);
    assert.equal(runs.length,7);
    assert.equal(runs[0][0].span,'full');
    const title=node=>node.children[0]?.children[0]?.text;
    assert.deepEqual(runs[1].slice(0,3).map(title),['直播连接','采集与存储','互动过滤']);
    assert.deepEqual(runs.slice(2).map(run=>run[0].title),['高级页面适配与去重','弹幕备用采集与场次识别','运行记录','配置与运行记录','使用说明']);
    assert.ok(runs.slice(2).every(run=>run.length===1),'收起的高级区不生成空白卡片');
    const input=p.node('[data-field="selfId"]');
    input.value='123456789';input.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
    p.tab('welcome');p.tab('diagnostics');
    assert.equal(p.node('[data-field="selfId"]'),input);assert.equal(input.value,'123456789');
    for(const action of ['diagnose','debug-send','recover-events','import-income','import','export-log'])assert.equal(page.querySelectorAll(`[data-action="${action}"]`).length,1);
  }finally{bridge?.destroy();f.close();}
});

test('所有功能页在全部详情打开后仍遵循同一尺寸角色且保留原字段',()=>{
 const f=fixture(),p=f.panel,bridge=createWorkspaceBridge(p);
 try{
  const visit=(node,check)=>{check(node);for(const child of node.children || [])visit(child,check);};
  for(const page of p.root.querySelectorAll('[data-page]')){
   const fields=[...page.querySelectorAll('input,textarea,select')],key=page.dataset.page;
   p.tab(key);
   for(const detail of page.querySelectorAll('details'))detail.open=true;
   bridge.refresh();
   visit(bridge.getSnapshot().content,node=>{
    if(node.layout!=='cards')return;
    for(const child of node.children){
     if(child.kind==='details'){assert.equal(child.span,'full',key);assert.equal(child.size,'section',key);}
     else if(child.surface==='card')assert.equal(child.size,child.span==='full' ? 'section' : 'tile',key);
     else assert.equal(child.span,'full',key);
    }
   });
   assert.deepEqual([...page.querySelectorAll('input,textarea,select')],fields,key+' 原字段不因布局或展开而替换');
  }
 }finally{bridge.destroy();f.close();}
});

test('直播连接默认收起长检查结果与发送测试，检查后结果可见且不展开测试记录',async()=>{
 const f=fixture(),p=f.panel;let bridge;
 try{
  p.tab('diagnostics');
  const output=p.node('[data-diagnostics]'),results=output.closest('details'),records=p.node('[data-deliveries]').closest('details');
  assert.ok(results,'长诊断输出按需查看');assert.ok(records,'测试说明与记录按需查看');
  assert.equal(results.open,false);assert.equal(records.open,false);
  assert.ok(records.contains(p.node('[data-action=debug-send]')));
  p.callbacks.diagnose=()=>({hook:true,sockets:2,connected:true,frames:25,events:30,errors:0,anchorId:'123',input:true,send:true});
  p.node('[data-action=diagnose]').click();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(results.open,true);assert.match(output.textContent,/捕获连接：2；连接在线/);
  assert.equal(records.open,false);
  bridge=createWorkspaceBridge(p);
  const find=node=>node.id && node.kind==='details' && node.title==='连接检查结果' ? node : node.children?.map(find).find(Boolean);
  assert.equal(find(bridge.getSnapshot().content).open,true,'可见界面同步原详情开关');
  results.open=false;p.tab('welcome');p.tab('diagnostics');assert.equal(results.open,false);
 }finally{bridge?.destroy();f.close();}
});

test('抽奖的弹幕与礼物参与独立分组，礼物长目录不撑高奖品与规则',()=>{
 const f=fixture();try{
  const page=f.panel.node('[data-page=giveaway]');
  const chat=page.querySelector('[data-giveaway=keyword]').closest('.giveaway-config');
  const gift=page.querySelector('[data-giveaway=gifts]').closest('.giveaway-config');
  assert.notEqual(chat,gift);assert.match(chat.querySelector('legend').textContent,/弹幕/);assert.match(gift.querySelector('legend').textContent,/礼物/);
  assert.ok(page.querySelector('[data-giveaway-gift-list]').closest('details'),'长礼物目录按需展开，手动填写保留在主卡片');
  assert.equal(page.querySelector('[data-giveaway=anchorGuaranteed]').closest('.giveaway-config'),chat,'短中奖规则归入弹幕参与条件');
  const live=page.querySelector('.giveaway-live');
  for(const selector of ['[data-giveaway=announcePrizeNames]','[data-action=giveaway-start]','[data-giveaway-status]'])assert.ok(live.contains(page.querySelector(selector)),'本轮操作与反馈不另撑一列');
 }finally{f.close();}
});
test('功能开关按用途分组直接操作，不为单个开关创建卡片',()=>{
 const f=fixture();try{
  const page=f.panel.node('[data-page=features]'),sections=[...page.querySelectorAll('.feature-section')];
  assert.deepEqual(sections.map(section=>section.querySelector('h3').textContent),['直播互动','AI 互动','治理与统计']);
  assert.deepEqual(sections.map(section=>section.querySelectorAll('.feature-row input').length),[6,3,2]);
  assert.equal(page.querySelectorAll('.workspace-card,.feature-tile').length,0);
  assert.equal(page.querySelectorAll('.feature-row input[role=switch]').length,11);
  assert.ok(page.querySelector('[data-go=ai]'),'配置入口在 AI 分组直接可用');
  assert.match(page.textContent,/关闭后停止采集，历史数据仍保留/u);
  const input=page.querySelector('[data-field="bot.enabled"]');input.closest('label').click();assert.equal(input.checked,false);assert.equal(f.panel.dirty,true);
 }finally{f.close();}
});
test('礼物近期记录按需展开，机器人游戏选项横向分栏，不与长规则共用一排',()=>{
 const f=fixture();try{
  const recent=f.panel.node('[data-recent-gifts]');assert.ok(recent.closest('details'));
  assert.ok(recent.closest('details').querySelector('[data-gift-count]'),'实时记录数量仍可见');
  const games=f.panel.node('[data-page=bot] .bot-game-options');assert.ok(games);assert.ok(games.closest('.workspace-wide'));
  assert.ok(f.panel.node('[data-field="bot.idiomGames"]').closest('.workspace-wide'));
 }finally{f.close();}
});
test('点赞感谢的单项规则与话术合并，不为一个选项撑出整列空卡片',()=>{
 const f=fixture();try{
  const mode=f.panel.node('[data-field="like.responseMode"]').closest('.settings-group'),copy=f.panel.node('[data-field="like.templates"]').closest('.settings-group');
  assert.equal(mode,copy);assert.match(mode.querySelector('h3').textContent,/感谢方式与话术/u);
 }finally{f.close();}
});

test('本页分区跳转展开高级设置并聚焦标题，不丢失草稿或误保存',()=>{
  const f=fixture(),p=f.panel;
  try{
    p.tab('welcome');const target=p.node('[data-field="welcome.admin.enabled"]').closest('details');target.open=false;
    const jump=p.node('[data-page-sections]');const option=[...jump.options].find(o=>o.textContent.includes('管理员弹幕欢迎'));assert.ok(option);
    f.change(jump,option.value);assert.equal(target.open,true);assert.equal(p.root.activeElement,target.querySelector('summary'));assert.equal(p.dirty,false);
  }finally{f.close();}
});

test('导航跨越断点后焦点转到可见入口，表单焦点不被改变',()=>{
  const f=fixture(),p=f.panel;
  try{
    p.tab('welcome');p.navigation.update(1000);p.node('[data-tab="welcome"]').focus();p.navigation.update(380);
    assert.equal(p.root.activeElement,p.node('[data-nav-page]'));
    p.navigation.update(1000);assert.equal(p.root.activeElement,p.node('[data-tab="welcome"]'));
    const input=p.node('[data-field="welcome.minWealth"]');input.focus();p.navigation.update(380);assert.equal(p.root.activeElement,input);
  }finally{f.close();}
});

test('切换主播子页面后分区目录只显示当前视图',async()=>{
  const f=fixture(),p=f.panel;
  try{
    p.tab('anchor');p.node('[data-anchor-view="income"]').click();await Promise.resolve();
    const text=[...p.node('[data-page-sections]').options].map(o=>o.textContent).join(' ');
    assert.match(text,/直播场次明细/);assert.ok(!text.includes('观众与互动'));
  }finally{f.close();}
});
