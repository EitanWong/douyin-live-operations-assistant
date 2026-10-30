import {RoomContext,roomFromURL} from '../../src/browser/room-context.js';
import { ProtocolCache } from '../../extension/protocol-cache.js';
import { fanclubFrameContext, cleanFanclubSnapshot } from '../../src/data/fanclub.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { validateEndpoint } from '../../src/services/ai.js';
import { GiftStore } from '../../src/data/gifts.js';
import { DurableStorage, isDurableKey } from '../../extension/durable-storage.js';
import { EventInbox } from '../../src/runtime/inbox.js';
import { installCollectionKeeper } from '../../extension/collection-keeper.js';
import { RequestBridgeClient } from '../../src/browser/request-sender.js';
import { webLocks } from '../helpers/web-locks.mjs';
import { buildFixture } from '../helpers/build.mjs';
const {dist:testDist, cleanup} = await buildFixture();
after(cleanup);
const file=name=>join(testDist,'chrome-extension',name);
const nativeQueues=new WeakMap();
function connectNative(page) {
  if(nativeQueues.has(page))return;
  const events=[],captures=[];nativeQueues.set(page,{events,captures});
  const original=page.chrome.runtime.sendMessage.bind(page.chrome.runtime);
  page.chrome.runtime.sendMessage=async request=>{
    if(request.type!=='page-command')return original(request);
    if(page.__douyinAssistantPageV2)return {ok:true,value:await page.__douyinAssistantPageV2.call(request.command)};
    if(request.command.type==='drain')return {ok:true,value:{events:events.splice(0),captures:captures.splice(0),status:{}}};
    return {ok:true,value:false};
  };
}
function nativeEvent(page,event) {nativeQueues.get(page).events.push(event);}
async function rawEntry(entry) {
  let source=(await readFile(new URL(`../../extension/${entry}.js`,import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
  if(entry==='content')source=source.replace('async function startContent() {\n','').replace(/\n}\nstartContent\(\);\s*$/,'');
  return source;
}
async function evalPage(page) {page.RoomContext=RoomContext;page.eval(await rawEntry('page'));}
async function evalContent(page) {connectNative(page);page.eval(await readFile(file('content.js'),'utf8'));}
function pageTransport(page) {return async request=>({ok:true,value:await page.__douyinAssistantPageV2.call(request.command)});}
test('构建后的 MAIN 与隔离点赞桥无本人 IM 回执也完成三批，重复批次只发一次，停止票据立即失效',async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1',runScripts:'outside-only'}),page=dom.window,requests=[];
  try {
    Object.assign(page,{TextDecoder,TextEncoder});
    page.__STORE__={roomStore:{roomInfo:{roomId:'7700231539170609947',room:{web_rid:'1',status:2,room_auth:{Digg:true}}}},userStore:{userInfo:{id_str:'987654321'}}};
    const client={defaults:{baseURL:page.location.origin,withCredentials:true},request:async request=>{requests.push(request);return {data:{status_code:0,data:{}}};}};
    const require=()=>({ZP:client});require.m={request:function(){return ['API_DOMAIN','interceptors.request.use','/webcast/privilege/subscribe'];}};
    page.webpackChunkdouyin_live_v2=[];page.webpackChunkdouyin_live_v2.push=value=>value[2](require);
    page.eval(await readFile(file('page.js'),'utf8'));
    const bridge=new RequestBridgeClient(page,pageTransport(page)),prepared=await bridge.prepareLike();
    assert.equal(prepared.available,true);
    let now=page.Date.now();page.Date.now=()=>now;
    for(const [i,count] of [3,3,1].entries()){
      now+=1;
      const result=await bridge.commitLike(prepared.token,count,i+1);
      assert.equal(result.submitted,true);assert.equal(result.count,count);
      assert.equal((await bridge.commitLike(prepared.token,count,i+1)).submitted,true);
    }
    assert.deepEqual(requests.map(request=>request.params.count),[3,3,1]);
    await bridge.stopLike(prepared.token);
    assert.equal((await bridge.commitLike(prepared.token,3,4)).submitted,false);
    assert.equal(requests.length,3);
  }finally{page.close();}
});
async function worker(values = {}, indexedDB = new IDBFactory()) {
  let usedBytes = 0, listener,changed; const sent=[], requests=[]; let allowed=true;
  const WorkerDurableStorage = class extends DurableStorage {
    constructor(options = {}) { super({...options, indexedDB: options.indexedDB || indexedDB, IDBKeyRange}); }
  };
  const chrome={runtime:{getURL:()=> 'chrome-extension://test/',onMessage:{addListener:f=>listener=f}},storage:{local:{QUOTA_BYTES:5*1024*1024,getBytesInUse:async()=>usedBytes,setAccessLevel:async()=>{},get:async()=>values,set:async v=>Object.assign(values,v),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete values[key];}},onChanged:{addListener:f=>changed=f}},permissions:{contains:async()=>allowed},tabs:{query:async()=>[{id:1,url:'https://live.douyin.com/1'},{id:2,url:'https://live.douyin.com/2'}],sendMessage:async(id,m)=>{sent.push([id,m]);return {ok:true};}}};
  const code=(await readFile(file('background.js'),'utf8'));
  vm.runInNewContext(code,{fanclubFrameContext,cleanFanclubSnapshot,chrome,ProtocolCache,installCollectionKeeper,validateEndpoint,GiftStore,DurableStorage:WorkerDurableStorage,isDurableKey,indexedDB,IDBKeyRange,TextEncoder,crypto:globalThis.crypto,AbortController,setTimeout,clearTimeout,URL,URLSearchParams,fetch:async(url,opts)=>{requests.push({url,opts});return {status:200,url,text:async()=>'{"choices":[]}'};}});
  const sender={frameId:0,tab:{url:'https://live.douyin.com/1'}};
  const durable=()=>new DurableStorage({indexedDB,IDBKeyRange,local:chrome.storage.local});
  return {values,indexedDB,durable,sent,requests,changed,usage:value=>{usedBytes=value;},send:(m,s=sender)=>new Promise(r=>listener(m,s,result=>r(structuredClone(result)))),deny:()=>allowed=false};
}
test('MV3产物包含所有入口、图标，无远程代码依赖', async()=>{
  const m=JSON.parse(await readFile(file('manifest.json'),'utf8')); assert.equal(m.manifest_version,3);
  assert.deepEqual(m.permissions,['storage','unlimitedStorage','alarms','power','scripting']); assert.deepEqual(m.host_permissions,['https://live.douyin.com/*']);
  for(const name of [m.background.service_worker,m.action.default_popup,...Object.values(m.icons),...m.content_scripts.flatMap(s=>s.js)]) await access(file(name));
  assert.equal(m.content_scripts[0].world,'MAIN'); assert.equal(m.content_scripts[1].world,'ISOLATED');
  const main=await readFile(file('page.js'),'utf8'); assert.doesNotMatch(main,/chrome\.storage|GM_getValue|api-key:|GM_xmlhttpRequest/);
  assert.doesNotMatch(main,/window\.postMessage/);
});

test('粉丝团跨域快照只转交同标签主页，拒绝错误来源、UID、过量成员并持久化回放',async()=>{
  const w=await worker(),frameURL='https://lf-webcast-gr-sourcecdn.bytegecko.com/obj/byte-gurd-source-gr/webcast/mono/h5/fansclub_h5_douyin/pages/member_list/index.html?anchor_id=123&room_id=456&user_id=321&fans_level=6&light_status=1';
  const sender={frameId:2,url:frameURL,tab:{id:1,url:'https://live.douyin.com/1'}};
  const event={type:'anchor-fanclub',source:'native-fanclub',anchorId:'123',roomId:'456',fansCount:'14343',lightedCount:'88',members:[],receivedAt:Date.now()-10000};
  assert.equal((await w.send({type:'fanclub-frame',event},sender)).ok,true);
  assert.equal(w.sent.length,1);assert.equal(w.sent[0][0],1);
  assert.equal(w.sent[0][1].event.viewer.level,6);
  assert.equal(w.sent[0][1].event.receivedAt,event.receivedAt);
  for(const invalid of [{...sender,url:frameURL.replace('bytegecko.com','evil.test')},{...sender,frameId:0}]) assert.equal((await w.send({type:'fanclub-frame',event},invalid)).ok,false);
  assert.equal((await w.send({type:'fanclub-frame',event:{...event,anchorId:'999'}},sender)).ok,false);
  assert.equal((await w.send({type:'fanclub-frame',event:{...event,members:Array(11).fill({})}},sender)).ok,false);
  const saved=await w.send({type:'event-append',id:'fansclub-event-00000001',event:w.sent[0][1].event});
  assert.equal(saved.ok,true);
  const restarted=await worker(w.values,w.indexedDB);
  assert.equal((await restarted.send({type:'event-list'})).value[0].event.fansCount,'14343');
});

test('生成的粉丝团 iframe 脚本读取原生字段并分块发送，未加载字段不伪造',async()=>{
  const rows=Array.from({length:21},(_,i)=>`<div class="item"><span class="fansclub-list-item-nickname">成员${i}</span><span class="fmlchlci-right">0</span></div>`).join('');
  const dom=new JSDOM(`<div class="title-bar-text">主播粉丝团</div><div class="fmlc-hasfans-header-left">共14343位"粉丝"，88位勋章点亮中</div><div class="list-scroll">${rows}</div>`,{url:'https://lf-webcast-gr-sourcecdn.bytegecko.com/obj/byte-gurd-source-gr/webcast/mono/h5/fansclub_h5_douyin/pages/member_list/index.html?anchor_id=123&room_id=456',runScripts:'outside-only'});
  const calls=[],page=dom.window;
  try {
    const source=(await readFile(file('fanclub-frame.js'),'utf8')).replace(/window\s*!==\s*window\.top/g,'true');
    page.chrome={runtime:{id:'test',sendMessage:async message=>{calls.push(message);return {ok:true};}}};
    page.eval(source);await new Promise(setImmediate);
    assert.deepEqual(calls.map(row=>row.event.members.length),[10,10,1]);
    assert.equal(calls[2].event.totalRows,21);assert.equal(calls[2].event.members[0].position,21);
    assert.equal(calls[2].event.members[0].level,null);
    page.dispatchEvent(new page.Event('pagehide'));
  } finally {page.close();}
});

test('展馆 iframe 保级消息仅可从已知指标页转交同标签主页，错误来源与 UID 被拒绝',async()=>{
  const w=await worker();
  const frameURL='https://lf-normal-gr-sourcecdn.bytegecko.com/obj/byte-gurd-source-gr/webcast/mono/h5/live_pc_indicator_container_douyin/pages/index.html?anchor_id=123&room_id=456';
  const sender={frameId:2,url:frameURL,tab:{id:1,url:'https://live.douyin.com/1'}};
  const event={type:'anchor-exhibition-retention',source:'native-indicator',anchorId:'123',roomId:'456',name:'甄选展馆',text:'甄选展馆差1款保级',remaining:1};
  await w.send({type:'exhibition-indicator',event},sender);
  assert.equal(w.sent.length,1);assert.equal(w.sent[0][0],1);assert.equal(w.sent[0][1].event.remaining,1);
  for(const invalid of [{...sender,url:frameURL.replace('bytegecko.com','example.com')},{...sender,frameId:0}]) {
    assert.equal((await w.send({type:'exhibition-indicator',event},invalid)).ok,false);
  }
  assert.equal((await w.send({type:'exhibition-indicator',event:{...event,anchorId:'789'}},sender)).ok,false);
  assert.equal(w.sent.length,1);
});

test('构建后的指标脚本在动态展馆提示出现后采集且不注入场控 UI',async()=>{
  const source=await readFile(file('indicator-frame.js'),'utf8');
  const dom=new JSDOM('<body><div><span>甄选展馆</span><span>差1款保级</span></div></body>',{url:'https://lf-normal-gr-sourcecdn.bytegecko.com/obj/byte-gurd-source-gr/webcast/mono/h5/live_pc_indicator_container_douyin/pages/index.html?anchor_id=123&room_id=456',runScripts:'outside-only'});
  const calls=[],page=dom.window;
  try {
    // 测试环境模拟被嵌入的 frame，避免接触真实直播间发送通道。
    const code=source.replace(/window !== window.top/g,'true');
    page.chrome={runtime:{id:'test',sendMessage:async message=>{calls.push(message);return {ok:true};}}};
    page.eval(code);await new Promise(setImmediate);
    assert.equal(calls[0].event.remaining,1);assert.equal(calls[0].event.anchorId,'123');
    assert.equal(page.document.querySelector('[data-live-assistant]'),null);
    page.dispatchEvent(new page.Event('pagehide'));
  } finally {page.close();}
});
test('后台与弹窗的完整模块依赖均可从扩展产物内解析', async()=>{
  const result = await build({
    absWorkingDir:join(testDist,'chrome-extension'),
    entryPoints:['background.js','popup.js'],
    bundle:true,write:false,outdir:'module-check',format:'esm',platform:'browser',
    metafile:true,logLevel:'silent'
  });
  for (const path of Object.keys(result.metafile.inputs)) {
    assert.ok(!path.startsWith('../'),`模块依赖不能越出扩展目录：${path}`);
  }
  for (const output of Object.values(result.metafile.outputs)) {
    assert.deepEqual(output.imports,[],'所有模块依赖必须包含在扩展产物中');
  }
});
test('油猴与隔离脚本产物均可执行礼物与观众回复上下文', async () => {
  for (const entry of ['userscript','content']) {
    const path = entry === 'userscript' ? join(testDist,'douyin-live-assistant.user.js') : file(`${entry}.js`);
    const source = await readFile(path,'utf8');
    const dom = new JSDOM('<body></body>',{url:'https://live.douyin.com/1',runScripts:'outside-only'});
    try {
      Object.assign(dom.window,{TextDecoder,TextEncoder});
      dom.window.eval(source.replace(/(?:boot|startContent)\(\);\s*}\)\(\);\s*$/, 'globalThis.replyTest = {Engine, copy, DEFAULTS};})();'));
      const {Engine,copy,DEFAULTS} = dom.window.replyTest;
      assert.equal(DEFAULTS.pkOperations.durationSec,300,entry);
      const config=copy(DEFAULTS);config.ai.enabled=true;config.gift.responseMode='ai';config.mode='preview';config.anchorId='1234567890';
      let prompt;
      const engine=new Engine({config,ai:async value=>{prompt=value;return '青山，这份礼物好惊喜，谢谢支持！';}});
      assert.ok(engine.pkOperations.view().plan,`${entry}: PK 依赖可初始化`);
      engine.start();
      engine.ingest({type:'gift',id:'bundled-gift',user:{id:'viewer',name:'青山',wealthLevel:50,fanClubs:[{anchorId:'1234567890',level:12,status:1}]},giftId:'star',giftName:'星星',unitValue:100,count:20,final:true});
      await engine.tick(false);await new Promise(setImmediate);
      assert.equal(prompt.task.data.totalDiamonds,2000,entry);
      assert.equal(prompt.task.data.valueTier,'large',entry);
      assert.equal(prompt.target.wealthLevel,50,entry);assert.equal(prompt.target.fanLevel,12,entry);
      assert.equal(engine.queue[0].aiGenerated,true,entry);
      engine.stop();
    } finally {dom.window.close();}
  }
});

test('room_id 查询链接的 MAIN 观察器和后台均识别同一直播间',async()=>{
  const w=await worker(),sender={frameId:0,tab:{url:'https://live.douyin.com/?room_id=1'}};
  assert.equal((await w.send({type:'init'},sender)).ok,true);
  assert.equal((await w.send({type:'init'},{frameId:0,tab:{url:'https://evil.example/?room_id=1'}})).ok,false);
  let captured;
  const dom=new JSDOM('<body></body>',{url:sender.tab.url,runScripts:'outside-only'});
  dom.window.DouyinAdapter=class {constructor(options){captured=options;}hook(){}emitStatus(){}};
  dom.window.DEFAULTS={};dom.window.copy=value=>value;
  try {await evalPage(dom.window);assert.equal(typeof captured.onEvent,'function');}
  finally {dom.window.close();}
});

test('MAIN 观察器在隔离脚本读取前完整缓存事件，分页读取只交付一次', async () => {
  let captured;
  const dom = new JSDOM('<body></body>', {url:'https://live.douyin.com/1',runScripts:'outside-only'});
  const received = [];
  dom.window.DouyinAdapter = class { constructor(options) {captured=options;} hook() {} emitStatus() {} };
  dom.window.DEFAULTS = {}; dom.window.copy = value => value;

  try {
    await evalPage(dom.window);
    for(let n=0;n<160;n++)captured.onEvent({type:n % 2 ? 'chat' : 'gift',id:String(n),text:`消息${n}`});
    assert.equal(received.length,0);
    const drain=()=>received.push(...dom.window.__douyinAssistantPageV2.call({type:'drain'}).events);
    drain();drain();drain();
    assert.equal(received.length,160); assert.equal(received[159].id,'159'); assert.equal(received.filter(e=>e.type==='chat').length,80);
  } finally {dom.window.close();}
});
test('隔离脚本把 MAIN 原始协议帧送入独立持久化通道', async () => {
  const dom = new JSDOM('<body></body>', {url:'https://live.douyin.com/1',runScripts:'outside-only',pretendToBeVisual:true});
  const saved=[];
  Object.assign(dom.window,{TextDecoder,TextEncoder,chrome:{runtime:{
    sendMessage:async request=>{
      if(request.type==='init')return {ok:true,value:{}};
      if(request.type==='protocol-append'){saved.push(request);return {ok:true,value:{key:'stored'}};}
      if(request.type==='event-list'||request.type==='protocol-list')return {ok:true,value:[]};
      return {ok:true,value:true};
    },onMessage:{addListener(){}}
  }}});
  try {
    await evalContent(dom.window);
    await new Promise(resolve=>setTimeout(resolve,100));
    const record={protocolVersion:1,transport:'socket',receivedAt:Date.now(),rawBytes:2,rawBase64:'CAI=',messages:[{method:'WebcastMysteryMessage',messageId:'2',decodedTypes:[]}]};
    dom.window.dispatchEvent(new dom.window.MessageEvent('message',{source:dom.window,origin:dom.window.location.origin,data:{source:'live-assistant-page-v1',room:'1',type:'protocol-frame',record}}));
    await new Promise(resolve=>setTimeout(resolve,250));assert.equal(saved.length,0,'公开消息不得写入协议存储');
    nativeQueues.get(dom.window).captures.push(record);
    const deadline=Date.now()+1000;
    while(Date.now()<deadline&&!saved.length)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(saved.length,1);assert.deepEqual(saved[0].record.messages[0],record.messages[0]);
    assert.equal(saved[0].record.rawBase64,'CAI=');
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();}
});
test('MAIN 桥接遇到不可 JSON 序列化事件时记录缺口，不中断后续事件', async () => {
  let captured, status;
  const dom = new JSDOM('<body></body>', {url:'https://live.douyin.com/1',runScripts:'outside-only'});
  dom.window.DouyinAdapter = class {
    constructor(options) { captured = options; }
    hook() {}
    emitStatus() { captured.onStatus({hook:true}); }
  };
  dom.window.DEFAULTS = {}; dom.window.copy = value => value;

  try {
    await evalPage(dom.window);
    const cycle = {type:'gift',id:'cycle'}; cycle.self = cycle;
    captured.onEvent(cycle);
    await new Promise(resolve => setTimeout(resolve,0));
    status=dom.window.__douyinAssistantPageV2.call({type:'drain'}).status;assert.equal(status.bridgeGaps,1);
    const valid = {type:'chat',id:'ok',text:'正常'};
    captured.onEvent(valid);
    assert.equal(dom.window.__douyinAssistantPageV2.call({type:'drain'}).events[0].id,'ok');
    await new Promise(resolve => setTimeout(resolve,10));
  } finally { dom.window.close(); }
});
test('后台拒绝非直播页面与子frame，保存读取可复用', async()=>{
  const w=await worker(); assert.equal((await w.send({type:'init'},{frameId:0,tab:{url:'https://evil.example/'}})).ok,false);
  assert.equal((await w.send({type:'init'},{frameId:1,tab:{url:'https://live.douyin.com/1'}})).ok,false);
  assert.equal((await w.send({type:'set',key:'outside',value:1})).ok,false);
  assert.equal((await w.send({type:'set',key:'live-assistant:config:1',value:{mode:'auto'}})).ok,true);
  assert.equal((await w.send({type:'set',key:'live-assistant:runtime:1',value:{version:1}})).ok,true);
  assert.equal((await w.send({type:'init'})).value['live-assistant:config:1'].mode,'auto');
  assert.equal((await w.send({type:'init'})).value['live-assistant:runtime:1'].version,1);
});

test('外观偏好只允许已知模式并可由扩展页或直播页经后台访问', async()=>{
  const w=await worker();
  assert.equal((await w.send({type:'theme-get'})).value,'system');
  assert.equal((await w.send({type:'theme-set',value:'dark'})).ok,true);
  assert.equal((await w.send({type:'theme-get'})).value,'dark');
  assert.equal((await w.send({type:'theme-set',value:'unexpected'})).ok,false);
  const extensionPage={url:'chrome-extension://test/popup.html'};
  assert.equal((await w.send({type:'theme-set',value:'light'},extensionPage)).ok,true);
  assert.equal((await w.send({type:'theme-get'},extensionPage)).value,'light');
  assert.equal((await w.send({type:'theme-get'},{frameId:0,tab:{url:'https://evil.example/'}})).ok,false);
});

test('旧本地长期数据迁移到 IndexedDB 后才删除副本，协议帧仍留在临时缓存', async()=>{
  const values={
    'live-assistant:config:1':{mode:'auto'},
    'live-assistant:runtime:1':{version:1},
    'live-assistant:income:1':{version:2,days:[]},
    'live-assistant:event:1:pending-000000000001':{event:{type:'chat',id:'pending'},savedAt:10},
    'douyin-live-assistant:theme':'dark',
    'live-assistant:protocol:1:frame-000000000001':{record:{},savedAt:10}
  };
  const w=await worker(values);
  await w.send({type:'init'});
  for(const key of ['live-assistant:config:1','live-assistant:runtime:1','live-assistant:income:1','live-assistant:event:1:pending-000000000001','douyin-live-assistant:theme']) {
    assert.equal(key in values,false,`长期数据 ${key} 应已迁移`);
    assert.ok(await w.durable().get(key),`IndexedDB 应包含 ${key}`);
  }
  assert.ok('live-assistant:protocol:1:frame-000000000001' in values,'协议帧仍属于可清理临时缓存');
  assert.equal((await w.send({type:'storage-clear-cache'})).ok,true);
  assert.equal('live-assistant:protocol:1:frame-000000000001' in values,false,'手动释放只删除临时协议缓存');
  assert.deepEqual(await w.durable().get('live-assistant:config:1'),{mode:'auto'},'手动释放不能删除持久配置');

  const old={ 'live-assistant:config:9':{mode:'preview'} };
  const local={get:async()=>old,remove:async keys=>{for(const key of keys)delete old[key];}};
  const d=new DurableStorage({indexedDB:w.indexedDB,IDBKeyRange,local});
  await d.set('live-assistant:config:9',{mode:'auto'});
  await assert.rejects(d.migrate(),/旧数据迁移校验失败/);
  assert.deepEqual(old['live-assistant:config:9'],{mode:'preview'},'校验失败必须保留旧副本');
});

test('后台日志和配置拒绝不可 JSON 序列化输入并返回明确错误码', async()=>{
  const w=await worker();
  const cycle={type:'gift',id:'cycle'}; cycle.self=cycle;
  const eventResult=await w.send({type:'event-append',event:cycle});
  assert.equal(eventResult.ok,false); assert.equal(eventResult.code,'INVALID_EVENT');
  const config={}; config.self=config;
  const configResult=await w.send({type:'set',key:'live-assistant:config:1',value:config});
  assert.equal(configResult.ok,false); assert.equal(configResult.code,'INVALID_CONFIG');
  const giftResult=await w.send({type:'gift-record',event:{type:'gift',unitValue:1n}});
  assert.equal(giftResult.ok,false); assert.equal(giftResult.code,'INVALID_EVENT');
});
test('原生点赞快照可以通过扩展后台持久化并在重启后回放',async()=>{
  const w=await worker();
  const event={type:'room-likes',source:'native-room',anchorId:'4007055676415213',roomId:'7701733692930411306',total:15000,display:'1.5万',approximate:true,receivedAt:1800000000000};
  const saved=await w.send({type:'event-append',id:'likes-event-00000001',event});
  assert.equal(saved.ok,true);
  const restarted=await worker(w.values,w.indexedDB);
  const pending=await restarted.send({type:'event-list'});
  assert.equal(pending.value.length,1);
  assert.equal(pending.value[0].event.display,'1.5万');
  assert.equal(pending.value[0].event.roomId,event.roomId);
});
test('事件日志先持久化、后台重启后可回放，并严格隔离主播房间', async()=>{
  const w=await worker(), other={frameId:0,tab:{url:'https://live.douyin.com/2'}};
  const event={type:'gift',id:'gift-event-1',roomId:'stream-1',giftId:'rose',groupId:'combo-1',count:3,final:true,user:{id:'viewer-1',name:'观众'}};
  const saved=await w.send({type:'event-append',id:'event-uuid-00000001',event});
  assert.equal(saved.ok,true);
  const restarted=await worker(w.values,w.indexedDB);
  const pending=await restarted.send({type:'event-list'});
  assert.equal(pending.value.length,1);assert.equal(pending.value[0].event.count,3);
  assert.equal((await restarted.send({type:'event-ack',key:pending.value[0].key},other)).ok,false);
  assert.equal((await restarted.send({type:'event-ack',key:pending.value[0].key})).ok,true);
  assert.equal((await restarted.send({type:'event-list'})).value.length,0);
  const batch=await restarted.send({type:'event-append',id:'event-uuid-00000002',event:{...event,id:'gift-event-2'}});
  const second=await restarted.send({type:'event-append',id:'event-uuid-00000003',event:{...event,id:'gift-event-3'}});
  assert.equal((await restarted.send({type:'event-ack-many',keys:[batch.value.key,second.value.key]})).ok,true);
  const observed=await restarted.send({type:'event-append',id:'event-uuid-00000004',event:{type:'room-sync',id:'sync-1',syncType:'InteractEffectSyncData',syncDataBytes:128}});
  assert.equal(observed.ok,true,'只读 schema 观察事件也可持久化回放');
  assert.equal((await restarted.send({type:'event-list'})).value[0].event.type,'room-sync');
  assert.equal((await restarted.send({type:'event-ack',key:observed.value.key})).ok,true);
  assert.equal((await restarted.send({type:'event-list'})).value.length,0);
  assert.equal((await restarted.send({type:'event-ack-many',keys:['live-assistant:event:2:foreign-000000000000']})).ok,false);
  assert.equal((await restarted.send({type:'event-ack-many',keys:Array(101).fill(batch.value.key)})).ok,false);
});
test('AI网络需指定域名权限且不携带Cookies、不跟随跳转', async()=>{
  const w=await worker(); const m={type:'ai',url:'https://ai.example/v1/chat/completions',data:JSON.stringify({model:'model',messages:[]}),headers:{Authorization:'Bearer dummy',Cookie:'not-forwarded'}};
  assert.equal((await w.send(m)).ok,true); assert.equal(w.requests[0].opts.credentials,'omit'); assert.equal(w.requests[0].opts.redirect,'error'); assert.equal(w.requests[0].opts.headers.Cookie,undefined);
  w.deny(); assert.equal((await w.send(m)).ok,false); assert.equal(w.requests.length,1);
});

test('日志追加幂等、80%用量停止新日志并保留确认和恢复空间',async()=>{
  const w=await worker(),event={type:'gift',id:'gift',user:{id:'20',name:'观众'},count:1};
  const request={type:'event-append',id:'stable-event-0000000001',event};
  const first=await w.send(request);assert.equal(first.ok,true);
  const savedAt=(await w.durable().get(first.value.key)).savedAt;
  w.usage(5*1024*1024*.81);
  assert.equal((await w.send(request)).ok,true,'写入已成功但回包丢失时，重试同一日志不能被水位拒绝');
  assert.equal((await w.durable().get(first.value.key)).savedAt,savedAt);
  const accepted=await w.send({...request,id:'stable-event-0000000002'});
  assert.equal(accepted.ok,true,'本地临时缓存达到水位不应阻止 IndexedDB 事件日志');
  const usage=await w.send({type:'storage-status'});assert.ok(usage.value.ratio>.8);
  assert.equal((await w.send({type:'event-ack',key:first.value.key})).ok,true);
  w.usage(0);assert.equal((await w.send({...request,id:'stable-event-0000000002'})).ok,true);
});

test('存储达到80%时自动删除旧协议帧，保留配置、礼物日志和收入账本', async()=>{
  const values={
    'live-assistant:config:1':{mode:'auto'},
    'live-assistant:runtime:1':{incomePending:[['gift',{}]]},
    'live-assistant:event:1:gift-event-00000001':{event:{type:'gift',id:'gift-1'},savedAt:1},
    'live-assistant:event:1:chat-event-00000001':{event:{type:'chat',id:'chat-1'},savedAt:1},
    'live-assistant:income:1':{version:2,days:[]},
    'live-assistant:protocol:1:protocol-old-000001':{record:{rawBase64:'large'},savedAt:1},
    'live-assistant:protocol:2:protocol-old-000002':{record:{rawBase64:'large'},savedAt:2}
  };
  const w=await worker(values);w.usage(5*1024*1024*.81);
  const result=await w.send({type:'storage-status'});
  assert.equal(result.ok,true);assert.equal(result.value.pruned.deleted,2);
  for(const key of ['live-assistant:config:1','live-assistant:runtime:1','live-assistant:event:1:gift-event-00000001','live-assistant:event:1:chat-event-00000001','live-assistant:income:1']) assert.ok(await w.durable().get(key),key);
  assert.equal('live-assistant:protocol:1:protocol-old-000001' in w.values,false);
  assert.equal('live-assistant:protocol:2:protocol-old-000002' in w.values,false);
});

test('持久日志分页按保存时间与键稳定排序，避免回放时一次复制全部积压',async()=>{
  const w=await worker();
  for(let n=0;n<300;n++)await w.send({type:'event-append',id:`paged-event-${String(n).padStart(16,'0')}`,event:{type:'chat',id:String(n),text:'你好'}});
  const first=(await w.send({type:'event-list'})).value;assert.equal(first.length,256);
  const last=first.at(-1),second=(await w.send({type:'event-list',after:{savedAt:last.savedAt,key:last.key}})).value;
  assert.equal(second.length,44);assert.equal(new Set([...first,...second].map(record=>record.key)).size,300);
  const invalid=await w.send({type:'event-append',event:{type:'chat',user:{name:{}},text:'x'}});
  assert.equal(invalid.code,'INVALID_EVENT');
});
test('原始协议帧按房间持久保存未知 method，并可分页导出且受存储水位保护',async()=>{
  const w=await worker(),other={frameId:0,tab:{url:'https://live.douyin.com/2'}};
  const record={protocolVersion:1,transport:'socket',receivedAt:1792000000000,rawBytes:4,rawBase64:'CAECBA==',
    messages:[{method:'WebcastMysteryMessage',messageId:'9007199254740993999',decodedTypes:[]}]};
  const first=await w.send({type:'protocol-append',id:'protocol-frame-0001',record});
  assert.equal(first.ok,true);
  assert.equal((await w.send({type:'protocol-append',id:'protocol-frame-0001',record})).ok,true,'重复投递幂等');
  assert.equal((await w.send({type:'protocol-list'},other)).value.length,0);
  const restored=await worker(w.values,w.indexedDB),records=(await restored.send({type:'protocol-list'})).value;
  assert.equal(records.length,1);assert.equal(records[0].record.messages[0].method,'WebcastMysteryMessage');
  assert.equal(Buffer.from(records[0].record.rawBase64,'base64').toString('hex'),'08010204');
  const invalid=await restored.send({type:'protocol-append',record:{...record,rawBase64:'not base64!'}});
  assert.equal(invalid.ok,false);assert.equal(invalid.code,'INVALID_PROTOCOL_FRAME');
  const oversized=await restored.send({type:'protocol-append',id:'protocol-frame-large',record:{...record,rawBytes:512*1024+1,rawBase64:undefined,captureError:'FRAME_TOO_LARGE'}});
  assert.equal(oversized.ok,true,'超限原帧明确保留元数据状态');
  restored.usage(5*1024*1024*.81);
  const blocked=await restored.send({type:'protocol-append',id:'protocol-frame-0002',record});
  assert.equal(blocked.ok,false);assert.equal(blocked.code,'STORAGE_PRESSURE');
});
test('积压运行快照超过1MiB仍保存，普通配置保留大小校验', async () => {
  const w = await worker(), payload = {version:1, queue:[{text:'x'.repeat(1100000)}]};
  assert.equal((await w.send({type:'set',key:'live-assistant:runtime:1',value:payload})).ok, true);
  assert.equal((await w.durable().get('live-assistant:runtime:1')).queue[0].text.length, 1100000);
  assert.equal((await w.send({type:'set',key:'live-assistant:config:1',value:payload})).ok, false);
});
test('内容脚本持续突发按序交接并回收已消费槽位，回放不会覆盖在途任务', async () => {
  const dom = new JSDOM('<body></body>', {url:'https://live.douyin.com/1',runScripts:'outside-only'});
  let adapter, release, replayRelease, blocked = false; const handled = [];
  const gate = new Promise(resolve => { release = resolve; });
  const replayGate = new Promise(resolve => { replayRelease = resolve; });
  Object.assign(dom.window, {
    EventInbox,roomFromURL,
    RequestBridgeClient,
    DouyinAdapter:class { constructor(options) { Object.assign(this, options); } emitStatus() {} },
    IdentityReader:class {},
    chrome:{runtime:{sendMessage:async message => ({ok:true,value:message.type === 'init' ? {} : message.type === 'event-list' ? await replayGate : true}),onMessage:{addListener() {}}}},
    boot:options => {
      adapter = options.adapterFactory({onLog() {},onEvent:async event => {
        if (event.id === '0' && !blocked) { blocked = true; await gate; }
        handled.push(event.id);
      }});
      adapter.hook();
    }
  });
  try {
    await dom.window.eval(`(async () => {${await rawEntry('content')}})()`);
    const tasks = [];
    for (let i = 0; i < 2400; i++) tasks.push(adapter.dispatch({type:'chat',id:String(i)}));
    const replay = adapter.replayJournal();
    replayRelease([{key:'replay',event:{type:'chat',id:'replay'}}]);
    await Promise.resolve(); await Promise.resolve(); release();
    await Promise.all([...tasks, replay]);
    assert.deepEqual(handled, ['0','replay',...Array.from({length:2399},(_, i) => String(i + 1))]);
    assert.equal(adapter.eventHead, 0); assert.equal(adapter.eventQueue.length, 0);
    let compacted = false;
    adapter.onEvent = async event => {
      if (event.id === '1199') {
        await Promise.resolve();
        compacted = adapter.eventHead < 1200;
      }
    };
    const burst = [];
    for (let i = 0; i < 2300; i++) burst.push(adapter.dispatch({type:'chat',id:String(i)}));
    await Promise.all(burst);
    assert.equal(compacted, true, '持续处理期间应回收大块已消费前缀');
    assert.equal(adapter.eventQueue.length, 0); assert.equal(adapter.eventHead, 0);
  } finally { release(); replayRelease([]); dom.window.close(); }
});

test('存储水位阻塞的新事件不会挡住持久日志恢复与释放容量',async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1',runScripts:'outside-only'});
  let adapter,recovered=false;const handled=[];
  Object.assign(dom.window,{
    EventInbox,roomFromURL,
    RequestBridgeClient,
    DouyinAdapter:class {constructor(options){Object.assign(this,options);}emitStatus(){}},
    IdentityReader:class {},
    chrome:{runtime:{sendMessage:async message=>({ok:true,value:message.type==='init'?{}:message.type==='event-list'?[{key:'durable',savedAt:1,event:{type:'gift',id:'durable'}}]:true}),onMessage:{addListener(){}}}},
    boot:options=>{adapter=options.adapterFactory({onEvent:async event=>{
      if(event.id==='live'&&!recovered)throw Object.assign(new Error('存储水位'),{code:'STORAGE_PRESSURE'});
      if(event.id==='durable')recovered=true;
      handled.push(event.id);
    }});adapter.hook();}
  });
  try {
    await dom.window.eval(`(async()=>{${await rawEntry('content')}})()`);
    const live=adapter.dispatch({type:'gift',id:'live'});await adapter.inbox.whenIdle();assert.equal(adapter.inbox.blocked,true);
    await adapter.recoverEvents();await live;await adapter.inbox.whenIdle();
    assert.deepEqual(handled,['durable','live']);assert.equal(adapter.inbox.blocked,false);assert.equal(adapter.inbox.status().gaps,0);
  } finally {dom.window.close();}
});
test('同步只送当前房间配置/租约，不广播AI密钥',async()=>{
  const w=await worker(); await w.changed({'live-assistant:api-key:https://ai.example':{newValue:'dummy'}},'local'); assert.equal(w.sent.length,0);
  await w.changed({'live-assistant:config:1':{newValue:{}}},'local'); assert.equal(w.sent.length,1); assert.equal(w.sent[0][0],1);
});
test('实际扩展content产物通过Chrome接口启动；保存失败显示且保持未保存',async()=>{
  const listeners=[];
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/?room_id=1',runScripts:'outside-only',pretendToBeVisual:true});
  Object.assign(dom.window,{TextDecoder,TextEncoder,fetch:async()=>({ok:true,text:async()=>'{"status_code":0,"data":{}}'}),chrome:{runtime:{sendMessage:async m=>m.type==='init'?{ok:true,value:{}}:{ok:false,error:'测试存储失败'},onMessage:{addListener:f=>listeners.push(f)}}}});
  await evalContent(dom.window); await new Promise(r=>setTimeout(r,100));
  const root=dom.window.document.querySelector('#douyin-live-assistant')?.shadowRoot; assert.ok(root);
  assert.equal(root.querySelector('.launcher').hidden,false);
  assert.equal(dom.window.document.querySelector('#douyin-live-assistant').style.zIndex,'2147483000');
  const f=root.querySelector('[data-field="gift.minValue"]');f.value='200';f.dispatchEvent(new dom.window.Event('input',{bubbles:true}));root.querySelector('[data-action="save"]').click(); await new Promise(r=>setTimeout(r,30));
  assert.match(root.querySelector('.toast').textContent,/测试存储失败/); assert.match(root.querySelector('[data-save-state]').textContent,/未保存/);
  const info=await new Promise(resolve=>listeners.forEach(listener=>listener({type:'room-info'},{},resolve))); assert.equal(info.ready,true);dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();
});

test('实际扩展 content 传递双方 PK 比分并在暂停面板显示，中途入场无需开始事件', async () => {
  const anchorId = '9007199254740993999';
  const values = {'live-assistant:config:1':{anchorId,identity:{autoAnchor:false,autoSelf:false}}};
  const dom = new JSDOM('<body></body>', {url:'https://live.douyin.com/1',runScripts:'outside-only',pretendToBeVisual:true});
  Object.assign(dom.window, {TextDecoder,TextEncoder,chrome:{runtime:{
    sendMessage:async request => {
      if (request.type === 'init') return {ok:true,value:values};
      if (request.type === 'event-list' || request.type === 'income-profiles') return {ok:true,value:[]};
      if (request.type === 'set') values[request.key] = request.value;
      return {ok:true};
    },onMessage:{addListener:()=>{}}
  }}});
  try {
    await evalContent(dom.window);
    await new Promise(resolve=>setTimeout(resolve,100));
    const root = dom.window.document.querySelector('#douyin-live-assistant')?.shadowRoot;
    assert.ok(root);
    const emit = event => nativeEvent(dom.window,event);
    emit({type:'pk-score',id:'pk-score-1',battleId:'two-battle',roomId:'server-room',scores:[{anchorId:'12345',score:0},{anchorId,score:65249}]});
    const deadline = Date.now()+2000;
    while (Date.now()<deadline && root.querySelector('[data-pk-self-score]').textContent !== '65,249') await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(root.querySelector('[data-pk-self-score]').textContent, '65,249');
    assert.equal(root.querySelector('[data-pk-opponent-score]').textContent, '0');
    assert.equal(root.querySelector('[data-pk-state]').textContent, 'PK 进行中');
    assert.equal(root.querySelector('[data-pk-self-speed]').textContent, '0');
    assert.notEqual(root.querySelector('[data-pk-self-win]').textContent, '未知');
    assert.equal(values['live-assistant:runtime:1']?.wasRunning || false, false);
    emit({type:'pk-start',id:'multi-start',battleId:'multi-battle',roomId:'server-room',anchorId,anchorName:'己方',remainingMs:90000,
      participants:[{anchorId,name:'己方',roomId:'server-room'},{anchorId:'rival-b',name:'主播乙',roomId:'room-b'},{anchorId:'rival-c',name:'主播丙',roomId:'room-c'}]});
    emit({type:'pk-score',id:'multi-score',battleId:'multi-battle',roomId:'server-room',anchorId,
      scores:[{anchorId,score:65249},{anchorId:'rival-b',score:50000},{anchorId:'rival-c',score:71000}],remainingMs:85000});
    const multiDeadline=Date.now()+2000;
    while(Date.now()<multiDeadline && root.querySelectorAll('[data-pk-competitors] tr').length!==3) await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(root.querySelector('[data-pk-multi]').hidden,false);
    assert.equal(root.querySelector('.pk-scoreboard').hidden,true);
    assert.equal(root.querySelectorAll('[data-pk-competitors] tr').length,3);
    assert.match(root.querySelector('[data-pk-competitors]').textContent,/主播丙/);
    assert.equal(root.querySelectorAll('[data-pk-score-header] th').length,4);
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();}
});

test('实际扩展接收点赞和礼物，本人礼物入账但不自发感谢，并保留同名观众互动',async()=>{
  const selfId='9007199254740993123';
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1',runScripts:'outside-only',pretendToBeVisual:true});
  Object.defineProperty(dom.window.navigator,'locks',{value:webLocks()});
  const values={'live-assistant:config:1':{mode:'preview',selfId,identity:{autoSelf:false},like:{enabled:true}}};
  const journal=new Map();let journalId=0,failAppendOnce=true;
  const giftStore = new GiftStore({get:async(key,fallback)=>values[key] ?? fallback,set:async(key,value)=>{values[key]=JSON.parse(JSON.stringify(value));},all:async()=>values});
  Object.assign(dom.window,{TextDecoder,TextEncoder,fetch:async()=>({ok:true,text:async()=>'{"status_code":0,"data":{}}'}),chrome:{runtime:{sendMessage:async m=>{
    if(m.type==='init')return {ok:true,value:values};
    if(m.type==='event-append'&&m.event?.id==='other-gift')return new Promise(()=>{});
    if(m.type==='event-append'&&failAppendOnce){failAppendOnce=false;return {ok:false,error:'模拟后台存储短暂失败'};}
    if(m.type==='event-append'){const key=`live-assistant:event:1:${++journalId}000000000000`;journal.set(key,{key,event:m.event,savedAt:Date.now()});return {ok:true,value:{key}};}
    if(m.type==='event-list')return {ok:true,value:[...journal.values()]};
    if(m.type==='event-ack'){journal.delete(m.key);return {ok:true,value:true};}
    if(m.type==='event-ack-many'){for(const key of m.keys)journal.delete(key);return {ok:true,value:true};}
    if(m.type==='set')values[m.key]=m.value;
    if(m.type==='income-profile')return {ok:true,value:await giftStore.profile(m.profile)};
    if(m.type==='income-profiles')return {ok:true,value:await giftStore.profiles()};
    if(m.type==='income-report')return {ok:true,value:await giftStore.report(m.room,m.month)};
    if(m.type==='contribution-record')return {ok:true,value:await giftStore.recordContribution(m)};
    if(m.type==='gift-record')return {ok:true,value:await giftStore.record(m)};
    return {ok:true};
  },onMessage:{addListener:()=>{}}}}});
  try {
    await evalContent(dom.window);await new Promise(r=>setTimeout(r,100));
    const root=dom.window.document.querySelector('#douyin-live-assistant')?.shadowRoot;assert.ok(root);
    root.querySelector('[data-action="start"]').click();await new Promise(r=>setTimeout(r,30));
    root.querySelector('[data-tab="diagnostics"]').click();root.querySelector('[data-log-details]').open=true;
    const emit=event=>nativeEvent(dom.window,event);
    const user={id:selfId,name:'同名账号'};
    emit({type:'like',id:'self-like',user,count:30});
    emit({type:'gift',id:'self-gift',user,giftId:'1',giftName:'本人的礼物',unitValue:500,count:1,groupId:'self',final:true});
    const selfGiftDeadline=Date.now()+3000;
    while(Date.now()<selfGiftDeadline && root.querySelector('[data-gift-diamonds]').textContent!=='500')await new Promise(r=>setTimeout(r,25));
    assert.equal(root.querySelector('[data-gift-diamonds]').textContent,'500');
    assert.match(root.querySelector('[data-recent-gifts]').textContent,/本人的礼物/);
    assert.doesNotMatch(root.querySelector('[data-logs]').textContent,/like：|gift：/);

    const other={id:'9007199254740993124',name:user.name};
    emit({type:'like',id:'other-like',user:other,count:30});
    emit({type:'gift',id:'other-gift',user:other,giftId:'1',giftName:'观众的礼物',unitValue:500,count:1,groupId:'other',final:true});
    const deadline=Date.now()+2500;
    while(Date.now()<deadline && !root.querySelector('[data-logs]').textContent.includes('gift：'))await new Promise(r=>setTimeout(r,25));
    assert.match(root.querySelector('[data-logs]').textContent,/like：.*同名账号/);
    assert.match(root.querySelector('[data-logs]').textContent,/gift：.*同名账号/);
    const incomeDeadline=Date.now()+2000;
    while(Date.now()<incomeDeadline && root.querySelector('[data-gift-diamonds]').textContent!=='1,000')await new Promise(r=>setTimeout(r,25));
    assert.equal(root.querySelector('[data-gift-diamonds]').textContent,'1,000');
    assert.equal(values['live-assistant:income:1'].days[0][1].totalDiamonds,1000);
    assert.match(root.querySelector('[data-recent-gifts]').textContent,/观众的礼物/);
    assert.match(root.querySelector('[data-recent-gifts]').textContent,/本人的礼物/);
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();}
});

test('实际后台持久存储月报，重启后仍去重；两个主播配置与收入隔离',async()=>{
  const w=await worker();
  const other={frameId:0,tab:{url:'https://live.douyin.com/2'}};
  await w.send({type:'set',key:'live-assistant:config:1',value:{selfId:'10',gift:{minValue:100},ai:{model:'model-a'}}});
  await w.send({type:'set',key:'live-assistant:config:2',value:{selfId:'20',gift:{minValue:500},ai:{model:'model-b'}}},other);
  await w.send({type:'income-profile',profile:{room:'1',name:'主播甲',anchorId:'101'}});
  await w.send({type:'income-profile',profile:{room:'2',name:'主播乙',anchorId:'202'}},other);
  const event={type:'gift',roomId:'stream-1',giftId:'g',groupId:'combo',count:2,unitValue:100,user:{id:'30'},final:true};
  const message={type:'gift-record',room:'2',event,userKey:'uid:30',rate:0.05};
  const results=await Promise.all([w.send(message),w.send(message)]);
  assert.ok(results.every(result=>result.ok));
  const again=await worker(w.values,w.indexedDB),month=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());
  const report=await again.send({type:'income-report',room:'1',month});
  assert.equal(report.ok,true);assert.equal(report.value.summary.estimatedIncome,10);
  assert.equal((await again.send({type:'income-report',room:'2',month})).value.summary.totalDiamonds,0);
  assert.equal((await again.send({type:'gift-record',event:{...event,groupId:'self',user:{id:'10'}},userKey:'uid:10',rate:0.05})).value,true);
  await again.send(message);
  assert.equal((await again.send({type:'income-report',room:'1',month})).value.summary.giftCount,4);
  const initial=(await again.send({type:'init'})).value;
  assert.equal(initial['live-assistant:config:1'].ai.model,'model-a');assert.equal(initial['live-assistant:config:2'].ai.model,'model-b');
  assert.equal(initial['live-assistant:income:1'],undefined);
  assert.equal((await again.send({type:'income-profiles'})).value.length,2);
});

test('页面刷新及扩展后台重启后自动读回礼物收入和榜单估值，重复礼物不重计',async()=>{
  let backend=await worker({'live-assistant:config:1':{mode:'preview',incomeEnabled:true,gift:{enabled:false}}});
  const code=await readFile(file('content.js'),'utf8');
  const waitFor=async predicate=>{
    const deadline=Date.now()+3000;
    while(Date.now()<deadline&&!await predicate())await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(await predicate(),'持久数据应自动加载并显示');
  };
  const launch=async()=>{
    const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1',runScripts:'outside-only',pretendToBeVisual:true});
    Object.defineProperty(dom.window.navigator,'locks',{value:webLocks()});
    Object.assign(dom.window,{TextDecoder,TextEncoder,fetch:async()=>({ok:true,text:async()=>'{"status_code":0,"data":{}}'}),chrome:{runtime:{sendMessage:message=>backend.send(message),onMessage:{addListener(){}}}}});
    connectNative(dom.window);dom.window.eval(code);
    await waitFor(()=>dom.window.document.querySelector('#douyin-live-assistant')?.shadowRoot);
    const root=dom.window.document.querySelector('#douyin-live-assistant').shadowRoot;
    return {dom,root};
  };
  const close=page=>{page.dom.window.dispatchEvent(new page.dom.window.Event('pagehide'));page.dom.window.close();};
  let page=await launch();
  try {
    const receivedAt=Date.now();
    const event={type:'gift',id:'refresh-kiss',user:{id:'30',name:'送礼观众'},giftId:'kiss',giftName:'亲吻',groupId:'refresh-combo',count:2,unitValue:99,final:true,at:receivedAt,receivedAt};
    const emit=()=>nativeEvent(page.dom.window,event);
    emit();
    await waitFor(async()=> (await backend.durable().get('live-assistant:income:1'))?.days?.[0]?.[1]?.totalDiamonds===198);
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(receivedAt));
    assert.equal((await backend.send({type:'contribution-record',date,userId:'uid:30',name:'送礼观众',score:1200})).ok,true);
    close(page);
    // 只保留落盘数据，重建后台和页面，不能依赖旧页面的内存账本。
    backend=await worker(structuredClone(backend.values),backend.indexedDB);
    page=await launch();
    await waitFor(()=>page.root.querySelector('[data-gift-diamonds]').textContent==='198');
    assert.match(page.root.querySelector('[data-gift-income]').textContent,/9\.90/);
    assert.match(page.root.querySelector('[data-income-total]').textContent,/9\.90/);
    assert.match(page.root.querySelector('[data-income-calibration]').textContent,/120\.00/);
    emit();
    await new Promise(resolve=>setTimeout(resolve,200));
    const report=(await backend.send({type:'income-report',room:'1',month:date.slice(0,7)})).value;
    assert.deepEqual(report.summary,{totalDiamonds:198,unknownCount:0,giftCount:2,estimatedIncome:9.9});
    assert.equal(report.calibration.incomeEstimate,120);
  } finally {close(page);}
});

test('扩展后台把在线榜单观测隔离到来源房间并允许同UID重复轮询更新',async()=>{
  const w=await worker();
  await w.send({type:'set',key:'live-assistant:config:1',value:{incomeEnabled:true}});
  await w.send({type:'contribution-record',room:'2',date:'2026-10-15',userId:'uid:30',name:'榜单观众',score:1000});
  await w.send({type:'contribution-record',date:'2026-10-15',userId:'uid:30',name:'榜单观众',score:1200});
  await w.send({type:'contribution-record',date:'2026-10-15',userId:'uid:30',name:'榜单观众',score:1100});
  const report=(await w.send({type:'income-report',room:'1',month:'2026-10'})).value;
  assert.equal(report.calibration.users,1);
  assert.equal(report.calibration.score,1200);
  assert.equal(report.calibration.incomeEstimate,120);
  assert.equal((await w.send({type:'income-report',room:'2',month:'2026-10'})).value.calibration.users,0);
  await w.send({type:'set',key:'live-assistant:config:1',value:{incomeEnabled:false}});
  assert.equal((await w.send({type:'contribution-record',date:'2026-10-15',userId:'uid:31',name:'未开启',score:1000})).value,false);
});

test('场次后台接口绑定来源房间，支持零礼物场次和后台重启', async () => {
  const w=await worker(),at=Date.now()-60000;
  const start=await w.send({type:'income-session',boundaryType:'start',room:'2',roomId:'broadcast-A',at,source:'platform'});
  assert.equal(start.ok,true);
  const restarted=await worker(w.values,w.indexedDB);
  const end=await restarted.send({type:'income-session',boundaryType:'end',roomId:'broadcast-A',at:at+30000,source:'platform'});
  assert.equal(end.ok,true);
  const own=await restarted.send({type:'income-report',room:'1',month:'2026-10'});
  assert.equal(own.value.sessions.length,1);assert.equal(own.value.sessions[0].endAt,at+30000);
  assert.equal(own.value.sessions[0].giftCount,0);
  const other=await restarted.send({type:'income-report',room:'2',month:'2026-10'});
  assert.equal(other.value.sessions.length,0);
});


test('概览场次读取跨月历史，月度导出不会混入其他月份场次', async()=>{
  const w=await worker();
  const at=Date.parse('2026-09-30T23:00:00+08:00');
  await w.send({type:'income-session',boundaryType:'start',roomId:'old-live',at,source:'platform'});
  await w.send({type:'income-session',boundaryType:'end',roomId:'old-live',at:at+7200000,source:'platform'});
  await w.send({type:'income-session',boundaryType:'start',roomId:'new-live',at:at+10800000,source:'platform'});
  const restarted=await worker(w.values,w.indexedDB);
  const monthly=(await restarted.send({type:'income-report',room:'1',month:'2026-10'})).value;
  assert.equal(monthly.sessions.length,1);assert.equal(monthly.allSessions,undefined);
  const overview=(await restarted.send({type:'income-report',room:'1',month:'2026-10',includeAllSessions:true})).value;
  assert.equal(overview.allSessions.length,2);assert.equal(overview.currentSession.roomId,'new-live');
});

test('构建后的 MAIN 与隔离脚本处理后台唤醒，暂停场控仍保活，下播释放待机保护',{timeout:15000},async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1',runScripts:'outside-only',pretendToBeVisual:true});
  // jsdom's postMessage omits source/origin; model the browser's same-window bridge.
  dom.window.postMessage=(data,origin)=>dom.window.setTimeout(()=>dom.window.dispatchEvent(new dom.window.MessageEvent('message',{data,origin,source:dom.window})),0);
  const listeners=[];let moves=0;const leases=[];
  Object.assign(dom.window,{TextDecoder,TextEncoder,chrome:{runtime:{sendMessage:async request=>{
    if(request.type==='init')return {ok:true,value:{}};
    if(request.type==='event-list'||request.type==='protocol-list')return {ok:true,value:[]};
    if(request.type==='collection-state'){leases.push(request.active);return {ok:true,value:{awake:request.active}};}
    return {ok:true,value:true};
  },onMessage:{addListener:f=>listeners.push(f)}}}});
  dom.window.__STORE__={roomStore:{roomInfo:{roomId:'100',room:{web_rid:'1',status:2}}}};
  dom.window.document.addEventListener('mousemove',()=>moves++);
  const wake=()=>new Promise(resolve=>{for(const listener of listeners)listener({type:'collection-wake'},{},resolve);});
  try {
    dom.window.eval(await readFile(file('page.js'),'utf8'));
    await evalContent(dom.window);
    await new Promise(resolve=>setTimeout(resolve,120));
    assert.equal((await wake()).active,true);assert.ok(moves>0);assert.ok(leases.includes(true));
    const panel=dom.window.document.querySelector('#douyin-live-assistant').shadowRoot;
    assert.equal(panel.querySelector('[data-state]').textContent,'已暂停');
    dom.window.__STORE__.roomStore.roomInfo.room.status=4;
    assert.equal((await wake()).active,false);
    await new Promise(resolve=>setTimeout(resolve,30));assert.equal(leases.at(-1),false);
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();}
});

test('后台场次榜单校准与原始礼物共用持久事务，来源隔离和重启后不重复补差',async()=>{
  const w=await worker(),capturedAt=Date.now();
  await w.send({type:'income-session',boundaryType:'start',at:capturedAt,roomId:'broadcast'});
  const sample={type:'contribution-record',room:'2',roomId:'broadcast',capturedAt,userId:'uid:30',score:1000,rate:0.05};
  await Promise.all([w.send(sample),w.send(sample)]);
  const month=new Date(capturedAt+8*3600000).toISOString().slice(0,7);
  let report=(await w.send({type:'income-report',room:'1',month})).value;
  assert.equal(report.summary.estimatedIncome,50);assert.equal(report.summary.giftCount,0);
  const restarted=await worker(w.values,w.indexedDB);
  await restarted.send({type:'gift-record',event:{type:'gift',roomId:'broadcast',giftId:'g',groupId:'late',count:10,unitValue:100,user:{id:'30'},final:true},userKey:'uid:30',rate:0.05});
  await restarted.send(sample);
  report=(await restarted.send({type:'income-report',room:'1',month})).value;
  assert.equal(report.summary.estimatedIncome,50);assert.equal(report.summary.calibrationIncome,0);
  assert.equal(report.summary.giftCount,10);
  assert.equal((await restarted.send({type:'income-report',room:'2',month})).value.summary.estimatedIncome,0);
});

test('整榜快照通过后台原子去重，绑定来源房间并遵守收入关闭开关',async()=>{
  const w=await worker(),capturedAt=Date.now(),month=new Date(capturedAt+8*3600000).toISOString().slice(0,7);
  await w.send({type:'income-session',boundaryType:'start',at:capturedAt,roomId:'live'});
  const snapshot={type:'contribution-snapshot',room:'2',roomId:'live',capturedAt,rows:[{name:'未知UID观众',score:6297}],rate:0.05};
  const responses=await Promise.all([w.send(snapshot),w.send(snapshot)]);
  assert.ok(responses.every(response=>response.ok));
  const restarted=await worker(w.values,w.indexedDB);
  assert.equal((await restarted.send(snapshot)).value,false);
  const report=(await restarted.send({type:'income-report',room:'1',month})).value;
  assert.ok(Math.abs(report.currentSession.estimatedIncome-314.85)<1e-8);
  assert.equal((await restarted.send({type:'income-report',room:'2',month})).value.summary.estimatedIncome,0);
  await restarted.send({type:'set',key:'live-assistant:config:1',value:{incomeEnabled:false}});
  assert.equal((await restarted.send({...snapshot,rows:[{name:'未知UID观众',score:9000}]})).value,false);
});

test('MAIN 管理桥只提交当前房间白名单动作，票据重复投递不重复禁言',async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123',runScripts:'outside-only',pretendToBeVisual:true});
  const page=dom.window,requests=[];
  try{
    Object.assign(page,{TextDecoder,TextEncoder});
    page.__STORE__={roomStore:{roomInfo:{roomId:'7698776476925443611',room:{web_rid:'123',owner:{id_str:'456'},admin_user_ids_str:['789']}}},userStore:{userInfo:{id_str:'789'}}};
    const client={defaults:{baseURL:'https://live.douyin.com',withCredentials:true},request:async request=>{requests.push(request);return {data:{status_code:0}};}};
    const require=()=>({ZP:client});require.m={request:function(){return ['API_DOMAIN','interceptors.request.use','/webcast/privilege/subscribe'];}};
    page.webpackChunkdouyin_live_v2=[];page.webpackChunkdouyin_live_v2.push=value=>value[2](require);
    page.postMessage=data=>page.setTimeout(()=>page.dispatchEvent(new page.MessageEvent('message',{source:page,origin:page.location.origin,data})),0);
    page.eval(await readFile(file('page.js'),'utf8'));
    const bridge=new RequestBridgeClient(page,pageTransport(page)),target={id:'999',secUid:'sec-viewer'};
    const prepared=await bridge.prepareModeration('mute',target);assert.equal(prepared.available,true);
    assert.equal((await bridge.commitModeration(prepared.token)).submitted,true);
    assert.equal((await bridge.commitModeration(prepared.token)).submitted,true);
    assert.equal(requests.length,1);assert.equal(requests[0].url,'/webcast/room/silence/');
    assert.equal(requests[0].params.user_id,'999');
    const ban=await bridge.prepareModeration('ban',target);page.__STORE__.roomStore.roomInfo.room.admin_user_ids_str=[];
    assert.equal((await bridge.commitModeration(ban.token)).submitted,false);assert.equal(requests.length,1);
  }finally{page.close();}
});

test('MAIN 忽略页面伪造的发送命令和事件，提前取消也不会迟到提交',async()=>{
  const dom=new JSDOM('',{url:'https://live.douyin.com/1',runScripts:'outside-only'}),page=dom.window;
  let options,prepares=0;
  Object.assign(page,{RoomContext,DEFAULTS:{},copy:value=>value,DouyinAdapter:class {
    constructor(input){options=input;this.status={};this.requestSender={prepareLike:()=>{prepares++;return {available:true};}};}
    hook(){}
  }});
  try {
    await evalPage(page);options.onEvent({type:'gift',id:'real'});
    for(const data of [{source:'live-assistant-content-v1',room:'1',type:'send-api',operation:'prepare-like',id:'fake'},
      {source:'live-assistant-page-v1',room:'1',type:'event',event:{type:'gift',id:'forged'}}])page.dispatchEvent(new page.MessageEvent('message',{source:page,origin:page.location.origin,data}));
    const bridge=page.__douyinAssistantPageV2;assert.equal(Object.getOwnPropertyDescriptor(page,'__douyinAssistantPageV2').writable,false);
    assert.deepEqual(Array.from(bridge.call({type:'drain'}).events,row=>row.id),['real']);assert.equal(prepares,0);
    bridge.call({type:'cancel',id:'canceled'});
    assert.equal((await bridge.call({type:'send-api',id:'canceled',operation:'prepare-like'})).available,false);assert.equal(prepares,0);
  } finally {page.close();}
});

test('上下文同步失效时更新诊断并停止重试，取消保活失败不覆盖恢复提示',async()=>{
  const dom=new JSDOM('',{url:'https://live.douyin.com/1',runScripts:'outside-only'});let adapter,failedCalls=0;
  Object.assign(dom.window,{EventInbox,roomFromURL,RequestBridgeClient,IdentityReader:class {},
    DouyinAdapter:class {constructor(options){Object.assign(this,options);}emitStatus(){}},
    chrome:{runtime:{sendMessage:message=>{
      if(message.type==='init')return Promise.resolve({ok:true,value:{}});
      failedCalls++;throw Error('Extension context invalidated');
    },onMessage:{addListener(){}}}},
    boot:options=>{adapter=options.adapterFactory({onEvent(){}});}
  });
  try {
    await dom.window.eval(`(async()=>{${await rawEntry('content')}})()`);
    await assert.rejects(adapter.checkStorage(),error=>error.code==='CONTEXT_INVALID' && /刷新/.test(error.message));
    assert.equal(adapter.status.contextInvalidated,true);
    await assert.rejects(adapter.checkStorage(),error=>error.code==='CONTEXT_INVALID');
    assert.equal(failedCalls,2,'仅尝试原操作和一次保活撤销，不重复调用失效扩展');
    assert.match((await adapter.exportEvents()).error,/导出恢复数据/);
  }finally{dom.window.close();}
});


test('后台唤醒与内容脚本租约更新没有循环等待，活跃页不因等待超时被移除',async()=>{
  const dom=new JSDOM('',{url:'https://live.douyin.com/1',runScripts:'outside-only'}),listeners=[],saved={};
  const tab={id:1,url:dom.window.location.href};let keeper;
  const chrome={storage:{session:{get:async key=>({[key]:saved[key]}),set:async values=>Object.assign(saved,values)}},
    alarms:{create(){},onAlarm:{addListener(){}}},power:{requestKeepAwake(){},releaseKeepAwake(){}},
    tabs:{query:async()=>keeper?[tab]:[],sendMessage:()=>new Promise(resolve=>listeners[0]({type:'collection-wake'},{},resolve))}};
  keeper=installCollectionKeeper(chrome,{wakeTimeoutMs:50});await keeper.refresh();
  Object.assign(dom.window,{EventInbox,roomFromURL,RequestBridgeClient,IdentityReader:class {},
    DouyinAdapter:class {constructor(options){Object.assign(this,options);}emitStatus(){}},boot:()=>{},
    chrome:{runtime:{onMessage:{addListener:f=>listeners.push(f)},sendMessage:async message=>{
      if(message.type==='init')return {ok:true,value:{}};
      if(message.type==='page-command')return {ok:true,value:true};
      if(message.type==='collection-state')return {ok:true,value:await keeper.update({frameId:0,tab},message.active)};
      return {ok:true};
    }}}});
  try {
    await dom.window.eval(`(async()=>{${await rawEntry('content')}})()`);
    assert.equal((await keeper.refresh()).awake,true);
    assert.equal(saved['live-assistant:collection-leases']['1'],tab.url);
  }finally{dom.window.close();}
});
