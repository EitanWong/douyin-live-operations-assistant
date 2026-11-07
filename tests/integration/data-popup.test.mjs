import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {validateEndpoint} from '../../src/services/ai.js';
import {validateSearchEndpoint} from '../../src/services/search.js';
import {servicePermissionPattern} from '../../extension/service-permissions.js';

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

test('权限弹窗自动读取独立后台研究接口，在点击栈中授权Responses服务；拒绝后保留地址可重试',async()=>{
 const html=await readFile(new URL('../../extension/popup.html',import.meta.url),'utf8');
 const source=(await readFile(new URL('../../extension/popup.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 const dom=new JSDOM(html,{url:'https://example.test',runScripts:'outside-only'}),requests=[];let gesture=false,allowed=false;
 try{
  Object.assign(dom.window,{installTheme(){},validateEndpoint,validateSearchEndpoint,servicePermissionPattern,chrome:{runtime:{sendMessage:async()=>({ok:true,value:{enabled:false,pending:0}})},tabs:{query:async()=>[{id:1,url:'https://live.douyin.com/1'}],sendMessage:async()=>({ready:true,endpoint:'https://reply.example/v1/chat/completions',researchEndpoint:'https://research.example/v1/responses'})},permissions:{request:async value=>{assert.equal(gesture,true,'权限申请必须由当前点击直接发起');requests.push(value);return allowed;}}}});
  dom.window.eval(source);await new Promise(setImmediate);const d=dom.window.document,input=d.querySelector('#research-endpoint'),button=d.querySelector('#allow-research');
  assert.ok(input && button,'后台API有独立授权入口');assert.equal(input.value,'https://research.example/v1/responses');
  gesture=true;button.click();gesture=false;await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(JSON.stringify(requests)),[{origins:['https://research.example/*']}]);assert.match(d.querySelector('#status').textContent,/未授权/);assert.equal(input.value,'https://research.example/v1/responses');
  allowed=true;gesture=true;button.click();gesture=false;await new Promise(setImmediate);assert.match(d.querySelector('#status').textContent,/后台研究.*已授权/);
  input.value='https://research.example/v1/responses?api_key=never-send';gesture=true;button.click();gesture=false;await new Promise(setImmediate);assert.equal(requests.length,2,'非法含凭据地址不申请权限');
  d.querySelector('#endpoint').value='http://localhost:11434/v1/responses';gesture=true;d.querySelector('#allow').click();gesture=false;await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1))),{origins:['http://localhost/*']});
 }finally{dom.window.close();}
});
