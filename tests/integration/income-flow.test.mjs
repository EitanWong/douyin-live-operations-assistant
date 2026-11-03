import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { boot } from '../../src/app.js';
import { readAudienceContributions } from '../../src/browser/adapter.js';
import { GiftLedger, GiftStore, giftDate } from '../../src/data/gifts.js';

const room = '1234567890';
const samples = [
  ['喂喂','粉丝团灯牌',1,1], ['总有刁民想害朕','粉丝团灯牌',1,1],
  ['LILAC','甜心跑车',1,1200], ['小包（回老家版）','为你闪耀',6,9],
  ['小包（回老家版）','粉丝团灯牌',1,1], ['LILAC','守护天使',1,6000],
  ['LILAC','玫瑰之约',1,6000], ['阿莫西西多','点亮粉丝团',1,9]
];
const waitFor = async (predicate,timeout=2000) => {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(predicate(), '等待状态更新超时');
};

test('未打开主播数据页也主动播报本场榜单及千票人数，预览模式不调用发送',async()=>{
  const dom=new JSDOM('<body></body>',{url:`https://live.douyin.com/${room}`,pretendToBeVisual:true});
  for (const name of ['document','window','location','MutationObserver','HTMLElement']) globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  const ledger=new GiftLedger();let api;
  ledger.startSession(Date.now()-1000,'platform','current');
  for (const [id,name,count] of [['1','甲',1200],['2','乙',100]]) ledger.observe({id,groupId:id,giftId:'g',count,unitValue:1,final:true,user:{id,name}},room,`uid:${id}`);
  const values=new Map([[`live-assistant:income:${room}`,ledger.serialize()],[`live-assistant:config:${room}`,{anchorId:'123',mode:'preview',automation:{autoStart:false}}]]);
  const get=(key,fallback)=>structuredClone(values.get(key) ?? fallback), set=async(key,value)=>values.set(key,structuredClone(value));
  const store=new GiftStore({get,set,all:async()=>Object.fromEntries(values)});
  const engine=boot({page:dom.window,get,set,del:key=>values.delete(key),repository:store,request:()=>{},
    adapterFactory:()=>({status:{},hook(){},observeDOM(){},stopDOM(){},healthy:()=>false,sync(){},send(){assert.fail('预览模式不应发送');}}),
    identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>api=value});
  try {
    await api.panel.callbacks.income();
    api.panel.tab('gift');assert.equal(api.panel.activeTab,'gift');engine.start();
    await waitFor(()=>engine.stats.previews===3,5000);
    assert.deepEqual(api.panel.entries.filter(row=>row.category==='preview').map(row=>row.message),[
      '本场观众贡献榜第1名：甲。','本场观众贡献榜第2名：乙。','本场千票贡献榜人数：1 人。'
    ]);
    assert.equal(engine.queue.length,0);assert.equal(engine.stats.submitted,0);
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});

test('本场播报预览与实际入队一致，统计历史、搜索和表格排序不影响前三名',async()=>{
  const dom=new JSDOM('<body></body>',{url:`https://live.douyin.com/${room}`,pretendToBeVisual:true});
  for (const name of ['document','window','location','MutationObserver','HTMLElement']) globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  let time=Date.now()-10000, api;
  const ledger=new GiftLedger({now:()=>time});
  const gift=(id,name,count)=>({type:'gift',id,groupId:id,giftId:'g',giftName:'星星',count,unitValue:1,final:true,user:{id,name}});
  ledger.startSession(time,'platform','old');ledger.observe(gift('9','历史榜首',99999),room,'uid:9');ledger.endSession(time+1000);
  time+=2000;ledger.startSession(time,'platform','current');
  for (const [i,count] of [100,300,200,50].entries()) ledger.observe(gift(String(i+1),`观众${i+1}`,count),room,`uid:${i+1}`);
  const values=new Map([[`live-assistant:income:${room}`,ledger.serialize()],[`live-assistant:config:${room}`,{anchorId:'123',mode:'auto',automation:{autoStart:false}}]]);
  const get=(key,fallback)=>structuredClone(values.get(key) ?? fallback), set=async(key,value)=>values.set(key,structuredClone(value));
  const store=new GiftStore({get,set,all:async()=>Object.fromEntries(values)});
  const engine=boot({page:dom.window,get,set,del:key=>values.delete(key),repository:store,request:()=>{},
    adapterFactory:()=>({status:{},hook(){},observeDOM(){},stopDOM(){},healthy:()=>false,sync(){}}),
    identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>api=value});
  try {
    api.panel.tab('anchor');
    await api.panel.callbacks.income();
    await waitFor(()=>api?.panel.anchorDashboard.broadcastSession && engine.liveData()?.income);
    const dashboard=api.panel.anchorDashboard, sessionId=dashboard.broadcastSession;
    engine.start();
    api.panel.node('[data-anchor-period=all]').click();
    const search=api.panel.node('[data-anchor-audience-search]');search.value='历史榜首';search.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    const sort=api.panel.node('[data-anchor-audience-sort]');sort.value='giftCount';sort.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    const preview=api.panel.node('[data-anchor-broadcast-preview]').textContent;
    assert.match(preview,/第1名：观众2。/);assert.match(preview,/第2名：观众3。/);assert.match(preview,/第3名：观众1。/);
    assert.doesNotMatch(preview,/钻|历史榜首|观众4/);
    await api.panel.callbacks.broadcastAnchor(sessionId);
    assert.deepEqual(engine.queue.map(job=>job.text),preview.split('\n'));
    await assert.rejects(api.panel.callbacks.broadcastAnchor(sessionId),/重复播报/);
    const queued=engine.queue.length;
    await assert.rejects(api.panel.callbacks.broadcastAnchor('old'),/场次已变化/);
    assert.equal(engine.queue.length,queued);
    await store.recordSession({room,type:'end',roomId:'current',at:Date.now()});
    await assert.rejects(api.panel.callbacks.broadcastAnchor(sessionId),/场次已变化/);
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});

test('扩展后台断连时标明待入账；导出不依赖后台，恢复后样本全部入账且重复导入不重计', async () => {
  const dom = new JSDOM('<body></body>', {url:`https://live.douyin.com/${room}`,pretendToBeVisual:true});
  for (const name of ['document','window','location','MutationObserver','HTMLElement']) globalThis[name] = dom.window[name];
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  globalThis.CSS = {escape:s=>s};
  const values = new Map(), get = (key,fallback) => structuredClone(values.get(key) ?? fallback);
  const set = async (key,value) => { values.set(key,structuredClone(value)); };
  const store = new GiftStore({get,set,all:async()=>Object.fromEntries(values)});
  const ledger = new GiftLedger();
  ledger.observe({id:'baseline-a',count:14,unitValue:1,final:true},room,'uid:old');
  ledger.observe({id:'baseline-b',count:1,unitValue:89,final:true},room,'uid:old');
  await set(`live-assistant:income:${room}`,ledger.serialize());
  let disconnected = false, api, onEvent, exported;
  const createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL;
  URL.createObjectURL = blob => { exported = blob; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  try {
    boot({page:dom.window,get,set,del:key=>values.delete(key),request:()=>{},
      repository:{profile:p=>store.profile(p),profiles:()=>store.profiles(),report:(...args)=>store.report(...args),record:item=>{if(disconnected)throw new Error('Extension context invalidated.');return store.record(item);}},
      adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},healthy:()=>false,sync(){},exportEvents:async()=>{throw new Error('Extension context invalidated.');}};},
      identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>{api=value;}
    });
    await waitFor(()=>api?.panel.node('[data-gift-diamonds]').textContent==='103');
    disconnected = true;
    for (const [i,[name,giftName,count,unitValue]] of samples.entries()) await onEvent({type:'gift',id:`sample-${i}`,groupId:`combo-${i}`,giftId:giftName,giftName,count,unitValue,final:true,user:{id:name,name},receivedAt:Date.now()});
    await api.checkpoint();
    assert.equal(values.get(`live-assistant:runtime:${room}`).incomePending.length,8,'引擎暂停时也保存待入账恢复点');
    assert.match(api.panel.node('[data-gift-estimate-note]').textContent,/后台断开/);
    assert.match(api.panel.node('[data-gift-estimate-note]').textContent,/8 组礼物待入账/);
    assert.doesNotMatch(api.panel.node('[data-gift-estimate-note]').textContent,/已保存到本地账本/);
    await api.panel.callbacks.exportEvents();
    const recovery = JSON.parse(await exported.text());
    assert.equal(recovery.incomePending.length,8);
    assert.match(recovery.collection.error,/context invalidated/);
    await assert.rejects(api.panel.callbacks.importIncome({...recovery,room:'other'}),/当前直播间/);
    disconnected = false;
    await api.panel.callbacks.importIncome(recovery);
    await api.panel.callbacks.importIncome(recovery);
    const report = await store.report(room,giftDate().slice(0,7));
    assert.equal(report.summary.totalDiamonds,13369);
    assert.equal(report.summary.giftCount,28);
    assert.equal(report.summary.estimatedIncome,668.45);
    assert.equal(api.panel.node('[data-gift-diamonds]').textContent,'13,369');
    assert.match(api.panel.node('[data-gift-income]').textContent,/668\.45/);
  } finally {
    dom.window.dispatchEvent(new dom.window.Event('pagehide')); api?.panel.destroy();dom.window.close();
    URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL;
  }
});

test('场控暂停时观众榜变动即时触发整榜校准，补回礼物和重复DOM刷新不重复',async()=>{
  const dom=new JSDOM(`<body><div id="chatroom"><div><div class="LyAdeVIF sBRqUw32"><div></div><div></div><div><div><div><div><div>
    <div class="LLkRvMAV"><div>1</div><div class="_QlQGbi1">LILAC</div><div class="Ql4e1dvM"><span>岁小孩</span>0</div></div>
    <div class="LLkRvMAV"><div>2</div><div class="_QlQGbi1">用户甲</div><div class="Ql4e1dvM">1001</div></div>
  </div></div></div></div></div></div></div></div></body>`,{url:`https://live.douyin.com/${room}`,pretendToBeVisual:true});
  for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  const values=new Map(),get=(key,fallback)=>structuredClone(values.get(key)??fallback);
  const set=async(key,value)=>values.set(key,structuredClone(value));
  const store=new GiftStore({get,set,all:async()=>Object.fromEntries(values)});
  let api,onEvent;
  const engine=boot({page:dom.window,get,set,del:key=>values.delete(key),repository:store,request:()=>{},
    adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},healthy:()=>false,sync(){},readAudienceContributions:()=>readAudienceContributions(dom.window.document)};},
    identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>{api=value;}
  });
  try {
    await waitFor(()=>api);
    await onEvent({type:'start',roomId:'broadcast',at:Date.now(),source:'platform'});
    await onEvent({type:'room-audience',ranks:[{user:{id:'12345678',name:'用户甲'}}]});
    await waitFor(()=>values.get(`live-assistant:income:${room}`)?.sessions?.[0]?.[1]?.contributionFloor?.score===1001);
    assert.equal(engine.running,false);
    const score=dom.window.document.querySelector('.Ql4e1dvM');
    const updatedAt=Date.now();score.innerHTML='<span>岁小孩</span>6297';
    await waitFor(()=>values.get(`live-assistant:income:${room}`)?.sessions?.[0]?.[1]?.contributionFloor?.score===7298);
    assert.ok(Date.now()-updatedAt<1500,'不等待5秒兜底轮询');
    let report=await store.report(room,giftDate().slice(0,7));
    assert.ok(Math.abs(report.currentSession.estimatedIncome-364.9)<1e-8);
    assert.equal(report.currentSession.totalDiamonds,7298);
    assert.equal(report.currentSession.giftDiamonds,0);assert.equal(report.currentSession.calibrationDiamonds,7298);
    await waitFor(()=>api.panel.node('[data-gift-diamonds]').textContent==='7,298');
    assert.match(api.panel.node('[data-gift-income]').textContent,/364\.90/);
    assert.match(api.panel.node('[data-gift-diamonds-label]').textContent,/含榜单补差/);
    assert.match(api.panel.node('[data-gift-estimate-note]').textContent,/已采集礼物 0 钻 \+ 榜单补差 7,298 钻/);
    score.innerHTML='<span>岁小孩</span>6297';
    await onEvent({type:'gift',id:'late',roomId:'broadcast',groupId:'late',giftId:'g',giftName:'礼物',count:6297,unitValue:1,final:true,user:{id:'87654321',name:'LILAC'},receivedAt:Date.now()});
    await waitFor(()=>values.get(`live-assistant:income:${room}`)?.sessions?.[0]?.[1]?.giftCount===6297);
    report=await store.report(room,giftDate().slice(0,7));
    assert.ok(Math.abs(report.currentSession.estimatedIncome-364.9)<1e-8);
    assert.equal(report.currentSession.giftCount,6297);
    assert.equal(report.currentSession.totalDiamonds,7298);
    assert.equal(report.currentSession.giftDiamonds,6297);assert.equal(report.currentSession.calibrationDiamonds,1001);
    await waitFor(()=>api.panel.node('[data-gift-estimate-note]').textContent.includes('已采集礼物 6,297 钻'));
    assert.equal(api.panel.node('[data-gift-diamonds]').textContent,'7,298');
    assert.match(api.panel.node('[data-gift-income]').textContent,/364\.90/);
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});
