import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {DouyinAdapter} from '../../src/browser/adapter.js';
import {copy,DEFAULTS} from '../../src/core/engine.js';
import {runtimeAlertState,hasUnacknowledgedRuntimeAlert} from '../../src/runtime/health.js';

function setup(t,onEvent) {
  const dom=new JSDOM('<body><div id="chat"></div></body>',{url:'https://live.douyin.com/1'});
  for(const key of ['document','MutationObserver']){
    const previous=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
    t.after(()=>previous?Object.defineProperty(globalThis,key,previous):delete globalThis[key]);
  }
  const statuses=[],adapter=new DouyinAdapter({page:dom.window,getConfig:()=>copy(DEFAULTS),onEvent,onLog:()=>{},onStatus:status=>statuses.push(status)});
  t.after(()=>{adapter.stopDOM?.();dom.window.close();});
  const insert=(count,text='消息')=>{
    const fragment=document.createDocumentFragment();
    for(let i=0;i<count;i++){
      const row=document.createElement('div');row.dataset.e2e='chat-message';
      row.innerHTML='<b data-e2e="chat-nickname">观众</b><span data-e2e="chat-content"></span>';
      row.lastChild.textContent=`${text}${i}`;fragment.append(row);
    }
    document.querySelector('#chat').replaceChildren(fragment);
  };
  return {adapter,statuses,insert};
}

test('DOM 慢订阅的在途批次和等待事件共用容量，超量可见且停止释放缓冲',async t=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});t.after(release);
  const received=[],f=setup(t,async event=>{received.push(event.text);await gate;});
  t.mock.timers.enable({apis:['setTimeout']});
  f.adapter.observeDOM();f.insert(4096);await new Promise(setImmediate);
  t.mock.timers.tick(50);await new Promise(setImmediate);assert.equal(received.length,1);
  f.insert(10,'满载后');await new Promise(setImmediate);
  const network=f.statuses.at(-1)||{};
  assert.equal(network.dom?.pending,4096);assert.equal(network.dom?.gaps,10);
  assert.equal(hasUnacknowledgedRuntimeAlert(network),true);
  assert.equal(runtimeAlertState(network).gaps.dom,10);
  release();
  for(let i=0;i<22;i++){t.mock.timers.tick(50);await new Promise(setImmediate);}
  assert.deepEqual(received,Array.from({length:4096},(_,i)=>`消息${i}`),'释放慢订阅后按序交付所有已接纳事件');
  f.insert(1,'停止后');await new Promise(setImmediate);
  f.adapter.stopDOM();t.mock.timers.tick(50);await new Promise(setImmediate);
  assert.equal(f.statuses.at(-1).dom.pending,0);assert.equal(f.statuses.at(-1).dom.bytes,0);
  assert.equal(received.length,4096);
});

test('DOM 超大消息受字节预算限制，正常消息交给扩展 dispatch 统一恢复',async t=>{
  const f=setup(t,()=>assert.fail('扩展备用采集不得绕过 dispatch'));
  const received=[];f.adapter.dispatch=async event=>received.push(event.text);
  t.mock.timers.enable({apis:['setTimeout']});
  f.adapter.observeDOM();f.insert(1,'x'.repeat(4*1024*1024));await new Promise(setImmediate);
  assert.equal(f.statuses.at(-1)?.dom?.gaps,1);
  f.insert(1,'正常');await new Promise(setImmediate);t.mock.timers.tick(50);await new Promise(setImmediate);
  assert.deepEqual(received,['正常0']);assert.equal(f.statuses.at(-1).dom.pending,0);
});
