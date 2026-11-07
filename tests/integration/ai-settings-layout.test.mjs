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

test('后台研究和人物整理可独立配置，切换保留草稿与独立密钥，停用时不删除已填内容',()=>{
 const s=setup();try{
  const {panel,change,section,dom}=s;
  for(const kind of ['research','profile']){
   const path=`ai.taskModels.${kind}`;
   assert.equal(panel.node(`[data-field="${path}.enabled"]`).closest('[data-ai-section]'),section('models'));
   change(`${path}.enabled`,true);change(`${path}.endpoint`,`https://${kind}.example/chat/completions`);change(`${path}.model`,kind);
   panel.node(`[data-media-key="${kind}"]`).value=`${kind}-private`;
  }
  panel.aiSettings.showSection('audience');change('ai.assistant.research.profileEnabled',true);panel.aiSettings.showSection('models');
  assert.equal(panel.aiSettings.credentials().research.key,'research-private');
  assert.equal(panel.read().ai.taskModels.profile.model,'profile');
  change('ai.taskModels.research.enabled',false);assert.equal(panel.read().ai.taskModels.research.model,'research');
  const endpoint=panel.node('[data-field="ai.taskModels.profile.endpoint"]');endpoint.value='https://new.example/chat/completions';endpoint.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(panel.aiSettings.credentials().profile.key,'');
 }finally{s.close();}
});

test('AI 设置按用途归类，切换不修改配置、不丢草稿或密钥，键盘可导航',async()=>{
  let saved;const s=setup({save:async config=>saved=config});
  try{
    const {panel,section,dom}=s,tabs=[...panel.root.querySelectorAll('[data-ai-section-tab]')];
    assert.deepEqual(tabs.map(t=>t.textContent),['连接与模型','直播感知','知识与搜索','观众与研究','问答测试','本地与性能','高级设置']);
    assert.ok(section('models'));assert.equal(section('models').hidden,false);
    const connection=panel.node('[data-action="test-ai"]').closest('.ai-card');
    assert.equal(connection,panel.node('[data-field="ai.pipeline.mode"]').closest('.ai-card'),'连接检查归到组合配置，不独占一张短卡片');
    assert.equal(connection,panel.node('[data-reply-slider]').closest('.ai-card'),'发言节奏和组合配置合并');
    assert.ok(panel.node('[data-field="ai.media.videoEnabled"]').closest('details'),'自定义感知开关按需展开');
    assert.ok(panel.node('[data-media-start]').closest('.workspace-wide'),'长直播采集配置独占一行');
    tabs[1].click();assert.equal(section('models').hidden,true);assert.equal(section('perception').hidden,false);assert.equal(panel.dirty,false);
    tabs[2].click();const knowledge=panel.node('[data-field="ai.knowledge"]');knowledge.value='周六八点开播';knowledge.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    tabs[0].click();panel.node('[data-api-key]').value='draft-secret';tabs.at(-1).click();tabs[0].click();
    assert.equal(knowledge.value,'周六八点开播');assert.equal(panel.node('[data-api-key]').value,'draft-secret');
    tabs[0].focus();tabs[0].dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'End',bubbles:true}));
    assert.equal(panel.root.activeElement,tabs.at(-1));assert.equal(section('advanced').hidden,false);
    tabs.at(-1).dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));assert.equal(panel.root.activeElement,tabs[0]);
    assert.equal(tabs.filter(t=>t.tabIndex===0).length,1);assert.equal(tabs[0].getAttribute('aria-selected'),'true');
    panel.node('[data-action="save"]').click();await new Promise(setImmediate);assert.equal(saved.ai.knowledge,'周六八点开播');
    assert.ok(!JSON.stringify(saved).includes('draft-secret'));
  }finally{s.close();}
});
test('本地模型与观众研究从连接页和知识页独立归组，字段仍唯一且错误能定位',()=>{
 const s=setup();try{
  const {panel,section}=s;
  for(const path of ['ai.edge.enabled','ai.edge.textModel','ai.latency.cloudMs'])assert.equal(panel.node(`[data-field="${path}"]`).closest('[data-ai-section]'),section('local'));
  assert.equal(panel.root.querySelectorAll('[data-edge-auto]').length,1);
  assert.equal(panel.node('[data-edge-auto]').closest('[data-ai-section]'),section('local'));
  assert.equal(panel.node('[data-setup-kind="text"]').closest('[data-ai-section]'),section('local'));
  assert.equal(visible(panel.node('[data-edge-auto]')),false);
  panel.node('[data-ai-section-tab="local"]').click();assert.equal(visible(panel.node('[data-edge-auto]')),true);
  for(const path of ['ai.assistant.memoryEnabled','ai.accountCollection.enabled'])assert.equal(panel.node(`[data-field="${path}"]`).closest('[data-ai-section]'),section('audience'));
  assert.ok(panel.node('[data-agent-question]').closest('[data-ai-section="audience"]'));
  const field=panel.node('[data-field="ai.latency.cloudMs"]');field.value='';assert.throws(()=>panel.read(),/不能为空/);assert.equal(section('local').hidden,false);assert.equal(panel.root.activeElement,field);
  assert.equal(panel.root.querySelectorAll('[data-field="ai.edge.textModel"]').length,1);
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

test('本地 AI 总开关独立于云端，关闭后解除仅本地并保留模型选择',()=>{
 const s=setup();try{
  const {panel,change}=s;change('ai.pipeline.mode','omni-llm');change('ai.pipeline.workspaceId','workspace');
  change('ai.edge.textModel','qwen-0.5b');change('ai.edge.localOnly',true);change('ai.edge.enabled',false);
  const config=panel.read();assert.equal(config.ai.edge.localOnly,false);assert.equal(config.ai.edge.enabled,false);
  assert.equal(config.ai.pipeline.mode,'omni-llm');assert.equal(config.ai.edge.textModel,'qwen-0.5b');
  assert.equal(panel.node('[data-text-service]').hidden,false);assert.equal(panel.node('[data-field="ai.edge.localOnly"]').disabled,true);
  change('ai.edge.enabled',true);assert.equal(panel.read().ai.edge.localOnly,false);
  assert.equal(panel.node('[data-field="ai.edge.localOnly"]').disabled,false);
 }finally{s.close();}
});
