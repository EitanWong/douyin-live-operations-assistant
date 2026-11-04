import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {boot} from '../../src/app.js';
import {installNativePerceptionBridge} from '../../extension/native-perception.js';

const wait=async predicate=>{for(let i=0;i<200 && !predicate();i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(predicate(),'等待后台感知状态超时');};
function events(){const listeners=[];return {addListener:fn=>listeners.push(fn),emit:value=>{for(const fn of listeners)fn(value);}};}
function bridge(){
  let connected;const hosts=[],trace=[];
  installNativePerceptionBridge({runtime:{onConnect:{addListener:fn=>connected=fn},connectNative:()=>{
    const host={onMessage:events(),onDisconnect:events(),sent:[],closed:0,postMessage(value){this.sent.push(value);},disconnect(){this.closed++;}};
    hosts.push(host);return host;
  }}});
  return {hosts,trace,connect(url){
    const a={onMessage:events(),onDisconnect:events()},b={onMessage:events(),onDisconnect:events()};let closed=false;
    for(const [local,remote] of [[a,b],[b,a]]){
      local.postMessage=value=>{trace.push([local===a?'page':'bridge',value.type,value.row?.text]);if(closed)throw new Error('port closed');queueMicrotask(()=>remote.onMessage.emit(value));};
      local.disconnect=()=>{if(closed)return;closed=true;queueMicrotask(()=>{a.onDisconnect.emit();b.onDisconnect.emit();});};
    }
    Object.assign(b,{name:'native-perception',sender:{frameId:0,url,tab:{id:1,url}}});connected(b);return a;
  }};
}
async function launch(values,native){
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123456?anchor_id=123',pretendToBeVisual:true});
  for(const key of ['document','window','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  let api;
  boot({page:dom.window,get:(key,fallback)=>structuredClone(values.get(key) ?? fallback),set:async(key,value)=>values.set(key,structuredClone(value)),del:key=>values.delete(key),all:()=>Object.fromEntries(values),
    nativeConnect:()=>native.connect(dom.window.location.href),lock:{acquire:async()=>true,release(){}},request:()=>{},
    adapterFactory:()=>({status:{},hook(){},sync(){},observeDOM(){},stopDOM(){},healthy:()=>false}),identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>api=value});
  await wait(()=>api);await new Promise(setImmediate);
  return {api,dom,hide:persisted=>dom.window.dispatchEvent(new dom.window.PageTransitionEvent('pagehide',{persisted})),close(){this.hide(false);api.panel.destroy();dom.window.close();}};
}

test('原生任务跨页面缓存、刷新继续采集；无持久密钥也恢复同一任务，手动停止跨刷新生效',async()=>{
  const native=bridge(),values=new Map();let page=await launch(values,native);
  try{
    const c=structuredClone(page.api.engine.config);c.mode='preview';c.automation.autoStart=false;c.ai.enabled=true;c.ai.pipeline.mode='omni-llm';c.ai.pipeline.workspaceId='workspace';c.ai.media.inputSource='native';
    await page.api.panel.callbacks.save(c,'',false,{}, {pipeline:{key:'memory-only-secret',remember:false}});
    const started=page.api.panel.callbacks.startMedia(c,{});await wait(()=>native.hosts.length===1);
    const host=native.hosts[0];host.onMessage.emit({type:'ready'});await started;
    page.hide(true);assert.equal(host.closed,0);assert.equal(host.sent.filter(v=>v.type==='stop').length,0);
    const at=Date.now();host.onMessage.emit({type:'observation',row:{kind:'omni',id:'background',at,endedAt:at,text:'离开页面仍在观察'}});
    page.dom.window.dispatchEvent(new page.dom.window.PageTransitionEvent('pageshow',{persisted:true}));
    await wait(()=>page.api.media.state==='running');assert.equal(native.hosts.length,1);
    assert.deepEqual(page.api.engine.aiContext().mediaContext.observations.map(row=>row.text),['离开页面仍在观察'],JSON.stringify(native.trace));
    page.close();assert.equal(host.closed,0);
    page=await launch(values,native);await wait(()=>page.api.media.state==='running');
    assert.equal(native.hosts.length,1);assert.equal(page.api.engine.running,false);
    assert.deepEqual(page.api.engine.aiContext().mediaContext.observations.map(row=>row.text),['离开页面仍在观察'],JSON.stringify(native.trace));
    await page.api.panel.callbacks.acknowledgeRuntimeAlert();
    assert.doesNotMatch(JSON.stringify([...values]),/memory-only-secret/);
    assert.match(JSON.stringify(values.get('live-assistant:live-memory:123456:123')),/离开页面仍在观察/);
    page.api.panel.callbacks.stopMedia();await wait(()=>host.closed===1);page.close();
    page=await launch(values,native);await page.api.panel.callbacks.start();await new Promise(resolve=>setTimeout(resolve,350));
    assert.equal(page.api.media.state,'idle');assert.equal(native.hosts.length,1);
    const explicit=page.api.panel.callbacks.startMedia(c,{pipeline:{key:'new-secret',remember:false}});
    await wait(()=>native.hosts.length===2);native.hosts[1].onMessage.emit({type:'ready'});await explicit;
    page.api.panel.callbacks.stopMedia();await wait(()=>native.hosts[1].closed===1);
  }finally{page.close();}
});

test('原生启动中离页不取消宿主；草稿会话返回后仍可从已保存的文字模式手动停止',async()=>{
  const native=bridge(),values=new Map();let page=await launch(values,native);
  try{
    const saved=structuredClone(page.api.engine.config);saved.mode='preview';saved.automation.autoStart=false;saved.ai.pipeline.mode='text';
    await page.api.panel.callbacks.save(saved,'',false,{},{});
    const draft=structuredClone(saved);draft.ai.pipeline.mode='omni-llm';draft.ai.pipeline.workspaceId='workspace';draft.ai.media.inputSource='native';
    const started=page.api.panel.callbacks.startMedia(draft,{pipeline:{key:'transient-secret',remember:false}});
    await wait(()=>native.hosts.length===1);const host=native.hosts[0];
    page.close();await started;assert.equal(host.closed,0);
    page=await launch(values,native);await wait(()=>page.api.media.state==='starting');
    assert.equal(page.api.panel.root.querySelector('[data-perception-active]').hidden,false,'后台任务的停止按钮必须可见');
    assert.equal(page.api.panel.root.querySelector('[data-media-stop]').disabled,false);
    host.onMessage.emit({type:'ready'});await wait(()=>page.api.media.state==='running');assert.equal(native.hosts.length,1);
    page.api.panel.root.querySelector('[data-media-stop]').click();await wait(()=>host.closed===1);
  }finally{page.close();}
});
