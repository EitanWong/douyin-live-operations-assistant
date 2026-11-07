import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {copy,DEFAULTS} from '../../src/core/engine.js';
import {createWorkspaceBridge} from '../../src/ui/product/bridge.js';
const walk=n=>[n,...(n?.children || []).flatMap(walk)];
function setup(callbacks={}){
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123',pretendToBeVisual:true});
 for(const k of ['document','window','location','MutationObserver','HTMLElement'])globalThis[k]=dom.window[k];
 globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
 const panel=new Panel({config:copy(DEFAULTS),room:'1',callbacks});
 const edit=(selector,value)=>{const input=panel.node(selector);input.value=value;input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
 return {dom,panel,edit,close:()=>{panel.destroy();dom.window.close();}};
}
test('知识库可通过同一弹窗与AI补充人物，确定后进入原知识草稿，保存前不持久化',async()=>{
 let seen,saved;const f=setup({profileTurn:async input=>{seen=input;return {version:1,name:input.name,key:'',turns:[{text:input.message,at:Date.now()}],facts:[{field:'residence',value:'杭州',evidence:[{turn:1,quote:'现在住杭州'}]}],relationships:[],analysis:[],knowledge:[],reply:'已记录当前居住地，身份仍待核实。'};},save:async c=>{saved=c;}});
 const bridge=createWorkspaceBridge(f.panel);
 try{
  bridge.navigate('knowledge');const add=walk(bridge.getSnapshot().content).find(n=>n.kind==='button' && n.text==='与AI补充人物');
  assert.ok(add,'知识库提供人物资料对话入口');bridge.activate(add.id);
  let dialog=bridge.getSnapshot().dialog;assert.equal(dialog.title,'与AI补充人物');
  bridge.change(walk(dialog).find(n=>n.kind==='field' && n.label==='人物名称').id,'小雨');
  dialog=bridge.getSnapshot().dialog;bridge.change(walk(dialog).find(n=>n.kind==='field' && n.label==='补充内容或更正').id,'小雨现在住杭州');
  bridge.activate(walk(bridge.getSnapshot().dialog).find(n=>n.kind==='button' && n.text==='发送给AI').id);await new Promise(setImmediate);bridge.refresh();
  assert.equal(seen.name,'小雨');assert.match(seen.message,/杭州/);assert.equal(f.panel.read().ai.memory.entries.length,0);assert.equal(saved,undefined);
  assert.match(walk(bridge.getSnapshot().dialog).map(n=>n.text || n.value || '').join(' '),/当前居住地|杭州/);
  bridge.activate(walk(bridge.getSnapshot().dialog).find(n=>n.kind==='button' && n.text==='确定').id);
  const entry=f.panel.read().ai.memory.entries[0];assert.equal(entry.person.name,'小雨');assert.equal(entry.trust,'unverified');assert.match(entry.content,/杭州/);assert.equal(f.panel.dirty,true);
  bridge.activate(bridge.getSnapshot().toolbar.find(n=>n.kind==='button' && n.text==='保存设置').id);await new Promise(setImmediate);
  assert.equal(saved.ai.memory.entries[0].person.facts[0].value,'杭州');
 }finally{bridge.destroy();f.close();}
});
test('人物对话取消会中止请求，迟到回复不覆盖新草稿；同名不自动绑定账号',async()=>{
 let finish,signal;const f=setup({profileTurn:input=>{signal=input.signal;return new Promise(r=>{finish=r;});}});
 try{
  f.panel.tab('knowledge');const button=f.panel.node('[data-person-add]');assert.ok(button);button.click();
  f.edit('[data-person-name]','小雨');f.edit('[data-person-message]','目前在杭州');f.panel.node('[data-person-send]').click();await new Promise(setImmediate);
  f.panel.node('[data-memory-cancel]').click();assert.equal(signal.aborted,true);
  button.click();f.edit('[data-person-name]','另一个人');finish({name:'小雨'});await new Promise(setImmediate);
  assert.equal(f.panel.node('[data-person-name]').value,'另一个人');assert.equal(f.panel.read().ai.memory.entries.length,0);
 }finally{f.close();}
});
test('保存后继续补充同一个人，失败保留输入和旧档案；原话资料计入容量，取消返回人物入口',async()=>{
 let calls=0;const at=Date.now();const f=setup({profileTurn:async input=>{
  if(++calls===2)throw Error('模型暂不可用');
  return {version:1,name:input.name,key:'',turns:[...(input.profile?.turns || []),{text:input.message,at}],facts:[{field:'residence',value:calls===1 ? '杭州' : '横店',evidence:[{turn:calls===1 ? 1 : 2,quote:input.message}]}],relationships:[],analysis:[],knowledge:[],reply:'已整理'};
 }});
 try{
  f.panel.tab('knowledge');const button=f.panel.node('[data-person-add]');button.click();f.panel.node('[data-memory-cancel]').click();assert.equal(f.panel.root.activeElement,button);
  button.click();f.edit('[data-person-name]','小雨');f.edit('[data-person-message]','目前住杭州');f.panel.node('[data-person-send]').click();await new Promise(setImmediate);f.panel.node('[data-memory-confirm]').click();
  const first=f.panel.read().ai.memory.entries[0];assert.ok(Number(f.panel.node('[data-knowledge-chars]').textContent.split(' / ')[0])>first.content.length,'对话及结构资料也计入总容量');
  f.panel.node('[data-memory-edit]').click();assert.equal(f.panel.node('[data-person-name]').disabled,true);assert.match(f.panel.node('[data-person-history]').textContent,/杭州/);
  f.edit('[data-person-message]','更正，目前住横店');f.panel.node('[data-person-send]').click();await new Promise(setImmediate);
  assert.equal(f.panel.node('[data-person-message]').value,'更正，目前住横店');assert.match(f.panel.node('[data-memory-dialog-error]').textContent,/模型暂不可用/);assert.deepEqual(f.panel.read().ai.memory.entries[0],first);
  f.panel.node('[data-person-send]').click();await new Promise(setImmediate);f.panel.node('[data-memory-confirm]').click();
  const entries=f.panel.read().ai.memory.entries;assert.equal(entries.length,1);assert.equal(entries[0].id,first.id);assert.equal(entries[0].person.turns.length,2);assert.equal(entries[0].person.facts[0].value,'横店');assert.match(entries[0].person.turns[0].text,/杭州/);
 }finally{f.close();}
});
test('请求中修改原话使旧整理失效，保留输入且不更新人物草稿',async()=>{
 let finish;const f=setup({profileTurn:input=>new Promise(r=>{finish=()=>r({version:1,name:input.name,key:'',turns:[{text:input.message,at:Date.now()}],facts:[],relationships:[],analysis:[],knowledge:[],reply:'已整理'});})});
 try{
  f.panel.tab('knowledge');f.panel.node('[data-person-add]').click();f.edit('[data-person-name]','小雨');f.edit('[data-person-message]','原话');f.panel.node('[data-person-send]').click();f.edit('[data-person-message]','更新的原话');finish();await new Promise(setImmediate);
  assert.equal(f.panel.node('[data-person-message]').value,'更新的原话');assert.match(f.panel.node('[data-memory-dialog-error]').textContent,/已修改/);assert.equal(f.panel.knowledgeLibrary?.editing?.record?.person,undefined);assert.equal(f.panel.read().ai.memory.entries.length,0);
 }finally{f.close();}
});
