import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import vm from 'node:vm';
import { installDevelopmentReload } from '../../extension/development-reload.js';
const run = promisify(execFile);
const a = 'a'.repeat(64), b = 'b'.repeat(64);

test('开发页心跳在扩展重载或上下文失效时静默停止，不抛出页面错误', async () => {
  const source = await readFile(new URL('../../extension/development-content.js', import.meta.url), 'utf8');
  const intervals = [], cleared = [], listeners = new Map();
  const page = { location:{pathname:'/123'}, addEventListener:(name,fn)=>listeners.set(name,fn), removeEventListener:()=>{} };
  const chrome = { runtime:{ connect:()=>{ throw new Error('Extension context invalidated.'); } } };
  assert.doesNotThrow(() => vm.runInNewContext(source,{chrome,location:page.location,window:page,setInterval:fn=>{intervals.push(fn);return fn;},clearInterval:id=>cleared.push(id)}));
  assert.equal(intervals.length,0);

  let ping;
  const port = { postMessage:()=>{ throw new Error('Extension context invalidated.'); }, disconnect:()=>{}, onDisconnect:{addListener:fn=>ping=fn,removeListener:()=>{}} };
  const context = { chrome:{runtime:{connect:()=>port,lastError:null}}, location:page.location, window:page,
    setInterval:fn=>{intervals.push(fn);return fn;}, clearInterval:id=>cleared.push(id) };
  vm.runInNewContext(source,context); assert.equal(intervals.length,1);
  assert.doesNotThrow(() => intervals.at(-1)()); assert.ok(cleared.includes(intervals.at(-1)));
  assert.doesNotThrow(() => ping?.());
});

test('开发心跳正常发送，断开时消费 lastError；页面销毁或清理失效均不残留心跳',async()=>{
  const source=await readFile(new URL('../../extension/development-content.js',import.meta.url),'utf8');
  for(const reason of ['disconnect','pagehide','postMessage','listener']){
    const intervals=new Map(),listeners=new Map();let disconnectListener,checks=0,disconnects=0,errorReads=0,invalid=false;
    const port={
      postMessage:()=>{if(invalid)throw new Error('Extension context invalidated.');checks++;},
      disconnect:()=>{disconnects++;throw new Error('Extension context invalidated.');},
      onDisconnect:{addListener:fn=>{disconnectListener=fn;if(reason==='listener')throw new Error('Extension context invalidated.');},removeListener:()=>{throw new Error('Extension context invalidated.');}}
    };
    const runtime={connect:()=>port,get lastError(){errorReads++;return {message:'The message port closed.'};}};
    const page={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
    assert.doesNotThrow(()=>vm.runInNewContext(source,{chrome:{runtime},window:page,location:{pathname:'/123'},setInterval:fn=>{intervals.set(1,fn);return 1;},clearInterval:id=>intervals.delete(id)}));
    if(reason==='listener'){assert.equal(checks,0);assert.equal(intervals.size,0);assert.equal(disconnects,1);continue;}
    assert.equal(checks,1);const tick=intervals.get(1);tick();assert.equal(checks,2);
    if(reason==='disconnect'){assert.doesNotThrow(disconnectListener);assert.equal(errorReads,1);}
    if(reason==='pagehide')assert.doesNotThrow(listeners.get('pagehide'));
    if(reason==='postMessage'){invalid=true;assert.doesNotThrow(tick);}
    assert.equal(intervals.size,0);assert.equal(listeners.size,0);assert.equal(disconnects,1);
    assert.doesNotThrow(tick);assert.equal(checks,2);assert.doesNotThrow(disconnectListener);assert.equal(disconnects,1);
  }
});

function harness({revision=a,values={},fetchUpdate,beforeReload,prepareReload=async()=>({ok:true}),alarmsAvailable=true}={}) {
  let alarm,connect,reloads=0,flushed=0;
  const tabs = new Map([[1,{id:1,url:'https://live.douyin.com/123'}],[2,{id:2,url:'https://example.com/'}]]), refreshed=[];
  const chrome = {
    runtime:{reload:()=>{reloads++;},onConnect:{addListener:f=>connect=f}},
    storage:{local:{get:async()=>values,set:async data=>Object.assign(values,data),remove:async key=>delete values[key]}},
    tabs:{sendMessage:prepareReload,query:async()=>[...tabs.values()],get:async id=>tabs.get(id),reload:async id=>refreshed.push(id)},
    alarms:{create:async()=>{},onAlarm:{addListener:f=>alarm=f}}
  };
  if (!alarmsAvailable) delete chrome.alarms;
  const api=installDevelopmentReload({chrome,revision,endpoint:'http://127.0.0.1:4179/build',beforeReload:async()=>{flushed++;await beforeReload?.();},fetchUpdate:fetchUpdate || (async()=>({ok:true,json:async()=>({revision})}))});
  return {api,values,tabs,refreshed,alarm,connect,reloads:()=>reloads,flushed:()=>flushed};
}

test('缺少 alarms 权限时仍完成初始化，并通过直播页心跳检测更新', async () => {
  let next=a, ping;
  const h=harness({alarmsAvailable:false,fetchUpdate:async()=>({ok:true,json:async()=>({revision:next})})});
  await h.api.checkUpdate(); assert.equal(h.reloads(),0);
  h.connect({name:'live-assistant-development',sender:{frameId:0,tab:{url:'https://live.douyin.com/123'}},onMessage:{addListener:f=>ping=f}});
  next=b; ping(); await h.api.checkUpdate();
  assert.equal(h.reloads(),1); assert.equal(h.flushed(),1);
});

test('具有 alarms 权限时由定时事件检测更新，忽略其他闹钟', async () => {
  let next=a, checks=0;
  const h=harness({fetchUpdate:async()=>{checks++;return {ok:true,json:async()=>({revision:next})};}});
  await h.api.checkUpdate(); const initialChecks=checks;
  next=b; h.alarm({name:'unrelated'}); assert.equal(checks,initialChecks);
  h.alarm({name:'live-assistant-development'}); await h.api.checkUpdate();
  assert.equal(h.reloads(),1); assert.equal(h.flushed(),1);
});

test('开发更新仅在构建变化后重载，先落账，并发检测只重载一次', async () => {
  let next=a;
  const h=harness({fetchUpdate:async()=>({ok:true,json:async()=>({revision:next})})});
  await h.api.checkUpdate(); assert.equal(h.reloads(),0);
  next=b; await Promise.all([h.api.checkUpdate(),h.api.checkUpdate(),h.api.checkUpdate()]);
  assert.equal(h.reloads(),1); assert.equal(h.flushed(),1);
  assert.deepEqual(h.values['live-assistant:development:refresh'].tabs,[{id:1,url:'https://live.douyin.com/123'}]);
  await h.api.checkUpdate(); assert.equal(h.reloads(),1);
});

test('开发更新重启后刷新原直播页，已导航页面和普通网页不刷新，配置账本不清除', async () => {
  const values = {'live-assistant:config:123':{mode:'preview'},'live-assistant:income:123':{days:[]},'live-assistant:development:refresh':{from:a,tabs:[{id:1,url:'https://live.douyin.com/123'},{id:2,url:'https://live.douyin.com/456'}]}};
  const h=harness({revision:b,values}); await h.api.restored;
  assert.deepEqual(h.refreshed,[1]); assert.equal(values['live-assistant:development:refresh'],undefined);
  assert.equal(values['live-assistant:config:123'].mode,'preview'); assert.deepEqual(values['live-assistant:income:123'],{days:[]});
});

test('开发服务关闭、构建中或非法版本不触发重载；可在下一次检测恢复', async () => {
  let mode='offline';
  const h=harness({fetchUpdate:async()=>{
    if(mode==='offline')throw new Error('ECONNREFUSED');
    return {ok:mode!=='building',json:async()=>({revision:mode==='bad'?'bad':b})};
  }});
  await h.api.checkUpdate();mode='building';await h.api.checkUpdate();mode='bad';await h.api.checkUpdate();
  assert.equal(h.reloads(),0);mode='ok';await h.api.checkUpdate();assert.equal(h.reloads(),1);
});

test('礼物写入未完成或失败时不重载，写入恢复后可重试更新', async () => {
  let release, started, fail=true;
  const waiting = new Promise(resolve=>{started=resolve;});
  const h=harness({fetchUpdate:async()=>({ok:true,json:async()=>({revision:b})}),beforeReload:async()=>{
    started(); await new Promise(resolve=>{release=resolve;});
    if(fail)throw new Error('storage unavailable');
  }});
  const update=h.api.checkUpdate(); await waiting;
  assert.equal(h.reloads(),0); assert.equal(h.values['live-assistant:development:refresh'],undefined);
  release(); await update;
  assert.equal(h.reloads(),0); assert.equal(h.values['live-assistant:development:refresh'],undefined);
  fail=false; const retry=h.api.checkUpdate();
  // 等待下一次进入写入屏障。
  while(h.flushed()<2)await new Promise(resolve=>setImmediate(resolve));
  release(); await retry; assert.equal(h.reloads(),1);
});

test('开发构建分离本地权限，正式构建不包含自动重载入口，输出版本可重复', async () => {
  const dist=await mkdtemp(join(tmpdir(),'douyin-development-'));
  try {
    const env={...process.env,DOUYIN_DIST_DIR:dist};
    await run(process.execPath,['scripts/build.mjs','--dev'],{env});
    const ext=join(dist,'chrome-extension');
    const manifest=JSON.parse(await readFile(join(ext,'manifest.json'),'utf8'));
    assert.ok(manifest.permissions.includes('alarms'));assert.ok(manifest.host_permissions.includes('http://127.0.0.1:4179/*'));
    const revision=JSON.parse(await readFile(join(dist,'development-build.json'),'utf8')).revision;
    assert.match(revision,/^[a-f0-9]{64}$/);assert.match(await readFile(join(ext,'background.js'),'utf8'),/installDevelopmentReload/);
    await run(process.execPath,['scripts/build.mjs','--dev'],{env});
    assert.equal(JSON.parse(await readFile(join(dist,'development-build.json'),'utf8')).revision,revision);
    await writeFile(join(dist,'development-watch.lock'),String(process.pid));
    await run(process.execPath,['scripts/build.mjs'],{env});
    const production=JSON.parse(await readFile(join(ext,'manifest.json'),'utf8'));
    assert.deepEqual(production.permissions,['storage','unlimitedStorage','alarms','power']);assert.doesNotMatch(await readFile(join(ext,'background.js'),'utf8'),/installDevelopmentReload/);
    assert.ok(!production.content_scripts.some(script=>script.js.includes('development-content.js')));
  } finally {await rm(dist,{recursive:true,force:true});}
});


test('页面未确认保存或仍有待入账恢复点写入时不重载扩展', async () => {
  let fail=true, release, entered;
  const ready=new Promise(resolve=>{entered=resolve;});
  const h=harness({fetchUpdate:async()=>({ok:true,json:async()=>({revision:b})}),prepareReload:async()=>{
    if(fail)return {ok:false};
    entered();await new Promise(resolve=>{release=resolve;});return {ok:true};
  }});
  await h.api.checkUpdate();assert.equal(h.reloads(),0);assert.equal(h.flushed(),0);
  fail=false;const update=h.api.checkUpdate();await ready;
  assert.equal(h.reloads(),0);release();await update;
  assert.equal(h.reloads(),1);
});
