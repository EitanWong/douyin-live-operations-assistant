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
 const edit=value=>{const input=panel.node('[data-person-message]');input.value=value;input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
 return {dom,panel,edit,close:()=>{panel.destroy();dom.window.close();}};
}
const entry=(id,content)=>({id,title:id,content,source:'用户补充 · Agent整理，待核实',updatedAt:Date.now(),expiresOn:'',enabled:true,trust:'unverified',supplement:{text:content,history:[],evidence:[]}});
test('补充知识只填一段文字，Agent结果直接进入知识库，不再要求姓名、账号、标题或确认保存',async()=>{
 let seen;const f=setup({knowledgeSupplement:async input=>{seen=input;input.onProgress({trace:[{step:'tool:relationships',detail:'查找已有的人物资料'}]});return {entries:[entry('person-a','人物：小雨。当前居住地：杭州。小雨是阿明的助理。'),entry('topic-a','陶瓷茶具可用温水清洗。')],answer:'已更新两条知识。'};}}),bridge=createWorkspaceBridge(f.panel);
 try{
  bridge.navigate('knowledge');bridge.activate(walk(bridge.getSnapshot().content).find(n=>n.kind==='button' && n.text==='AI补充知识').id);
  const fields=walk(bridge.getSnapshot().dialog).filter(n=>n.kind==='field');assert.deepEqual(fields.map(n=>n.label),['补充知识']);
  bridge.change(fields[0].id,'小雨现在住杭州，是阿明的助理。陶瓷茶具用温水清洗。');
  bridge.activate(walk(bridge.getSnapshot().dialog).find(n=>n.kind==='button' && n.text==='交给Agent处理').id);await new Promise(setImmediate);bridge.refresh();
  assert.match(seen.message,/杭州/);assert.equal(seen.name,undefined);assert.equal(f.panel.read().ai.memory.entries.length,2);assert.equal(f.panel.dirty,false);
  const text=walk(bridge.getSnapshot().dialog).map(n=>n.text || '').join(' ');assert.match(text,/已更新两条知识/);assert.match(text,/查找已有的人物资料/);
  assert.ok(!walk(bridge.getSnapshot().dialog).some(n=>n.kind==='button' && n.text==='确定'));assert.equal(f.panel.node('[data-person-message]').value,'');
 }finally{bridge.destroy();f.close();}
});
test('取消会中止Agent等待，迟到结果不覆盖新输入；重新提交只携带文字',async()=>{
 let finish,signal;const f=setup({knowledgeSupplement:input=>{signal=input.signal;return new Promise(r=>finish=r);}});
 try{
  f.panel.tab('knowledge');const button=f.panel.node('[data-person-add]');button.click();f.edit('小雨住杭州');f.panel.node('[data-person-send]').click();await new Promise(setImmediate);
  f.panel.node('[data-memory-cancel]').click();assert.equal(signal.aborted,true);assert.equal(f.panel.root.activeElement,button);
  button.click();f.edit('另一段知识');finish({entries:[entry('old','旧结果')],answer:'旧结果'});await new Promise(setImmediate);
  assert.equal(f.panel.node('[data-person-message]').value,'另一段知识');assert.equal(f.panel.read().ai.memory.entries.length,0);
 }finally{f.close();}
});
test('失败和空输入保留旧知识与草稿，执行中阻止重复提交；继续补充携带稳定条目ID',async()=>{
 let calls=0,seen;const f=setup({knowledgeSupplement:async input=>{calls++;seen=input;if(calls===1)throw Error('模型暂不可用');return {entries:[entry('person-a','人物：小雨。当前居住地：横店。')],answer:'已更正'};}});
 try{
  f.panel.knowledgeLibrary.add(entry('person-a','人物：小雨。当前居住地：杭州。'));f.panel.node('[data-memory-edit]').click();
  f.panel.node('[data-person-send]').click();assert.equal(calls,0);
  f.edit('更正，小雨目前住横店');f.panel.node('[data-person-send]').click();f.panel.node('[data-person-send]').click();await new Promise(setImmediate);
  assert.equal(calls,1);assert.equal(f.panel.node('[data-person-message]').value,'更正，小雨目前住横店');assert.match(f.panel.node('[data-memory-dialog-error]').textContent,/模型暂不可用/);assert.match(f.panel.read().ai.memory.entries[0].content,/杭州/);
  f.panel.node('[data-person-send]').click();await new Promise(setImmediate);assert.equal(seen.entryId,'person-a');assert.equal(f.panel.read().ai.memory.entries.length,1);assert.match(f.panel.read().ai.memory.entries[0].content,/横店/);
 }finally{f.close();}
});
test('执行中禁止更改已提交原话，完成后可以继续补充，普通手工编辑仍可用',async()=>{
 let finish;const f=setup({knowledgeSupplement:()=>new Promise(r=>finish=r)});
 try{
  f.panel.node('[data-person-add]').click();f.edit('小雨住杭州');f.panel.node('[data-person-send]').click();assert.equal(f.panel.node('[data-person-message]').disabled,true);
  finish({entries:[entry('a','人物：小雨。')],answer:'已保存'});await new Promise(setImmediate);assert.equal(f.panel.node('[data-person-message]').disabled,false);
  f.panel.node('[data-memory-cancel]').click();f.panel.node('[data-memory-add]').click();assert.equal(f.panel.node('[data-memory-editor]').hidden,false);assert.equal(f.panel.node('[data-memory-confirm]').hidden,false);
 }finally{f.close();}
});
