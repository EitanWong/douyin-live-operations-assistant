import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {copy,DEFAULTS} from '../../src/core/engine.js';
import {createWorkspaceBridge} from '../../src/ui/product/bridge.js';

const record=(id,title,extra={})=>({id,title,content:'主播每周六晚上八点开播',source:'主播确认',updatedAt:Date.now(),expiresOn:'',enabled:true,...extra});
function setup(entries=[],callbacks={}){
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123',pretendToBeVisual:true});
 for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
 globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
 const config=copy(DEFAULTS);config.ai.memory.entries=entries;
 const panel=new Panel({config,room:'1',callbacks});
 const edit=(selector,value,type='input')=>{const input=panel.node(selector);input.value=value;input.dispatchEvent(new dom.window.Event(type,{bubbles:true}));};
 return {dom,panel,edit,close(){panel.destroy();dom.window.close();}};
}
const visibleRows=panel=>[...panel.node('[data-memory-list]').children].filter(row=>!row.hidden);
const walk=node=>[node,...(node?.children || []).flatMap(walk)];

test('知识库独立导航，默认折叠摘要；跨页、搜索和筛选保留所有编辑草稿并完整保存',async()=>{
 let saved;const f=setup([record('a','开播安排'),record('b','商品口径',{content:'陶瓷茶杯不可微波',enabled:false}),record('c','旧活动',{expiresOn:'2020-01-01'})],{save:async config=>saved=config});
 try{
  const {panel,edit}=f;panel.node('[data-tab="knowledge"]').click();
  assert.equal(panel.activeTab,'knowledge');assert.equal(panel.node('[data-page="knowledge"]').hidden,false);
  assert.equal(panel.node('[data-memory-list]').closest('[data-page]').dataset.page,'knowledge');
  assert.ok([...panel.node('[data-memory-list]').children].every(row=>row.tagName==='DETAILS' && !row.open));
  assert.match(panel.node('[data-memory-list] summary').textContent,/开播安排.*可用/u);
  const row=panel.node('[data-memory-list]').firstElementChild;row.open=true;
  edit('[data-memory-field="title"]','每周排期');edit('[data-memory-filter-query]','陶瓷');
  assert.deepEqual(visibleRows(panel).map(row=>row.record.id),['b']);
  panel.tab('ai');panel.tab('knowledge');assert.equal(row.querySelector('[data-memory-field="title"]').value,'每周排期');
  edit('[data-memory-filter-query]','');edit('[data-knowledge-status]','expired','change');assert.deepEqual(visibleRows(panel).map(row=>row.record.id),['c']);
  panel.node('[data-action="save"]').click();await new Promise(setImmediate);
  assert.equal(saved.ai.memory.entries.length,3);assert.equal(saved.ai.memory.entries.find(r=>r.id==='a').title,'每周排期');
  assert.equal(panel.node('[data-knowledge-status]').value,'expired');
 }finally{f.close();}
});

test('无匹配可重置，添加时清除筛选并展开新条目，隐藏无效草稿保存时定位到正文',()=>{
 const f=setup([record('a','原资料')]);try{
  const {panel,edit}=f;panel.tab('knowledge');edit('[data-memory-filter-query]','不存在');
  assert.equal(visibleRows(panel).length,0);assert.equal(panel.node('[data-knowledge-no-results]').hidden,false);
  panel.node('[data-knowledge-reset]').click();assert.equal(visibleRows(panel).length,1);
  edit('[data-memory-filter-query]','原资料');panel.node('[data-memory-add]').click();
  const row=panel.node('[data-memory-list]').querySelector('details[open]');assert.ok(row);assert.equal(row.open,true);assert.equal(row.hidden,false);
  row.querySelector('[data-memory-field="title"]').value='新资料';edit('[data-memory-filter-query]','原资料');panel.tab('ai');
  assert.throws(()=>panel.read(),/正文/);assert.equal(panel.activeTab,'knowledge');assert.equal(row.hidden,false);assert.equal(row.open,true);
  assert.equal(panel.root.activeElement,row.querySelector('[data-memory-field="content"]'));
 }finally{f.close();}
});

test('联网知识可全文查找、折叠与整理为停用的可编辑手工草稿，删除原来源不丢整理稿',async()=>{
 let rows=[{id:'web',query:'PK规则',searchedAt:Date.now(),expiresAt:Date.now()+60000,results:[{index:1,title:'官方活动说明',url:'https://www.douyin.com/rules',content:'<img src=x onerror=alert(1)> 活动加成以页面为准'}]}];
 const f=setup([],{webKnowledge:{persistent:true,list:async()=>rows,remove:async()=>{rows=[];},clear:async()=>{rows=[];}}});
 try{
  const {panel,edit}=f;panel.tab('knowledge');await new Promise(setImmediate);
  edit('[data-memory-filter-query]','加成');assert.equal(panel.node('[data-web-knowledge-list] details').hidden,false);
  assert.equal(panel.node('[data-web-knowledge-list] img'),null);
  panel.node('[data-web-knowledge-copy]').click();
  const draft=panel.read().ai.memory.entries[0];assert.equal(draft.title,'PK规则');assert.equal(draft.enabled,false);assert.match(draft.content,/活动加成/);assert.match(draft.source,/douyin/);
  assert.equal(panel.node('[data-memory-list] details').open,true);
  panel.node('[data-web-knowledge-remove]').click();await new Promise(setImmediate);assert.equal(panel.read().ai.memory.entries.length,1);
 }finally{f.close();}
});

test('可见产品界面投影支持折叠、查询、编辑和保存同一份知识数据',async()=>{
 let saved;const f=setup([record('a','主播排期'),record('b','商品说明')],{save:async config=>saved=config});
 const bridge=createWorkspaceBridge(f.panel);
 try{
  bridge.navigate('knowledge');let nodes=walk(bridge.getSnapshot().content);
  const detail=nodes.find(n=>n.kind==='details' && n.title.includes('主播排期'));assert.ok(detail);assert.equal(detail.open,false);
  bridge.toggle(detail.id,true);nodes=walk(bridge.getSnapshot().content);
  const title=nodes.find(n=>n.kind==='field' && n.label==='资料标题');assert.ok(title);bridge.change(title.id,'已核对的排期');
  const query=nodes.find(n=>n.kind==='field' && n.label==='搜索知识');bridge.change(query.id,'陶瓷');
  assert.doesNotMatch(JSON.stringify(bridge.getSnapshot().content),/已核对的排期/);
  const save=bridge.getSnapshot().toolbar.find(n=>n.kind==='button' && n.text==='保存设置');bridge.activate(save.id);await new Promise(setImmediate);
  assert.equal(saved.ai.memory.entries[0].title,'已核对的排期');assert.equal(saved.ai.memory.entries.length,2);
 }finally{bridge.destroy();f.close();}
});

test('筛选、排序和批量折叠不改配置；按来源查找、停用与过期筛选各自准确',()=>{
 const f=setup([record('b','周末排期',{source:'直播运营组',updatedAt:Date.now()-1000}),record('a','商品说明',{enabled:false}),record('c','历史活动',{expiresOn:'2020-01-01'})]);
 try{
  const {panel,edit}=f;panel.tab('knowledge');
  for(const name of ['ai.memory.enabled','ai.search.rememberKnowledge'])assert.equal(panel.root.querySelectorAll(`[data-field="${name}"]`).length,1);
  edit('[data-memory-filter-query]','运营组');assert.deepEqual(visibleRows(panel).map(r=>r.record.id),['b']);
  panel.node('[data-knowledge-expand]').click();assert.equal(visibleRows(panel)[0].open,true);assert.equal([...panel.node('[data-memory-list]').children].filter(r=>r.open).length,1);
  panel.node('[data-knowledge-collapse]').click();assert.ok([...panel.node('[data-memory-list]').children].every(r=>!r.open));
  panel.node('[data-knowledge-reset]').click();edit('[data-knowledge-status]','disabled','change');assert.deepEqual(visibleRows(panel).map(r=>r.record.id),['a']);
  edit('[data-knowledge-status]','active','change');assert.deepEqual(visibleRows(panel).map(r=>r.record.id),['b']);
  panel.node('[data-knowledge-reset]').click();edit('[data-knowledge-sort]','title','change');
  assert.deepEqual(visibleRows(panel).map(r=>r.record.title),['历史活动','商品说明','周末排期']);assert.equal(panel.dirty,false);
 }finally{f.close();}
});

test('删除后可撤销全部未保存编辑，保存后重新打开仍能查询和编辑',async()=>{
 let saved;const f=setup([record('a','原资料')],{save:async config=>saved=config});
 try{
  const {panel,edit}=f;panel.tab('knowledge');edit('[data-memory-field="content"]','最新确认的安排');panel.node('[data-memory-remove]').click();
  assert.equal(panel.read().ai.memory.entries.length,0);panel.node('[data-memory-undo]').click();
  assert.equal(panel.read().ai.memory.entries[0].content,'最新确认的安排');panel.node('[data-action="save"]').click();await new Promise(setImmediate);
  const reopened=new Panel({room:'1',config:saved,callbacks:{}});try{reopened.tab('knowledge');assert.equal(reopened.read().ai.memory.entries[0].content,'最新确认的安排');assert.equal(reopened.node('[data-memory-list] details').open,false);}finally{reopened.destroy();}
 }finally{f.close();}
});

test('40条知识均可折叠查询，容量已满时拒绝新建并保留已有草稿',()=>{
 const f=setup(Array.from({length:40},(_,i)=>record(String(i),`知识${i}`,{content:`已核对资料${i}`})));
 try{
  const {panel,edit}=f;panel.tab('knowledge');panel.node('[data-memory-add]').click();
  assert.equal(panel.read().ai.memory.entries.length,40);assert.match(panel.node('.toast').textContent,/最多40/);
  edit('[data-memory-filter-query]','已核对资料39');assert.equal(visibleRows(panel).length,1);assert.equal(visibleRows(panel)[0].record.id,'39');
 }finally{f.close();}
});
