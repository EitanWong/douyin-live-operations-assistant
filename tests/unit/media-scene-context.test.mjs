import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMediaClient,MEDIA_DEFAULTS,MediaEvidence} from '../../src/services/media.js';
const image='data:image/jpeg;base64,/9j/2Q==';
test('独立视觉可按时间顺序分析最多三帧，保留覆盖范围且不把图片放入文本上下文',async()=>{
 let sent;const client=createMediaClient({getKey:()=> 'key',now:()=>4000,request:d=>{sent=JSON.parse(d.data);d.onload({status:200,responseText:'{"choices":[{"message":{"content":"主播先拿起杯子，随后展示杯口。"}}]}'});}});
 const result=await client({kind:'video',data:image,at:1000,endedAt:3000,frames:[{data:image,at:1000},{data:'data:image/jpeg;base64,/9j/2g==',at:2000},{data:'data:image/jpeg;base64,/9j/2w==',at:3000}]},{...MEDIA_DEFAULTS,videoEnabled:true,visionModel:'qwen-vl-plus'});
 assert.equal(sent.messages[1].content.filter(p=>p.type==='image_url').length,3);assert.equal(result.frameCount,3);
 const evidence=new MediaEvidence({now:()=>4000});evidence.add(result);const context=evidence.context(30);assert.equal(context.scene.visual.frameCount,3);assert.match(context.scene.visual.text,/展示杯口/);assert.ok(!JSON.stringify(context).includes('base64'));
});
test('当前现场区分语音、画面和音画观察，过期后不残留当前活动',()=>{
 let now=5000;const evidence=new MediaEvidence({now:()=>now});evidence.add({kind:'audio',at:1000,endedAt:3000,text:'我在介绍茶具',isFinal:true});evidence.add({kind:'video',at:2000,endedAt:3000,text:'手中有杯子',isFinal:true});
 assert.equal(evidence.context(15).scene.speech.text,'我在介绍茶具');assert.equal(evidence.context(15).scene.visual.text,'手中有杯子');now=30000;assert.equal(evidence.context(15).scene.visual,null);assert.equal(evidence.context(15).scene.speech,null);
});
