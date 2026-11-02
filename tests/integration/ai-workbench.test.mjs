import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {copy,DEFAULTS} from '../../src/core/engine.js';
import {AIWorkbench} from '../../src/ui/ai-workbench.js';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
const settle=()=>new Promise(setImmediate);
function setup(){const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1',pretendToBeVisual:true});for(const key of ['document','window','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};return dom;}
test('技能安装到草稿、替换、保存和移除保持一致，非法代码不能进入配置',async()=>{
 const dom=setup();let saved;const panel=new Panel({room:'1',config:copy(DEFAULTS),callbacks:{save:async c=>saved=c}});
 try{
  const input=panel.node('[data-skill-json]'),skill={version:1,id:'tea',name:'茶具交流',scenes:['ai'],instructions:'核对茶具资料'};
  input.value=JSON.stringify({...skill,execute:'bad'});panel.node('[data-skill-install]').click();assert.equal(panel.read().ai.assistant.skills.length,0);
  input.value=JSON.stringify(skill);panel.node('[data-skill-install]').click();assert.equal(panel.dirty,true);assert.equal(panel.config.ai.assistant.skills.length,0);
  input.value=JSON.stringify({...skill,instructions:'依据来源回答'});panel.node('[data-skill-install]').click();assert.equal(panel.read().ai.assistant.skills.length,1);
  panel.node('[data-action=save]').click();await settle();assert.equal(saved.ai.assistant.skills[0].instructions,'依据来源回答');
  panel.node('[data-skill-list] button').click();assert.equal(panel.read().ai.assistant.skills.length,0);
 }finally{panel.destroy();dom.window.close();}
});
test('工作台显示事实记忆、保存纠正和删除，后台提交后仍可操作，安全展示结果并取消',async()=>{
 const dom=setup(),panel=new Panel({room:'1',config:copy(DEFAULTS),callbacks:{}}),memory=new AudienceMemory({anchor:'10'});let saves=0,submitted,rows=[],cancelled;
 memory.observe({id:'chat-1',type:'chat',source:'socket',user:{id:'1',name:'小雨'},text:'我喜欢陶瓷'});
 const errors=[];const workbench=new AIWorkbench(panel.root,{memory:()=>memory,saveMemory:async()=>saves++,onError:error=>errors.push(error),tasks:{list:async()=>rows,submit:async(question,sources)=>{submitted={question,sources};rows=[{id:'task-1',question,status:'running',trace:[]}];},cancel:async id=>{cancelled=id;rows=[];}}});
 try{
  assert.match(panel.node('[data-audience-memory]').textContent,/陶瓷/);panel.node('[data-audience-note]').value='用户公开确认喜欢白瓷';panel.node('[data-audience-note-save]').click();await settle();assert.equal(saves,1);assert.deepEqual(memory.context({id:'1'}).verifiedOperatorNotes,['用户公开确认喜欢白瓷']);
  panel.node('[data-agent-question]').value='茶具如何清洗';panel.node('[data-agent-sources]').value='https://example.com/post';panel.node('[data-agent-submit]').click();await settle();assert.deepEqual(submitted,{question:'茶具如何清洗',sources:['https://example.com/post']});assert.match(panel.node('[data-agent-results]').textContent,/后台执行中/);
  panel.node('[data-audience-forget]').click();await settle();assert.equal(memory.list().length,0);panel.node('[data-agent-cancel]').click();await settle();assert.equal(cancelled,'task-1');
  rows=[{question:'结果',status:'succeeded',result:{answer:'<img src=x onerror=bad()>',publicSources:[{url:'https://example.com',title:'资料'}]}}];await workbench.refreshTasks();assert.equal(panel.node('[data-agent-results] img'),null);assert.match(panel.node('[data-agent-results]').textContent,/https:\/\/example.com/);assert.equal(errors.length,0);
 }finally{workbench.close();panel.destroy();dom.window.close();}
});

test('提交回执前双击研究按钮只创建一项任务，失败可重试且不锁住其他操作',async()=>{
 const dom=setup(),panel=new Panel({room:'1',config:copy(DEFAULTS),callbacks:{}}),memory=new AudienceMemory({anchor:'10'});let submit,fail,calls=0;const errors=[];
 const workbench=new AIWorkbench(panel.root,{memory:()=>memory,saveMemory:async()=>{},onError:e=>errors.push(e),tasks:{list:async()=>[],submit:()=>{calls++;return new Promise((resolve,reject)=>{submit=resolve;fail=reject;});}}});
 try{
  const button=panel.node('[data-agent-submit]');panel.node('[data-agent-question]').value='核对资料';button.click();button.click();await settle();
  assert.equal(calls,1);assert.equal(button.disabled,true);assert.equal(panel.node('[data-audience-refresh]').disabled,false);
  fail(new Error('测试断网'));await settle();assert.equal(button.disabled,false);assert.equal(errors.length,1);
  button.click();await settle();assert.equal(calls,2);submit();await settle();assert.equal(button.disabled,false);
 }finally{workbench.close();panel.destroy();dom.window.close();}
});

test('较旧的任务列表迟到不能覆盖已经显示的最终结果',async()=>{
 const dom=setup(),panel=new Panel({room:'1',config:copy(DEFAULTS),callbacks:{}}),memory=new AudienceMemory({anchor:'10'});const pending=[];
 const workbench=new AIWorkbench(panel.root,{memory:()=>memory,saveMemory:async()=>{},tasks:{list:()=>new Promise(resolve=>pending.push(resolve))}});
 try{
  pending.shift()([]);await settle();const old=workbench.refreshTasks(),latest=workbench.refreshTasks();
  pending[1]([{question:'核对资料',status:'succeeded',result:{answer:'核对完成'}}]);await latest;
  pending[0]([{question:'核对资料',status:'running',trace:[]}]);await old;
  assert.match(panel.node('[data-agent-results]').textContent,/核对完成/);assert.doesNotMatch(panel.node('[data-agent-results]').textContent,/后台执行中/);
 }finally{workbench.close();panel.destroy();dom.window.close();}
});

test('初始任务查询迟到失败不能清掉后续刷新已经显示的完成结果',async()=>{
 const dom=setup(),panel=new Panel({room:'1',config:copy(DEFAULTS),callbacks:{}}),memory=new AudienceMemory({anchor:'10'});let failFirst,calls=0;
 const workbench=new AIWorkbench(panel.root,{memory:()=>memory,saveMemory:async()=>{},tasks:{list:()=>++calls===1 ? new Promise((_resolve,reject)=>failFirst=reject) : Promise.resolve([{question:'核对资料',status:'succeeded',result:{answer:'核对完成'}}])}});
 try{
  await workbench.refreshTasks();failFirst(new Error('过时的连接错误'));await settle();
  assert.match(panel.node('[data-agent-results]').textContent,/核对完成/);assert.doesNotMatch(panel.node('[data-agent-results]').textContent,/过时的连接错误/);
 }finally{workbench.close();panel.destroy();dom.window.close();}
});
