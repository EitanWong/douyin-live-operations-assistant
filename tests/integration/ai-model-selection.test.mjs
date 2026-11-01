import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {copy,DEFAULTS} from '../../src/core/engine.js';

function setup(config=copy(DEFAULTS),callbacks={}){
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890',pretendToBeVisual:true});
  for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  const panel=new Panel({room:'1',config,callbacks});
  const choose=(path,value)=>{const select=panel.node(`[data-model-select="${path}"]`);assert.ok(select,`缺少 ${path} 的模型菜单`);select.value=value;select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
  return {dom,panel,choose,close:()=>{panel.destroy();dom.window.close();}};
}

test('AI 所有模型均提供菜单，组合默认已选推荐模型，选择后保存实际模型 ID',async()=>{
  let saved;const s=setup(undefined,{save:async config=>saved=config});
  try{
    const {panel,choose}=s;
    assert.equal(panel.root.querySelectorAll('[data-model-select]').length,7);
    for(const key of ['realtimeModel','replyModel','visionModel','audioModel']){
      const path=`ai.pipeline.${key}`,select=panel.node(`[data-model-select="${path}"]`);
      assert.equal(select.value,DEFAULTS.ai.pipeline[key]);assert.match(select.selectedOptions[0].textContent,/推荐/);
      assert.equal(panel.node(`[data-model-picker="${path}"] [data-model-custom]`).hidden,true);
    }
    choose('ai.pipeline.realtimeModel','qwen3.5-omni-flash-realtime');
    choose('ai.pipeline.replyModel','qwen3.5-omni-flash');
    choose('ai.pipeline.visionModel','qwen3-vl-flash');
    choose('ai.media.visionModel','qwen3-vl-plus');choose('ai.media.audioModel','qwen3-asr-flash');
    assert.equal(panel.dirty,true);panel.node('[data-action="save"]').click();await new Promise(setImmediate);
    assert.equal(saved.ai.pipeline.realtimeModel,'qwen3.5-omni-flash-realtime');
    assert.equal(saved.ai.pipeline.replyModel,'qwen3.5-omni-flash');assert.equal(saved.ai.pipeline.visionModel,'qwen3-vl-flash');
    assert.equal(saved.ai.media.visionModel,'qwen3-vl-plus');assert.equal(saved.ai.media.audioModel,'qwen3-asr-flash');
  }finally{s.close();}
});

test('文字服务切换同步菜单和默认模型；自定义与旧模型回显不丢失',()=>{
  const config=copy(DEFAULTS);config.ai.pipeline.realtimeModel='my-realtime-v2';config.ai.media.audioModel='tenant-audio';
  const s=setup(config);
  try{
    const {panel,choose,dom}=s,model=path=>panel.node(`[data-field="${path}"]`),select=path=>panel.node(`[data-model-select="${path}"]`);
    assert.equal(select('ai.model')?.value,DEFAULTS.ai.model);
    assert.equal(select('ai.pipeline.realtimeModel').value,':custom:');assert.equal(model('ai.pipeline.realtimeModel').value,'my-realtime-v2');
    assert.equal(select('ai.media.audioModel').value,':custom:');assert.equal(panel.read().ai.media.audioModel,'tenant-audio');
    const provider=panel.node('[data-preset]');provider.value='qwen';provider.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.equal(select('ai.model').value,'qwen-plus');assert.ok([...select('ai.model').options].some(o=>o.value==='qwen-turbo'));
    assert.ok(![...select('ai.model').options].some(o=>o.value==='deepseek-flash'));
    choose('ai.model','qwen-turbo');assert.equal(panel.read().ai.model,'qwen-turbo');
    choose('ai.model',':custom:');const custom=panel.node('[data-model-picker="ai.model"] [data-model-custom]');assert.equal(custom.hidden,false);
    model('ai.model').value='tenant-model-v9';model('ai.model').dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    const saved=panel.read();panel.populate(saved);assert.equal(select('ai.model').value,':custom:');assert.equal(custom.hidden,false);assert.equal(model('ai.model').value,'tenant-model-v9');
    panel.populate(copy(DEFAULTS));assert.equal(select('ai.model').value,'deepseek-flash');assert.equal(custom.hidden,true);
    provider.value='local';provider.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(select('ai.model').value,'qwen2.5:7b');
    choose('ai.model',':custom:');model('ai.model').value='local/model:latest';assert.equal(panel.read().ai.model,'local/model:latest');
  }finally{s.close();}
});

test('实时与非实时选项分开，空的自定义媒体不被自动写入其他服务模型',()=>{
  const s=setup();try{
    const {panel,choose}=s;
    assert.equal(panel.read().ai.media.visionModel,'');assert.equal(panel.read().ai.media.audioModel,'');
    const realtime=panel.node('[data-model-select="ai.pipeline.realtimeModel"]');assert.ok(realtime);
    assert.ok([...realtime.options].filter(o=>o.value && o.value!==':custom:').every(o=>o.value.endsWith('-realtime')));
    const reply=panel.node('[data-model-select="ai.pipeline.replyModel"]');assert.ok([...reply.options].every(o=>!o.value.endsWith('-realtime')));
    choose('ai.pipeline.realtimeModel',':custom:');const field=panel.node('[data-field="ai.pipeline.realtimeModel"]');field.value='invalid model';
    assert.throws(()=>panel.read(),/模型名称无效/);
  }finally{s.close();}
});
