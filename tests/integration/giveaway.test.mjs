import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {boot} from '../../src/app.js';
import {webLocks} from '../helpers/web-locks.mjs';

const flush=()=>new Promise(setImmediate);
async function until(predicate){for(let i=0;i<300;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(predicate());}
function page(){
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123',pretendToBeVisual:true});
  for(const key of ['document','window','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];
  globalThis.CSS={escape:value=>value};globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:webLocks()}});return dom;
}
test('扩展工具抽奖独立于场控：真实入口收弹幕与礼物、开奖记录、导出与刷新恢复',async()=>{
  const dom=page(),values=new Map();let api,onEvent;
  boot({page:dom.window,get:(key,fallback)=>values.get(key) ?? fallback,set:(key,value)=>values.set(key,structuredClone(value)),
    adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>true};},
    onReady:value=>{api=value;}});
  try {
    await api.tools.ready;assert.equal(api.engine.running,false);
    const p=api.panel;p.toggleOpen();p.node('[data-tab=giveaway]').click();assert.equal(p.activeCategory,'tools');
    p.node('[data-giveaway=prize]').value='签名礼盒';p.node('[data-giveaway=durationSec]').value='1';
    p.node('[data-giveaway=giftEnabled]').checked=true;p.node('[data-giveaway=gifts]').value='小心心';
    p.node('[data-action=giveaway-start]').click();await until(()=>api.tools.state('giveaway').phase==='running');
    const at=Date.now();
    await Promise.all([
      onEvent({type:'chat',id:'chat-1',source:'socket',at,text:'参与抽奖',user:{id:'1',name:'小雨'}}),
      onEvent({type:'gift',id:'gift-2',source:'socket',at,giftId:'463',giftName:'小心心',count:1,final:true,user:{id:'2',name:'小林'}}),
      onEvent({type:'chat',id:'chat-2',source:'socket',at,text:'参与抽奖',user:{id:'1',name:'小雨'}})
    ]);
    assert.equal(api.tools.state('giveaway').rounds[0].entrants.length,2);
    await until(()=>api.tools.state('giveaway').rounds[0].status==='drawn');
    assert.match(p.node('[data-giveaway-result]').textContent,/签名礼盒/);
    const report=await api.tools.invoke('giveaway','export');assert.equal(report.rounds[0].entrants.length,2);assert.equal(report.rounds[0].winnerIds.length,1);
    await api.tools.restart('giveaway');assert.deepEqual(api.tools.state('giveaway').rounds[0].winnerIds,report.rounds[0].winnerIds);
    assert.match(p.node('[data-giveaway-history]').textContent,/签名礼盒/);assert.equal(api.engine.running,false);
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));await api.tools.close();api.panel.destroy();dom.window.close();}
});

test('存储失败的抽奖事件保留日志且不妨碍核心处理，重建后可重放',async()=>{
  const dom=page(),values=new Map(),acks=[];let api,onEvent,fail=false;
  boot({page:dom.window,get:(key,fallback)=>values.get(key) ?? fallback,set:(key,value)=>values.set(key,structuredClone(value)),
    giveawayStorage:{get:async key=>values.get(key),set:async(key,value)=>{if(fail)throw Error('抽奖写盘失败');values.set(key,structuredClone(value));}},
    journal:{ack:async key=>acks.push(key),ackMany:async keys=>acks.push(...keys)},
    adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>true};},onReady:value=>{api=value;}});
  try{
    await api.tools.ready;await api.tools.invoke('giveaway','start',{prize:'礼盒',winners:1,durationSec:30,chatEnabled:true,keyword:'参与抽奖',giftEnabled:false});
    fail=true;const event={type:'chat',id:'c-1',_journalKey:'pending',source:'socket',at:Date.now(),text:'参与抽奖',user:{id:'1',name:'小雨'}};
    await assert.rejects(onEvent(event),/抽奖/);await flush();assert.deepEqual(acks,[]);
    await assert.rejects(onEvent({...event,id:'c-2',_journalKey:'pending-2',user:{id:'2',name:'小林'}}),/抽奖/);
    fail=false;await api.tools.restart('giveaway');await onEvent(event);assert.equal(api.tools.state('giveaway').rounds[0].entrants.length,1);
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));await api.tools.close();api.panel.destroy();dom.window.close();}
});
