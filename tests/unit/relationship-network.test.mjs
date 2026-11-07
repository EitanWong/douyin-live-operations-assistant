import {test} from 'node:test';
import assert from 'node:assert/strict';
import cytoscape from 'cytoscape';
import {JSDOM} from 'jsdom';
import {createNetworkView} from '../../src/ui/product/network-view.js';
import {projectNetwork,networkElements,relationshipPath} from '../../src/ui/relationship-network.js';
const graph={entities:['a','b','c','d'].map(id=>({id,name:id,role:id==='a' ? '主播' : '观众'})),relations:[{id:'ab',from:'a',to:'b',predicate:'朋友',status:'verified'},{id:'bc',from:'b',to:'c',predicate:'同事',status:'unverified'},{id:'cd',from:'c',to:'d',predicate:'朋友',status:'observed'},{id:'bad',from:'a',to:'missing',status:'verified'}]};
test('状态、类型和人物邻域过滤不留下断边，不改变来源图，路径仅表示证据连接',()=>{
 const filtered=projectNetwork(graph,{status:'verified'});assert.deepEqual(filtered.relations.map(r=>r.id),['ab']);
 const nearby=projectNetwork(graph,{focus:'a',depth:1});assert.deepEqual(nearby.entities.map(n=>n.id),['a','b']);
 const path=relationshipPath(graph,'a','c');assert.deepEqual(path,{nodes:['a','b','c'],edges:['ab','bc']});
 assert.equal(relationshipPath(graph,'a','missing'),null);assert.equal(graph.relations.length,4);
 assert.equal(projectNetwork(graph,{predicate:'同事'}).relations.length,1);
});
test('画布数据到达后按最终尺寸适配；证据刷新和手动操作保留节点位置与视角，销毁释放资源',()=>{
 const dom=new JSDOM('<div></div>'),element=dom.window.document.querySelector('div'),frames=new Map();let next=0,observe,disconnected=false;
 dom.window.requestAnimationFrame=fn=>{frames.set(++next,fn);return next;};dom.window.cancelAnimationFrame=id=>frames.delete(id);
 dom.window.ResizeObserver=class{constructor(fn){observe=fn;}observe(){}disconnect(){disconnected=true;}};
 Object.defineProperties(element,{clientWidth:{value:800},clientHeight:{value:400}});
 const renderer=createNetworkView(element,{headless:true});
 try{
  const star={entities:['hub','a','b','c','d','e','f','g'].map(id=>({id,name:id})),relations:[...['a','b','c','d','e','f','g'].map(id=>['hub',id]),['a','b'],['a','c'],['a','d']].map(([from,to],i)=>({id:String(i),from,to,predicate:'朋友',status:'unverified'}))};
  renderer.update(star,{selected:{kind:'entity',id:'hub'}});const center=renderer.core.getElementById('node:hub').position();
  const distances=['a','b','c','d','e','f','g'].map(id=>{const p=renderer.core.getElementById(`node:${id}`).position();return Math.hypot(p.x-center.x,p.y-center.y);});
  assert.ok(Math.max(...distances)-Math.min(...distances)<.01,'人物聚焦将所选人物放在中心，直接关系处于同一圈');
  renderer.update(projectNetwork(graph,{}));assert.equal(frames.size,1,'新拓扑安排最终尺寸适配');
  for(const [id,fn] of frames){frames.delete(id);fn();}
  renderer.command('in');renderer.pan(12,8);const zoom=renderer.core.zoom(),pan={...renderer.core.pan()},position={...renderer.core.nodes()[0].position()};
  renderer.update(projectNetwork({...graph,relations:graph.relations.map(r=>({...r,status:'conflicted'}))},{}));
  assert.equal(renderer.core.zoom(),zoom);assert.deepEqual(renderer.core.nodes()[0].position(),position);
  observe();for(const [id,fn] of frames){frames.delete(id);fn();}assert.equal(renderer.core.zoom(),zoom);assert.deepEqual(renderer.core.pan(),pan);
 }finally{renderer.destroy();assert.equal(disconnected,true);assert.equal(frames.size,0);assert.equal(renderer.core.destroyed(),true);dom.window.close();}
});
test('真实Cytoscape可读取中文标签、证据状态与平行否定边，布局和路径不需要自制绘图引擎',()=>{
 const safe=projectNetwork(graph,{}),elements=networkElements(safe);
 const cy=cytoscape({headless:true,elements});try{
  assert.equal(cy.nodes().length,4);assert.equal(cy.edges().length,3);
  assert.equal(cy.getElementById('node:a').data('label'),'a');assert.equal(cy.getElementById('edge:bc').data('status'),'unverified');
  assert.equal(cy.elements().dijkstra({root:cy.getElementById('node:a')}).distanceTo(cy.getElementById('node:c')),2);
 }finally{cy.destroy();}
});
