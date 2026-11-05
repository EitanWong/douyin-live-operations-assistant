import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {boot} from '../../src/app.js';

const wait=async fn=>{for(let i=0;i<200 && !fn();i++)await new Promise(r=>setTimeout(r,10));assert.ok(fn(),'等待应用状态超时');};
const settle=()=>new Promise(resolve=>setTimeout(resolve,600));
async function fixture(run,options={}){
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123456?anchor_id=123',pretendToBeVisual:true});
  for(const key of ['document','window','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  let api,source,opened=0,closed=0;const requests=[],values=new Map();
  try{
    boot({page:dom.window,get:(k,f)=>structuredClone(values.get(k) ?? f),set:async(k,v)=>values.set(k,structuredClone(v)),del:k=>values.delete(k),all:()=>Object.fromEntries(values),
      lock:{acquire:async()=>true,release(){}},nativeCapture:async args=>{opened++;source=args;if(options.fail)throw new Error('会话额度已用完');return {stop:()=>closed++};},
      request:d=>{requests.push(d);d.onload({status:200,responseText:JSON.parse(d.data).stream ? 'data: {"choices":[{"delta":{"content":"杯子是蓝色的。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n' : JSON.stringify({choices:[{message:{content:'杯子是蓝色的。'}}]})});},
      adapterFactory:()=>({status:{},hook(){},sync(){},observeDOM(){},stopDOM(){},healthy:()=>false}),identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:v=>api=v,...options.boot});
    await wait(()=>api);
    const config=structuredClone(api.engine.config);config.mode='preview';config.automation.autoStart=false;config.ai.enabled=true;config.ai.pipeline.mode='omni-llm';config.ai.pipeline.workspaceId='workspace';config.ai.media.inputSource='native';config.ai.model='text-model';
    const save=async c=>api.panel.callbacks.save(c,'reply-secret',false,{}, {pipeline:{key:'omni-secret',remember:false}});
    await save(config);
    await run({api,config,save,requests,values,dom,get source(){return source;},get opened(){return opened;},get closed(){return closed;}});
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
}

test('本地语音首次使用自动准备并拉流，停止准备中的感知不会迟到启动',async()=>{
 let finish,prepared=0,captured=0,warmed=false;
 const pending=new Promise(resolve=>finish=resolve);
 await fixture(async f=>{
  f.config.ai.pipeline.mode='local-audio';f.config.ai.edge.audioBackend='native-sensevoice';
  await f.save(f.config);
  const starting=f.api.panel.callbacks.startMedia(f.config,{});
  await wait(()=>prepared===1);
  assert.equal(f.api.media.state,'starting');f.api.panel.callbacks.stopMedia();finish({phase:'ready'});
  await starting;await new Promise(setImmediate);assert.equal(captured,0);
  await f.api.panel.callbacks.startMedia(f.config,{});assert.equal(captured,1);assert.equal(prepared,1);
 },{boot:{nativeASR:{ready:async()=>warmed,prepare:async()=>{prepared++;const result=await pending;warmed=true;return result;},status:async()=>({phase:'ready'}),close(){}},
  mediaCapture:async()=>{captured++;return {stop(){}};}}});
});

test('一键启用自动选择并准备本地文字和语音，保存免密钥配置且不启动发送',async()=>{
 const prepared=new Set(),calls=[];
 const edge={detect:async()=>({webgpu:true}),ready:async kind=>prepared.has(kind),
  status:async()=>({text:{phase:prepared.has('text')?'ready':'unprepared'},audio:{phase:prepared.has('audio')?'ready':'unprepared'}}),
  prepare:async kind=>{calls.push(kind);prepared.add(kind);return {phase:'ready'};},close(){}};
 await fixture(async f=>{
  const knowledge=f.api.panel.root.querySelector('[data-field="ai.knowledge"]');knowledge.value='保留用户正在编辑的草稿';
  f.api.panel.root.querySelector('[data-edge-auto]').click();
  await wait(()=>f.api.panel.root.querySelector('[data-edge-status]').textContent.includes('本地 AI 已启用'));
  const saved=f.values.get('live-assistant:config:123456');
  assert.equal(saved.ai.enabled,true);assert.equal(saved.ai.chatEnabled,true);assert.equal(saved.ai.pipeline.mode,'local-audio');
  assert.equal(saved.ai.knowledge,'保留用户正在编辑的草稿');assert.equal(saved.ai.edge.textModel,'auto');
  assert.equal(f.api.engine.running,false);assert.equal(f.opened,0);assert.equal(f.requests.length,0);
  assert.deepEqual(calls.sort(),['audio','text']);assert.equal(f.api.panel.dirty,false);
  assert.equal(f.api.panel.root.querySelector('[data-text-service]').hidden,true,'本地模式隐藏不需要的云端密钥表单');
 },{boot:{edge}});
});

test('一键启用在准备完成前保存意图，刷新后可继续；进度更新不覆盖正在编辑的草稿',async()=>{
 let finish;const pending=new Promise(resolve=>finish=resolve),listeners=new Set();
 const edge={detect:async()=>({webgpu:true}),ready:async()=>false,status:async()=>({}),prepare:()=>pending,subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);},close(){}};
 await fixture(async f=>{
  f.api.panel.root.querySelector('[data-edge-auto]').click();
  await wait(()=>f.values.get('live-assistant:config:123456')?.ai.edge.localOnly);
  assert.equal(f.api.engine.running,false);
  const draft=f.api.panel.root.querySelector('[data-field="ai.knowledge"]');draft.value='下载中继续编辑';
  for(const listener of listeners)listener({text:{phase:'loading',progress:{stage:'download',loaded:5,total:10}}});
  assert.equal(draft.value,'下载中继续编辑');assert.match(f.api.panel.root.querySelector('[data-setup-kind="text"]').textContent,/下载/);
  finish({phase:'ready'});await wait(()=>f.api.panel.root.querySelector('[data-edge-status]').textContent.includes('已启用'));
  assert.equal(draft.value,'下载中继续编辑','后台完成不重填表单');
 },{boot:{edge}});
});

test('AI开始场控自动接入原生音画，正常问答获得最新观察；手动停止不会被计时器重新开启',async()=>fixture(async f=>{
  assert.equal(f.opened,0);await f.api.panel.callbacks.start();await wait(()=>f.api.media.state==='running');assert.equal(f.opened,1);
  const at=Date.now();f.source.onObservation({kind:'omni',at,endedAt:at,text:'主播正画蓝色的花。',inputSource:'native'});
  await f.api.panel.callbacks.testAI(f.config,'',false);
  const input=JSON.parse(JSON.parse(f.requests.at(-1).data).messages[1].content);assert.match(input.media_context.observations[0].text,/蓝色/);
  f.api.panel.callbacks.stopMedia();await settle();assert.equal(f.opened,1);assert.equal(f.closed,1);assert.equal(f.api.engine.aiContext().mediaContext,null);
  f.api.stop('暂停');await f.api.panel.callbacks.start();await settle();assert.equal(f.opened,1);
  await f.api.panel.callbacks.startMedia(f.config,{});assert.equal(f.opened,2);f.api.stop('暂停');assert.equal(f.closed,1);
}));

test('感知失败只尝试一次，不阻塞前台，不绕过额度自动重启；显式开始可以重试',async()=>fixture(async f=>{
  await f.api.panel.callbacks.start();assert.equal(f.api.engine.running,true);await settle();assert.equal(f.opened,1);assert.equal(f.api.media.state,'idle');
  assert.match(f.api.panel.root.querySelector('[data-media-error]').textContent,/额度/);
  await assert.rejects(f.api.panel.callbacks.startMedia(f.config,{}),/额度/);assert.equal(f.opened,2);await settle();assert.equal(f.opened,2);
},{fail:true}));

for(const mode of ['auto-off','AI-off','text','display'])test(`自动感知不越过用户选择：${mode}`,async()=>fixture(async f=>{
  if(mode==='auto-off')f.config.ai.media.autoStart=false;
  if(mode==='AI-off')f.config.ai.enabled=false;
  if(mode==='text')f.config.ai.pipeline.mode='text';
  if(mode==='display')f.config.ai.media.inputSource='display';
  await f.save(f.config);await f.api.panel.callbacks.start();await settle();assert.equal(f.opened,0);assert.equal(f.api.media.state,'idle');
}));

test('运行中保存感知配置只切换一次；切文字、页面关闭释放采集',async()=>fixture(async f=>{
  await f.api.panel.callbacks.start();await wait(()=>f.opened===1);
  f.config.ai.pipeline.realtimeModel='qwen3-omni-flash-realtime';await f.save(f.config);await wait(()=>f.opened===2);await settle();assert.equal(f.opened,2);assert.equal(f.closed,1);
  f.config.ai.pipeline.mode='text';await f.save(f.config);await settle();assert.equal(f.closed,2);assert.equal(f.opened,2);
  f.config.ai.pipeline.mode='omni-llm';await f.save(f.config);await wait(()=>f.opened===3);
  f.dom.window.dispatchEvent(new f.dom.window.Event('pagehide'));assert.equal(f.closed,3);assert.equal(f.api.engine.aiContext().mediaContext,null);
}));

test('原生感知不随AI回复开关停止；后台明确结束后页面不擅自重开任务',async()=>fixture(async f=>{
  await f.api.panel.callbacks.start();await wait(()=>f.opened===1);
  f.config.ai.enabled=false;await f.save(f.config);await settle();assert.equal(f.closed,0);assert.equal(f.opened,1);
  f.config.ai.enabled=true;await f.save(f.config);await settle();assert.equal(f.opened,1);
  f.source.onEnded();await settle();assert.equal(f.closed,1);assert.equal(f.opened,1);
}));

test('自动启动中的原生采集不随场控暂停；停止识别立即取消，迟到资源释放',async()=>{
  let finish,signal,released=0;
  await fixture(async f=>{
    await f.api.panel.callbacks.start();await wait(()=>signal);assert.equal(f.api.media.state,'starting');assert.equal(f.api.engine.running,true);
    f.api.stop('立即暂停');assert.equal(signal.aborted,false);assert.equal(f.api.engine.running,false);
    f.api.panel.callbacks.stopMedia();assert.equal(signal.aborted,true);finish({stop:()=>released++});await settle();assert.equal(released,1);assert.equal(f.api.media.state,'idle');
  },{boot:{nativeCapture:args=>{signal=args.signal;return new Promise(resolve=>finish=resolve);}}});
});

test('设置只有一个生效开关，内容互动和自动感知读写一致',async()=>fixture(async f=>{
  const root=f.api.panel.root;
  for(const path of ['ai.idleEnabled','ai.proactiveEnabled','ai.media.autoStart'])assert.equal(root.querySelectorAll(`[data-field="${path}"]`).length,1);
  root.querySelector('[data-field="ai.proactiveEnabled"]').checked=true;
  root.querySelector('[data-field="ai.proactiveIntervalSec"]').value='120';
  root.querySelector('[data-field="ai.media.autoStart"]').checked=false;
  const read=f.api.panel.read();assert.equal(read.ai.proactiveEnabled,true);assert.equal(read.ai.proactiveIntervalSec,120);assert.equal(read.ai.media.autoStart,false);
}));

test('原生感知独立于模块、标签页可见性和场控暂停；手动停止后保存与重新开始场控不重启',async()=>fixture(async f=>{
  await f.api.panel.callbacks.start();await wait(()=>f.api.media.state==='running');
  for(const tab of ['ai','anchor','rewards','diagnostics']){
    f.api.panel.tab(tab);f.api.panel.aiSettings.showSection('models');
    f.dom.window.document.dispatchEvent(new f.dom.window.Event('visibilitychange'));
    await new Promise(setImmediate);
    assert.equal(f.api.media.state,'running');assert.equal(f.closed,0);
  }
  f.api.panel.toggleOpen();f.api.stop('暂停场控');await settle();
  assert.equal(f.api.engine.running,false);assert.equal(f.api.media.state,'running');assert.equal(f.closed,0);
  const at=Date.now();f.source.onObservation({kind:'omni',at,endedAt:at,text:'后台仍在观察',inputSource:'native'});
  assert.equal(f.api.engine.aiContext().mediaContext.observations[0].text,'后台仍在观察');
  f.api.panel.callbacks.stopMedia();assert.equal(f.closed,1);
  f.config.ai.persona='改动其他AI设置';await f.save(f.config);
  await f.api.panel.callbacks.start();await settle();assert.equal(f.opened,1);assert.equal(f.api.media.state,'idle');
  await f.api.panel.callbacks.startMedia(f.config,{});assert.equal(f.opened,2);
}));

test('原生感知用草稿启动后保存其他模块不会释放正在运行的采集',async()=>fixture(async f=>{
  const draft=structuredClone(f.config);draft.ai.pipeline.realtimeModel='qwen3-omni-flash-realtime';
  await f.api.panel.callbacks.startMedia(draft,{});assert.equal(f.opened,1);
  f.config.welcome.enabled=!f.config.welcome.enabled;await f.save(f.config);await settle();
  assert.equal(f.api.media.state,'running');assert.equal(f.closed,0);assert.equal(f.opened,1);
}));

test('自定义直连感知也随AI运行自动采样，演示环境不会自动拉真实直播',async()=>{
  let capture,opened=0,released=0;
  const boot={mediaCapture:async args=>{opened++;capture=args;return {stop:()=>released++};}};
  await fixture(async f=>{
    f.config.ai.pipeline.mode='custom';Object.assign(f.config.ai.media,{inputSource:'direct',videoEnabled:true,audioEnabled:true,omniEnabled:true,visionModel:'omni',visionEndpoint:'http://localhost:1234/v1/chat/completions'});
    await f.save(f.config);await f.api.panel.callbacks.start();await wait(()=>capture);assert.equal(opened,1);
    await capture.onSample({kind:'omni',at:Date.now(),image:'data:image/jpeg;base64,/9j/2Q==',data:'UklGRiQAAABXQVZF',inputSource:'direct'});
    assert.equal(f.api.engine.aiContext().mediaContext.observations[0].inputSource,'direct');
    f.api.stop('停止');assert.equal(released,1);
  },{boot});
  await fixture(async f=>{
    await f.api.panel.callbacks.start();await settle();assert.equal(f.opened,0);assert.equal(f.api.media.state,'idle');
  },{boot:{demo:true}});
});

test('原生语音与画面完成后自动判断主播接话，不需要弹幕、不等待冷场且不重复回应',async()=>fixture(async f=>{
 f.config.ai.proactiveEnabled=true;f.config.ai.chatEnabled=false;await f.save(f.config);
 const prompts=[];f.api.engine.ai=async p=>{prompts.push(p);return '蓝色和这个花纹挺搭的。';};
 await f.api.panel.callbacks.start();await wait(()=>f.api.media.state==='running');const at=Date.now();
 f.source.onObservation({kind:'audio',id:'partial',at,endedAt:at,text:'大家觉得',isFinal:false,inputSource:'native'});
 await new Promise(setImmediate);assert.equal(prompts.length,0);
 f.source.onObservation({kind:'omni',id:'picture',at,endedAt:at,text:'主播拿着蓝色和绿色两个杯子。',inputSource:'native'});
 f.source.onObservation({kind:'audio',id:'question',at,endedAt:at,text:'大家觉得蓝色还是绿色好看？',inputSource:'native'});
 await wait(()=>f.api.engine.stats.previews===1);assert.equal(prompts.length,1);assert.equal(prompts[0].target.type,'speech');assert.equal(prompts[0].target.text,'大家觉得蓝色还是绿色好看？');
 assert.ok(prompts[0].mediaContext.observations.some(row=>row.text.includes('两个杯子')));
 f.source.onObservation({kind:'audio',id:'same-question',at:Date.now(),endedAt:Date.now(),text:'大家觉得蓝色还是绿色好看？',inputSource:'native'});
 await settle();assert.equal(prompts.length,1);assert.equal(f.api.engine.stats.previews,1);assert.equal(f.opened,1);
 f.api.stop('暂停');assert.equal(f.closed,0);f.api.panel.callbacks.stopMedia();assert.equal(f.closed,1);
}));

test('同一直播间首次补全主播资料不会停止已经启动的原生感知',async()=>{
  let identify;
  await fixture(async f=>{
    f.config.anchorId='';await f.save(f.config);await f.api.panel.callbacks.start();await wait(()=>f.api.media.state==='running');
    identify({anchor:{id:'123',name:'当前主播'}});
    assert.equal(f.api.engine.config.anchorId,'123');assert.equal(f.api.media.state,'running');assert.equal(f.closed,0);
    const at=Date.now();f.source.onObservation({kind:'omni',at,endedAt:at,text:'补全资料后继续观察',inputSource:'native'});
    assert.equal(f.api.engine.aiContext().mediaContext.observations[0].text,'补全资料后继续观察');
  },{boot:{identityFactory:callback=>{identify=callback;return {refresh:async()=>{},close(){}};}}});
});
