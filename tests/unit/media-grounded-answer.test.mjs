import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAIClient,makeAIRequest} from '../../src/services/ai.js';
import {mergeConfig} from '../../src/core/engine.js';
import {makeEdgeMessages} from '../../src/ai/edge-prompt.js';
const now=1800000000000;
test('本地回复同样收到语音依据与修订要求，缺少音频时不宣称听见',()=>{
 const prompt={now,maxLength:50,mediaCorrection:true,mediaContext:{observations:[{id:'voice',kind:'audio',at:now-1000,endedAt:now,text:'今天跟爷爷学做茶杯'}]}};
 const messages=makeEdgeMessages(prompt,mergeConfig().ai);
 assert.match(messages[0].content,/音频|语音转写/u);assert.match(messages[0].content,/修订|上次回答/u);
 assert.equal(JSON.parse(messages[1].content).media_context.availability.audio,'available');
});
test('已有有效音画却笼统否认感知能力时只修订一次，结合具体证据回答',async()=>{
 for(const kind of ['video','audio']){
  let calls=0,reserved=0;
  const prompt={now,target:{text:kind==='video' ? '手里是什么' : '刚才主播说了什么'},task:{kind:'ai'},maxLength:50,mediaContext:{observations:[{id:kind,kind,at:now-1000,endedAt:now,text:kind==='video' ? '手里是蓝色茶杯' : '今天跟爷爷学做茶杯'}]},reserveFollowup:()=>{reserved++;return true;}};
  const client=createAIClient({generate:async p=>{calls++;return JSON.stringify({intent:'chat',query:'',reply:p.mediaCorrection ? '刚才在聊蓝色茶杯。' : kind==='video' ? '我无法识别直播画面。' : '我无法识别音频和声音。'});}});
  assert.equal(await client(prompt,mergeConfig().ai),'刚才在聊蓝色茶杯。');assert.equal(calls,2);assert.equal(reserved,1);
  const input=JSON.parse(makeAIRequest(prompt,mergeConfig().ai).messages[1].content);assert.equal(input.media_context.availability[kind==='video' ? 'visual' : 'audio'],'available');
 }
});
test('旧证据不能用来强迫回答；重复否认不发送，修订遵守调用额度',async()=>{
 let calls=0;const client=createAIClient({generate:async()=>{calls++;return '{"intent":"chat","query":"","reply":"我无法识别直播画面。"}';}});
 const prompt={now,target:{text:'现在拿着什么'},task:{kind:'ai'},maxLength:50,mediaContext:{observations:[{kind:'video',at:now-1000,endedAt:now,text:'蓝杯子'}]},reserveFollowup:()=>true};
 await assert.rejects(client(prompt,mergeConfig().ai),/音画|画面/);assert.equal(calls,2);
 await assert.rejects(client({...prompt,reserveFollowup:()=>false},mergeConfig().ai),/音画|画面/);assert.equal(calls,3);
 const stale={...prompt,mediaContext:{observations:[{kind:'video',at:now-120000,endedAt:now-120000,text:'旧杯子'}]}};
 assert.match(await client(stale,mergeConfig().ai),/无法/);assert.equal(calls,4);
});
