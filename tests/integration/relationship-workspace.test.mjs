import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {copy,DEFAULTS} from '../../src/core/engine.js';
import {createWorkspaceBridge} from '../../src/ui/product/bridge.js';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {createRelationshipRetriever} from '../../src/ai/relationship-memory.js';
import {createKnowledgeCorpus} from '../../src/ai/knowledge-corpus.js';
import {createRelationshipLibrary} from '../../src/ai/relationship-library.js';
const walk=n=>[n,...(n?.children || []).flatMap(walk)];
function fixture(relationships){
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123',pretendToBeVisual:true});
 for(const key of ['document','window','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];
 globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
 const panel=new Panel({room:'123',config:copy(DEFAULTS),callbacks:{relationships}}),bridge=createWorkspaceBridge(panel);
 return {dom,panel,bridge,close(){bridge.destroy();panel.destroy();dom.window.close();}};
}
const graph={entities:[{id:'a',name:'阿明',role:'主播'},{id:'b',name:'小雨',role:'观众'}],relations:[{id:'r',from:'a',to:'b',predicate:'朋友',status:'unverified',evidence:[{text:'我是小雨的朋友',source:'弹幕',trust:'unverified',at:1800000000000}]}],ambiguities:[]};
test('知识库拥有独立资料和关系子页，共用导航与说明，切换保留搜索和唯一控制器',async()=>{
 const f=fixture(async()=>graph);try{
  f.bridge.navigate('knowledge');let state=f.bridge.getSnapshot();assert.deepEqual(state.subviews.map(n=>n.text),['知识资料','人物关系图谱']);
  assert.ok(!walk(state.content).some(n=>n.kind==='network'));
  f.bridge.activate(state.subviews[1].id);await new Promise(setImmediate);state=f.bridge.getSnapshot();
  const network=walk(state.content).find(n=>n.kind==='network');assert.ok(network);assert.equal(network.view.graph.entities.length,2);
  assert.ok(!walk(state.content).some(n=>n.text==='添加知识'));assert.ok(state.utilities.help.length);
  f.bridge.networkAction(network.id,{type:'query',value:'小雨'});f.bridge.activate(state.subviews[0].id);f.bridge.activate(f.bridge.getSnapshot().subviews[1].id);
  assert.equal(walk(f.bridge.getSnapshot().content).find(n=>n.kind==='network').view.query,'小雨');assert.equal(f.panel.dirty,false);
 }finally{f.close();}
});

test('独立工作台人物导航和连线选择共用档案，完整原文按需读取，遗忘后移除且不改知识草稿',async()=>{
 const at=Date.now(),audience=new AudienceMemory({anchor:'10',now:()=>at}),retrieve=createRelationshipRetriever();
 const text='我喜欢陶艺。'+'这次活动有很多细节。'.repeat(150)+'周六带陶土。';
 audience.observe({id:'a',type:'chat',source:'socket',receivedAt:at,user:{id:'1',name:'小雨',secUid:'rain-account'},text});
 const f=fixture((q,memory,options)=>retrieve({anchor:'10',audience,memory,now:at},q,options));
 try{
  f.bridge.navigate('knowledge');f.bridge.activate(f.bridge.getSnapshot().subviews[1].id);await new Promise(setImmediate);
  let node=walk(f.bridge.getSnapshot().content).find(n=>n.kind==='network');const person=node.view.graph.entities.find(n=>n.name==='小雨');
  f.bridge.networkAction(node.id,{type:'select',selection:{kind:'entity',id:person.id}});
  node=walk(f.bridge.getSnapshot().content).find(n=>n.kind==='network');assert.equal(node.view.selected.id,person.id);assert.ok(person.dossier.facets.some(r=>r.category==='interests' && r.text.includes('陶艺')));assert.ok(person.dossier.profiles.includes('https://www.douyin.com/user/rain-account'));
  f.bridge.networkAction(node.id,{type:'original',recordId:person.dossier.events[0].recordId});await new Promise(setImmediate);assert.equal(f.panel.relationshipWorkspace.state.original.text,text);
  audience.forget('uid:1');await f.panel.relationshipWorkspace.refresh();assert.equal(f.panel.relationshipWorkspace.state.selected,null);assert.equal(f.panel.relationshipWorkspace.state.original,null);assert.equal(f.panel.dirty,false);
 }finally{f.close();}
});

test('后台来源新增、冲突、删除及到期持续投影，稳定人物选择不被刷新重置',async()=>{
 let at=Date.now();const values={'live-assistant:config:1':{anchorId:'2',ai:{assistant:{memoryEnabled:true},memory:{enabled:false,entries:[]}}}};
 const corpus=createKnowledgeCorpus({read:async key=>values[key],write:async(key,value)=>{values[key]=structuredClone(value);},now:()=>at}),background=createRelationshipLibrary({all:async()=>values,now:()=>at});
 const f=fixture((q,memory,o)=>background.query('1',q,{memory},o));
 try{
  f.bridge.navigate('knowledge');f.bridge.activate(f.bridge.getSnapshot().subviews[1].id);await new Promise(setImmediate);const controller=f.panel.relationshipWorkspace;
  assert.equal(controller.state.graph.relations.length,0);
  await corpus.remember('1','2',[{url:'https://example.org/friends',text:'阿明和小雨是朋友。'}],{lifetime:60000});await controller.refresh();const id=(await corpus.list('1','2'))[0].id;
  assert.equal(controller.state.graph.relations.length,1);assert.equal(controller.state.graph.relations[0].evidence[0].scope.room,'1');
  controller.select({kind:'entity',id:controller.state.graph.entities[0].id});const selection=controller.state.selected;
  await corpus.remember('1','2',[{url:'https://example.org/correction',text:'阿明和小雨不是朋友。'}],{lifetime:60000});await controller.refresh();
  assert.equal(controller.state.graph.relations.length,2);assert.ok(controller.state.graph.relations.every(r=>r.status==='conflicted'));assert.equal(controller.state.selected,selection);
  await corpus.remove('1','2',id);await controller.refresh();assert.equal(controller.state.graph.relations.length,1);assert.equal(controller.state.graph.relations[0].negative,true);
  at+=60001;await controller.refresh();assert.equal(controller.state.graph.relations.length,0);assert.equal(controller.state.graph.entities.length,0);assert.equal(f.panel.dirty,false);
 }finally{f.close();}
});
