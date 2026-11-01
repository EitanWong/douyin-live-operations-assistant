import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {boot} from '../../src/app.js';

test('应用端到端共享媒体观测与持久记忆，暂停后清空且原始媒体不进入日志、问答和存储',async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890?anchor_id=123',pretendToBeVisual:true});
  for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  let api,sampling,identify,opened=0,closed=0;const requests=[],values=new Map();
  const waitFor=async fn=>{const until=Date.now()+3000;while(!fn() && Date.now()<until)await new Promise(r=>setTimeout(r,10));assert.ok(fn());};
  try {
    boot({page:dom.window,get:(key,fallback)=>structuredClone(values.get(key) ?? fallback),set:async(key,value)=>values.set(key,structuredClone(value)),del:key=>values.delete(key),all:()=>Object.fromEntries(values),
      request:details=>{requests.push(details);details.onload({status:200,responseText:details.operation==='media' && JSON.parse(details.data).stream ? 'data: {"choices":[{"delta":{"content":"主播在介绍茶具。"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n' : JSON.stringify({choices:[{message:{content:details.operation==='media' ? '主播在介绍茶具。' : '你好。'}}]})});},
      mediaCapture:async options=>{opened++;sampling=options.onSample;return {stop:()=>{closed++;}};},
      adapterFactory:()=>({status:{},hook(){},observeDOM(){},stopDOM(){},healthy:()=>false,sync(){}}),identityFactory:onIdentity=>{identify=onIdentity;return {refresh:async()=>{},close(){}};},onReady:value=>api=value});
    await waitFor(()=>api);assert.equal(opened,0,'刷新不会自动恢复采集');
    const config=structuredClone(api.engine.config);config.ai.endpoint='http://localhost:11434/v1/chat/completions';config.ai.model='text';
    config.ai.media={...config.ai.media,omniEnabled:true,videoEnabled:true,audioEnabled:true,visionModel:'qwen3.5-omni-flash',visionEndpoint:'http://localhost:1234/v1/chat/completions'};
    config.ai.memory.entries=[{id:'tea',title:'茶具背景',content:'主播销售的是陶瓷茶具',source:'主播确认',updatedAt:Date.now(),expiresOn:'',enabled:true}];
    await api.panel.callbacks.save(config,'',false,{},{});
    const started=api.panel.callbacks.startMedia(config,{});assert.equal(opened,1,'没有异步等待消耗选屏所需的用户激活');await started;
    await sampling({kind:'omni',at:Date.now(),image:'data:image/jpeg;base64,/9j/2Q==',data:'UklGRiQAAABXQVZF'});
    await api.panel.callbacks.testAI(config,'',false);
    let data=JSON.parse(requests.at(-1).data).messages[1].content;data=JSON.parse(data);
    assert.equal(data.media_context.observations[0].text,'主播在介绍茶具。');assert.equal(data.media_context.observations[0].kind,'omni');assert.equal(data.evidence_context.memories[0].id,'tea');
    assert.equal(data.media_context.coverage,'sampled-shared-media');assert.ok(!JSON.stringify(data).includes('UklGRiQAAABXQVZF'));
    assert.ok(!JSON.stringify([...values]).includes('UklGRiQAAABXQVZF'));assert.ok(!JSON.stringify(api.panel.entries).includes('主播在介绍茶具'));
    api.stop('测试暂停');assert.equal(closed,1);assert.equal(api.engine.aiContext().mediaContext,null);
    await api.panel.callbacks.testAI(config,'',false);assert.equal(JSON.parse(JSON.parse(requests.at(-1).data).messages[1].content).media_context,null);
    assert.equal(values.get('live-assistant:config:1234567890').ai.memory.entries[0].content,'主播销售的是陶瓷茶具');
    await api.panel.callbacks.startMedia(config,{});identify({anchor:{id:'456',name:'另一位主播'}});
    assert.equal(api.media.state,'idle');assert.equal(closed,2,'自动识别主播归属变化后释放采集');
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});

test('默认原始流输入从应用采样进入文字回复上下文并在暂停时释放',async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890',pretendToBeVisual:true});
  for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  const track={stop(){},addEventListener(){}},stream={getTracks:()=>[track],getVideoTracks:()=>[track],getAudioTracks:()=>[]};
  dom.window.HTMLMediaElement.prototype.play=async()=>{};dom.window.HTMLMediaElement.prototype.pause=()=>{};
  for(const [key,value] of Object.entries({readyState:2,videoWidth:640,videoHeight:360}))Object.defineProperty(dom.window.HTMLVideoElement.prototype,key,{get:()=>value,configurable:true});
  dom.window.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});dom.window.HTMLCanvasElement.prototype.toDataURL=()=>'data:image/jpeg;base64,/9j/2Q==';
  let api,sourceConfig,stopped=0;const requests=[];
  const wait=async fn=>{for(let i=0;i<300 && !fn();i++)await new Promise(r=>setTimeout(r,10));assert.ok(fn());};
  try{
    boot({demo:true,get:(_key,fallback)=>fallback,set:async()=>{},del:()=>{},all:()=>({}),directStreamSource:async({config})=>{sourceConfig=config;return {stream,source:'direct',stop:()=>stopped++};},
      request:d=>{requests.push(d);d.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:d.operation==='media'?'主播展示茶杯。':'你好。'}}]})});},
      adapterFactory:()=>({status:{},sync(){},observeDOM(){},stopDOM(){},healthy:()=>false}),onReady:value=>api=value});
    await wait(()=>api);const c=structuredClone(api.engine.config);c.ai.endpoint='http://localhost:11434/v1/chat/completions';c.ai.model='text';
    Object.assign(c.ai.media,{videoEnabled:true,visionModel:'vision',visionEndpoint:'http://localhost:1234/v1/chat/completions'});
    await api.panel.callbacks.save(c,'',false,{},{});await api.panel.callbacks.startMedia(c,{});
    await wait(()=>requests.some(d=>d.operation==='media'));await new Promise(setImmediate);
    assert.equal(sourceConfig.inputSource,'direct');await api.panel.callbacks.testAI(c,'',false);
    const input=JSON.parse(JSON.parse(requests.at(-1).data).messages[1].content);assert.equal(input.media_context.coverage,'sampled-direct-stream');assert.equal(input.media_context.observations[0].inputSource,'direct');assert.equal(input.media_context.observations[0].text,'主播展示茶杯。');
    api.stop('测试暂停');assert.equal(stopped,1);assert.equal(api.engine.aiContext().mediaContext,null);
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});
