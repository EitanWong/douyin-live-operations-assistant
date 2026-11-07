import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {installTheme} from '../../src/ui/theme.js';

test('自动授权页无地址填空，点击同步申请实际所需域名；拒绝与错误可重试并保留焦点',async()=>{
 const html=await readFile(new URL('../../extension/service-access.html',import.meta.url),'utf8'),source=(await readFile(new URL('../../extension/service-access-page.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 const dom=new JSDOM(html,{url:'https://fixture.test',runScripts:'outside-only'}),requests=[],listeners=new Set();let gesture=false,granted=false,throwing=false;
 let services=[{pattern:'https://model.example/*',origin:'https://model.example',label:'后台研究模型',waiting:true},{pattern:'http://localhost/*',origin:'http://localhost:11434',label:'本地模型',waiting:true}];
 try{
  Object.assign(dom.window,{installTheme,chrome:{runtime:{onMessage:{addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f)},sendMessage:async m=>{
   if(m.type==='service-access-complete')services=granted ? [] : services.map(row=>({...row,waiting:false}));
   if(m.type==='service-access-cancel')services=services.map(row=>({...row,waiting:false}));
   return {ok:true,value:{services}};
  }},permissions:{request:async value=>{assert.equal(gesture,true);requests.push(JSON.parse(JSON.stringify(value)));if(throwing)throw Error('Chrome暂不可用');return granted;}}}});
  dom.window.eval(source);await new Promise(setImmediate);const d=dom.window.document,button=d.querySelector('#access-allow');assert.equal(d.querySelectorAll('input').length,0);assert.match(d.body.textContent,/localhost:11434/);
  button.focus();gesture=true;button.click();gesture=false;await new Promise(setImmediate);assert.deepEqual(requests[0],{origins:['https://model.example/*','http://localhost/*']});assert.match(d.querySelector('#access-status').textContent,/暂未授权/);assert.equal(button.disabled,false);assert.equal(d.activeElement,button);
  throwing=true;gesture=true;button.click();gesture=false;await new Promise(setImmediate);assert.match(d.querySelector('#access-status').textContent,/Chrome暂不可用/);assert.equal(button.disabled,false);
  throwing=false;granted=true;gesture=true;button.click();gesture=false;await new Promise(setImmediate);assert.match(d.querySelector('#access-status').textContent,/已授权/);assert.equal(button.disabled,true);
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));assert.equal(listeners.size,0);
 }finally{dom.window.close();}
});
