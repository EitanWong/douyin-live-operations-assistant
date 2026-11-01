import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {boot} from '../../src/app.js';

test('纯 Omni 组合从独立密钥和实时观察贯通 RAG、搜索与回复，切换组合拒绝迟到结果',async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890',pretendToBeVisual:true});
  for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  let api,capture,started=0,stopped=0;const requests=[],values=new Map();
  const wait=async fn=>{for(let i=0;i<300 && !fn();i++)await new Promise(r=>setTimeout(r,10));assert.ok(fn());};
  try{
    boot({demo:true,get:(key,fallback)=>structuredClone(values.get(key) ?? fallback),set:async(key,value)=>values.set(key,structuredClone(value)),del:key=>values.delete(key),all:()=>Object.fromEntries(values),
      request:d=>{requests.push(d);if(d.operation==='search'){d.onload({status:200,responseText:JSON.stringify({data:{webPages:{value:[{name:'天气来源',url:'https://weather.example/today',summary:'北京今天晴。'}]}}})});return;}
        const body=JSON.parse(d.data),input=JSON.parse(body.messages[1].content),text=input.web_search ? '北京今天晴。[1]' : input.target?.text==='北京天气' ? JSON.stringify({intent:'web-search',query:'北京今天的天气',reply:''}) : '茶杯是陶瓷的。';
        d.onload({status:200,responseText:`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`});},
      realtimeCapture:async options=>{started++;capture=options;return {stop(){stopped++;}};},
      adapterFactory:()=>({status:{},sync(){},observeDOM(){},stopDOM(){},healthy:()=>false}),onReady:value=>api=value});
    await wait(()=>api);const c=structuredClone(api.engine.config);c.ai.pipeline.mode='omni-only';c.ai.pipeline.workspaceId='ws-example';c.ai.search.enabled=true;
    c.ai.memory.entries=[{id:'tea',title:'茶杯材质',content:'本直播间茶杯使用陶瓷制作。',source:'主播确认',updatedAt:Date.now(),expiresOn:'',enabled:true}];
    await api.panel.callbacks.save(c,'',false,{key:'search-private'},{pipeline:{key:'ali-private',remember:false}});
    const pending=api.panel.callbacks.startMedia(c,{});assert.equal(started,1);await pending;
    capture.onObservation({kind:'omni',id:'session:r',at:Date.now(),endedAt:Date.now(),text:'主播在介绍茶杯。',isFinal:true,transport:'webrtc',model:c.ai.pipeline.realtimeModel});
    await api.panel.callbacks.testAI(c,'',false);
    let body=JSON.parse(requests.at(-1).data),input=JSON.parse(body.messages[1].content);
    assert.equal(body.model,'qwen3.8-omni-flash');assert.equal(requests.at(-1).headers.Authorization,'Bearer ali-private');assert.equal(input.media_context.coverage,'realtime-vad-shared-media');assert.equal(input.evidence_context.memories[0].entryId,'tea');
    const output=await api.engine.ai({...api.engine.aiContext(),maxLength:30,target:{text:'北京天气'},task:{kind:'ai'}},c.ai);assert.equal(output,'北京今天晴。[1]');
    assert.equal(requests.at(-2).headers.Authorization,'Bearer search-private');assert.equal(JSON.parse(requests.at(-2).data).query,'北京今天的天气');assert.equal(requests.at(-1).headers.Authorization,'Bearer ali-private');
    const next=structuredClone(c);next.ai.pipeline.mode='text';await api.panel.callbacks.save(next,'',false,{},{});assert.equal(stopped,1);assert.equal(api.engine.aiContext().mediaContext,null);
    capture.onObservation({kind:'omni',id:'late',at:Date.now(),text:'迟到结果',transport:'webrtc'});assert.equal(api.media.state,'idle');assert.equal(api.engine.aiContext().mediaContext,null);
    assert.ok(!JSON.stringify([...values]).includes('ali-private'));assert.ok(!JSON.stringify(api.panel.entries).includes('Bearer'));
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});
