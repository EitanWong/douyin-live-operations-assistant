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
    p.node('[data-prize=name]').value='签名礼盒';p.node('[data-giveaway=durationSec]').value='1';
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
    const report=await api.tools.invoke('giveaway','export');assert.equal(report.rounds[0].entrants.length,2);assert.equal(report.rounds[0].awards.length,1);
    await api.tools.restart('giveaway');assert.deepEqual(api.tools.state('giveaway').rounds[0].awards,report.rounds[0].awards);
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

test('配置多个奖品，搜索多选礼物与手动规则同步，开轮后锁定并导出各自奖品',async()=>{
  const dom=page(),values=new Map();let api;
  boot({page:dom.window,demo:true,get:(key,fallback)=>values.get(key) ?? fallback,set:(key,value)=>values.set(key,structuredClone(value)),onReady:value=>{api=value;}});
  try {
    await api.tools.ready;const p=api.panel;
    p.node('[data-action=giveaway-add-prize]').click();
    await until(()=>p.root.querySelectorAll('[data-giveaway-prize]').length===2);
    const rows=p.root.querySelectorAll('[data-giveaway-prize]');
    rows[0].querySelector('[data-prize=name]').value='签名礼盒';rows[1].querySelector('[data-prize=name]').value='纪念杯';
    rows[1].querySelector('[data-prize=count]').value='2';p.node('[data-giveaway=durationSec]').value='1';
    p.node('[data-action=giveaway-refresh-gifts]').click();await until(()=>p.root.querySelectorAll('[data-giveaway-gift-id]').length===6);
    const initial=p.node('[data-giveaway=gifts]');initial.value='';initial.dispatchEvent(new dom.window.Event('input'));
    const select=id=>p.root.querySelector(`[data-giveaway-gift-id="${id}"]`);
    const search=p.node('[data-giveaway-gift-search]');search.value='791';search.dispatchEvent(new dom.window.Event('input'));
    assert.equal(p.root.querySelectorAll('[data-giveaway-gift-id]').length,1);select('791').click();
    assert.equal(p.node('[data-giveaway=giftEnabled]').checked,true);
    search.value='';search.dispatchEvent(new dom.window.Event('input'));select('463').click();
    assert.equal(select('791').checked,true);assert.equal(select('463').checked,true);
    assert.match(p.node('[data-giveaway-gift-selected]').textContent,/玫瑰/);
    const manual=p.node('[data-giveaway=gifts]');manual.value='791, 手工礼物';manual.dispatchEvent(new dom.window.Event('input'));
    assert.equal(select('791').checked,true);assert.equal(select('463').checked,false);
    p.node('[data-action=giveaway-start]').click();await until(()=>api.tools.state('giveaway').phase==='running');
    assert.equal(select('791').disabled,true);assert.equal(p.node('[data-action=giveaway-add-prize]').disabled,true);
    const at=Date.now();for(const id of ['1','2','3'])await api.tools.dispatch('event',{type:'gift',id:`g-${id}`,at,source:'socket',giftId:'791',giftName:'玫瑰',count:1,user:{id,name:`观众${id}`}});
    await until(()=>api.tools.state('giveaway').rounds[0].status==='drawn');
    const report=await api.tools.invoke('giveaway','export');assert.equal(report.version,2);
    assert.deepEqual(report.rounds[0].config.prizes,[{name:'签名礼盒',count:1},{name:'纪念杯',count:2}]);
    assert.equal(report.rounds[0].awards.length,3);assert.match(p.node('[data-giveaway-result]').textContent,/纪念杯/);
    await api.tools.restart('giveaway');assert.deepEqual(api.tools.state('giveaway').rounds[0].awards,report.rounds[0].awards);
    p.node('[data-prize-remove]').click();await until(()=>p.root.querySelectorAll('[data-giveaway-prize]').length===1);
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));await api.tools.close();api.panel.destroy();dom.window.close();}
});
test('观众权重和主播必中通过工具入口锁定，主播使用当前房间 UID 且结果可恢复',async()=>{
  const dom=page(),values=new Map();let api;
  boot({page:dom.window,demo:true,get:(key,fallback)=>values.get(key) ?? fallback,set:(key,value)=>values.set(key,structuredClone(value)),onReady:value=>{api=value;}});
  try {
    await api.tools.ready;const p=api.panel;
    p.node('[data-action=giveaway-add-weight]').click();
    const row=p.root.querySelector('[data-giveaway-weight]');row.querySelector('[data-weight=userId]').value='2';row.querySelector('[data-weight=weight]').value='3';
    p.node('[data-giveaway=anchorGuaranteed]').checked=true;p.node('[data-giveaway=durationSec]').value='1';
    p.node('[data-action=giveaway-start]').click();await until(()=>api.tools.state('giveaway').phase==='running');
    const at=Date.now();for(const id of ['2','1234567890'])await api.tools.dispatch('event',{type:'chat',id:`c-${id}`,at,source:'socket',text:'参与抽奖',user:{id,name:id}});
    assert.equal(p.root.querySelector('[data-weight=weight]').disabled,true);
    await until(()=>api.tools.state('giveaway').rounds[0].status==='drawn');
    const report=await api.tools.invoke('giveaway','export'),round=report.rounds[0];
    assert.deepEqual(round.config.weights,[{userId:'2',weight:3}]);assert.equal(round.anchorId,'1234567890');
    assert.deepEqual(round.awards,[{userId:'1234567890',prizeIndex:0}]);assert.match(p.node('[data-giveaway-result]').textContent,/主播参与必中/);
    await api.tools.restart('giveaway');assert.deepEqual(api.tools.state('giveaway').rounds[0].awards,round.awards);
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));await api.tools.close();api.panel.destroy();dom.window.close();}
});

test('场控暂停时真实工具入口仍会发送开轮、报名、关键倒计时与开奖结果，回显不重复报名',async()=>{
  const dom=page(),values=new Map(),sent=[];let api,onEvent;
  boot({page:dom.window,get:(key,fallback)=>values.get(key) ?? fallback,set:(key,value)=>values.set(key,structuredClone(value)),
    adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>true,
      send:async(text,current,hooks)=>{assert.equal(current(),true);await hooks.beforeClick();sent.push(text);api.engine.observeEcho({type:'chat',source:'socket',text,user:{id:'9'},receivedAt:Date.now()});return {submitted:true,clicked:true};}};},onReady:value=>{api=value;}});
  try {
    await api.tools.ready;api.engine.config.selfId='9';assert.equal(api.engine.running,false);
    const p=api.panel;assert.ok(p.node('[data-giveaway=feedbackEnabled]').checked);
    await api.tools.invoke('giveaway','start',{prizes:[{name:'礼盒',count:2}],durationSec:12,chatEnabled:true,keyword:'参与抽奖',giftEnabled:false});
    await until(()=>sent.some(text=>text.includes('抽奖开始')));
    const at=Date.now();for(const id of ['1','2','1'])await onEvent({type:'chat',id:crypto.randomUUID(),source:'socket',text:'参与抽奖',at,user:{id,name:`观众${id}`}});
    for(let i=0;i<1500 && !sent.some(text=>text.includes('开奖·'));i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(sent.some(text=>/报名成功.*观众1、观众2/.test(text)),JSON.stringify(sent));
    assert.ok(sent.some(text=>/抽奖剩余\d+秒/.test(text)));assert.ok(sent.some(text=>/开奖·礼盒.*观众1.*观众2/.test(text)));
    const report=await api.tools.invoke('giveaway','export');assert.equal(report.rounds[0].entrants.length,2);assert.equal(api.engine.running,false);
    const before=sent.length;await api.tools.restart('giveaway');await new Promise(resolve=>setTimeout(resolve,500));assert.equal(sent.length,before);
    assert.match(p.node('[data-giveaway-feedback]').textContent,/发送|队列/);
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));await api.tools.close();api.panel.destroy();dom.window.close();}
});
