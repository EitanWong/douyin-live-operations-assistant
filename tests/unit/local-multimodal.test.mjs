import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeConfig} from '../../src/core/engine.js';
import {resolveMediaConfig,validatePipeline} from '../../src/services/ai-pipeline.js';
import {createMediaClient,validateMediaConfig} from '../../src/services/media.js';
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
