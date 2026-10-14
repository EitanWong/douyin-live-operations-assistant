import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { validateEndpoint } from '../src/ai.js';
const file=name=>new URL(`../dist/chrome-extension/${name}`,import.meta.url);
async function worker() {
  let listener,changed; const values={}, sent=[], requests=[]; let allowed=true;
  const chrome={runtime:{getURL:()=> 'chrome-extension://test/',onMessage:{addListener:f=>listener=f}},storage:{local:{setAccessLevel:async()=>{},get:async()=>values,set:async v=>Object.assign(values,v),remove:async k=>delete values[k]},onChanged:{addListener:f=>changed=f}},permissions:{contains:async()=>allowed},tabs:{query:async()=>[{id:1,url:'https://live.douyin.com/1'},{id:2,url:'https://live.douyin.com/2'}],sendMessage:async(id,m)=>sent.push([id,m])}};
  const code=(await readFile(file('background.js'),'utf8')).replace(/^import .*;\n/,'');
  vm.runInNewContext(code,{chrome,validateEndpoint,AbortController,setTimeout,clearTimeout,URL,fetch:async(url,opts)=>{requests.push({url,opts});return {status:200,url,text:async()=>'{"choices":[]}'};}});
  const sender={frameId:0,tab:{url:'https://live.douyin.com/1'}};
  return {values,sent,requests,changed,send:(m,s=sender)=>new Promise(r=>listener(m,s,r)),deny:()=>allowed=false};
}
test('MV3产物包含所有入口、图标，无远程代码依赖', async()=>{
  const m=JSON.parse(await readFile(file('manifest.json'),'utf8')); assert.equal(m.manifest_version,3);
  assert.deepEqual(m.permissions,['storage']); assert.deepEqual(m.host_permissions,['https://live.douyin.com/*']);
  for(const name of [m.background.service_worker,m.action.default_popup,...Object.values(m.icons),...m.content_scripts.flatMap(s=>s.js)]) await access(file(name));
  assert.equal(m.content_scripts[0].world,'MAIN'); assert.equal(m.content_scripts[1].world,'ISOLATED');
  const main=await readFile(file('page.js'),'utf8'); assert.doesNotMatch(main,/chrome\.storage|GM_getValue|api-key:|GM_xmlhttpRequest/);
});
test('后台拒绝非直播页面与子frame，保存读取可复用', async()=>{
  const w=await worker(); assert.equal((await w.send({type:'init'},{frameId:0,tab:{url:'https://evil.example/'}})).ok,false);
  assert.equal((await w.send({type:'init'},{frameId:1,tab:{url:'https://live.douyin.com/1'}})).ok,false);
  assert.equal((await w.send({type:'set',key:'outside',value:1})).ok,false);
  assert.equal((await w.send({type:'set',key:'live-assistant:config:1',value:{mode:'review'}})).ok,true);
  assert.equal((await w.send({type:'init'})).value['live-assistant:config:1'].mode,'review');
});
test('AI网络需指定域名权限且不携带Cookies、不跟随跳转', async()=>{
  const w=await worker(); const m={type:'ai',url:'https://ai.example/v1/chat/completions',data:JSON.stringify({model:'model',messages:[]}),headers:{Authorization:'Bearer dummy',Cookie:'not-forwarded'}};
  assert.equal((await w.send(m)).ok,true); assert.equal(w.requests[0].opts.credentials,'omit'); assert.equal(w.requests[0].opts.redirect,'error'); assert.equal(w.requests[0].opts.headers.Cookie,undefined);
  w.deny(); assert.equal((await w.send(m)).ok,false); assert.equal(w.requests.length,1);
});
test('同步只送当前房间配置/租约，不广播AI密钥',async()=>{
  const w=await worker(); await w.changed({'live-assistant:api-key:https://ai.example':{newValue:'dummy'}},'local'); assert.equal(w.sent.length,0);
  await w.changed({'live-assistant:config:1':{newValue:{}}},'local'); assert.equal(w.sent.length,1); assert.equal(w.sent[0][0],1);
});
test('实际扩展content产物通过Chrome接口启动；保存失败显示且保持未保存',async()=>{
  let listener;
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1',runScripts:'outside-only',pretendToBeVisual:true});
  Object.assign(dom.window,{TextDecoder,TextEncoder,fetch:async()=>({ok:true,text:async()=>'{"status_code":0,"data":{}}'}),chrome:{runtime:{sendMessage:async m=>m.type==='init'?{ok:true,value:{}}:{ok:false,error:'测试存储失败'},onMessage:{addListener:f=>listener=f}}}});
  dom.window.eval(await readFile(file('content.js'),'utf8')); await new Promise(r=>setTimeout(r,100));
  const root=dom.window.document.querySelector('#douyin-live-assistant')?.shadowRoot; assert.ok(root);
  const f=root.querySelector('[data-field="gift.minValue"]');f.value='200';f.dispatchEvent(new dom.window.Event('input',{bubbles:true}));root.querySelector('[data-action="save"]').click();await new Promise(r=>setTimeout(r,30));
  assert.match(root.querySelector('.toast').textContent,/测试存储失败/); assert.match(root.querySelector('[data-save-state]').textContent,/未保存/);
  const info=await new Promise(r=>listener({type:'room-info'},{},r));assert.equal(info.ready,true);dom.window.dispatchEvent(new dom.window.Event('pagehide'));dom.window.close();
});
