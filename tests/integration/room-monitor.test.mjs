import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {boot} from '../../src/app.js';
import {webLocks} from '../helpers/web-locks.mjs';

async function until(check) {
  const deadline=Date.now()+2500;
  while(!check() && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(check(),'应用应在初始化及渲染后到达可观察状态');
}

function launch({mode='auto',autoStart=true,liveStatus='ended',monitorRoom=true,runtime}={}) {
  const navigationErrors=[],virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error=>{if(error.type==='not implemented' && /navigation/.test(error.message))navigationErrors.push(error.message);else throw error;});
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123',pretendToBeVisual:true,virtualConsole});
  for(const key of ['window','document','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.CSS={escape:value=>value};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:webLocks()}});
  const values=new Map([['live-assistant:config:123',{mode,automation:{autoStart,monitorRoom}}]]);
  if(runtime)values.set('live-assistant:runtime:123',runtime);
  const leases=[];
  let api,publish,reads=0,connected=true,live=liveStatus==='unknown'?undefined:{roomId:'10',status:liveStatus,startAt:Date.now()-60000,endAt:Date.now()-1000,observedAt:Date.now()};
  const engine=boot({page:dom.window,get:(key,fallback)=>values.get(key)??fallback,set:(key,value)=>values.set(key,value),del:key=>values.delete(key),request:()=>{},
    adapterFactory:options=>({status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>connected,requestAvailable:()=>true,
      dispatch:event=>options.onEvent(event),send:async()=>({submitted:true})}),
    identityFactory:onIdentity=>{publish=()=>onIdentity({live});return {refresh:async()=>publish(),refreshRoom:async()=>{reads++;publish();},close(){}};},
    onMonitorStatus:status=>leases.push({...status,rendered:Boolean(dom.window.document.querySelector('#douyin-live-assistant'))}),onReady:value=>api=value});
  return {dom,engine,values,leases,navigationErrors,get api(){return api;},get reads(){return reads;},connect:value=>connected=value,
    live:(status,roomId='11')=>{live={roomId,status,startAt:Date.now(),endAt:status==='ended'?Date.now():0,observedAt:Date.now()};publish();},
    close:()=>{dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}};
}

test('启动先建立监控租约，再构建界面；关闭监控配置不会建立租约',()=>{
  for(const monitorRoom of [true,false]){
    const f=launch({autoStart:false,monitorRoom});
    try {
      assert.ok(f.leases.some(status=>!status.rendered && status.active===monitorRoom),'无需等待界面构建或首个周期计时器');
      if(!monitorRoom)assert.ok(f.leases.every(status=>!status.active));
    } finally {f.close();}
  }
});

for(const mode of ['auto','preview'])test(`${mode} 未开播时等待，后台唤醒检测开播立即启动，下播清场并等待下一场`,async()=>{
  const f=launch({mode});
  try {
    await until(()=>f.api);await f.api.wake();assert.equal(f.engine.running,false);
    await until(()=>/等待开播/.test(f.api.panel.node('[data-state]').textContent));
    assert.equal(f.api.panel.node('[data-action=stop]').hidden,false,'等待开播时也能暂停监控');
    const before=f.reads;f.live('live');await f.api.wake();assert.equal(f.engine.running,true);assert.equal(f.reads,before+1);
    f.engine.enqueue('welcome','上一场的欢迎');f.live('ended');await f.api.wake();
    assert.equal(f.engine.running,false);assert.equal(f.engine.queue.length,0);
    const stoppedEpoch=f.engine.epoch;f.live('ended');await f.api.wake();assert.equal(f.engine.epoch,stoppedEpoch,'重复下播查询不重复停机场控');
    f.live('live','12');await f.api.wake();assert.equal(f.engine.running,true);
    f.api.stop('手动暂停',{manual:true});f.live('ended','12');f.live('live','13');await f.api.wake();
    assert.equal(f.engine.running,false,'手动暂停后连播及后台唤醒不重启');
  } finally {f.close();}
});

test('未开启自动开始时检测开播仍保持暂停',async()=>{
  const f=launch({autoStart:false});
  try {
    await until(()=>f.api);await f.api.wake();
    await until(()=>/等待开播/.test(f.api.panel.node('[data-state]').textContent));
    assert.equal(f.api.panel.node('[data-action=start]').hidden,false,'监控不能隐藏手动开始');
    f.live('live');await f.api.wake();assert.equal(f.engine.running,false);
  }
  finally {f.close();}
});

test('仅有旧连接不能证明主播开播，状态未知时等待明确开播证据',async()=>{
  const f=launch({liveStatus:'unknown'});
  try {
    await until(()=>f.api);await f.api.wake();assert.equal(f.engine.running,false);
    f.live('live');await f.api.wake();assert.equal(f.engine.running,true);
  }finally{f.close();}
});

test('恢复的历史下播记录不能授权刷新当前状态未知的直播页',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);
  const f=launch({autoStart:false,liveStatus:'unknown',runtime:{version:1,savedAt:now-60000,
    liveMode:{version:1,roomId:'9',boundaryAt:now-120000,endedAt:now-60000}}});
  try {
    await until(()=>f.api);assert.ok(f.engine.liveMode.endedAt,'确实恢复了历史下播记录');
    const before=f.reads;
    now+=120001;await f.api.wake();now+=60000;await f.api.wake();
    assert.deepEqual(f.navigationErrors,[],'不能根据旧场次下播记录刷新');
    assert.ok(f.reads>before,'状态未知时继续查询（并发唤醒允许合并）');
    f.live('ended','11');await f.api.wake();
    assert.equal(f.navigationErrors.length,1,'当前查询明确下播时仍可刷新');
  }finally{f.close();}
});
