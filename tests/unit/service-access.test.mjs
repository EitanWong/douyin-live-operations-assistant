import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServiceAccess} from '../../extension/service-access.js';
const tick=()=>new Promise(setImmediate);
function fixture(options){
 const granted=new Set(),opened=[],changed=[],listeners={};
 const event=name=>({addListener:f=>listeners[name]=f,removeListener:f=>{if(listeners[name]===f)delete listeners[name];}});
 const chrome={runtime:{getURL:path=>`chrome-extension://test/${path}`,sendMessage:async m=>changed.push(m)},permissions:{contains:async value=>value.origins.every(p=>granted.has(p)),onAdded:event('added')},tabs:{query:async()=>[],create:async value=>{opened.push(value);return {id:7};},update:async()=>{},onRemoved:event('removed')}};
 return {granted,opened,changed,listeners,chrome,access:createServiceAccess(chrome,options)};
}

test('并发服务共用授权页，相同域名只确认一次；确认之前不执行请求，之后自动继续',async()=>{
 const f=fixture(),calls=[];
 try{
  const a=f.access.ensure('https://research.example/v1/responses',{label:'后台研究模型'}).then(()=>calls.push('a'));
  const b=f.access.ensure('https://research.example/v1/chat/completions').then(()=>calls.push('b'));
  const c=f.access.ensure('http://localhost:11434/v1/chat/completions',{label:'本地模型'}).then(()=>calls.push('c'));
  await tick();assert.deepEqual(calls,[]);assert.equal(f.opened.length,1);
  const state=await f.access.handle({type:'service-access-state'});assert.equal(state.services.length,2);assert.ok(state.services.every(row=>row.waiting));
  f.granted.add('https://research.example/*');f.granted.add('http://localhost/*');
  await f.access.handle({type:'service-access-complete',patterns:state.services.map(row=>row.pattern)});await Promise.all([a,b,c]);assert.deepEqual(calls,['a','b','c']);
  await f.access.ensure('http://localhost:9000/v1/responses');assert.equal(f.opened.length,1);assert.deepEqual((await f.access.handle({type:'service-access-state'})).services,[]);
 }finally{f.access.close();}
});

test('拒绝后不重复弹页或放行请求，授权页可重试；不相信页面声称的授权结果',async()=>{
 const f=fixture();
 try{
  const failed=assert.rejects(f.access.ensure('https://model.example/v1/responses'),/尚未授权/);await tick();
  await f.access.handle({type:'service-access-complete',patterns:['https://model.example/*'],allowed:true});await failed;
  await assert.rejects(f.access.ensure('https://model.example/v1/responses'),/尚未授权/);assert.equal(f.opened.length,1);
  f.granted.add('https://model.example/*');await f.access.handle({type:'service-access-complete',patterns:['https://model.example/*']});await f.access.ensure('https://model.example/v1/responses');assert.equal(f.opened.length,1);
 }finally{f.access.close();}
});

test('先授权模型再需要搜索时重新显示同一授权页，不让新服务在后台无声等待',async()=>{
 const f=fixture(),focused=[];
 f.chrome.tabs.query=async()=>f.opened.length ? [{id:7,url:'chrome-extension://test/service-access.html'}] : [];
 f.chrome.tabs.update=async(id,options)=>focused.push({id,...options});
 try{
  const first=f.access.ensure('https://model.example/v1/responses');await tick();f.granted.add('https://model.example/*');await f.access.handle({type:'service-access-complete',patterns:['https://model.example/*']});await first;
  const second=f.access.ensure('https://search.example/search');void second.catch(()=>{});await tick();assert.deepEqual(focused,[{id:7,active:true}]);assert.equal(f.opened.length,1);
  f.granted.add('https://search.example/*');await f.access.handle({type:'service-access-complete',patterns:['https://search.example/*']});await second;
 }finally{f.access.close();}
});

test('取消一个请求不影响同域其他请求，迟到授权不会复活已取消请求',async()=>{
 const f=fixture(),controller=new AbortController();let calls=0;
 try{
  const cancelled=assert.rejects(f.access.ensure('https://model.example/v1/responses',{signal:controller.signal}).then(()=>calls++),/取消/);
  const other=f.access.ensure('https://model.example/v1/responses').then(()=>calls++);await tick();controller.abort();await cancelled;
  f.granted.add('https://model.example/*');await f.access.handle({type:'service-access-complete',patterns:['https://model.example/*']});await other;assert.equal(calls,1);
 }finally{f.access.close();}
});

test('关闭授权页结束等待，后续后台重试不反复开页',async()=>{
 const f=fixture();
 try{
  const failed=assert.rejects(f.access.ensure('https://model.example/v1/responses'),/已关闭/);await tick();f.listeners.removed(7);await failed;
  await assert.rejects(f.access.ensure('https://model.example/v1/responses'),/尚未授权/);assert.equal(f.opened.length,1);
 }finally{f.access.close();}
});

test('从扩展原入口授予权限也会自动继续等待请求，非本次需要的域名不申请',async()=>{
 const f=fixture();
 try{
  const waiting=f.access.ensure('https://model.example/v1/responses');await tick();f.granted.add('https://model.example/*');f.listeners.added({origins:['https://model.example/*']});await waiting;
  assert.deepEqual((await f.access.handle({type:'service-access-state'})).services,[]);
  assert.equal((await f.access.handle({type:'service-access-complete',patterns:['https://unrelated.example/*']})).granted,0);
 }finally{f.access.close();}
});

test('授权等待超时或打开页面失败时释放请求，后续显式授权仍可使用服务',async()=>{
 const f=fixture({waitMs:15});
 try{await assert.rejects(f.access.ensure('https://model.example/v1/responses'),/等待超时/);assert.equal((await f.access.handle({type:'service-access-state'})).services[0].waiting,false);await assert.rejects(f.access.ensure('https://model.example/v1/responses'),/尚未授权/);assert.equal(f.opened.length,1);}
 finally{f.access.close();}
 const g=fixture();g.chrome.tabs.create=async()=>{throw Error('tabs unavailable');};
 try{await assert.rejects(g.access.ensure('https://model.example/v1/responses'),/无法打开.*tabs unavailable/);}
 finally{g.access.close();}
});

test('非法服务地址和已取消请求不打开授权页，也不申请广泛权限',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();
 try{
  for(const url of ['http://remote.example/v1/responses','file:///tmp/test','https://key:secret@model.example/v1/responses'])await assert.rejects(f.access.ensure(url),/无效/);
  await assert.rejects(f.access.ensure('https://model.example/v1/responses',{signal:controller.signal}),/取消/);assert.equal(f.opened.length,0);
 }finally{f.access.close();}
});
