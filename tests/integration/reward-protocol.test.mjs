import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {boot} from '../../src/app.js';
import {webLocks} from '../helpers/web-locks.mjs';

test('暂停场控时协议活动仍经过应用进入工具和面板，配置可保存且不会参与真实活动',async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123',pretendToBeVisual:true});
  for(const name of ['window','document','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:value=>value};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:webLocks()}});
  const self='9007199254740993123',room='7702463172476701483',lottery='7702514039720839955';
  const values=new Map([['live-assistant:config:123',{selfId:self,identity:{autoSelf:false},rewards:{enabled:false},automation:{autoStart:false}}]]);
  let api,onEvent;
  const engine=boot({page:dom.window,get:(key,fallback)=>structuredClone(values.get(key)??fallback),
    set:async(key,value)=>values.set(key,structuredClone(value)),del:key=>values.delete(key),request:()=>assert.fail('没有外部请求'),
    adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>true};},
    identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>{api=value;}});
  try {
    await api.tools.ready;
    await onEvent({type:'start',roomId:room,at:Date.now()});
    await onEvent({type:'activity-signal',activityKind:'lottery-start',roomId:room,lotteryId:lottery,startedAt:String(Math.floor(Date.now()/1000)-10),
      drawAt:String(Math.floor(Date.now()/1000)+120),prizeCount:'30',luckyCount:'3'});
    await onEvent({type:'activity-signal',activityKind:'lottery-candidate',roomId:room,lotteryId:lottery,userId:self,participateSuccess:true,version:'200'});
    api.tools.notify('tick');
    for(let i=0;i<50&&!api.tools.state('rewards').lottery;i++)await new Promise(setImmediate);
    assert.equal(engine.running,false);assert.equal(api.tools.state('rewards').lottery.participation,'confirmed');
    assert.match(api.panel.node('[data-rewards-activity]').textContent,/服务器已确认参与/);
    assert.equal(api.tools.state('rewards').submitted,0);
    const option=api.panel.node('[data-field="rewards.nativePassword"]');assert.equal(option.checked,false);
    option.checked=true;option.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    api.panel.node('[data-action=save]').click();
    for(let i=0;i<50&&!values.get('live-assistant:config:123').rewards.nativePassword;i++)await new Promise(setImmediate);
    assert.equal(values.get('live-assistant:config:123').rewards.nativePassword,true);
    assert.equal(values.get('live-assistant:config:123').rewards.enabled,false);
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));await api.tools.close();api.panel.destroy();dom.window.close();}
});
