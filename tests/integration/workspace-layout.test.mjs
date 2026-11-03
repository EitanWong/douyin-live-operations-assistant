import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {copy,DEFAULTS} from '../../src/core/engine.js';

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
    for(const key of ['gift','welcome','likes','keywords','timers','auto-like','auto-gift','giveaway','rewards','diagnostics','features','runtime','profiles','bot','moderation','ai','appearance','anchor','pk']){
      const page=p.node(`[data-page="${key}"]`);assert.ok(page);assert.ok(page.querySelector('h3,legend,details>summary'),key+' 缺少分组标题');
    }
    const input=p.node('[data-field="welcome.requireFan"]');assert.equal(input.getAttribute('role'),'switch');
    const before=input.checked;input.closest('label').click();assert.equal(input.checked,!before);assert.equal(p.dirty,true);
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
