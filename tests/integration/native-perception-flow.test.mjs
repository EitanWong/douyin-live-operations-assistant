import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {boot} from '../../src/app.js';

test('原生感知通过应用路由、统一上下文和现有回复模型；切模式释放且拒绝迟到观察',async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123456',pretendToBeVisual:true});
  for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  let api,listener,disconnect,closed=0;const sent=[],requests=[],values=new Map();
  const port={postMessage:v=>{if(v.type==='status')listener({type:'session',stopped:false});else sent.push(v);},disconnect:()=>{if(sent.length)closed++;},onMessage:{addListener:f=>listener=f},onDisconnect:{addListener:f=>disconnect=f}};
  try{
    boot({page:dom.window,nativeConnect:()=>port,nativeExtensionId:'a'.repeat(32),get:(k,f)=>structuredClone(values.get(k) ?? f),set:async(k,v)=>values.set(k,structuredClone(v)),del:k=>values.delete(k),all:()=>Object.fromEntries(values),
      request:d=>{requests.push(d);d.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:'杯子是蓝色的。'}}]})});},
      adapterFactory:()=>({status:{},hook(){},sync(){},observeDOM(){},stopDOM(){},healthy:()=>false}),identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:v=>api=v});
    for(let i=0;i<300 && !api;i++)await new Promise(r=>setTimeout(r,10));assert.ok(api);
    const config=structuredClone(api.engine.config);config.ai.pipeline.mode='omni-llm';config.ai.pipeline.workspaceId='workspace';config.ai.media.inputSource='native';config.ai.model='text-model';
    await api.panel.callbacks.save(config,'reply-secret',false,{}, {pipeline:{key:'omni-secret',remember:false}});
    const pending=api.panel.callbacks.startMedia(config,{});assert.equal(sent[0].key,'omni-secret');assert.equal(sent[0].room,'123456');
    assert.equal(api.media.state,'starting');assert.match(api.panel.callbacks.diagnoseAI().join('\n'),/正在启动/);listener({type:'ready'});await pending;
    assert.match(api.panel.callbacks.diagnoseAI().join('\n'),/等待模型完成观察/);
    const at=Date.now();listener({type:'observation',row:{kind:'omni',id:'r',at,endedAt:at,text:'主播拿着蓝色杯子。'}});
    assert.equal(api.engine.aiContext().mediaContext.coverage,'realtime-native-stream');
    assert.match(api.panel.callbacks.diagnoseAI().join('\n'),/完成观察 1/);assert.equal(requests.length,0,'诊断不调用回复模型');
    await api.panel.callbacks.testAI(config,'',false);
    const body=JSON.parse(requests.at(-1).data),input=JSON.parse(body.messages[1].content);
    assert.equal(body.model,'text-model');assert.equal(requests.at(-1).headers.Authorization,'Bearer reply-secret');assert.equal(input.media_context.observations[0].inputSource,'native');
    const next=structuredClone(config);next.ai.pipeline.mode='text';await api.panel.callbacks.save(next,'',false,{},{});
    assert.equal(closed,1);listener({type:'observation',row:{kind:'omni',id:'late',at,endedAt:at,text:'迟到'}});assert.equal(api.engine.aiContext().mediaContext,null);
    assert.match(api.panel.callbacks.diagnoseAI().join('\n'),/未开启/);
    assert.doesNotMatch(JSON.stringify([...values]),/omni-secret|reply-secret|input_audio_buffer/);
    assert.match(api.panel.root.querySelector('[data-native-install-command]').textContent,/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
    const select=api.panel.root.querySelector('[data-field="ai.media.inputSource"]');select.value='native';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.equal(api.panel.root.querySelector('[data-native-install]').hidden,false);
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});
