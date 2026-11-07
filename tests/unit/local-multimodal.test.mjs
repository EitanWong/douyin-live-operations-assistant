import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeConfig} from '../../src/core/engine.js';
import {resolveMediaConfig,validatePipeline} from '../../src/services/ai-pipeline.js';
import {createMediaClient,validateMediaConfig,validateMediaRequest} from '../../src/services/media.js';
import {createSpeechRecognizer} from '../../src/services/speech-routing.js';

test('明确选择本地音画组合才启用中文本地识别，禁止把本地视觉指向云端',()=>{
 const c=mergeConfig({ai:{pipeline:{mode:'local-multimodal'}}});
 assert.doesNotThrow(()=>validatePipeline(c.ai));const media=resolveMediaConfig(c.ai);
 assert.equal(media.localAudio,true);assert.equal(media.localVision,true);assert.equal(media.videoEnabled,true);
 assert.equal(media.visionEndpoint,'http://127.0.0.1:11434/v1/chat/completions');assert.equal(media.visionModel,'qwen2.5vl:3b');
 assert.equal(media.transport,'sampled');assert.doesNotThrow(()=>validateMediaConfig(media,true));
 c.ai.pipeline.localVisionEndpoint='https://example.com/v1/chat/completions';assert.throws(()=>resolveMediaConfig(c.ai),/本机/);
});

test('本地视觉不占云端小时调用数，不读取云端密钥；重复画面节流，语音不受视觉限额干扰',async()=>{
 let now=1800000000000;const requests=[];
 const client=createMediaClient({now:()=>now,getKey:()=>{throw Error('不得读取云端密钥');},request:d=>{requests.push(d);d.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:'蓝色杯子'}}]})});}});
 const media=resolveMediaConfig(mergeConfig({ai:{pipeline:{mode:'local-multimodal'},media:{maxPerHour:1}}}).ai);
 const sample=data=>({kind:'video',data:'data:image/jpeg;base64,'+data,at:now,endedAt:now});
 assert.ok(await client(sample('anBlZw=='),media));now+=1000;assert.equal(await client(sample('anBlZw=='),media),null);
 now+=12000;assert.ok(await client(sample('b3RoZXI='),media));assert.equal(requests.length,2);
 assert.equal(client.usage().cloudCalls,0);assert.equal(client.usage().localCalls,2);
 const recognize=createSpeechRecognizer({cloud:client,edge:{ready:async()=>true,transcribe:async()=> '杯子是蓝色',audioBackend:()=> 'native-sensevoice'},config:()=>({enabled:true,audioEnabled:true}),now:()=>now});
 assert.equal((await recognize({kind:'audio',at:now,endedAt:now},media)).text,'杯子是蓝色');assert.equal(requests.length,2);
});

test('本机视觉关闭模型思考，将原160 token预算用于可检索观察，旧视觉模型仍可返回正文',async()=>{
 const sent=[],client=createMediaClient({getKey:()=>{throw Error('不读取云端密钥');},request:details=>{
  const body=JSON.parse(details.data);sent.push(body);
  const message=body.model==='qwen3.5:4b' && body.reasoning_effort!=='none'
   ? {content:'',reasoning:'受控思考占满预算'} : {content:'深色帽子；下装未入镜。'};
  details.onload({status:200,responseText:JSON.stringify({choices:[{message}]})});
 }});
 for(const model of ['qwen3.5:4b','qwen2.5vl:3b']){
  const media=resolveMediaConfig(mergeConfig({ai:{pipeline:{mode:'local-multimodal',localVisionModel:model}}}).ai);
  const result=await client({kind:'video',data:'data:image/jpeg;base64,/9j/2Q==',at:1000},media);
  assert.equal(result.text,'深色帽子；下装未入镜。');assert.equal(result.model,model);
 }
 assert.equal(sent.length,2);
 for(const body of sent){assert.equal(body.reasoning_effort,'none');assert.equal(body.max_tokens,160);assert.equal(body.stream,false);}
});

test('非思考参数只接受有界视觉或既有Omni契约，不扩展到语音、其他思考等级和任意字段',async()=>{
 const bodies=[],client=createMediaClient({getKey:()=> 'key',request:details=>{bodies.push(JSON.parse(details.data));details.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:'观察'}}]})});}});
 const media=resolveMediaConfig(mergeConfig({ai:{pipeline:{mode:'local-multimodal'}}}).ai);
 await client({kind:'video',data:'data:image/jpeg;base64,/9j/2Q==',at:1000},media);
 const visual={...bodies[0],reasoning_effort:'none'};
 assert.doesNotThrow(()=>validateMediaRequest(visual));
 for(const value of [true,false,'low','high',''])assert.throws(()=>validateMediaRequest({...visual,reasoning_effort:value}));
 assert.throws(()=>validateMediaRequest({...visual,max_tokens:500}));
 assert.throws(()=>validateMediaRequest({...visual,think:false}));
 await client({kind:'video',data:'data:image/jpeg;base64,/9j/2Q==',at:1000},{...media,localVision:false,visionEndpoint:'https://vision.test/v1/chat/completions'});
 assert.equal(bodies[1].reasoning_effort,undefined);assert.equal(bodies[1].max_tokens,500);
 await client({kind:'audio',data:'UklGRiQAAABXQVZF',at:1000},{...media,localAudio:false,audioEndpoint:'https://audio.test/v1/chat/completions',audioModel:'audio-test'});
 assert.throws(()=>validateMediaRequest({...bodies[2],reasoning_effort:'none',max_tokens:160}));
 for(const invalid of [null,undefined,0,''])assert.throws(()=>validateMediaRequest(invalid),/媒体请求无效/);
});

test('非流式媒体截断或过滤结果不成为观察，同帧重试不会被错误节流',async()=>{
 for(const reason of ['length','content_filter','tool_calls',null]){
  let calls=0;
  const client=createMediaClient({getKey:()=>'',request:details=>{calls++;details.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:calls===1 ? reason : 'stop',message:{content:'深色衣袖，未完整描述'}}]})});}});
  const media=resolveMediaConfig(mergeConfig({ai:{pipeline:{mode:'local-multimodal'}}}).ai),sample={kind:'video',data:'data:image/jpeg;base64,/9j/2Q==',at:1000};
  await assert.rejects(client(sample,media),/未完整|截断|过滤/);
  assert.equal((await client(sample,media)).text,'深色衣袖，未完整描述');assert.equal(calls,2);
 }
});

test('单张拼图仍只是一张有时间戳的图片，本机观察在固定输出预算内保持简短',async()=>{
 let body;const client=createMediaClient({getKey:()=>'',request:details=>{body=JSON.parse(details.data);details.onload({status:200,responseText:JSON.stringify({choices:[{finish_reason:'stop',message:{content:'深色帽子；下装未入镜。'}}]})});}});
 const media=resolveMediaConfig(mergeConfig({ai:{pipeline:{mode:'local-multimodal'}}}).ai);
 assert.equal((await client({kind:'video',data:'data:image/jpeg;base64,/9j/2Q==',at:9400},media)).text,'深色帽子；下装未入镜。');
 assert.match(body.messages[1].content[0].text,/1张采样图片/);assert.match(body.messages[1].content[0].text,/拼图.*不代表连续/);
 assert.match(body.messages[1].content[0].text,/9400/);assert.equal(body.messages[1].content.filter(p=>p.type==='image_url').length,1);
 assert.match(body.messages[0].content,/80个汉字/);assert.equal(body.max_tokens,160);
});
