import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {copy,DEFAULTS} from '../../src/core/engine.js';
import {createWorkspaceBridge} from '../../src/ui/product/bridge.js';
import {createKnowledgeCorpus} from '../../src/ai/knowledge-corpus.js';
import {createRelationshipLibrary} from '../../src/ai/relationship-library.js';

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

test('人物图谱在知识库按当前草稿本机查询，展示原话、冲突与时间且不渲染不可信HTML',()=>{
 let seen;const f=setup([record('r','人物关系',{content:'阿明是小雨的师傅'})],{relationships:(query,memory)=>{
  seen={query,memory};return {entities:[{id:'a',name:'阿明'},{id:'b',name:'小雨'}],relations:[{id:'r',from:'a',to:'b',predicate:'师傅',negative:false,status:'conflicted',evidence:[{text:'<img src=x>阿明是小雨的师傅',at:Date.now(),source:'弹幕',trust:'unverified'}]}],ambiguities:[],paths:[]};
 }});
 try{
  const {panel,edit}=f;panel.tab('knowledge');edit('[data-relationship-query]','阿明是谁');panel.node('[data-relationship-search]').click();
  assert.equal(seen.query,'阿明是谁');assert.equal(seen.memory.entries.length,1);
  assert.match(panel.node('[data-relationship-results]').textContent,/阿明.*师傅|师傅.*小雨/u);
  assert.match(panel.node('[data-relationship-results]').textContent,/冲突|待核实/u);
  assert.equal(panel.node('[data-relationship-results]').querySelector('img'),null);assert.equal(panel.dirty,false);
 }finally{f.close();}
});

test('AI知识与搜索移除知识库组件与管理入口，知识库保持唯一添加编辑位置',()=>{
 const f=setup();try{
  const {panel}=f;panel.tab('ai');panel.node('[data-ai-section-tab="knowledge"]').click();
  const section=panel.node('[data-ai-section="knowledge"]');
  assert.equal(section.querySelector('[data-go="knowledge"]'),null);
  assert.ok(![...section.querySelectorAll('h3')].some(n=>n.textContent==='知识库'));
  assert.equal(section.querySelector('[data-memory-add]'),null);
  panel.tab('knowledge');assert.ok(panel.node('[data-page="knowledge"] [data-memory-add]'));
 }finally{f.close();}
});

test('新增知识弹窗校验、确认与取消，未确认内容不污染列表和设置',async()=>{
 let saved;const f=setup([record('a','原资料')],{save:async config=>saved=config});try{
  const {panel,edit}=f;panel.tab('knowledge');edit('[data-memory-filter-query]','不存在');
  panel.node('[data-memory-add]').click();const dialog=panel.node('[data-knowledge-dialog]');
  assert.equal(dialog.hidden,false);assert.equal(dialog.getAttribute('aria-modal'),'true');
  assert.equal(panel.root.activeElement,dialog.querySelector('[data-memory-field="title"]'));
  assert.equal(panel.read().ai.memory.entries.length,1);assert.equal(panel.dirty,false);
  panel.node('[data-memory-confirm]').click();assert.equal(dialog.hidden,false);
  assert.match(panel.node('[data-memory-dialog-error]').textContent,/标题/);
  edit('[data-memory-field="title"]','新增安排');assert.equal(panel.node('[data-memory-dialog-error]').hidden,true);panel.node('[data-memory-confirm]').click();assert.match(panel.node('[data-memory-dialog-error]').textContent,/正文/);
  edit('[data-memory-field="content"]','每周六开播');edit('[data-memory-field="source"]','本人确认');
  panel.node('[data-memory-confirm]').click();assert.equal(dialog.hidden,true);assert.equal(panel.dirty,true);
  assert.equal(panel.read().ai.memory.entries.length,2);assert.equal(visibleRows(panel).length,2);
  assert.match(panel.node('[data-memory-list]').textContent,/新增安排/);
  panel.node('[data-action="save"]').click();await new Promise(setImmediate);
  assert.equal(saved.ai.memory.entries.find(r=>r.title==='新增安排').content,'每周六开播');
  panel.node('[data-memory-add]').click();edit('[data-memory-field="title"]','放弃的新增');panel.node('[data-memory-cancel]').click();
  assert.equal(panel.read().ai.memory.entries.length,2);assert.equal(panel.dirty,false);
 }finally{f.close();}
});

test('编辑弹窗取消不改原文，跨页保留在编内容，确认后支持筛选、保存及重新打开',async()=>{
 let saved;const f=setup([record('a','开播安排'),record('b','商品口径',{content:'陶瓷茶杯不可微波',enabled:false}),record('c','旧活动',{expiresOn:'2020-01-01'})],{save:async config=>saved=config});
 try{
  const {panel,edit}=f;panel.tab('knowledge');const row=[...panel.node('[data-memory-list]').children].find(r=>r.record.id==='a');
  assert.ok(!row.open);row.open=true;row.querySelector('[data-memory-edit]').click();
  edit('[data-memory-field="content"]','取消的修改');panel.node('[data-memory-cancel]').click();
  assert.equal(panel.read().ai.memory.entries.find(r=>r.id==='a').content,record('a','').content);assert.equal(panel.dirty,false);
  row.querySelector('[data-memory-edit]').click();edit('[data-memory-field="title"]','每周排期');panel.tab('ai');panel.tab('knowledge');
  assert.equal(panel.node('[data-memory-field="title"]').value,'每周排期');panel.node('[data-memory-confirm]').click();
  edit('[data-memory-filter-query]','陶瓷');assert.deepEqual(visibleRows(panel).map(r=>r.record.id),['b']);
  edit('[data-memory-filter-query]','');edit('[data-knowledge-status]','expired','change');assert.deepEqual(visibleRows(panel).map(r=>r.record.id),['c']);
  panel.node('[data-action="save"]').click();await new Promise(setImmediate);
  assert.equal(saved.ai.memory.entries.find(r=>r.id==='a').title,'每周排期');assert.equal(saved.ai.memory.entries.length,3);
  assert.equal(panel.node('[data-knowledge-status]').value,'expired');
  const reopened=new Panel({room:'1',config:saved,callbacks:{}});try{reopened.tab('knowledge');[...reopened.node('[data-memory-list]').children].find(r=>r.record.id==='a').querySelector('[data-memory-edit]').click();assert.equal(reopened.node('[data-memory-field="title"]').value,'每周排期');}finally{reopened.destroy();}
 }finally{f.close();}
});

test('弹窗Escape取消并归还焦点，正文容量验证失败保留输入与已有资料',()=>{
 const f=setup(Array.from({length:10},(_,i)=>record(String(i),`知识${i}`,{content:'文'.repeat(2000)})));try{
  const {panel,edit,dom}=f;panel.tab('knowledge');panel.node('[data-memory-add]').click();
  edit('[data-memory-field="title"]','超额知识');edit('[data-memory-field="content"]','超出总量');
  panel.node('[data-memory-confirm]').click();assert.equal(panel.node('[data-knowledge-dialog]').hidden,false);
  assert.match(panel.node('[data-memory-dialog-error]').textContent,/20000/);assert.equal(panel.read().ai.memory.entries.length,10);
  panel.node('[data-memory-field="content"]').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(panel.node('[data-knowledge-dialog]').hidden,true);assert.equal(panel.root.activeElement,panel.node('[data-memory-add]'));assert.equal(panel.dirty,false);
 }finally{f.close();}
});

test('联网知识整理先打开预填弹窗，取消不创建；确认保留来源与停用状态，删除来源不丢整理稿',async()=>{
 let rows=[{id:'web',query:'PK规则',searchedAt:Date.now(),expiresAt:Date.now()+60000,results:[{index:1,title:'官方活动说明',url:'https://www.douyin.com/rules',content:'<img src=x onerror=alert(1)> 活动加成以页面为准'}]}];
 const f=setup([],{webKnowledge:{persistent:true,list:async()=>rows,remove:async()=>{rows=[];},clear:async()=>{rows=[];}}});
 try{
  const {panel,edit}=f;panel.tab('knowledge');await new Promise(setImmediate);
  edit('[data-memory-filter-query]','加成');assert.equal(panel.node('[data-web-knowledge-list] details').hidden,false);assert.equal(panel.node('[data-web-knowledge-list] img'),null);
  panel.node('[data-web-knowledge-copy]').click();assert.equal(panel.read().ai.memory.entries.length,0);
  assert.equal(panel.node('[data-memory-field="title"]').value,'PK规则');panel.node('[data-memory-cancel]').click();assert.equal(panel.read().ai.memory.entries.length,0);
  panel.node('[data-web-knowledge-copy]').click();panel.node('[data-memory-confirm]').click();
  const draft=panel.read().ai.memory.entries[0];assert.equal(draft.title,'PK规则');assert.equal(draft.enabled,false);assert.match(draft.content,/活动加成/);assert.match(draft.source,/douyin/);
  panel.node('[data-web-knowledge-remove]').click();await new Promise(setImmediate);assert.equal(panel.read().ai.memory.entries.length,1);
 }finally{f.close();}
});

test('可见产品界面投影使用独立弹窗与同一份表单数据，确认后保存修改，取消保留原值',async()=>{
 let saved;const f=setup([record('a','主播排期')],{save:async config=>saved=config});const bridge=createWorkspaceBridge(f.panel);
 try{
  bridge.navigate('knowledge');let nodes=walk(bridge.getSnapshot().content);
  const detail=nodes.find(n=>n.kind==='details' && n.title.includes('主播排期'));bridge.toggle(detail.id,true);
  nodes=walk(bridge.getSnapshot().content);bridge.activate(nodes.find(n=>n.kind==='button' && n.text==='编辑知识').id);
  let dialog=bridge.getSnapshot().dialog;assert.ok(dialog);assert.equal(dialog.title,'编辑知识');
  assert.ok(!walk(bridge.getSnapshot().content).some(n=>n.kind==='field' && n.label==='资料标题'));
  const title=walk(dialog).find(n=>n.kind==='field' && n.label==='资料标题');bridge.change(title.id,'已核对的排期');
  bridge.activate(walk(bridge.getSnapshot().dialog).find(n=>n.kind==='button' && n.text==='确定').id);
  assert.equal(bridge.getSnapshot().dialog,null);
  bridge.activate(bridge.getSnapshot().toolbar.find(n=>n.kind==='button' && n.text==='保存设置').id);await new Promise(setImmediate);
  assert.equal(saved.ai.memory.entries[0].title,'已核对的排期');
  bridge.activate(walk(bridge.getSnapshot().content).find(n=>n.kind==='button' && n.text==='添加知识').id);dialog=bridge.getSnapshot().dialog;
  bridge.activate(dialog.cancelId);assert.equal(f.panel.read().ai.memory.entries.length,1);
 }finally{bridge.destroy();f.close();}
});

test('筛选、排序和批量折叠不改配置；按来源查找、停用与过期筛选各自准确',()=>{
 const f=setup([record('b','周末排期',{source:'直播运营组',updatedAt:Date.now()-1000}),record('a','商品说明',{enabled:false}),record('c','历史活动',{expiresOn:'2020-01-01'})]);
 try{
  const {panel,edit}=f;panel.tab('knowledge');for(const name of ['ai.memory.enabled','ai.search.rememberKnowledge'])assert.equal(panel.root.querySelectorAll(`[data-field="${name}"]`).length,1);
  edit('[data-memory-filter-query]','运营组');assert.deepEqual(visibleRows(panel).map(r=>r.record.id),['b']);panel.node('[data-knowledge-expand]').click();assert.equal(visibleRows(panel)[0].open,true);
  panel.node('[data-knowledge-collapse]').click();assert.ok([...panel.node('[data-memory-list]').children].every(r=>!r.open));panel.node('[data-knowledge-reset]').click();edit('[data-knowledge-status]','disabled','change');assert.deepEqual(visibleRows(panel).map(r=>r.record.id),['a']);
  edit('[data-knowledge-status]','active','change');assert.deepEqual(visibleRows(panel).map(r=>r.record.id),['b']);panel.node('[data-knowledge-reset]').click();edit('[data-knowledge-sort]','title','change');assert.deepEqual(visibleRows(panel).map(r=>r.record.title),['历史活动','商品说明','周末排期']);assert.equal(panel.dirty,false);
 }finally{f.close();}
});

test('删除可撤销；40条知识容量已满时拒绝新建，已有知识仍可用弹窗编辑',()=>{
 const f=setup(Array.from({length:40},(_,i)=>record(String(i),`知识${i}`)));try{
  const {panel,edit}=f;panel.tab('knowledge');panel.node('[data-memory-add]').click();assert.equal(panel.read().ai.memory.entries.length,40);assert.match(panel.node('.toast').textContent,/最多40/);
  panel.root.querySelector('[data-memory-edit]').click();edit('[data-memory-field="content"]','最新核对的安排');panel.node('[data-memory-confirm]').click();panel.root.querySelector('[data-memory-remove]').click();assert.equal(panel.read().ai.memory.entries.length,39);panel.node('[data-memory-undo]').click();assert.equal(panel.read().ai.memory.entries[0].content,'最新核对的安排');
 }finally{f.close();}
});

test('后台关系查询显示来源房间，迟到旧问题不覆盖新问题和草稿',async()=>{
 const pending=[];const f=setup([],{relationships:q=>new Promise(resolve=>pending.push({q,resolve}))});
 const graph=name=>({entities:[{id:'a',name},{id:'b',name:'小雨'}],relations:[{from:'a',to:'b',predicate:'朋友',status:'unverified',evidence:[{text:'历史陈述',source:'弹幕',at:Date.now(),trust:'unverified',scope:{room:'2',anchor:'20'}}]}],ambiguities:[]});
 try{
  f.panel.tab('knowledge');f.edit('[data-relationship-query]','阿明');f.panel.node('[data-relationship-search]').click();
  f.edit('[data-relationship-query]','青哥');f.panel.node('[data-relationship-search]').click();pending.find(p=>p.q==='青哥').resolve(graph('青哥'));await new Promise(setImmediate);
  pending.find(p=>p.q==='阿明').resolve(graph('阿明'));pending.find(p=>p.q==='').resolve(graph('旧总览'));await new Promise(setImmediate);
  assert.match(f.panel.node('[data-relationship-results]').textContent,/青哥/);assert.doesNotMatch(f.panel.node('[data-relationship-results]').textContent,/阿明/);assert.match(f.panel.node('[data-relationship-results]').textContent,/房间2/);assert.equal(f.panel.dirty,false);
 }finally{f.close();}
});

test('可视图谱自动加载，投影到共享图表和放大入口，点击节点与键盘选择共用证据',async()=>{
 const graph={stats:{entities:2,relations:1},entities:[{id:'a',name:'阿明',role:'主播'},{id:'b',name:'小雨',role:'观众'}],relations:[{id:'r',from:'a',to:'b',predicate:'朋友',status:'unverified',evidence:[{text:'阿明和小雨是朋友',source:'直播弹幕',trust:'unverified',at:Date.now()}]}],ambiguities:[],paths:[]};
 const f=setup([],{relationships:async()=>graph});let bridge;
 try{
  f.panel.tab('knowledge');await new Promise(setImmediate);
  const canvas=f.panel.node('[data-workspace-chart]');assert.ok(canvas?.chartOption);
  bridge=createWorkspaceBridge(f.panel);const chart=walk(bridge.getSnapshot().content).find(n=>n.kind==='chart');assert.ok(chart);assert.equal(chart.option.series[0].type,'graph');
  bridge.chartSelect(chart.id,{id:'b',kind:'entity'});
  assert.match(f.panel.node('[data-relationship-detail]').textContent,/小雨|朋友/);
  const select=f.panel.node('[data-relationship-selection]');select.value='relation:r';select.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));
  assert.match(f.panel.node('[data-relationship-detail]').textContent,/阿明和小雨是朋友/);
  assert.equal(f.panel.dirty,false);
 }finally{bridge?.destroy();f.close();}
});

test('未变化的十秒更新保留图表配置、查询和选择，隐藏折叠与销毁后不继续更新',async()=>{
 let calls=0,resolve;const graph={entities:[{id:'a',name:'阿明'}],relations:[],ambiguities:[],sources:{chunks:[]}};
 const f=setup([],{relationships:async()=>{calls++;return graph;}});
 try{
  f.panel.tab('knowledge');await new Promise(setImmediate);const library=f.panel.knowledgeLibrary,option=f.panel.node('[data-relationship-chart]').chartOption;
  f.panel.node('[data-relationship-selection]').value='entity:a';library.lastGraphAt=0;await library.tickRelationships();await new Promise(setImmediate);
  assert.equal(calls,2);assert.equal(f.panel.node('[data-relationship-chart]').chartOption,option);assert.equal(f.panel.node('[data-relationship-selection]').value,'entity:a');
  f.panel.node('[data-relationship-panel]').open=false;library.lastGraphAt=0;library.tickRelationships();assert.equal(calls,2);
  library.previewRelationships(()=>new Promise(r=>resolve=r));library.destroy();resolve({...graph,entities:[{id:'b',name:'旧主播'}]});await new Promise(setImmediate);
  assert.equal(library.relationshipGraph.entities[0].name,'阿明');
 }finally{f.close();}
});

test('运行中新原文自动进入图谱，矛盾保留双边，删除和到期随下一次更新移除',async()=>{
 let at=Date.now();const values={'live-assistant:config:1':{anchorId:'2',ai:{assistant:{memoryEnabled:true},memory:{enabled:false,entries:[]}}}};
 const corpus=createKnowledgeCorpus({read:async key=>values[key],write:async(key,value)=>{values[key]=structuredClone(value);},now:()=>at});
 const background=createRelationshipLibrary({all:async()=>values,now:()=>at});
 const f=setup([],{relationships:(query,memory,options)=>background.query('1',query,{memory},options)});
 const update=async()=>{f.panel.knowledgeLibrary.lastGraphAt=0;f.panel.knowledgeLibrary.tickRelationships();await new Promise(setImmediate);};
 const graph=()=>f.panel.knowledgeLibrary.relationshipGraph;
 const chart=()=>f.panel.node('[data-relationship-chart]').chartOption.series[0];
 try{
  f.panel.tab('knowledge');await new Promise(setImmediate);assert.equal(graph().relations.length,0);
  await corpus.remember('1','2',[{url:'https://example.org/friends',text:'阿明和小雨是朋友。'}],{lifetime:60000});await update();
  assert.equal(chart().links.length,1);assert.equal(graph().relations[0].status,'unverified');
  const positiveId=(await corpus.list('1','2'))[0].id;
  const selection=f.panel.node('[data-relationship-selection]');selection.value=`entity:${graph().entities[0].id}`;selection.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));const selected=selection.value;
  await corpus.remember('1','2',[{url:'https://example.org/correction',text:'阿明和小雨不是朋友。'}],{lifetime:60000});await update();
  assert.equal(chart().links.length,2);assert.ok(graph().relations.every(row=>row.status==='conflicted'));assert.equal(selection.value,selected);
  await corpus.remove('1','2',positiveId);await update();assert.equal(chart().links.length,1);assert.equal(graph().relations[0].negative,true);assert.equal(graph().relations[0].status,'unverified');
  at+=60001;await update();assert.equal(chart().links.length,0);assert.equal(graph().entities.length,0);assert.equal(f.panel.dirty,false);
 }finally{f.close();}
});
