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
    await run({api,config,save,requests,dom,get source(){return source;},get opened(){return opened;},get closed(){return closed;}});
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
}

test('AI开始场控自动接入原生音画，正常问答获得最新观察；手动停止不会被计时器重新开启',async()=>fixture(async f=>{
  assert.equal(f.opened,0);await f.api.panel.callbacks.start();await wait(()=>f.api.media.state==='running');assert.equal(f.opened,1);
  const at=Date.now();f.source.onObservation({kind:'omni',at,endedAt:at,text:'主播正画蓝色的花。',inputSource:'native'});
  await f.api.panel.callbacks.testAI(f.config,'',false);
  const input=JSON.parse(JSON.parse(f.requests.at(-1).data).messages[1].content);assert.match(input.media_context.observations[0].text,/蓝色/);
  f.api.panel.callbacks.stopMedia();await settle();assert.equal(f.opened,1);assert.equal(f.closed,1);assert.equal(f.api.engine.aiContext().mediaContext,null);
  f.api.stop('暂停');await f.api.panel.callbacks.start();await wait(()=>f.opened===2);f.api.stop('暂停');assert.equal(f.closed,2);
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

test('使用中的AI关闭后释放感知，再开启时恢复；会话到期不自动重启',async()=>fixture(async f=>{
  await f.api.panel.callbacks.start();await wait(()=>f.opened===1);
  f.config.ai.enabled=false;await f.save(f.config);await settle();assert.equal(f.closed,1);assert.equal(f.opened,1);
  f.config.ai.enabled=true;await f.save(f.config);await wait(()=>f.opened===2);
  f.source.onEnded();await settle();assert.equal(f.closed,2);assert.equal(f.opened,2);
}));

test('自动启动中的采集可立即暂停，迟到资源会释放，前台不等采集完成',async()=>{
  let finish,signal,released=0;
  await fixture(async f=>{
    await f.api.panel.callbacks.start();await wait(()=>signal);assert.equal(f.api.media.state,'starting');assert.equal(f.api.engine.running,true);
    f.api.stop('立即暂停');assert.equal(signal.aborted,true);finish({stop:()=>released++});await settle();assert.equal(released,1);assert.equal(f.api.media.state,'idle');
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
