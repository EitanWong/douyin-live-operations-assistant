import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MediaEvidence,MEDIA_DEFAULTS,createMediaClient,validateMediaRequest} from '../../src/services/media.js';
import {makeAIRequest} from '../../src/services/ai.js';
import {mergeConfig} from '../../src/core/engine.js';
import {createDisplayCapture} from '../../src/browser/live-media.js';
const now=1800000000000,config=mergeConfig();
const image=i=>`data:image/jpeg;base64,${Buffer.from('jpeg'+i).toString('base64')}`;
const row=(kind,id,text,age=0)=>({kind,id,text,at:now-age-1000,endedAt:now-age,receivedAt:now,isFinal:true,inputSource:'native',transport:'websocket'});
const payload=(media,ai=config.ai)=>JSON.parse(makeAIRequest({now,context:[{text:'弹幕里的问题'}],target:{type:'chat',text:'主播刚才说什么，手里是什么？'},task:{kind:'ai'},mediaContext:media,maxLength:50},ai).messages[1].content);
test('回复上下文只序列化一次音画原文，scene和moment按ID引用，不更改原始观察',()=>{
 const store=new MediaEvidence({now:()=>now});store.add(row('audio','a','刚才的原话独一份'));store.add(row('omni','v','手里是蓝色茶杯独一份'));
 const raw=store.context(60),before=JSON.stringify(raw),input=payload(raw),text=JSON.stringify(input);
 assert.equal(text.split('刚才的原话独一份').length-1,1);assert.equal(text.split('手里是蓝色茶杯独一份').length-1,1);
 assert.equal(input.media_context.scene.speechId,'a');assert.equal(input.media_context.moment.visualId,'v');assert.equal(JSON.stringify(raw),before);
 assert.equal('frameCount' in input.media_context.observations.find(r=>r.kind==='omni'),false);
 assert.equal(input.recent_chat[0].text,'弹幕里的问题');assert.equal(input.target.text,'主播刚才说什么，手里是什么？');
});
test('连续相同视觉描述压缩但保留最新采样时间，实际重复说话和场景往返不被合并',()=>{
 const store=new MediaEvidence({now:()=>now});
 for(const r of [row('video','v1','桌上有杯子',4000),row('audio','a1','好看',3000),row('video','v2','桌上有杯子',2000),row('audio','a2','好看',1000)])store.add(r);
 const input=payload(store.context(60));assert.equal(input.media_context.observations.filter(r=>r.kind==='video').length,1);assert.equal(input.media_context.observations.filter(r=>r.kind==='audio').length,2);
 const visual=input.media_context.observations.find(r=>r.kind==='video');assert.equal(visual.id,'v2');assert.equal(visual.at,now-3000);assert.equal(input.media_context.compaction.repeatedVisuals,1);
 store.add(row('video','v3','主播拿起了盘子',500));store.add(row('video','v4','桌上有杯子'));
 assert.equal(payload(store.context(60)).media_context.observations.filter(r=>r.kind==='video').length,3);
});
test('高频音频不挤掉仍有效的画面，预算缩减优先移除旧片段，最新音画ID不悬空',()=>{
 const store=new MediaEvidence({now:()=>now});store.add(row('video','visible','刚展示红色茶杯',14000));
 for(let i=0;i<80;i++)store.add(row('audio','a'+i,`第${i}段原话`+'细节'.repeat(600),14000-i*100));
 const input=payload(store.context(60),{...config.ai,pipeline:{...config.ai.pipeline,contextBudgetChars:16000}}),ids=new Set(input.media_context.observations.map(r=>r.id));
 assert.equal(store.context(60).observations.length,48);assert.ok(input.media_context.observations.length<48);assert.ok(ids.has('visible'));assert.ok(ids.has('a79'));assert.ok(ids.has(input.media_context.moment.speechId));assert.ok(ids.has(input.media_context.moment.visualId));assert.ok(input.context_meta.budget.omissions.length);
});
test('过期与未完成音画不作为当前上下文，实时配置仍默认自动采集且不启动未经选择的来源',()=>{
 const store=new MediaEvidence({now:()=>now});store.add(row('audio','old','已经过期',61000));store.add({...row('video','partial','未完成'),isFinal:false});
 assert.equal(payload(store.context(60)).media_context.observations.length,0);
 assert.equal(config.ai.media.autoStart,true);assert.equal(config.ai.media.videoEnabled,false);
});
test('分段Omni在同一次请求传入最多3个时间有序画面，静态相同帧只传一次',async()=>{
 const sent=[],client=createMediaClient({getKey:()=> 'key',now:()=>now,request:d=>{sent.push(JSON.parse(d.data));d.onload({status:200,responseText:'data: {"choices":[{"delta":{"content":"画面茶杯由蓝变绿，语音：绿色怎么样？"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'});}});
 const settings={...MEDIA_DEFAULTS,videoEnabled:true,audioEnabled:true,omniEnabled:true,visionModel:'qwen3.8-omni-flash'};
 const sample={kind:'omni',image:image(3),data:'UklGRiQAAABXQVZF',at:now-8000,endedAt:now,frames:[{data:image(1),at:now-8000},{data:image(2),at:now-4000},{data:image(3),at:now}]};
 const result=await client(sample,settings);assert.equal(sent.length,1);assert.equal(sent[0].messages[1].content.filter(p=>p.type==='image_url').length,3);assert.equal(result.frameCount,3);
 assert.match(sent[0].messages[0].content,/颜色|物品/);assert.match(sent[0].messages[0].content,/原话/);assert.match(sent[0].messages[1].content[0].text,/时间/);
 await client({...sample,frames:sample.frames.map(f=>({...f,data:image(1)}))},settings);assert.equal(sent[1].messages[1].content.filter(p=>p.type==='image_url').length,1);
 const invalid=structuredClone(sent[0]);invalid.messages[1].content.splice(1,0,{type:'image_url',image_url:{url:image(4)}});assert.throws(()=>validateMediaRequest(invalid));
});
test('真实分段采集保留开头中间结束的变化画面，停止释放采集，不新增录音请求',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now});
 let recorder,current=1,resolve,stops=0,recordings=0;const sample=new Promise(r=>resolve=r),track={stop(){stops++;},addEventListener(){}};
 const stream={getTracks:()=>[track],getAudioTracks:()=>[track]},video={readyState:2,videoWidth:640,videoHeight:360,play:async()=>{},pause(){}};
 const env={navigator:{mediaDevices:{getDisplayMedia:async()=>stream}},document:{createElement:name=>name==='video' ? video : {getContext:()=>({drawImage(){}}),toDataURL:()=>image(current)}},
 MediaStream:class{},MediaRecorder:class{constructor(){recordings++;recorder=this;this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.onstop();}},
 AudioContext:class{async decodeAudioData(){return {duration:1};}async close(){}},OfflineAudioContext:class{createBufferSource(){return {connect(){},start(){}};}async startRendering(){return {getChannelData:()=>new Float32Array(16000)};}}};
 const capture=await createDisplayCapture({config:{...MEDIA_DEFAULTS,videoEnabled:true,audioEnabled:true,omniEnabled:true},onSample:resolve,onEnded(){},onError:assert.fail},env);
 try{current=2;t.mock.timers.tick(4000);current=3;recorder.stop();const result=await sample;assert.deepEqual(result.frames.map(f=>f.data),[image(1),image(2),image(3)]);assert.ok(result.frames.every(f=>f.at>=result.at && f.at<=result.endedAt));assert.equal(recordings,2);}finally{capture.stop();}assert.equal(stops,1);
});

test('独立音频分段不会清除独立视觉的定时采样或画面缓存',async t=>{
 t.mock.timers.enable({apis:['Date','setTimeout','setInterval'],now});
 const samples=[],track={stop(){},addEventListener(){}},stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
 const video={readyState:2,videoWidth:640,videoHeight:360,play:async()=>{},pause(){}};
 const env={navigator:{mediaDevices:{getDisplayMedia:async()=>stream}},document:{createElement:name=>name==='video' ? video : {getContext:()=>({drawImage(){}}),toDataURL:()=>image(Date.now())}},
 MediaStream:class{},MediaRecorder:class{constructor(){this.state='inactive';}start(){this.state='recording';}stop(){this.state='inactive';this.onstop();}},
 AudioContext:class{async decodeAudioData(){return {duration:1};}async close(){}},OfflineAudioContext:class{createBufferSource(){return {connect(){},start(){}};}async startRendering(){return {getChannelData:()=>new Float32Array(16000).fill(.1)};}}};
 const capture=await createDisplayCapture({config:{...MEDIA_DEFAULTS,videoEnabled:true,audioEnabled:true},onSample:s=>samples.push(s),onEnded(){},onError:assert.fail},env);
 try{for(let i=0;i<6;i++)t.mock.timers.tick(4000);const visuals=samples.filter(s=>s.kind==='video');assert.equal(visuals.length,3);assert.equal(visuals[1].endedAt,now+12000);assert.ok(visuals[2].frames.some(f=>f.at===now+20000));}finally{capture.stop();}
});
