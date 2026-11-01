import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {organizePage} from '../../src/ui/workspace-pages.js';
import {Panel} from '../../src/ui/panel.js';
import {copy,DEFAULTS} from '../../src/core/engine.js';
function fixture(){
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123',pretendToBeVisual:true});
  for(const key of ['document','window','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  const config=copy(DEFAULTS);for(const key of ['gift','welcome','like','keyword','bot'])config[key].enabled=true;config.timersEnabled=true;
  const p=new Panel({room:'123',config,callbacks:{}});
  return {p,dom,close(){p.destroy();dom.window.close();}};
}
test('导航、操作、消息分属固定区域，打开消息保留草稿与当前页面',async()=>{
  const f=fixture(),p=f.p;try{
    const messages=p.node('[data-workspace-messages]');assert.ok(messages);assert.ok(messages.contains(p.node('.toast')));assert.ok(messages.contains(p.node('[data-ai-alert]')));assert.ok(!p.node('.scroll').contains(messages));
    assert.ok(p.node('[data-workspace-status]').contains(p.node('.shell-status')));
    p.tab('welcome');const input=p.node('[data-field="welcome.minWealth"]');input.value='45';input.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
    p.toast('测试提示');await Promise.resolve();assert.equal(messages.open,true);assert.match(messages.querySelector('summary').textContent,/1/);
    messages.open=false;p.tab('ai');p.tab('welcome');assert.equal(input.value,'45');assert.equal(p.dirty,true);
    p.setAIServiceStatus('连接失败');await Promise.resolve();assert.equal(messages.open,true);assert.match(messages.textContent,/连接失败/);
  }finally{f.close();}
});
test('主播页面导航固定，筛选集中，切换账本保留原表单',async()=>{
  const f=fixture(),p=f.p;try{
    p.tab('anchor');const nav=p.node('.anchor-views');assert.ok(p.node('[data-workspace-views]').contains(nav));assert.ok(!p.node('.scroll').contains(nav));
    const filters=p.node('[data-workspace-anchor-filters]');for(const selector of ['[data-anchor-picker]','[data-anchor-session-picker]','[data-anchor-period]','[data-action="refresh-anchor"]','[data-action="export-anchor"]'])assert.ok(filters.contains(p.node(selector)),selector);
    p.node('[data-anchor-view="income"]').click();await Promise.resolve();assert.equal(p.anchorView,'income');assert.equal(p.node('[data-anchor-content="overview"]').hidden,true);assert.equal(p.dirty,false);
    p.node('[data-anchor-view="overview"]').click();assert.equal(p.node('[data-anchor-picker]'),filters.querySelector('[data-anchor-picker]'));
  }finally{f.close();}
});
test('设置卡片独立参与布局，说明收纳但字段与操作仍唯一',()=>{
  const f=fixture(),p=f.p;try{
    for(const key of ['gift','welcome','likes','bot','diagnostics','features','moderation']){
      const page=p.node(`[data-page="${key}"]`);assert.ok(page.querySelector('[data-workspace-body]'),key);assert.equal(page.querySelectorAll('.settings-column').length,0,key);
      assert.ok(page.querySelector('[data-workspace-help] .intro'),key);
    }
    assert.equal(p.root.querySelectorAll('[data-field="welcome.minWealth"]').length,1);assert.equal(p.root.querySelectorAll('[data-action="save"]').length,1);
    p.tab('welcome');const input=p.node('[data-field="welcome.minWealth"]');input.focus();p.navigation.update(1500);p.navigation.update(320);assert.equal(p.root.activeElement,input);
  }finally{f.close();}
});
test('主播关键指标连续呈现，数据卡片与功能设置分离',()=>{
  const f=fixture(),p=f.p;try{
    const metrics=p.node('[data-workspace-anchor-metrics]');assert.ok(metrics);assert.ok(metrics.querySelectorAll('.anchor-metrics>div').length>=4);
    const data=p.node('[data-workspace-anchor-data]');assert.ok(data);assert.ok(data.contains(p.node('[data-anchor-fanclub-count]')));assert.equal(data.querySelector('[data-field]'),null);
    const overview=p.node('[data-anchor-content="overview"]');assert.equal(overview.querySelectorAll('.anchor-workspace,.anchor-metric-workspace,.anchor-live-workspace').length,0);
  }finally{f.close();}
});
test('AI 与主播二级导航共用位置，切换页面不会重建或重置视图',()=>{
  const f=fixture(),p=f.p;try{
    p.tab('ai');const nav=p.node('.ai-section-tabs');assert.ok(p.node('[data-workspace-views]').contains(nav));assert.equal(nav.hidden,false);
    p.node('[data-ai-section-tab="knowledge"]').click();p.tab('anchor');assert.equal(nav.hidden,true);assert.equal(p.node('.anchor-views').hidden,false);p.tab('ai');assert.equal(nav.hidden,false);assert.equal(p.node('[data-ai-section="knowledge"]').hidden,false);assert.equal(p.dirty,false);
  }finally{f.close();}
});

test('已有播报功能被移入独立视图，保留设置值、事件与唯一字段',()=>{
  const dom=new JSDOM('<section data-page="anchor"><h2>主播数据</h2><div class="anchor-views"></div><div data-anchor-content="overview"><section class="anchor-section"><h3>数据</h3></section><section class="anchor-section anchor-broadcast-section"><h3>本场贡献榜播报</h3><label class="field"><input data-field="audienceBroadcast.intervalSec" value="420"></label><button>立即播报</button></section></div></section>');
  try{
    const page=dom.window.document.querySelector('section'),input=page.querySelector('input'),button=page.querySelector('button');let calls=0;button.addEventListener('click',()=>calls++);organizePage(page);
    const view=page.querySelector('[data-anchor-content="broadcast"]');assert.ok(view);assert.equal(view.hidden,true);assert.equal(view.querySelector('input'),input);assert.equal(input.value,'420');assert.equal(page.querySelectorAll('input').length,1);assert.equal(page.querySelector('[data-anchor-view="broadcast"]').textContent,'播报设置');
    view.hidden=false;button.click();assert.equal(calls,1);assert.equal(page.querySelector('[data-workspace-anchor-data] input'),null);
  }finally{dom.window.close();}
});

test('自定义感知保留显隐边界并与模型卡片共享网格，避免独占整行',()=>{
  const f=fixture(),p=f.p;try{
    const custom=p.node('[data-custom-media]');assert.ok(custom.hasAttribute('data-workspace-contents'));assert.equal(custom.parentElement,p.node('[data-ai-section="models"]'));
    p.node('[data-field="ai.pipeline.mode"]').value='text';p.node('[data-field="ai.pipeline.mode"]').dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));assert.equal(custom.hidden,true);
    p.node('[data-field="ai.pipeline.mode"]').value='custom';p.node('[data-field="ai.pipeline.mode"]').dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));assert.equal(custom.hidden,false);
  }finally{f.close();}
});
