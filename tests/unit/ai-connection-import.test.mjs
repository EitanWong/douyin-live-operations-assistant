import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAIConnection} from '../../src/services/ai-connection-import.js';

test('导入 SDK JSON 与环境变量，完整地址决定协议且凭据单独返回',()=>{
 assert.deepEqual(parseAIConnection('{"base_url":"https://relay.test/v1","model":"best-model","api_key":"test-key","wire_api":"responses","reasoning_effort":"high"}'),{endpoint:'https://relay.test/v1/responses',model:'best-model',key:'test-key',reasoningEffort:'high'});
 const value=parseAIConnection('OPENAI_BASE_URL="https://kimi.test/v1"\nOPENAI_MODEL="kimi-reasoning"\nexport OPENAI_API_KEY=test-key');
 assert.equal(value.endpoint,'https://kimi.test/v1/chat/completions');assert.equal(value.model,'kimi-reasoning');
 assert.equal(parseAIConnection('{"endpoint":"https://relay.test/v1/responses","model":"claude-via-gateway"}').endpoint,'https://relay.test/v1/responses');
 assert.equal(parseAIConnection('{"env":{"OPENAI_BASE_URL":"https://relay.test/v1","OPENAI_MODEL":"model"}}').model,'model');
});

test('无效导入拒绝缺少模型、远程明文地址和包含凭据的URL',()=>{
 for(const value of [{base_url:'https://relay.test/v1'},{base_url:'http://remote.test/v1',model:'x'},{base_url:'https://user:secret@relay.test/v1',model:'x'},{base_url:'https://relay.test/v1?token=secret',model:'x'}])assert.throws(()=>parseAIConnection(JSON.stringify(value)));
});
