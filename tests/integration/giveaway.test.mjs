import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {boot} from '../../src/app.js';
import {webLocks} from '../helpers/web-locks.mjs';
import {decodeMessage} from '../../src/browser/protocol.js';
import {DouyinAdapter} from '../../src/browser/adapter.js';

const flush=()=>new Promise(setImmediate);
async function until(predicate){for(let i=0;i<300;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.ok(predicate());}
function page(){
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123',pretendToBeVisual:true});
  for(const key of ['document','window','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];
  globalThis.CSS={escape:value=>value};globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:webLocks()}});return dom;
}
test('页面备用采集保留弹幕行的 UID 或安全 UID，不把同名观众合并',async()=>{
  const dom=page(),values=new Map(),captured=[];let api,adapter;
  boot({page:dom.window,get:(key,fallback)=>values.get(key) ?? fallback,set:(key,value)=>values.set(key,structuredClone(value)),
    adapterFactory:options=>{adapter=new DouyinAdapter({...options,onEvent:event=>{captured.push(event);return options.onEvent(event);}});adapter.hook=()=>{};adapter.healthy=()=>true;return adapter;},onReady:value=>{api=value;}});
  try {
    await api.tools.ready;api.engine.config.mode='preview';
    await api.tools.invoke('giveaway','start',{prize:'礼盒',winners:1,durationSec:30,chatEnabled:true,keyword:'参与抽奖',giftEnabled:false});
    const rows=[
      '<span data-e2e="chat-nickname" data-user-id="12345">同名观众：</span>',
      '<span data-e2e="chat-nickname" data-sec-uid="stable-second">同名观众：</span>',
      '<a data-e2e="chat-nickname" href="https://www.douyin.com/user/MS4w-stable-third">同名观众：</a>',
      '<span data-e2e="chat-nickname" data-uid="23456"><a href="https://www.douyin.com/user/34567">身份冲突：</a></span>',
      '<span data-e2e="chat-nickname">无身份：</span><a data-user-id="45678" href="https://www.douyin.com/user/45678">消息提到的其他观众</a>',
      '<a data-e2e="chat-nickname" href="https://other.test/user/56789">外站链接：</a>'
    ];
    for(const nickname of rows) {
      const row=dom.window.document.createElement('div');row.setAttribute('data-e2e','chat-message');
      row.innerHTML=`${nickname}<span data-e2e="chat-content">参与抽奖</span>`;
      dom.window.document.body.append(row);
    }
    await until(()=>captured.filter(event=>event.type==='chat').length===rows.length);
    await until(()=>api.tools.state('giveaway').rounds[0].entrants.length===3);
    assert.deepEqual(api.tools.state('giveaway').rounds[0].entrants.map(row=>row.userId),['12345','sec:stable-second','sec:MS4w-stable-third']);
    assert.equal(captured.filter(event=>event.type==='chat' && !event.user.id && !event.user.secUid).length,3);
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));await api.tools.close();adapter.stopDOM();api.panel.destroy();dom.window.close();}
});
test('协议解码的空时间、零 UID 口令可报名；无身份的页面弹幕明确显示失败原因',async()=>{
  const dom=page(),values=new Map();let api,onEvent;
  const varint=value=>{let n=BigInt(value);const bytes=[];while(n>127n){bytes.push(Number(n&127n)|128);n>>=7n;}return Buffer.from([...bytes,Number(n)]);};
  const number=(field,value)=>Buffer.concat([varint(field*8),varint(value)]);
  const bytes=(field,value)=>{const data=Buffer.from(value);return Buffer.concat([varint(field*8+2),varint(data.length),data]);};
  boot({page:dom.window,get:(key,fallback)=>values.get(key) ?? fallback,set:(key,value)=>values.set(key,structuredClone(value)),
    adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>true};},onReady:value=>{api=value;}});
  try {
    await api.tools.ready;api.engine.config.mode='preview';api.engine.running=true;api.engine.config.ai.enabled=true;api.engine.config.ai.chatEnabled=true;
    const prompts=[];api.engine.ai=prompt=>{prompts.push(prompt);return new Promise(()=>{});};
    await api.tools.invoke('giveaway','start',{prize:'礼盒',winners:1,durationSec:30,chatEnabled:true,keyword:'参与抽奖',giftEnabled:false});
    await onEvent({type:'chat',source:'dom',text:'参与抽奖',receivedAt:Date.now(),user:{id:'',name:'小雨'}});
    assert.match(api.panel.node('[data-giveaway-entry-feedback]').textContent,/小雨.*未报名.*用户 ID/);
    const payload=Buffer.concat([bytes(1,number(2,100)),bytes(2,Buffer.concat([number(1,0),bytes(46,'stable-viewer'),bytes(3,'小雨')])),bytes(3,'参与抽奖')]);
    const decoded=decodeMessage('WebcastChatMessage',payload);
    assert.equal(decoded.at,0);assert.equal(decoded.user.id,'0');
    const event={...decoded,receivedAt:Date.now()};await onEvent(event);await onEvent(event);
    const round=api.tools.state('giveaway').rounds[0];
    assert.deepEqual(round.entrants.map(row=>[row.userId,row.userName]),[['sec:stable-viewer','小雨']]);
    assert.equal(round.feedback.filter(row=>row.kind==='entry').length,1);
    assert.match(round.feedback.find(row=>row.kind==='entry').text,/@小雨/);
    assert.match(api.panel.node('[data-giveaway-entry-feedback]').textContent,/已报名 1 人/);
    assert.equal(prompts.length,0);
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));await api.tools.close();api.panel.destroy();dom.window.close();}
});
test('抽奖口令优先报名并立即生成 @ 确认，不触发关键词或 AI 回复',async()=>{
  const dom=page(),values=new Map();let api,onEvent,aiCalls=0;
  boot({page:dom.window,get:(key,fallback)=>values.get(key) ?? fallback,set:(key,value)=>values.set(key,structuredClone(value)),
    adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>true};},onReady:value=>{api=value;}});
  try {
    await api.tools.ready;await api.tools.invoke('giveaway','start',{prize:'礼盒',winners:1,durationSec:30,chatEnabled:true,keyword:'参与抽奖',giftEnabled:false});
    api.engine.running=true;api.engine.config.keyword.enabled=true;api.engine.config.keyword.rules=[{keywords:['参与抽奖'],exact:true,reply:'普通回复'}];
    api.engine.config.ai.enabled=true;api.engine.config.ai.chatEnabled=true;api.engine.requestChatAI=()=>{aiCalls++;};
    await onEvent({type:'chat',id:'entry',source:'socket',at:Date.now(),text:'参与抽奖',user:{id:'1',name:'小雨'}});
    const round=api.tools.state('giveaway').rounds[0];
    assert.equal(round.entrants.length,1);assert.ok(round.feedback.some(row=>row.kind==='entry' && row.text.includes('@小雨') && row.text.includes('报名成功')));
    assert.equal(api.engine.queue.filter(row=>row.kind==='keyword').length,0);assert.equal(aiCalls,0);
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));await api.tools.close();api.panel.destroy();dom.window.close();}
});
test('应用入口在猜数字和 AI 聊天中优先登记抽奖，其他弹幕仍可正常触发 AI',async()=>{
  const dom=page(),values=new Map();let api,onEvent;const prompts=[];
  boot({page:dom.window,get:(key,fallback)=>values.get(key) ?? fallback,set:(key,value)=>values.set(key,structuredClone(value)),
    adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>true};},onReady:value=>{api=value;}});
  try {
    await api.tools.ready;const engine=api.engine;engine.running=true;engine.config.mode='preview';engine.config.bot.enabled=true;
    engine.setIdentity({self:{id:'9',name:'场控'}});
    engine.ingest({type:'chat',id:'start-game',user:{id:'2',name:'小林'},text:'@场控 开始猜数字'});
    const target=String(engine.bot.session.target);
    await api.tools.invoke('giveaway','start',{prize:'礼盒',winners:1,durationSec:30,chatEnabled:true,keyword:target,giftEnabled:false});
    await onEvent({type:'chat',id:'game-entry',source:'socket',at:Date.now(),text:target,user:{id:'1',name:'小雨'}});
    assert.equal(engine.bot.session.type,'guess');
    assert.equal(api.tools.state('giveaway').rounds[0].entrants.length,1);
    engine.config.bot.enabled=false;engine.config.ai.enabled=true;engine.config.ai.chatEnabled=true;
    engine.ai=prompt=>{prompts.push(prompt);return new Promise(()=>{});};
    await onEvent({type:'chat',id:'ai-entry',source:'socket',at:Date.now(),text:target,user:{id:'3',name:'小王'}});
    assert.equal(api.tools.state('giveaway').rounds[0].entrants.length,2);assert.equal(prompts.length,0);
    await onEvent({type:'chat',id:'normal',source:'socket',at:Date.now(),text:'今天直播什么',user:{id:'4',name:'小陈'}});
    assert.equal(prompts.length,1);
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));await api.tools.close();api.panel.destroy();dom.window.close();}
});
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
    const p=api.panel;assert.equal(p.root.querySelector('[data-giveaway=feedbackEnabled]'),null);
    await api.tools.invoke('giveaway','start',{prizes:[{name:'礼盒',count:2}],durationSec:12,chatEnabled:true,keyword:'参与抽奖',giftEnabled:false});
    await until(()=>sent.some(text=>text.includes('抽奖开始')));
    const at=Date.now();for(const id of ['1','2','1'])await onEvent({type:'chat',id:crypto.randomUUID(),source:'socket',text:'参与抽奖',at,user:{id,name:`观众${id}`}});
    for(let i=0;i<1500 && !sent.some(text=>text.includes('开奖·'));i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(sent.some(text=>/报名成功.*@观众1/.test(text)),JSON.stringify(sent));
    assert.ok(sent.some(text=>/报名成功.*@观众2/.test(text)),JSON.stringify(sent));
    assert.ok(sent.some(text=>/抽奖剩余\d+秒/.test(text)));assert.ok(sent.some(text=>/开奖·礼盒.*观众1.*观众2/.test(text)));
    const report=await api.tools.invoke('giveaway','export');assert.equal(report.rounds[0].entrants.length,2);assert.equal(api.engine.running,false);
    const before=sent.length;await api.tools.restart('giveaway');await new Promise(resolve=>setTimeout(resolve,500));assert.equal(sent.length,before);
    assert.match(p.node('[data-giveaway-feedback]').textContent,/发送|队列/);
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));await api.tools.close();api.panel.destroy();dom.window.close();}
});
