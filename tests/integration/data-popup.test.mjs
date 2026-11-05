import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('archive popup follows confirmed state after enable/pause, preserves input through repeated disclosure and reports errors',async()=>{
 const html=await readFile(new URL('../../extension/popup.html',import.meta.url),'utf8');
 const source=(await readFile(new URL('../../extension/popup.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 const dom=new JSDOM(html,{url:'https://example.test',runScripts:'outside-only'});let enabled=false,failed=false;
 try{
  Object.assign(dom.window,{installTheme(){},chrome:{runtime:{sendMessage:async m=>{
   if(failed)return {ok:false,error:'本地组件不可用'};
   if(m.type==='data-configure')enabled=m.enabled;
   return {ok:true,value:{enabled,pending:3,native:{records:8,database:'/local/live.sqlite3'}}};
  }},tabs:{query:async()=>[{id:1,url:'https://live.douyin.com/1'}],sendMessage:async()=>({ready:true})}}});
  dom.window.eval(source);await new Promise(setImmediate);
  const d=dom.window.document,enable=d.querySelector('#data-enable'),pause=d.querySelector('#data-disable'),input=d.querySelector('#data-room');
  enable.click();await new Promise(setImmediate);assert.equal(enable.disabled,true);assert.equal(pause.disabled,false);
  assert.match(d.querySelector('#data-status').textContent,/归档已启用/);
  input.value='https://live.douyin.com/123';input.focus();const details=input.closest('details');
  for(let i=0;i<5;i++){details.open=true;details.open=false;}
  assert.equal(input.value,'https://live.douyin.com/123');
  pause.click();await new Promise(setImmediate);assert.equal(enable.disabled,false);assert.equal(pause.disabled,true);
  failed=true;enable.click();await new Promise(setImmediate);assert.match(d.querySelector('#data-status').textContent,/不可用/);assert.equal(enable.disabled,false);
 }finally{dom.window.close();}
});

test('custom storage shows confirmed directory, preserves unsaved path and reports failed migration without discarding draft',async()=>{
 const html=await readFile(new URL('../../extension/popup.html',import.meta.url),'utf8');
 const source=(await readFile(new URL('../../extension/popup.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 const dom=new JSDOM(html,{url:'https://example.test',runScripts:'outside-only'});
 let directory='/local',failed=false;const calls=[];
 try{
  Object.assign(dom.window,{installTheme(){},chrome:{runtime:{sendMessage:async m=>{
   calls.push(m);
   if(m.type==='data-relocate'){
    if(failed)return {ok:false,error:'目标数据库已存在，未覆盖'};
    assert.equal(m.expectedDatabase,`${directory}/live.sqlite3`);directory=m.directory;
   }
   return {ok:true,value:{enabled:true,pending:3,native:{records:8,database:`${directory}/live.sqlite3`}}};
  }},tabs:{query:async()=>[{id:1,url:'https://live.douyin.com/1'}],sendMessage:async()=>({ready:true})}}});
  dom.window.eval(source);await new Promise(setImmediate);
  const d=dom.window.document,input=d.querySelector('#data-directory'),save=d.querySelector('#data-relocate');
  assert.ok(input && save,'storage location can be changed from the extension popup');
  assert.equal(input.value,'/local');input.value='/Volumes/直播 数据';input.dispatchEvent(new dom.window.Event('input'));input.focus();
  d.querySelector('#data-retry').click();await new Promise(setImmediate);assert.equal(input.value,'/Volumes/直播 数据');
  save.click();await new Promise(setImmediate);assert.match(d.querySelector('#data-status').textContent,/\/Volumes\/直播 数据\/live.sqlite3/);
  assert.equal(calls.filter(m=>m.type==='data-relocate').length,1);
  failed=true;input.value='/existing';input.dispatchEvent(new dom.window.Event('input'));save.click();await new Promise(setImmediate);
  assert.match(d.querySelector('#data-status').textContent,/未覆盖/);assert.equal(input.value,'/existing');assert.equal(save.disabled,false);
 }finally{dom.window.close();}
});
