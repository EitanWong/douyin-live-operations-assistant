import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {copy,DEFAULTS} from '../../src/core/engine.js';

function setup(callbacks={}){
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890',pretendToBeVisual:true});
  for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  const panel=new Panel({config:copy(DEFAULTS),room:'1',callbacks});panel.tab('ai');
  const change=(path,value)=>{const el=panel.node(`[data-field="${path}"]`);if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
  const section=name=>panel.node(`[data-ai-section="${name}"]`);
  return {dom,panel,change,section,close:()=>{panel.destroy();dom.window.close();}};
}
function visible(el){for(let node=el;node;node=node.parentElement)if(node.hidden)return false;return true;}

test('AI 设置分成四个页签，切换不修改配置、不丢草稿或密钥，键盘可导航',async()=>{
  let saved;const s=setup({save:async config=>saved=config});
  try{
    const {panel,section,dom}=s,tabs=[...panel.root.querySelectorAll('[data-ai-section-tab]')];
    assert.deepEqual(tabs.map(t=>t.textContent),['连接与模型','直播感知','知识与搜索','高级设置']);
    assert.ok(section('models'));assert.equal(section('models').hidden,false);
    tabs[1].click();assert.equal(section('models').hidden,true);assert.equal(section('perception').hidden,false);assert.equal(panel.dirty,false);
    tabs[2].click();const knowledge=panel.node('[data-field="ai.knowledge"]');knowledge.value='周六八点开播';knowledge.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    tabs[0].click();panel.node('[data-api-key]').value='draft-secret';tabs[3].click();tabs[0].click();
    assert.equal(knowledge.value,'周六八点开播');assert.equal(panel.node('[data-api-key]').value,'draft-secret');
    tabs[0].focus();tabs[0].dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'End',bubbles:true}));
    assert.equal(panel.root.activeElement,tabs[3]);assert.equal(section('advanced').hidden,false);
    tabs[3].dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(panel.root.activeElement,tabs[0]);
    assert.equal(tabs.filter(t=>t.tabIndex===0).length,1);assert.equal(tabs[0].getAttribute('aria-selected'),'true');
    panel.node('[data-action="save"]').click();await new Promise(setImmediate);assert.equal(saved.ai.knowledge,'周六八点开播');
    assert.ok(!JSON.stringify(saved).includes('draft-secret'));
  }finally{s.close();}
});

test('每个组合只展示使用中的模型，切换组合保留全部已有模型值',()=>{
  const s=setup();try{
    const {panel,change}=s;
    const expected={custom:['ai.model'],text:['ai.model'],'omni-llm':['ai.model','ai.pipeline.realtimeModel'],'omni-only':['ai.pipeline.realtimeModel','ai.pipeline.replyModel'],'ali-split':['ai.model','ai.pipeline.visionModel','ai.pipeline.audioModel']};
    for(const [mode,paths] of Object.entries(expected)){
      change('ai.pipeline.mode',mode);
      const shown=[...panel.root.querySelectorAll('[data-model-select]')].filter(visible).map(n=>n.dataset.modelSelect);
      assert.deepEqual(shown.sort(),paths.sort(),mode);
    }
    change('ai.pipeline.workspaceId','ws-test');
    assert.equal(panel.read().ai.pipeline.realtimeModel,DEFAULTS.ai.pipeline.realtimeModel);
  }finally{s.close();}
});

test('自定义感知仅展开已启用的服务，Omni 联合模式只需一套感知服务；搜索按需展开',()=>{
  const s=setup();try{
    const {panel,change,section}=s;const model=kind=>panel.node(`[data-model-select="ai.media.${kind}Model"]`);
    assert.equal(visible(model('vision')),false);assert.equal(visible(model('audio')),false);
    change('ai.media.videoEnabled',true);assert.equal(visible(model('vision')),true);assert.equal(visible(model('audio')),false);
    change('ai.media.audioEnabled',true);assert.equal(visible(model('audio')),true);
    change('ai.media.omniEnabled',true);assert.equal(visible(model('vision')),true);assert.equal(visible(model('audio')),false);
    panel.node('[data-ai-section-tab="knowledge"]').click();assert.equal(section('knowledge').hidden,false);
    assert.equal(visible(panel.node('[data-search-key]')),false);change('ai.search.enabled',true);assert.equal(visible(panel.node('[data-search-key]')),true);
    assert.ok(panel.node('[data-search-key]').closest('[data-ai-section="knowledge"]'));
    change('ai.search.provider','searxng');assert.equal(panel.node('[data-search-auth]').open,false);
    assert.equal(panel.node('[data-search-endpoint]').open,true);assert.equal(panel.node('[data-search-auth-title]').hidden,false);
    panel.node('[data-search-auth]').open=true;panel.node('[data-search-key]').value='proxy-key';
    panel.node('[data-ai-section-tab="advanced"]').click();panel.node('[data-ai-section-tab="knowledge"]').click();assert.equal(panel.searchCredentials().key,'proxy-key');
  }finally{s.close();}
});

test('额度集中在高级设置且与模型配置分开，隐藏页签的输入错误能定位',()=>{
  const s=setup();try{
    const {panel,section}=s;
    for(const path of ['ai.maxPerHour','ai.contextSize','ai.contextAgeSec','ai.pipeline.contextBudgetChars','ai.pipeline.sessionMinutes','ai.pipeline.sessionTokens','ai.media.videoIntervalSec','ai.media.audioIntervalSec','ai.media.maxPerHour','ai.media.contextAgeSec','ai.search.maxPerHour','ai.search.maxResults']){
      const field=panel.node(`[data-field="${path}"]`);assert.equal(field.closest('[data-ai-section]'),section('advanced'),path);
      assert.equal(panel.root.querySelectorAll(`[data-field="${path}"]`).length,1);
    }
    const field=panel.node('[data-field="ai.maxPerHour"]');field.value='';
    assert.throws(()=>panel.read(),/不能为空/);assert.equal(section('advanced').hidden,false);assert.equal(panel.root.activeElement,field);
    assert.equal(panel.node('[data-ai-section-tab="advanced"]').getAttribute('aria-selected'),'true');
  }finally{s.close();}
});
