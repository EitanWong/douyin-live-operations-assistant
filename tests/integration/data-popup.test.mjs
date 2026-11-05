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
