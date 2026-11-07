import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveAITaskConfig,validateTaskModels,taskModelSecret} from '../../src/services/ai-task-config.js';
import {mergeConfig,validateConfig} from '../../src/core/engine.js';
import {validateAgentInput} from '../../src/ai/agent.js';

test('回复、后台研究和人物整理各用自己的模型，感知组合不重写任务路由',()=>{
 const ai=mergeConfig({ai:{pipeline:{mode:'omni-only',workspaceId:'test-space'},taskModels:{research:{enabled:true,endpoint:'https://deep.example/chat/completions',model:'deep'},profile:{enabled:true,endpoint:'https://profile.example/chat/completions',model:'profile'}}}}).ai;
 assert.equal(resolveAITaskConfig(ai,'reply').model,ai.pipeline.replyModel);
 assert.equal(resolveAITaskConfig(ai,'research').model,'deep');
 assert.equal(resolveAITaskConfig(ai,'profile').endpoint,'https://deep.example/chat/completions');
 assert.equal(resolveAITaskConfig(resolveAITaskConfig(ai,'profile'),'reply').model,'deep');
 const input=validateAgentInput({anchor:'10',ai,context:{}});
 assert.equal(input.ai.endpoint,'https://deep.example/chat/completions');
 assert.equal(ai.taskModels.profile,undefined);assert.equal(resolveAITaskConfig(ai,'profile').model,'deep');
 ai.taskModels.research.enabled=false;assert.equal(resolveAITaskConfig(ai,'research').model,ai.pipeline.replyModel);
 const inherited=resolveAITaskConfig(ai,'profile');
 assert.equal(taskModelSecret(inherited,'profile'),'live-assistant:media-key:https://test-space.cn-beijing.maas.aliyuncs.com','Omni 文字投影仍沿用原感知密钥');
});
test('旧配置兼容，启用独立服务时在配置边界拒绝错误地址或空模型',()=>{
 const config=mergeConfig({});assert.doesNotThrow(()=>validateConfig(config));
 assert.deepEqual(validateTaskModels({}),config.ai.taskModels);
 config.ai.taskModels.research={enabled:true,endpoint:'https://deep.example/not-chat',model:'deep'};
 assert.throws(()=>validateConfig(config),/接口|地址/);
 config.ai.taskModels.research.endpoint='https://deep.example/chat/completions';config.ai.taskModels.research.model=' ';
 assert.doesNotThrow(()=>validateConfig(config));
 assert.equal(resolveAITaskConfig(config.ai,'research').model,config.ai.model);
 assert.equal(resolveAITaskConfig(config.ai,'profile').model,config.ai.model);
});
