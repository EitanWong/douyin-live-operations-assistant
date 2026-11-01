import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeConfig,validateConfig} from '../../src/core/engine.js';
import {resolveMediaConfig,resolveReplyConfig,validateRealtimeEndpoint} from '../../src/services/ai-pipeline.js';
import {makeAIRequest,createAIClient} from '../../src/services/ai.js';

test('组合预设派生阿里接口，保留原有文字模型并兼容旧配置',()=>{
  const c=mergeConfig();assert.equal(c.ai.pipeline.mode,'custom');
  c.ai.pipeline.mode='omni-llm';c.ai.pipeline.workspaceId='ws-example';
  const media=resolveMediaConfig(c.ai);assert.equal(media.transport,'webrtc');assert.equal(media.audioEnabled,true);assert.equal(media.videoEnabled,true);
  assert.equal(new URL(media.realtimeEndpoint).hostname,'ws-example.cn-beijing.maas.aliyuncs.com');assert.equal(resolveReplyConfig(c.ai).model,c.ai.model);
  c.ai.pipeline.mode='omni-only';const reply=resolveReplyConfig(c.ai);
  assert.equal(reply.model,'qwen3.8-omni-flash');assert.equal(new URL(reply.endpoint).pathname,'/compatible-mode/v1/chat/completions');assert.equal(c.ai.model,'deepseek-flash');
  c.ai.pipeline.mode='ali-split';assert.equal(resolveMediaConfig(c.ai).transport,'sampled');
  c.ai.pipeline.mode='text';assert.equal(resolveMediaConfig(c.ai).videoEnabled,false);
});
test('配置入口拒绝非法地域、业务空间与实时接口，不放宽文字接口',()=>{
  const c=mergeConfig();c.ai.pipeline.mode='omni-only';c.ai.pipeline.workspaceId='../../evil';assert.throws(()=>validateConfig(c),/业务空间/u);
  for(const url of ['https://evil.com/api/v1/webrtc/realtime?model=qwen3.8-omni-flash-realtime','https://ws.cn-beijing.maas.aliyuncs.com/api/v1/webrtc/realtime?model=x&key=secret'])assert.throws(()=>validateRealtimeEndpoint(url));
});
test('Omni 回复统一使用文本 SSE，实际调用保持流式格式并支持所有 AI 任务',async()=>{
  const c=mergeConfig();c.ai.pipeline.mode='omni-only';c.ai.pipeline.workspaceId='ws-example';let sent;
  const client=createAIClient({getKey:()=> 'key',request:d=>{sent=d;d.onload({status:200,responseText:'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'});}});
  assert.equal(await client({context:[],maxLength:30,task:{kind:'welcome'}},c.ai),'你好');
  const body=JSON.parse(sent.data);assert.equal(body.model,'qwen3.8-omni-flash');assert.equal(body.stream,true);assert.deepEqual(body.modalities,['text']);assert.equal(body.reasoning_effort,'none');
  for(const kind of ['moderation','pk','phrase-library'])assert.equal(makeAIRequest({context:[],task:{kind},maxLength:30},c.ai).stream,true);
});

test('阿里独立语音识别使用官方 ASR 消息格式，不附加通用生成参数',async()=>{
  const {createMediaClient,validateMediaRequest}=await import('../../src/services/media.js');
  const c=mergeConfig();c.ai.pipeline.mode='ali-split';c.ai.pipeline.workspaceId='ws-example';let sent;
  const recognize=createMediaClient({getKey:()=> 'key',request:d=>{sent=JSON.parse(d.data);d.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:'欢迎来到直播间'}}]})});}});
  assert.equal((await recognize({kind:'audio',data:'UklGRiQAAABXQVZF',at:Date.now()},resolveMediaConfig(c.ai))).text,'欢迎来到直播间');
  assert.equal(sent.messages.length,1);assert.equal(sent.messages[0].content[0].input_audio.data,'data:audio/wav;base64,UklGRiQAAABXQVZF');assert.equal(sent.max_tokens,undefined);assert.doesNotThrow(()=>validateMediaRequest(sent));
});
