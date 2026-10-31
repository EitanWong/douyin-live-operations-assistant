import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {copy,DEFAULTS} from '../../src/core/engine.js';

function setup(){
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890',pretendToBeVisual:true});
  for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};return dom;
}
test('用户添加背景、来源与到期时间，保存后刷新仍能编辑和删除；旧知识保留',async()=>{
  const dom=setup();let saved;
  let panel=new Panel({room:'1',config:copy(DEFAULTS),callbacks:{save:async c=>{saved=c;}}});
  try {
    panel.tab('ai');panel.node('[data-memory-add]').click();
    const input=name=>panel.node(`[data-memory-field="${name}"]`);
    input('title').value='开播安排';input('content').value='主播每周六晚上八点开播';input('source').value='主播11月1日确认';input('expiresOn').value='2026-12-01';
    input('content').dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    assert.equal(panel.dirty,true);assert.deepEqual(panel.config.ai.memory.entries,[]);
    panel.node('[data-action=save]').click();await new Promise(setImmediate);
    assert.equal(saved.ai.memory.entries[0].content,'主播每周六晚上八点开播');
    assert.equal(saved.ai.memory.entries[0].expiresOn,'2026-12-01');assert.equal(saved.ai.knowledge,'');
    panel.destroy();panel=new Panel({room:'1',config:saved,callbacks:{}});
    assert.equal(panel.node('[data-memory-field="content"]').value,'主播每周六晚上八点开播');
    panel.node('[data-memory-field="content"]').dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.equal(panel.dirty,true);
    panel.node('[data-memory-remove]').click();assert.equal(panel.read().ai.memory.entries.length,0);
    assert.equal(panel.node('[data-memory-empty]').hidden,false);
  } finally {panel.destroy();dom.window.close();}
});

test('媒体开始按钮同步调用采集回调，设置、密钥分离，状态和识别内容安全展示',async()=>{
  const dom=setup();let called=false,captured;
  const panel=new Panel({room:'1',config:copy(DEFAULTS),callbacks:{startMedia:(config,credentials)=>{called=true;captured={config,credentials};},stopMedia:()=>panel.aiSettings.state({state:'idle'})}});
  try {
    panel.node('[data-field="ai.media.videoEnabled"]').checked=true;panel.node('[data-field="ai.media.visionModel"]').value='vision';panel.node('[data-media-key="vision"]').value='secret';
    panel.node('[data-media-start]').click();assert.equal(called,true,'用户点击内同步发起选屏');
    assert.equal(captured.config.ai.media.visionModel,'vision');assert.equal(captured.credentials.vision.key,'secret');assert.ok(!JSON.stringify(captured.config).includes('secret'));
    panel.aiSettings.state({state:'running',skipped:2});assert.equal(panel.node('[data-media-start]').disabled,true);assert.equal(panel.node('[data-media-stop]').disabled,false);
    panel.aiSettings.observations([{kind:'audio',at:1,text:'<img src=x onerror=alert(1)>'}]);assert.equal(panel.node('[data-media-results]').querySelector('img'),null);
    panel.node('[data-media-stop]').click();assert.equal(panel.node('[data-media-start]').disabled,false);
    assert.ok(panel.node('[data-page=ai]').textContent.includes('官方条款摘要'));assert.ok(panel.node('[data-page=ai]').textContent.includes('助手事实边界'));
  } finally {panel.destroy();dom.window.close();}
});

test('联网搜索配置切换服务、保存独立密钥，来源链接可核对且不执行HTML',async()=>{
  const dom=setup();let saved;
  const panel=new Panel({config:copy(DEFAULTS),room:'1',callbacks:{save:async(...args)=>{saved=args;}}});
  try {
    const provider=panel.node('[data-field="ai.search.provider"]');
    assert.equal(provider.value,'bocha');
    panel.node('[data-search-key]').value='bocha-unsaved';provider.value='tavily';provider.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.equal(panel.node('[data-search-key]').value,'');assert.equal(panel.node('[data-field="ai.search.endpoint"]').value,'https://api.tavily.com/search');
    panel.node('[data-field="ai.search.enabled"]').checked=true;panel.node('[data-search-key]').value='search-secret';panel.node('[data-remember-search-key]').checked=true;
    panel.node('[data-action="save"]').click();await new Promise(setImmediate);
    assert.equal(saved[0].ai.search.provider,'tavily');assert.deepEqual(saved[3],{key:'search-secret',remember:true});assert.ok(!JSON.stringify(saved[0]).includes('search-secret'));
    panel.recordSearch({question:'上海天气',answer:'晴。[1]',results:[{title:'<img src=x onerror=alert(1)>',url:'https://weather.test/"x'},{title:'恶意',url:'javascript:alert(1)'}]});
    assert.equal(panel.node('[data-search-history]').querySelectorAll('a').length,1);assert.equal(panel.node('[data-search-history]').querySelector('img'),null);
    assert.equal(panel.node('[data-search-history] a').rel,'noopener noreferrer');
    for(let i=0;i<10;i++)panel.recordSearch({query:`q${i}`,results:[]});
    assert.equal(panel.searchRecords.length,8);
  } finally {panel.destroy();dom.window.close();}
});
