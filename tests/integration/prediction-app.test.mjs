import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {boot} from '../../src/app.js';
import {PredictionService} from '../../src/analytics/service.js';
import {AnalyticsArchive} from '../../src/analytics/archive.js';
import {webLocks} from '../helpers/web-locks.mjs';
import {EventInbox} from '../../src/runtime/inbox.js';
test('paused app observes chat and gift overrides through durable predictions into the real panel without sending',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123',pretendToBeVisual:true});
 for(const key of ['document','window','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:v=>v};
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:webLocks()}});
 const values=new Map([['live-assistant:config:123',{anchorId:'2',mode:'preview',automation:{autoStart:false},gift:{prices:{'1':20}}}]]),archive=new AnalyticsArchive({indexedDB:new IDBFactory(),IDBKeyRange}),service=new PredictionService({archive});
 let api,options;const ack=[];
 boot({page:dom.window,get:(k,f)=>values.get(k)??f,set:async(k,v)=>values.set(k,v),del:k=>values.delete(k),request:()=>assert.fail('不调用云端或发送消息'),
 predictions:(action,value,anchor)=>service.call({room:'123',anchor},action,value),
 journal:{ackMany:async keys=>ack.push(...keys)},adapterFactory:o=>{options=o;return {status:{},hook(){},sync(){},observeDOM(){},stopDOM(){},healthy:()=>true};},identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>api=value});
 try{
  await api.tools.ready;assert.equal(api.engine.running,false);assert.equal(options.shouldReadChat(),true);
  const inbox=new EventInbox({handle:options.onEvent,wait:async()=>{}});
  await inbox.admit({type:'start',roomId:'1234',at:Date.now(),startAt:0,source:'platform-observed',receivedAt:Date.now()});
  assert.equal(inbox.status().quarantined,0,'unknown start time must not quarantine the session boundary');
  for(let i=0;i<55;i++){
   await inbox.admit({type:'enter',id:`enter-${i}`,at:0,user:{id:'9',name:'观众'},receivedAt:Date.now()});
   assert.equal(inbox.status().quarantined,0,'protocol time zero must not fill the quarantine');
  }
  await inbox.admit({type:'room-audience',id:'online',at:0,onlineCount:29,receivedAt:Date.now()});
  await inbox.admit({type:'chat',id:'c',at:0,_journalKey:'jc',user:{id:'9',name:'观众'},text:'准备送个礼物',receivedAt:Date.now()});
  assert.equal(inbox.status().blocked,false);assert.equal(inbox.status().quarantined,0);
  await inbox.admit({type:'gift',id:'g',at:0,_journalKey:'jg',groupId:'g',giftId:'1',count:3,user:{id:'9',name:'观众'},receivedAt:Date.now()});
  await api.tools.invoke('predictions','refresh');const r=api.tools.state('predictions').report;
  assert.equal(r.observedDiamonds,60);assert.equal(r.viewers[0].observedGiftGroups,1);assert.equal(r.semantics.sampleSize,1);
  const saved=await archive.read({room:'123',anchor:'2'});
  assert.equal(saved.session.startKnown,false);assert.equal(saved.minutes.reduce((sum,row)=>sum+(row.enters || 0),0),55);
  assert.equal(saved.minutes.at(-1).online,29);
  assert.match(api.panel.root.querySelector('[data-pred-observed]').textContent,/60/);
  assert.ok(!JSON.stringify(api.engine.aiContext().liveContext.predictions).includes('uid:9'));
  assert.equal(api.engine.stats.submitted,0);await new Promise(resolve=>setTimeout(resolve,150));await api.checkpoint();assert.ok(ack.includes('jg'));
 }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));await api.tools.close();api.panel.destroy();service.close();dom.window.close();}
});
