import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {mergeConfig,validateConfig} from '../../src/core/engine.js';
import {resolveAITaskConfig} from '../../src/services/ai-task-config.js';

test('导入到统一研究草稿，人物继承推理模型与密钥，配置导出不含凭据；可一键取消旧限额',()=>{
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890',pretendToBeVisual:true});
 for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
 globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
 const panel=new Panel({room:'1',config:mergeConfig({ai:{assistant:{research:{intervalSec:180,maxPerHour:3}}}}),callbacks:{}});
 try{
  panel.node('[data-connection-import]').value='{"base_url":"https://relay.test/v1","model":"best-reasoning","api_key":"fixture-secret","wire_api":"responses","reasoning_effort":"high"}';
  assert.equal(panel.root.querySelector('[data-connection-target]'),null);
  assert.equal(panel.root.querySelector('[data-field="ai.taskModels.profile.enabled"]'),null);
  assert.equal(panel.read().ai.taskModels.research.model,'gpt-6.1-terra');
  const reply=resolveAITaskConfig(panel.read().ai,'reply');
  panel.node('[data-connection-apply]').click();
  const config=panel.read();assert.doesNotThrow(()=>validateConfig(config));
  for(const kind of ['research','profile']){const ai=resolveAITaskConfig(config.ai,kind);assert.equal(ai.endpoint,'https://relay.test/v1/responses');assert.equal(ai.model,'best-reasoning');assert.equal(ai.reasoningEffort,'high');}
  assert.equal(panel.aiSettings.credentials().research.key,'fixture-secret');
  assert.equal(panel.node('[data-connection-import]').value,'');assert.ok(!JSON.stringify(config).includes('fixture-secret'));
  const after=resolveAITaskConfig(config.ai,'reply');
  assert.equal(after.endpoint,reply.endpoint);assert.equal(after.model,reply.model);assert.deepEqual(after.pipeline,reply.pipeline);
  panel.node('[data-research-unlimited]').click();
  for(const value of Object.values(panel.read().ai.assistant.research))if(typeof value==='number')assert.equal(value,0);
  assert.equal(panel.read().ai.search.maxPerHour,0);assert.equal(panel.read().ai.accountCollection.maxPerHour,0);
 }finally{panel.destroy();dom.window.close();}
});
