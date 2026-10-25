import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { TRUTH_QUESTIONS } from '../../src/data/interaction-questions.js';
import { boot } from '../../src/app.js';
import { webLocks } from '../helpers/web-locks.mjs';

test('应用入口允许登录账号手动回答，同时保留发送回显过滤和自发事件排除', async () => {
  const dom = new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890',pretendToBeVisual:true});
  for (const name of ['document','window','location','MutationObserver','HTMLElement']) globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
  globalThis.CSS={escape:value=>value};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:webLocks()}});
  const values=new Map([['live-assistant:config:1234567890',{mode:'auto',selfId:'100',bot:{enabled:true}}]]);
  const self={id:'100',name:'Eitan'},anchor={id:'200',name:'一只开心🎀'};
  let onEvent,api;
  const engine=boot({page:dom.window,get:(key,fallback)=>values.get(key)??fallback,set:(key,value)=>values.set(key,value),del:key=>values.delete(key),request:()=>assert.fail('不调用 AI'),
    adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>false};},
    identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>{api=value;}});
  try {
    engine.setIdentity({self}); engine.bot.random=()=>5.1/TRUTH_QUESTIONS.length; engine.start();
    await onEvent({type:'enter',id:'self-enter',user:self});
    await onEvent({type:'chat',id:'self-command',user:self,text:'@Eitan 真心话'});
    assert.equal(engine.bot.session,null);
    await onEvent({type:'chat',id:'question',user:anchor,text:'@Eitan 真心话'});
    assert.equal(engine.bot.session?.phase,'answer');
    const automatic='梦想成为一个大明星';
    const record=engine.deliveries.create(automatic,[],self);engine.deliveries.clicked(record);
    await onEvent({type:'chat',id:'echo',source:'socket',user:self,text:automatic});
    assert.equal(engine.stats.echoed,1);
    assert.equal(engine.bot.session?.phase,'answer');
    await onEvent({type:'chat',id:'manual',source:'socket',user:self,text:'@Eitan 我想当一名医生'});
    assert.equal(engine.bot.session,null);
    assert.equal(engine.queue.length,2);
    assert.match(engine.queue[1].text,/^Eitan，.*梦想/u);
    assert.doesNotMatch(engine.queue[1].text,/一只开心|大明星/u);
  } finally {
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();
  }
});
