import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {benchmarkChineseASR,audioInferenceOptions} from '../../src/ai/asr-performance.js';
import {decodePCM16} from '../../src/ai/edge-prompt.js';

test('浏览器测速必须转写真中文、多轮预热后计时，空白/错字不能取得ready',async()=>{
 const wav=await readFile(new URL('../../vendor/runtime-fixtures/asr-benchmark-zh.wav',import.meta.url));
 const samples=decodePCM16(wav.toString('base64'));assert.ok(samples.length>16000);
 let clock=0,calls=0;
 const infer=async(pcm,options)=>{assert.equal(pcm,samples);assert.equal(options.language,'chinese');calls++;clock+=100;return {text:'桌上有个蓝色的杯子。'};};
 const result=await benchmarkChineseASR(infer,samples,()=>clock);
 assert.equal(result.phase,'ready');assert.equal(result.selfTestPassed,true);assert.equal(calls,4);assert.equal(result.elapsedMs,100);
 assert.equal((await benchmarkChineseASR(async()=>({text:'今天天气很好'}),samples,()=>clock)).phase,'error');
 assert.ok(audioInferenceOptions(new Float32Array(8000)).max_new_tokens<100);
});
