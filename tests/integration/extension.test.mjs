import {createDataCapture,runReadOnlyCollector} from '../../extension/data-capture.js';
import {createEdgeClient} from '../../src/browser/edge-client.js';
import {createNativeASRClient} from '../../src/browser/native-asr-client.js';
import {RoomContext,roomFromURL} from '../../src/browser/room-context.js';
import { ProtocolCache } from '../../extension/protocol-cache.js';
import { ObservationBuffer } from '../../extension/observation-buffer.js';
import { StorageMirror } from '../../extension/storage-mirror.js';
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
import {validateSearchEndpoint,validateSearchBody} from '../../src/services/search.js';
import { GiftStore } from '../../src/data/gifts.js';
import { DurableStorage, isDurableKey } from '../../extension/durable-storage.js';
import { EventInbox, failureCode } from '../../src/runtime/inbox.js';
import { installCollectionKeeper } from '../../extension/collection-keeper.js';
import { RequestBridgeClient } from '../../src/browser/request-sender.js';
import { webLocks } from '../helpers/web-locks.mjs';
import {createGiveaway,enterGiveaway,drawGiveaway} from '../../src/core/giveaway.js';
import { buildFixture } from '../helpers/build.mjs';
import {mergeConfig} from '../../src/core/engine.js';
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
  if(entry==='content')source=`const failureCode = ${failureCode.toString()};\nconst StorageMirror = ${StorageMirror.toString()};\n`+source.replace('async function startContent() {\n','').replace(/\n}\nstartContent\(\);\s*$/,'');
  return source;
}
async function evalPage(page) {page.RoomContext=RoomContext;page.ObservationBuffer=ObservationBuffer;page.eval(await rawEntry('page'));}
async function evalContent(page) {page.structuredClone=structuredClone;connectNative(page);page.eval(await readFile(file('content.js'),'utf8'));}
function pageTransport(page) {return async request=>({ok:true,value:await page.__douyinAssistantPageV2.call(request.command)});}
test('构建后的 MAIN 与隔离点赞桥无本人 IM 回执也完成三批，重复批次只发一次，停止票据立即失效',async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1',runScripts:'outside-only'}),page=dom.window,requests=[];
  try {
    Object.assign(page,{TextDecoder,TextEncoder});
    // Regression: a native successful response need not have a LikeMessage,
    // and the room may not expose an IM subscription service at all.
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
async function worker(values = {}, indexedDB = new IDBFactory(), responseText='{"choices":[]}',overrides={}) {
  let usedBytes = 0, listener,changed; const sent=[], requests=[]; let allowed=true;
  const WorkerDurableStorage = class extends DurableStorage {
    constructor(options = {}) { super({...options, indexedDB: options.indexedDB || indexedDB, IDBKeyRange}); }
  };
  const chrome={runtime:{getURL:()=> 'chrome-extension://test/',onMessage:{addListener:f=>listener=f}},storage:{local:{QUOTA_BYTES:5*1024*1024,getBytesInUse:async()=>usedBytes,setAccessLevel:async()=>{},get:async()=>values,set:async v=>Object.assign(values,v),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete values[key];}},onChanged:{addListener:f=>changed=f}},permissions:{contains:async()=>allowed},tabs:{query:async()=>[{id:1,url:'https://live.douyin.com/1'},{id:2,url:'https://live.douyin.com/2'}],sendMessage:async(id,m)=>{sent.push([id,m]);return {ok:true};}}};
  const code=(await readFile(file('background.js'),'utf8'));
  vm.runInNewContext(code,{ReadableStream,TransformStream,Headers,Request,Response,AbortSignal,TextDecoder,performance,atob,btoa,queueMicrotask,CustomEvent,structuredClone,fanclubFrameContext,cleanFanclubSnapshot,chrome,ProtocolCache,installCollectionKeeper,validateEndpoint,validateSearchEndpoint,validateSearchBody,GiftStore,DurableStorage:WorkerDurableStorage,isDurableKey,indexedDB,IDBKeyRange,TextEncoder,crypto:globalThis.crypto,AbortController,setTimeout,clearTimeout,URL,URLSearchParams,fetch:async(url,opts)=>{requests.push({url,opts});return {status:200,url,text:async()=>responseText};},...overrides});
  const sender={frameId:0,tab:{url:'https://live.douyin.com/1'}};
  const durable=()=>new DurableStorage({indexedDB,IDBKeyRange,local:chrome.storage.local});
  return {values,indexedDB,durable,sent,requests,changed,route:(m,s,reply)=>listener(m,s,reply),usage:value=>{usedBytes=value;},send:(m,s=sender)=>new Promise(r=>listener(m,s,result=>r(structuredClone(result)))),deny:()=>allowed=false};
}
test('通用后台路由不抢答离屏准备的存储消息',async()=>{
 const w=await worker(),replies=[],sender={url:'chrome-extension://test/'};
 for(const target of ['edge-offscreen','edge-background'])assert.equal(w.route({target,action:'preparation-read'},sender,value=>replies.push(value)),undefined);
 await new Promise(setImmediate);assert.deepEqual(replies,[]);
});
test('运行后台共享知识单写入者跨房保存、通知、重启和图谱重读',async()=>{
 const entry={id:'shared-person',title:'人物资料',content:'云杉是小雨的助理。',source:'用户补充',updatedAt:Date.now(),expiresOn:'',enabled:true,trust:'unverified'};
 const w=await worker({'live-assistant:config:1':{anchorId:'10',ai:{memory:{enabled:true,entries:[entry]}}},'live-assistant:config:2':{anchorId:'20',ai:{memory:{enabled:true,entries:[]}}}});
 const sender={frameId:0,tab:{url:'https://live.douyin.com/2'}};
 const init=await w.send({type:'init'},sender);assert.equal(init.ok,true);const base=init.value['live-assistant:config:2'];
 assert.equal(base.ai.memory.entries[0].content,entry.content);
 const config=structuredClone(base);config.ai.memory.entries[0].content='云杉是小雨的搭档。';
 const result=await w.send({type:'save-config',config,base},sender);assert.equal(result.ok,true,result.error);
 assert.ok(w.sent.some(([id,m])=>id===1 && m.sharedKnowledge && m.changes['live-assistant:config:1'].newValue.ai.memory.entries[0].content.includes('搭档')));
 const restarted=await worker({},w.indexedDB),again=await restarted.send({type:'init'});
 assert.match(again.value['live-assistant:config:1'].ai.memory.entries[0].content,/搭档/);
 const graph=await restarted.send({type:'relationship-query',query:'云杉'});assert.equal(graph.value.relations[0].predicate,'搭档');
 const raw=await w.durable().get('live-assistant:config:2');assert.deepEqual(raw.ai.memory.entries,[]);
});
test('AI连接和已记住的密钥跨房共享、实时通知并重启恢复，主播节奏独立',async()=>{
 const key='live-assistant:api-key:https://cloud.example';
 const w=await worker({[key]:'fixture-secret','live-assistant:config:1':{version:2,ai:{endpoint:'https://cloud.example/chat/completions',model:'fixture-model',pipeline:{workspaceId:'fixture-space'},replyFrequency:'quiet'}},'live-assistant:config:2':{version:2,ai:{replyFrequency:'every',persona:'主播乙'}}});
 const sender={frameId:0,tab:{url:'https://live.douyin.com/2'}};
 const init=await w.send({type:'init'},sender),base=init.value['live-assistant:config:2'];
 assert.equal(base.ai.pipeline.workspaceId,'fixture-space');assert.equal(base.ai.model,'fixture-model');assert.equal(init.value[key],'fixture-secret');
 const config=structuredClone(base);config.ai.model='updated-model';config.ai.replyFrequency='off';
 const result=await w.send({type:'save-config',config,base},sender);assert.equal(result.ok,true,result.error);
 const notice=w.sent.findLast(([id,m])=>id===1 && m.sharedKnowledge)?.[1].changes['live-assistant:config:1'].newValue;
 assert.equal(notice.ai.model,'updated-model');assert.equal(notice.ai.replyFrequency,'quiet');
 await w.send({type:'set',key,value:'updated-fixture-secret'},sender);
 assert.ok(w.sent.some(([id,m])=>id===1 && m.type==='ai-credentials-changed'));
 assert.ok(!JSON.stringify(w.sent).includes('updated-fixture-secret'));
 assert.equal((await w.send({type:'ai-credentials-read'},sender)).value[key],'updated-fixture-secret');
 const restarted=await worker({},w.indexedDB),again=await restarted.send({type:'init'},sender);
 assert.equal(again.value['live-assistant:config:2'].ai.replyFrequency,'off');assert.equal(again.value[key],'updated-fixture-secret');
 await w.send({type:'delete',key},sender);
 assert.equal((await w.send({type:'ai-credentials-read'},sender)).value[key],undefined);
});
test('MV3产物包含所有入口、图标，无远程代码依赖', async()=>{
  const m=JSON.parse(await readFile(file('manifest.json'),'utf8')); assert.equal(m.manifest_version,3);
  assert.deepEqual(m.permissions,['storage','unlimitedStorage','alarms','power','scripting','nativeMessaging','offscreen']); assert.deepEqual(m.host_permissions,['https://live.douyin.com/*','https://www.douyin.com/*','https://geocoding-api.open-meteo.com/*','https://api.open-meteo.com/*','https://wttr.in/*','https://air-quality-api.open-meteo.com/*','https://api.frankfurter.dev/*','https://raw.githubusercontent.com/*','https://date.nager.at/*']);
  for(const name of [m.background.service_worker,m.action.default_popup,...Object.values(m.icons),...m.content_scripts.flatMap(s=>s.js)]) await access(file(name));
  assert.equal(m.content_scripts[0].world,'MAIN'); assert.equal(m.content_scripts[1].world,'ISOLATED');
  assert.match(m.content_security_policy.extension_pages,/wasm-unsafe-eval/u);
  for(const name of ['edge-worker.js','edge-offscreen.js','speech-vad.js','ort/ort-wasm-simd-threaded.asyncify.mjs','ort/ort-wasm-simd-threaded.asyncify.wasm','ort/ort-wasm-simd-threaded.jsep.mjs','ort/ort-wasm-simd-threaded.jsep.wasm','vad/silero_vad_v5.onnx','vad/ort/ort-wasm-simd-threaded.mjs','vad/ort/ort-wasm-simd-threaded.wasm'])await access(file(name));
  const main=await readFile(file('page.js'),'utf8'); assert.doesNotMatch(main,/chrome\.storage|GM_getValue|api-key:|GM_xmlhttpRequest/);
  assert.doesNotMatch(main,/window\.postMessage/);
});

test('扩展管理页与工具栏提供匹配尺寸的本地图标', async()=>{
  const manifest=JSON.parse(await readFile(file('manifest.json'),'utf8'));
  assert.ok(manifest.action.default_icon,'工具栏应显式指定图标，避免浏览器缩放不合适的尺寸');
  for(const size of [16,32,48,128]) {
    const path=manifest.icons[size];
    assert.ok(path,`缺少 ${size}px 图标`);
    const png=await readFile(file(path));
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16),size);
    assert.equal(png.readUInt32BE(20),size);
  }
  for(const size of [16,32])assert.equal(manifest.action.default_icon[size],manifest.icons[size]);
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
      Object.assign(dom.window,{TextDecoder,TextEncoder,structuredClone});
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

test('油猴与隔离产物内置 Cordis，浏览器无 Node 全局也能注入服务、回收与重建工具',async()=>{
  for (const entry of ['userscript','content']) {
    const path=entry==='userscript'?join(testDist,'douyin-live-assistant.user.js'):file('content.js');
    const source=await readFile(path,'utf8');
    const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1',runScripts:'outside-only'});
    let host;
    try {
      Object.assign(dom.window,{TextDecoder,TextEncoder,structuredClone});
      dom.window.eval(source.replace(/(?:boot|startContent)\(\);\s*}\)\(\);\s*$/, 'globalThis.toolTest = {ToolRuntime, ToolRegistry};})();'));
      assert.equal(dom.window.process,undefined);assert.equal(dom.window.require,undefined);
      const {ToolRuntime,ToolRegistry}=dom.window.toolTest;let mounts=0,disposed=0;
      host=new ToolRuntime({room:'1',services:{page:dom.window},createLock:()=>({release(){}}),registry:new ToolRegistry([{
        id:'sample',label:'样例',icon:'heart',version:'1.0.0',apiVersion:1,capabilities:[],view:{template:()=>'',update(){}},
        mount:ctx=>{mounts++;assert.equal(ctx.services.page,dom.window);ctx.scope.listen(dom.window,'probe',()=>assert.fail('卸载后不能回调'));return {dispose:()=>{disposed++;}};}
      }])});
      await host.start();assert.equal(host.diagnostics().backend,'cordis');assert.equal(host.diagnostics().plugins,1);
      await host.restart('sample');assert.equal(mounts,2);assert.equal(disposed,1);
      await host.close();dom.window.dispatchEvent(new dom.window.Event('probe'));
      assert.equal(disposed,2);assert.equal(host.diagnostics().plugins,0);assert.equal(host.diagnostics().scopes,0);
      assert.match(source,/Copyright \(c\) 2021-present Shigma/);
    } finally {await host?.close();dom.window.close();}
  }
  assert.doesNotMatch(await readFile(file('page.js'),'utf8'),/CordisToolAdapter/,'MAIN 桥不加载工具宿主');
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
    let ack;
    const drain=()=>{const batch=dom.window.__douyinAssistantPageV2.call({type:'drain',ack});received.push(...batch.events);ack=batch.batchId;};
    drain();drain();drain();
    assert.equal(received.length,160); assert.equal(received[159].id,'159'); assert.equal(received.filter(e=>e.type==='chat').length,80);
  } finally {dom.window.close();}
});
test('MAIN 未确认批次可重读且仍占容量，重复确认不删除下一批，暂停仍传递优先事件',async()=>{
  let captured;
  const dom=new JSDOM('',{url:'https://live.douyin.com/1',runScripts:'outside-only'}),page=dom.window;
  Object.assign(page,{DouyinAdapter:class {constructor(options){captured=options;}hook(){}},DEFAULTS:{},copy:value=>value});
  try {
    await evalPage(page);
    for(let i=0;i<4096;i++)captured.onEvent({type:'chat',id:String(i)});
    const call=command=>page.__douyinAssistantPageV2.call({type:'drain',...command});
    const first=call();
    assert.deepEqual(Array.from(call().events,e=>e.id),Array.from(first.events,e=>e.id),'响应丢失后重读同一批');
    captured.onEvent({type:'chat',id:'overflow'});
    assert.equal(call().status.bridgeGaps,1,'在途未确认事件仍占有界缓冲容量');
    assert.equal(call().status.bridgePending,4096);
    captured.onCapture({rawBase64:'AQ=='});
    const second=call({ack:first.batchId});
    assert.equal(second.events[0].id,'128');assert.equal(second.captures.length,1);
    assert.equal(call({ack:first.batchId}).events[0].id,'128','重复旧确认不得删除新批次');
    captured.onPK({type:'pk-score',id:'urgent'});
    const paused=call({ack:second.batchId,paused:true});
    assert.equal(paused.events.length,0);assert.equal(paused.priority[0].id,'urgent');
    const received=[...first.events,...second.events];let batch=call({ack:paused.batchId});
    while(batch.events.length){received.push(...batch.events);batch=call({ack:batch.batchId});}
    assert.deepEqual(received.map(e=>e.id),Array.from({length:4096},(_,i)=>String(i)));
    assert.equal(batch.status.bridgePending,0);assert.equal(batch.status.captureBridgePending,0);
  }finally{page.close();}
});

for(const mode of ['lost-response','pagehide','archive-pagehide'])test(`内容桥在 ${mode} 后恢复 MAIN 已读取批次且不重复交付`,async()=>{
  const dom=new JSDOM('',{url:'https://live.douyin.com/1',runScripts:'outside-only'}),page=dom.window;
  let captured,adapter,release,reads=0,archiveBlocked=false;const timers=[],handled=[],saved=[];
  Object.assign(page,{EventInbox,roomFromURL,RoomContext,createEdgeClient,createNativeASRClient,createDataCapture,runReadOnlyCollector,RequestBridgeClient,IdentityReader:class {},DEFAULTS:{},copy:value=>value,
    DouyinAdapter:class {constructor(options){Object.assign(this,options);captured=options;}hook(){}emitStatus(){}},
    setTimeout:callback=>{timers.push(callback);return timers.length;},clearTimeout(){},
    chrome:{runtime:{onMessage:{addListener(){}},sendMessage:async request=>{
      if(request.type==='init')return {ok:true,value:{}};
      if(request.type==='data-records' && mode==='archive-pagehide' && !archiveBlocked){archiveBlocked=true;await new Promise(resolve=>{release=resolve;});return {ok:true,value:true};}
      if(request.type==='protocol-append'){saved.push(request.record);return {ok:true,value:true};}
      if(request.type==='page-command' && request.command.type==='drain'){
        const value=page.__douyinAssistantPageV2.call(request.command);reads++;
        if(reads===1){
          if(mode==='lost-response')throw Error('response lost after MAIN executed');
          if(mode==='pagehide')await new Promise(resolve=>{release=resolve;});
        }
        return {ok:true,value};
      }
      return {ok:true,value:[]};
    }}},boot:options=>{adapter=options.adapterFactory({onEvent:event=>handled.push(event.id)});adapter.hook();}
  });
  try {
    await evalPage(page);captured.onEvent({type:'chat',id:'retained'});captured.onCapture({rawBase64:'AQ=='});
    await page.eval(`(async()=>{${await rawEntry('content')}})()`);await new Promise(setImmediate);
    if(mode==='pagehide' || mode==='archive-pagehide'){
      page.dispatchEvent(new page.Event('pagehide'));release();await new Promise(setImmediate);
      // An archive wait no longer delays live admission. Hiding during that wait
      // must retain the MAIN batch, then restore without delivering it twice.
      assert.deepEqual(handled,mode==='archive-pagehide' ? ['retained'] : []);
      assert.equal(saved.length,mode==='archive-pagehide' ? 1 : 0);
      assert.equal(page.__douyinAssistantPageV2.call({type:'drain'}).status.bridgePending,1);
      page.dispatchEvent(new page.PageTransitionEvent('pageshow',{persisted:true}));
    }else await timers.shift()();
    await new Promise(setImmediate);await adapter.inbox.whenIdle();
    await timers.shift()();await new Promise(setImmediate);
    assert.deepEqual(handled,['retained']);assert.equal(saved.length,1);
    assert.equal(page.__douyinAssistantPageV2.call({type:'drain'}).status.bridgePending,0);
  }finally{release?.();adapter?.closeEvents();page.close();}
});
test('隔离脚本把 MAIN 原始协议帧送入独立持久化通道', async () => {
  const dom = new JSDOM('<body></body>', {url:'https://live.douyin.com/1',runScripts:'outside-only',pretendToBeVisual:true});
  const saved=[];
  Object.assign(dom.window,{TextDecoder,TextEncoder,structuredClone,chrome:{runtime:{
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

for(const scenario of ['newer-success','both-fail','external-change'])test(`内容脚本保存失败不回滚较新的配置：${scenario}`,async()=>{
  const dom=new JSDOM('',{url:'https://live.douyin.com/1',runScripts:'outside-only'}),page=dom.window,key='live-assistant:config:1';
  let api,listener;const requests=[];
  Object.assign(page,{EventInbox,roomFromURL,createEdgeClient,createNativeASRClient,createDataCapture,runReadOnlyCollector,RequestBridgeClient,IdentityReader:class {},DouyinAdapter:class {},
    chrome:{runtime:{onMessage:{addListener:fn=>{listener=fn;}},sendMessage:request=>{
      if(request.type==='data-context')return Promise.resolve({ok:true,value:null});
      if(request.type==='init')return Promise.resolve({ok:true,value:{[key]:'initial'}});
      return new Promise(resolve=>requests.push({request,resolve}));
    }}},boot:options=>{api=options;}
  });
  try{
    await page.eval(`(async()=>{${await rawEntry('content')}})()`);
    const first=api.set(key,'first');const rejected=assert.rejects(first,/storage failed/);
    const second=scenario==='external-change'?null:api.set(key,'second');
    const secondRejected=scenario==='both-fail'?assert.rejects(second,/storage failed/):null;
    await new Promise(setImmediate);
    if(scenario==='external-change')listener({type:'storage',changes:{[key]:{newValue:'external'}}});
    requests.shift().resolve({ok:false,error:'storage failed'});await rejected;await new Promise(setImmediate);
    if(second){
      assert.equal(api.get(key),'second','旧请求失败不得覆盖较新的乐观保存');
      requests.shift().resolve(scenario==='both-fail'?{ok:false,error:'storage failed'}:{ok:true,value:true});
      await (secondRejected||second);
    }
    assert.equal(api.get(key),scenario==='newer-success'?'second':scenario==='both-fail'?'initial':'external');
  }finally{page.close();}
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
  const linked=await restarted.send({type:'event-append',id:'event-uuid-00000005',event:{type:'link-state',id:'link-1',linkedUsers:[{id:'12345',name:'连线主播'}]}});
  assert.equal(linked.ok,true,'连线事件可通过后台白名单持久化');
  assert.equal((await restarted.send({type:'event-list'})).value[0].event.type,'link-state');
  assert.equal((await restarted.send({type:'event-ack',key:linked.value.key})).ok,true);
  assert.equal((await restarted.send({type:'event-ack-many',keys:['live-assistant:event:2:foreign-000000000000']})).ok,false);
  assert.equal((await restarted.send({type:'event-ack-many',keys:Array(101).fill(batch.value.key)})).ok,false);
});
test('AI网络需指定域名权限且不携带Cookies、不跟随跳转', async()=>{
  const w=await worker(); const m={type:'ai',url:'https://ai.example/v1/chat/completions',data:JSON.stringify({model:'model',messages:[]}),headers:{Authorization:'Bearer dummy',Cookie:'not-forwarded'}};
  assert.equal((await w.send(m)).ok,true); assert.equal(w.requests[0].opts.credentials,'omit'); assert.equal(w.requests[0].opts.redirect,'error'); assert.equal(w.requests[0].opts.headers.Cookie,undefined);
  w.deny(); assert.equal((await w.send(m)).ok,false); assert.equal(w.requests.length,1);
});
test('天气GET经过后台固定接口和域名验证，不携带AI密钥或Cookie并支持实际取消',async()=>{
 const w=await worker(),url='https://geocoding-api.open-meteo.com/v1/search?name=横店&count=20&language=zh&format=json';
 const result=await w.send({type:'weather',url,headers:{Authorization:'Bearer must-not-forward'}});
 assert.equal(result.ok,true);assert.equal(w.requests[0].opts.method,'GET');assert.equal(w.requests[0].opts.body,undefined);assert.equal(w.requests[0].opts.credentials,'omit');assert.equal(w.requests[0].opts.redirect,'error');assert.equal(w.requests[0].opts.headers.Authorization,undefined);
 assert.equal((await w.send({type:'weather',url:url.replace('open-meteo.com','evil.test')})).ok,false);assert.equal(w.requests.length,1);
 assert.equal((await w.send({type:'weather',url},{tab:{url:'https://example.org/'}})).ok,false);w.deny();assert.equal((await w.send({type:'weather',url})).ok,false);
 let signal;const delayed=await worker({},new IDBFactory(),'{}',{fetch:async(_url,options)=>{signal=options.signal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('cancel'),{name:'AbortError'}))));}});
 const pending=delayed.send({type:'weather',url,requestId:'abcdefab-1234-1234-1234-abcdefabcdef'},{frameId:0,tab:{id:1,url:'https://live.douyin.com/1'}});
 for(let i=0;i<100 && !signal;i++)await new Promise(r=>setTimeout(r,5));assert.ok(signal);
 await delayed.send({type:'ai-request-cancel',id:'abcdefab-1234-1234-1234-abcdefabcdef'},{frameId:0,tab:{id:1,url:'https://live.douyin.com/1'}});assert.equal(signal.aborted,true);assert.equal((await pending).ok,false);
});
test('公共工具走同一无密钥GET通道，仅接受已登记的路径和参数',async()=>{
 const w=await worker(),urls=['https://api.frankfurter.dev/v2/rate/CNY/USD','https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/2026.json','https://date.nager.at/api/v3/PublicHolidays/2026/US','https://air-quality-api.open-meteo.com/v1/air-quality?latitude=29.15698&longitude=120.31478&timezone=auto&current=us_aqi,pm2_5,pm10'];
 for(const url of urls){assert.equal((await w.send({type:'public-data',url,headers:{Authorization:'Bearer do-not-forward'}})).ok,true);const {opts}=w.requests.at(-1);assert.equal(opts.method,'GET');assert.equal(opts.headers.Authorization,undefined);assert.equal(opts.body,undefined);}
 for(const url of [urls[0]+'?key=secret',urls[1].replace('NateScarlet','other'),'https://api.frankfurter.dev:444/v2/rate/CNY/USD'])assert.equal((await w.send({type:'public-data',url})).ok,false);
 assert.equal(w.requests.length,4);
});
test('音视频后台接收有界媒体包，拒绝网页伪造、远程图片与权限缺失，并持久保存独立密钥',async()=>{
  const w=await worker(),body={model:'vision-test',stream:false,temperature:0,max_tokens:500,messages:[{role:'system',content:'描述画面'},{role:'user',content:[{type:'text',text:'这一帧'},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${'A'.repeat(120000)}`}}]}]};
  const message={type:'media',url:'https://vision.test/v1/chat/completions',data:JSON.stringify(body),headers:{Authorization:'Bearer media-test',Cookie:'secret'}};
  assert.equal((await w.send(message)).ok,true);assert.equal(w.requests.length,1);
  assert.equal(w.requests[0].opts.credentials,'omit');assert.equal(w.requests[0].opts.redirect,'error');assert.equal(w.requests[0].opts.headers.Cookie,undefined);
  assert.equal((await w.send(message,{frameId:1,tab:{url:'https://live.douyin.com/1'}})).ok,false);
  const remote=structuredClone(body);remote.messages[1].content[1].image_url.url='https://private.test/img.jpg';
  assert.equal((await w.send({...message,data:JSON.stringify(remote)})).ok,false);
  const oversized=JSON.stringify({model:'text-test',messages:[{role:'user',content:'x'.repeat(1000000)}]});
  assert.equal((await w.send({...message,type:'ai',data:oversized})).ok,false,'文字AI容量放宽后仍拒绝超出整包容量的请求');
  const key='live-assistant:media-key:https://vision.test';
  assert.equal((await w.send({type:'set',key,value:'media-key'})).ok,true);
  const restarted=await worker(w.values,w.indexedDB);assert.equal((await restarted.send({type:'init'})).value[key],'media-key');
  w.deny();assert.equal((await w.send(message)).ok,false);assert.equal(w.requests.length,1);
});

test('扩展后台接受 Omni 音画组合，仅允许本地媒体并检查权限',async()=>{
  const w=await worker(),body={model:'qwen3.5-omni-flash',stream:true,temperature:0,max_tokens:500,modalities:['text'],messages:[{role:'system',content:'描述音画'},{role:'user',content:[{type:'text',text:'描述直播'},{type:'image_url',image_url:{url:'data:image/jpeg;base64,/9j/2Q=='}},{type:'input_audio',input_audio:{format:'wav',data:'data:audio/wav;base64,UklGRiQAAABXQVZF'}}]}]};
  const message={type:'media',url:'https://vision.test/v1/chat/completions',data:JSON.stringify(body),headers:{Authorization:'Bearer media-test',Cookie:'secret'}};
  assert.equal((await w.send(message)).ok,true);assert.equal(w.requests.length,1);
  assert.equal(w.requests[0].opts.headers.Cookie,undefined);assert.equal(w.requests[0].opts.credentials,'omit');
  const remote=structuredClone(body);remote.messages[1].content[2].input_audio.data='https://example.com/audio.wav';
  assert.equal((await w.send({...message,data:JSON.stringify(remote)})).ok,false);
  w.deny();assert.equal((await w.send(message)).ok,false);assert.equal(w.requests.length,1);
});

test('博查与Tavily搜索经过后台协议校验和域名授权，搜索密钥独立持久化',async()=>{
  const w=await worker();
  const messages=[{type:'search',url:'https://api.bochaai.com/v1/web-search',headers:{Authorization:'Bearer bocha-test',Cookie:'omit'},data:JSON.stringify({query:'上海天气',count:3,summary:true,freshness:'noLimit'})},
    {type:'search',url:'https://api.tavily.com/search',headers:{Authorization:'Bearer tavily-test'},data:JSON.stringify({query:'上海天气',max_results:3,search_depth:'basic',include_answer:false,include_raw_content:false})}];
  for(const message of messages)assert.equal((await w.send(message)).ok,true);
  assert.equal(w.requests.length,2);assert.equal(w.requests[0].opts.credentials,'omit');assert.equal(w.requests[0].opts.redirect,'error');assert.equal(w.requests[0].opts.headers.Cookie,undefined);
  assert.equal((await w.send({...messages[0],data:JSON.stringify({query:'q',url:'https://x.test'})})).ok,false);
  assert.equal((await w.send({...messages[0],url:'https://x.test/fetch'})).ok,false);
  const key='live-assistant:search-key:https://api.bochaai.com';
  assert.equal((await w.send({type:'set',key,value:'search-only-test'})).ok,true);
  assert.equal((await w.send({type:'init'})).value[key],'search-only-test');
  assert.equal((await w.send({type:'init'})).value['live-assistant:api-key:https://api.bochaai.com'],undefined);
  w.deny();assert.equal((await w.send(messages[0])).ok,false);assert.equal(w.requests.length,2);
});

test('自建SearXNG由后台以表单发送，仅允许有界JSON搜索参数',async()=>{
  const w=await worker(),data=new URLSearchParams({q:'开源搜索',format:'json',pageno:'1'}).toString();
  const request={type:'search',provider:'searxng',url:'http://localhost:8080/search',data,headers:{}};
  assert.equal((await w.send(request)).ok,true);assert.equal(w.requests[0].opts.headers['Content-Type'],'application/x-www-form-urlencoded');assert.equal(w.requests[0].opts.body,data);
  assert.equal((await w.send({...request,data:data+'&url=https://x.test'})).ok,false);
  assert.equal((await w.send({...request,provider:'unknown'})).ok,false);assert.equal(w.requests.length,1);
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
test('直播记忆独立持久化并按房间加载，缓存清理及后台重启不删除记忆',async()=>{
 const w=await worker(),key='live-assistant:live-memory:1:10',otherKey='live-assistant:live-memory:2:20';
 const payload={version:1,anchor:'10',audience:{version:2,anchor:'10',viewers:[]},perception:{observations:Array.from({length:120},(_,i)=>({id:String(i),kind:'audio',text:'原文'.repeat(5000),at:10+i,endedAt:11+i,inputSource:'native'}))}};
 assert.equal((await w.send({type:'set',key,value:payload})).ok,true);
 const other={frameId:0,tab:{url:'https://live.douyin.com/2'}};
 assert.equal((await w.send({type:'set',key,value:payload},other)).ok,false);
 assert.equal((await w.send({type:'set',key:otherKey,value:{...payload,anchor:'20',audience:{version:2,anchor:'20',viewers:[]}}},other)).ok,true);
 assert.equal((await w.send({type:'init'})).value[otherKey],undefined);
 await w.send({type:'storage-clear-cache'});
 const restored=await worker(w.values,w.indexedDB);
 assert.equal((await restored.send({type:'init'})).value[key].perception.observations.length,120);
});
test('内容脚本持续突发按序交接并回收已消费槽位，回放不会覆盖在途任务', async () => {
  const dom = new JSDOM('<body></body>', {url:'https://live.douyin.com/1',runScripts:'outside-only'});
  let adapter, release, replayRelease, blocked = false; const handled = [];
  const gate = new Promise(resolve => { release = resolve; });
  const replayGate = new Promise(resolve => { replayRelease = resolve; });
  Object.assign(dom.window, {
    EventInbox,roomFromURL,createEdgeClient,createNativeASRClient,createDataCapture,runReadOnlyCollector,
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
    EventInbox,roomFromURL,createEdgeClient,createNativeASRClient,createDataCapture,runReadOnlyCollector,
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
  const w=await worker(); await w.changed({'live-assistant:api-key:https://ai.example':{newValue:'dummy'}},'local'); assert.equal(w.sent.length,2);
  assert.ok(w.sent.every(([,message])=>message.type==='ai-credentials-changed'));assert.ok(!JSON.stringify(w.sent).includes('dummy'));w.sent.length=0;
  await w.changed({'live-assistant:config:1':{newValue:{}}},'local'); assert.equal(w.sent.length,1); assert.equal(w.sent[0][0],1);
});
test('已打开页面按通知读取密钥，迟到结果不覆盖新值，删除后停止沿用',async()=>{
 const key='live-assistant:api-key:https://cloud.example',listeners=[],reads=[],requests=[];
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1',runScripts:'outside-only',pretendToBeVisual:true});
 Object.assign(dom.window,{TextDecoder,TextEncoder,structuredClone,fetch:async()=>({ok:true,text:async()=>'{"status_code":0,"data":{}}'}),chrome:{runtime:{onMessage:{addListener:f=>listeners.push(f)},sendMessage:async m=>{
  if(m.type==='init')return {ok:true,value:{[key]:'fixture-old','live-assistant:config:1':{version:2,ai:{endpoint:'https://cloud.example/chat/completions',model:'fixture'}}}};
  if(m.type==='ai-credentials-read')return new Promise(resolve=>reads.push(resolve));
  if(m.type==='ai'){requests.push(m);return {ok:true,value:{status:200,responseText:JSON.stringify({choices:[{message:{content:'连接成功'}}]})}};}
  return {ok:true,value:[]};
 }}}});
 const wait=async predicate=>{const end=Date.now()+3000;while(!predicate() && Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(predicate());};
 try{
  await evalContent(dom.window);await wait(()=>dom.window.document.querySelector('#douyin-live-assistant')?.shadowRoot.querySelector('[data-action=test-ai]'));
  const root=dom.window.document.querySelector('#douyin-live-assistant').shadowRoot,button=root.querySelector('[data-action=test-ai]');
  button.click();await wait(()=>requests.length===1 && !button.disabled);assert.equal(requests[0].headers.Authorization,'Bearer fixture-old');
  for(let i=0;i<2;i++)for(const listener of listeners)listener({type:'ai-credentials-changed'},{},()=>{});
  await wait(()=>reads.length===2);reads[1]({ok:true,value:{[key]:'fixture-new'}});await new Promise(setImmediate);reads[0]({ok:true,value:{[key]:'fixture-stale'}});await new Promise(setImmediate);
  button.click();await wait(()=>requests.length===2 && !button.disabled);assert.equal(requests[1].headers.Authorization,'Bearer fixture-new');
  for(const listener of listeners)listener({type:'ai-credentials-changed'},{},()=>{});await wait(()=>reads.length===3);reads[2]({ok:true,value:{}});await new Promise(setImmediate);
  button.click();await wait(()=>!button.disabled);assert.equal(requests.length,2);assert.match(root.querySelector('.toast').textContent,/Key|密钥/u);
 }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();}
});
test('实际扩展content产物通过Chrome接口启动；保存失败显示且保持未保存',async()=>{
  const listeners=[];
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/?room_id=1',runScripts:'outside-only',pretendToBeVisual:true});
  Object.assign(dom.window,{TextDecoder,TextEncoder,structuredClone,fetch:async()=>({ok:true,text:async()=>'{"status_code":0,"data":{}}'}),chrome:{runtime:{sendMessage:async m=>m.type==='init'?{ok:true,value:{}}:{ok:false,error:'测试存储失败'},onMessage:{addListener:f=>listeners.push(f)}}}});
  await evalContent(dom.window); await new Promise(r=>setTimeout(r,100));
  const root=dom.window.document.querySelector('#douyin-live-assistant')?.shadowRoot; assert.ok(root);
  assert.equal(root.querySelector('.launcher').hidden,false);
  assert.equal(dom.window.document.querySelector('#douyin-live-assistant').style.zIndex,'2147483000');
  const f=root.querySelector('[data-field="gift.minValue"]');f.value='200';f.dispatchEvent(new dom.window.Event('input',{bubbles:true}));root.querySelector('[data-action="save"]').click(); await new Promise(r=>setTimeout(r,30));
  assert.match(root.querySelector('.toast').textContent,/测试存储失败/); assert.match(root.querySelector('[data-save-state]').textContent,/未保存/);
  const info=await new Promise(resolve=>listeners.forEach(listener=>listener({type:'room-info'},{},resolve))); assert.equal(info.ready,true);dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();
});

test('实际扩展授权信息使用已保存的后台研究API，保留Responses并忽略未保存的模型草稿',async()=>{
 const listeners=[],values={'live-assistant:config:1':mergeConfig({anchorId:'10',ai:{endpoint:'https://reply.example/v1/chat/completions',model:'reply',taskModels:{research:{enabled:true,endpoint:'https://research.example/v1/responses',model:'research'}}}})};
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1',runScripts:'outside-only',pretendToBeVisual:true});
 Object.assign(dom.window,{TextDecoder,TextEncoder,structuredClone,chrome:{runtime:{onMessage:{addListener:f=>listeners.push(f)},sendMessage:async m=>m.type==='init' ? {ok:true,value:structuredClone(values)} : {ok:true,value:[]}}}});
 const info=()=>new Promise(resolve=>listeners.forEach(listener=>listener({type:'room-info'},{},resolve)));
 try{
  await evalContent(dom.window);let result;
  for(let i=0;i<300;i++){if(listeners.length){result=await info();if(result.ready)break;}await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(result?.ready,true);assert.equal(result.researchEndpoint,'https://research.example/v1/responses');
  const root=dom.window.document.querySelector('#douyin-live-assistant').shadowRoot,input=root.querySelector('[data-field="ai.taskModels.research.endpoint"]');
  input.value='https://unfinished.example/v1/responses';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.equal((await info()).researchEndpoint,result.researchEndpoint);
  const config=structuredClone(values['live-assistant:config:1']);config.ai.taskModels.research.endpoint='http://localhost:11434/v1/responses';
  for(const listener of listeners)listener({type:'storage',sharedKnowledge:true,changes:{'live-assistant:config:1':{newValue:config}}},{},()=>{});
  assert.equal((await info()).researchEndpoint,config.ai.taskModels.research.endpoint);assert.equal(input.value,'https://unfinished.example/v1/responses','授权信息刷新不覆盖用户草稿');
  config.ai.taskModels.research.enabled=false;
  for(const listener of listeners)listener({type:'storage',sharedKnowledge:true,changes:{'live-assistant:config:1':{newValue:config}}},{},()=>{});
  assert.equal((await info()).researchEndpoint,config.ai.endpoint,'未启用独立模型时授权实际回退的回复接口');
 }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();}
});

test('实际扩展 content 传递双方 PK 比分并在暂停面板显示，中途入场无需开始事件', async () => {
  const anchorId = '9007199254740993999';
  const values = {'live-assistant:config:1':{anchorId,identity:{autoAnchor:false,autoSelf:false}}};
  const dom = new JSDOM('<body></body>', {url:'https://live.douyin.com/1',runScripts:'outside-only',pretendToBeVisual:true});
  Object.assign(dom.window, {TextDecoder,TextEncoder,structuredClone,chrome:{runtime:{
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
    emit({type:'link-state',id:'link-1',roomId:'server-room',linkedUsers:[{id:anchorId},{id:'12345'}]});
    const linkDeadline=Date.now()+2000;
    while(Date.now()<linkDeadline && root.querySelector('[data-live-mode]').textContent!=='连线中')await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(root.querySelector('[data-live-mode]').textContent,'连线中');
    emit({type:'pk-score',id:'pk-score-1',battleId:'two-battle',roomId:'server-room',scores:[{anchorId:'12345',score:0},{anchorId,score:65249}]});
    const deadline = Date.now()+2000;
    while (Date.now()<deadline && root.querySelector('[data-pk-self-score]').textContent !== '65,249') await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(root.querySelector('[data-pk-self-score]').textContent, '65,249');
    assert.equal(root.querySelector('[data-pk-opponent-score]').textContent, '0');
    assert.equal(root.querySelector('[data-pk-state]').textContent, 'PK 进行中');
    assert.equal(root.querySelector('[data-live-mode]').textContent,'PK 中');
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
  Object.assign(dom.window,{TextDecoder,TextEncoder,structuredClone,fetch:async()=>({ok:true,text:async()=>'{"status_code":0,"data":{}}'}),chrome:{runtime:{sendMessage:async m=>{
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

test('实际后台持久存储月报，重启后仍去重；AI服务共享，主播个性设置与收入隔离',async()=>{
  const w=await worker();
  const other={frameId:0,tab:{url:'https://live.douyin.com/2'}};
  await w.send({type:'set',key:'live-assistant:config:1',value:{selfId:'10',gift:{minValue:100},ai:{model:'model-a'}}});
  await w.send({type:'set',key:'live-assistant:config:2',value:{selfId:'20',gift:{minValue:500},ai:{model:'model-b'}}},other);
  const base=(await w.send({type:'init'})).value['live-assistant:config:1'],config=structuredClone(base);config.ai.model='shared-model';
  assert.equal((await w.send({type:'save-config',config,base})).ok,true);
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
  assert.equal(initial['live-assistant:config:1'].ai.model,'shared-model');assert.equal(initial['live-assistant:config:2'].ai.model,'shared-model');
  assert.equal(initial['live-assistant:config:1'].selfId,'10');assert.equal(initial['live-assistant:config:2'].selfId,'20');
  assert.equal(initial['live-assistant:config:1'].gift.minValue,100);assert.equal(initial['live-assistant:config:2'].gift.minValue,500);
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
    Object.assign(dom.window,{TextDecoder,TextEncoder,structuredClone,fetch:async()=>({ok:true,text:async()=>'{"status_code":0,"data":{}}'}),chrome:{runtime:{sendMessage:message=>backend.send(message),onMessage:{addListener(){}}}}});
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
  const w=await worker(),at=Date.parse('2026-10-15T12:00:00+08:00');
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
  Object.assign(dom.window,{TextDecoder,TextEncoder,structuredClone,chrome:{runtime:{sendMessage:async request=>{
    if(request.type==='init')return {ok:true,value:{'live-assistant:config:1':{automation:{monitorRoom:false}}}};
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

test('构建后的未开播页持有后台监控租约，后台唤醒查询房间，用户暂停后释放', {timeout:15000},async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1',runScripts:'outside-only',pretendToBeVisual:true});
  const page=dom.window,listeners=[],leases=[];let reads=0;
  Object.assign(page,{TextDecoder,TextEncoder,structuredClone,
    fetch:async path=>({ok:true,text:async()=>{
      if(!path.includes('/room/web/enter'))return JSON.stringify({data:{}});
      reads++;return JSON.stringify({data:{data:[{web_rid:'1',id_str:'100',status:4,owner:{id_str:'9'}}]}});
    }}),chrome:{runtime:{onMessage:{addListener:f=>listeners.push(f)},sendMessage:async request=>{
      if(request.type==='init')return {ok:true,value:{'live-assistant:config:1':{automation:{autoStart:true},incomeEnabled:false}}};
      if(request.type==='event-list'||request.type==='protocol-list')return {ok:true,value:[]};
      if(request.type==='collection-state'){leases.push(request.active);return {ok:true,value:{awake:request.active}};}
      return {ok:true,value:true};
    }}}});
  page.__STORE__={roomStore:{roomInfo:{roomId:'100',room:{web_rid:'1',status:4}}}};
  const wake=()=>new Promise(resolve=>listeners[0]({type:'collection-wake'},{},resolve));
  try {
    page.eval(await readFile(file('page.js'),'utf8'));await evalContent(page);
    const deadline=Date.now()+6000;
    while(!leases.includes(true) && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
    assert.ok(leases.includes(true),'未开播等待仍有系统待机保护');
    const before=reads;assert.equal((await wake()).active,true);
    await new Promise(resolve=>setTimeout(resolve,30));assert.ok(reads>before,'后台唤醒触发房间接口查询');
    const panel=page.document.querySelector('#douyin-live-assistant').shadowRoot;
    const rendered=Date.now()+3000;
    while(!/等待开播/.test(panel.querySelector('[data-state]').textContent) && Date.now()<rendered)await new Promise(resolve=>setTimeout(resolve,20));
    assert.match(panel.querySelector('[data-state]').textContent,/等待开播/);
    const stop=panel.querySelector('[data-action=stop]');assert.equal(stop.hidden,false);assert.equal(stop.disabled,false);stop.click();
    const stopped=Date.now()+2000;
    while(leases.at(-1)!==false && Date.now()<stopped)await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(leases.at(-1),false);assert.equal((await wake()).active,false);
  } finally {page.dispatchEvent(new page.Event('pagehide'));page.close();}
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
test('构建后的隔离桥将真实@范围传到MAIN并序列化原生rtf_content',async()=>{
  const dom=new JSDOM('',{url:'https://live.douyin.com/123',runScripts:'outside-only'}),page=dom.window,requests=[];
  try {
    Object.assign(page,{TextDecoder,TextEncoder});
    page.__STORE__={roomStore:{roomInfo:{roomId:'7698776476925443611',room:{web_rid:'123'}}},userStore:{userInfo:{id_str:'789'}},singletonStore:{message:{queuePush(){}}}};
    const client={defaults:{baseURL:'https://live.douyin.com',withCredentials:true},request:async request=>{requests.push(request);return {data:{status_code:0,data:{msg_id_str:'123',content:request.params.content,user:{id_str:'789'}}}};}};
    const require=()=>({ZP:client});require.m={request:function(){return ['API_DOMAIN','interceptors.request.use','/webcast/privilege/subscribe'];}};
    page.webpackChunkdouyin_live_v2=[];page.webpackChunkdouyin_live_v2.push=value=>value[2](require);
    page.eval(await readFile(file('page.js'),'utf8'));
    const bridge=new RequestBridgeClient(page,pageTransport(page));const ticket=await bridge.prepare('chat');
    assert.equal(ticket.available,true);
    const result=await bridge.commit(ticket.token,'@懒二🐑 你好',[{id:'4143433474648240',start:0,length:5}]);
    assert.equal(result.submitted,true);
    assert.deepEqual(JSON.parse(requests[0].params.rtf_content),[{type:2,value:'{"uid":"4143433474648240","webcast_uid":""}',start:0,length:5}]);
    assert.equal(await bridge.release(ticket.token),false,'已提交回执必须保留去重');
    await bridge.commit(ticket.token,'不可重复发送');assert.equal(requests.length,1);
    const unused=await bridge.prepare('chat');
    assert.equal(await bridge.release(unused.token),true);assert.equal(await bridge.release(unused.token),true);
    assert.equal((await bridge.commit(unused.token,'不可发送已取消票据')).submitted,false);assert.equal(requests.length,1);
  } finally {page.close();}
});

test('福袋记录按来源房间和账号持久化，后台重启后接管者可读且不能越房写入',async()=>{
  const w=await worker(),key='live-assistant:rewards:1:789',records=[{kind:'luckyBag',key:'luckyBag:activity',status:'unknown',at:Date.now()}];
  assert.equal((await w.send({type:'rewards-write',key,records})).ok,true);
  const restored=await worker(w.values,w.indexedDB);
  assert.deepEqual((await restored.send({type:'rewards-read',key})).value,records);
  assert.deepEqual((await restored.send({type:'rewards-read',key:'live-assistant:rewards:1:456'})).value,[]);
  assert.equal((await restored.send({type:'rewards-write',key:'live-assistant:rewards:2:789',records})).ok,false);
});

test('抽奖结果持久保存在后台数据库，重启可恢复，拒绝越房和非法记录',async()=>{
  const w=await worker(),key='live-assistant:giveaway:1';
  let round=createGiveaway({prize:'礼盒',winners:1,durationSec:2,chatEnabled:true,keyword:'参与抽奖',giftEnabled:false},{id:'round-1',room:'1',now:1000});
  round=enterGiveaway(round,{type:'chat',text:'参与抽奖',at:1500,user:{id:'9999999999999999999',name:'小雨'}},1500);
  const state={version:2,rounds:[drawGiveaway(round,3000,()=>0)]};
  assert.equal((await w.send({type:'giveaway-write',key,value:state})).ok,true);
  const restored=await worker(w.values,w.indexedDB);
  assert.deepEqual((await restored.send({type:'giveaway-read',key})).value,state);
  assert.equal((await restored.send({type:'giveaway-read',key:'live-assistant:giveaway:2'})).ok,false);
  assert.equal((await restored.send({type:'giveaway-write',key,value:{version:2,rounds:[{...round,room:'2'}]}})).ok,false);
  assert.equal((await restored.send({type:'giveaway-write',key,value:{version:2,rounds:[{...round,awards:[{userId:'stranger',prizeIndex:0}]}]}})).ok,false);
  assert.deepEqual((await restored.send({type:'giveaway-read',key})).value,state);
  assert.equal(w.values[key],undefined,'完整记录不落在 chrome.storage.local 配额内');
});

test('上下文同步失效时更新诊断并停止重试，取消保活失败不覆盖恢复提示',async()=>{
  const dom=new JSDOM('',{url:'https://live.douyin.com/1',runScripts:'outside-only'});let adapter,failedCalls=0;
  Object.assign(dom.window,{EventInbox,roomFromURL,createEdgeClient,createNativeASRClient,createDataCapture,runReadOnlyCollector,RequestBridgeClient,IdentityReader:class {},
    DouyinAdapter:class {constructor(options){Object.assign(this,options);}emitStatus(){}},
    chrome:{runtime:{sendMessage:message=>{
      if(message.type==='data-context')return Promise.resolve({ok:true,value:null});
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
  Object.assign(dom.window,{EventInbox,roomFromURL,createEdgeClient,createNativeASRClient,createDataCapture,runReadOnlyCollector,RequestBridgeClient,IdentityReader:class {},
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


test('事件桥短暂失联时暂停发送资格，后台恢复后继续接收，无需刷新',async()=>{
  const dom=new JSDOM('',{url:'https://live.douyin.com/1',runScripts:'outside-only'});
  let adapter,drains=0;const timers=[],handled=[];
  Object.assign(dom.window,{EventInbox,roomFromURL,createEdgeClient,createNativeASRClient,createDataCapture,runReadOnlyCollector,RequestBridgeClient,IdentityReader:class {},
    DouyinAdapter:class {
      constructor(options){Object.assign(this,options);}
      emitStatus(){}
      healthy(){return Boolean(this.status.connected || this.status.lastPoll);}
    },
    setTimeout:callback=>{timers.push(callback);return timers.length;},clearTimeout(){},
    chrome:{runtime:{sendMessage:async message=>{
      if(message.type==='init')return {ok:true,value:{}};
      if(message.type==='page-command' && message.command.type==='drain'){
        if(++drains===2)throw new Error('Could not establish connection. Receiving end does not exist.');
        return {ok:true,value:{events:drains===3?[{type:'gift',id:'after-reconnect'}]:[],captures:[],status:{hook:true,connected:true,lastPoll:Date.now(),frames:drains}}};
      }
      return {ok:true,value:{}};
    },onMessage:{addListener(){}}}},
    boot:options=>{adapter=options.adapterFactory({onEvent:async event=>handled.push(event.id)});adapter.hook();}
  });
  try {
    await dom.window.eval(`(async()=>{${await rawEntry('content')}})()`);
    await new Promise(setImmediate);
    assert.equal(adapter.healthy(),true);
    await timers.shift()();await new Promise(setImmediate);
    assert.equal(adapter.persistenceUnavailable(),false);
    assert.equal(adapter.healthy(),false);
    assert.match(adapter.status.bridgeError,/Receiving end/);
    assert.equal(timers.length,1);
    await timers.shift()();await new Promise(setImmediate);await adapter.inbox.whenIdle();
    assert.equal(adapter.healthy(),true);
    assert.equal(adapter.status.contextInvalidated,false);
    assert.equal(adapter.status.bridgeError,undefined);
    assert.equal(drains,3);
    assert.deepEqual(handled,['after-reconnect']);
  }finally{adapter?.closeEvents();dom.window.close();}
});


test('构建后台独立交换百炼 WebRTC SDP，要求直播页、服务授权和有效数据',async()=>{
  const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',w=await worker({},new IDBFactory(),sdp);
  const message={type:'media-sdp',url:'https://ws.cn-beijing.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen3.8-omni-flash-realtime',headers:{Authorization:'Bearer private'},data:sdp};
  assert.equal((await w.send(message)).ok,true);assert.equal(w.requests[0].opts.headers['Content-Type'],'application/sdp');assert.equal(w.requests[0].opts.redirect,'error');assert.equal(w.requests[0].opts.credentials,'omit');
  for(const invalid of [{...message,url:'https://evil.com/api/v1/webrtc/realtime?model=x'},{...message,data:'{}'},{...message,headers:{}}])assert.equal((await w.send(invalid)).ok,false);
  assert.equal((await w.send(message,{frameId:1,tab:{url:'https://live.douyin.com/1'}})).ok,false);assert.equal(w.requests.length,1);
  w.deny();assert.match((await w.send(message)).error,/授权/u);
});

test('配色与材质经同一后台白名单保存，直播页和弹窗共享，拒绝任意键和值',async()=>{
 const w=await worker(),popup={url:'chrome-extension://test/popup.html'};
 for(const [kind,initial,next] of [['palette','original','teal'],['material','liquid','solid']]){
  assert.equal((await w.send({type:'appearance-get',kind})).value,initial);
  assert.equal((await w.send({type:'appearance-set',kind,value:next},popup)).ok,true);
  assert.equal((await w.send({type:'appearance-get',kind})).value,next);
  assert.equal((await w.send({type:'appearance-set',kind,value:'bad'})).ok,false);
 }
 assert.equal((await w.send({type:'appearance-get',kind:'api-key'})).ok,false);
 assert.equal((await w.send({type:'appearance-set',kind:'palette',value:'blue'},{frameId:0,tab:{url:'https://evil.example/'}})).ok,false);
});


test('扩展搜索超过8秒仍等待结果，与服务30秒查证预算一致',async()=>{
 const timers=[];let release,signal;
 const w=await worker({},new IDBFactory(),'',{setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:()=>{},fetch:async(url,options)=>{signal=options.signal;await new Promise(resolve=>{release=resolve;});return {status:200,url,text:async()=>'{}'};}});
 const pending=w.send({type:'search',url:'https://api.bochaai.com/v1/web-search',data:JSON.stringify({query:'抖音PK规则',count:3,summary:true,freshness:'noLimit'})});
 await new Promise(setImmediate);
 try{for(const timer of timers)if(timer.ms<=8000)timer.fn();assert.equal(signal.aborted,false);assert.ok(timers.some(t=>t.ms===30000));}finally{release();await pending;}
});

test('天气备用接口通过扩展固定GET通道，拒绝任意路径和敏感参数',async()=>{
 const w=await worker(),url='https://wttr.in/29.15698,120.31478?format=j1';
 assert.equal((await w.send({type:'weather',url,headers:{Authorization:'Bearer secret'},body:'private'})).ok,true);
 assert.equal(w.requests[0].opts.method,'GET');
 assert.equal(w.requests[0].opts.body,undefined);
 assert.equal(w.requests[0].opts.headers.Authorization,undefined);
 for(const bad of [url+'&key=secret',url.replace('/29.15698,120.31478','/London'),url.replace('https:','http:'),url.replace('29.15698','99')])assert.equal((await w.send({type:'weather',url:bad})).ok,false);
 assert.equal(w.requests.length,1);
});

test('人物关系后台查询跨房间读取持续档案，只返回相关证据并保持写入隔离',async()=>{
 const at=Date.now(),values={};
 for(const [room,anchor,name,text] of [['1','10','阿青','我是小雨的朋友。'],['2','20','青哥','我是阿明的徒弟。']]){
  values[`live-assistant:config:${room}`]={anchorId:anchor,ai:{assistant:{memoryEnabled:true},contextSources:{audience:true}}};
  values[`live-assistant:live-memory:${room}:${anchor}`]={version:1,anchor,audience:{version:2,anchor,viewers:[{key:'uid:1',name,secUids:['sec-account-a'],firstAt:at,lastAt:at,statements:[{id:room,text,at}],gifts:[],notes:[]}]},perception:{observations:[],forgetBefore:0}};
 }
 const w=await worker(values);let response=await w.send({type:'relationship-query',query:'青哥和小雨和阿明'});
 assert.equal(response.ok,true);assert.equal(response.value.relations.length,2);assert.equal(response.value.entities.filter(n=>['阿青','青哥'].includes(n.name)).length,1);
 assert.deepEqual(Array.from(response.value.entities.find(n=>['阿青','青哥'].includes(n.name)).dossier.profiles),['https://www.douyin.com/user/sec-account-a'],'只披露已配对的公开主页');
 assert.doesNotMatch(JSON.stringify(response.value),/"(?:secUid|secUids|key)":/u,'不返回原始身份字段或整份存档');
 response=await w.send({type:'set',key:'live-assistant:live-memory:2:20',value:values['live-assistant:live-memory:2:20']});assert.equal(response.ok,false);
 await w.send({type:'set',key:'live-assistant:config:2',value:{...values['live-assistant:config:2'],ai:{assistant:{memoryEnabled:false}}}});
 response=await w.send({type:'relationship-query',query:'阿明'});assert.equal(response.value.relations.length,0);
 assert.equal((await w.send({type:'relationship-query',query:'x'.repeat(2001)})).ok,false);
});

test('自动知识库后台单写者保留原文，拒绝页面直写和旧主播范围，删除后图谱与重启均不复活',async()=>{
 const values={'live-assistant:config:1':{anchorId:'10',ai:{enabled:true,assistant:{memoryEnabled:true},search:{rememberKnowledge:true}}}},indexedDB=new IDBFactory();
 const w=await worker(values,indexedDB),input={anchor:'10',sources:[{url:'https://example.org/profile',title:'公开资料',text:'阿明是小雨的师傅'}]};
 assert.equal((await w.send({type:'knowledge-corpus',action:'remember',input})).ok,true);
 const records=await w.send({type:'knowledge-corpus',action:'list',input:{anchor:'10'}});assert.equal(records.value.length,1);
 let graph=await w.send({type:'relationship-query',query:'',browse:true});assert.equal(graph.value.relations[0].status,'unverified');
 assert.equal((await w.send({type:'set',key:'live-assistant:knowledge:1:10',value:{rows:[]}})).ok,false);
 assert.equal((await w.send({type:'knowledge-corpus',action:'remember',input:{...input,anchor:'20'}})).ok,false);
 const version=(await w.send({type:'knowledge-corpus',action:'version',input:{anchor:'10'}})).value;
 await w.send({type:'knowledge-corpus',action:'clear',input:{anchor:'10'}});
 await w.send({type:'knowledge-corpus',action:'remember',input:{...input,version}});
 const reopened=await worker({},indexedDB);graph=await reopened.send({type:'relationship-query',query:'阿明'});assert.equal(graph.value.relations.length,0);
});
