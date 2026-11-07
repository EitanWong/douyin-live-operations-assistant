import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {RelationshipWorkspace} from '../../src/ui/relationship-workspace.js';
const graph=()=>({entities:[{id:'a',name:'阿明',role:'主播',evidence:[]}],relations:[],ambiguities:[],sources:{chunks:[]}});
function fixture(retrieve=async()=>graph()){
 const dom=new JSDOM('<div id="host"><div data-relationship-workspace></div></div>'),root=dom.window.document.querySelector('#host');
 let now=10000;const memory={enabled:true,entries:[]},controller=new RelationshipWorkspace(root,{retrieve,readMemory:()=>memory,now:()=>now});
 return {controller,memory,dom,setNow:value=>now=value,close(){controller.destroy();dom.window.close();}};
}
test('并发检索只交付最新问题，隐藏不轮询，未变图保留同一对象，销毁拒绝迟到结果',async()=>{
 const pending=[],f=fixture((query,memory,options)=>new Promise(resolve=>pending.push({query,memory,options,resolve})));
 try{
  f.controller.setVisible(true);f.controller.dispatch({type:'query',value:'阿明'});const current=f.controller.refresh();pending[1].resolve(graph());await current;
  pending[0].resolve({...graph(),entities:[{id:'old',name:'旧资料'}]});await new Promise(setImmediate);assert.equal(f.controller.state.graph.entities[0].name,'阿明');
  const saved=f.controller.state.graph;const again=f.controller.refresh();pending[2].resolve(graph());await again;assert.equal(f.controller.state.graph,saved);
  f.controller.setVisible(false);f.setNow(999999);f.controller.tick();assert.equal(pending.length,3);
  const late=f.controller.refresh();f.controller.destroy();pending[3].resolve({...graph(),entities:[]});await late;assert.equal(f.controller.state.graph,saved);
 }finally{f.close();}
});
test('问答必须携带所选人物及原文证据，完成后复核；删除或取消期间不交付旧回答',async()=>{
 let value=graph(),release,request;const f=fixture(async()=>value);
 try{
  await f.controller.refresh();f.controller.select({kind:'entity',id:'a'});
  f.controller.service={run:args=>{request=args;return new Promise(resolve=>release=resolve);}};
  f.controller.dispatch({type:'question',value:'他和小雨是什么关系？'});const run=f.controller.ask();await new Promise(setImmediate);
  assert.deepEqual(request.relationshipContext.focus.entityIds,['a']);assert.equal(request.mode,'relationships');assert.equal(request.question,'他和小雨是什么关系？');
  value={...graph(),entities:[]};release({status:'succeeded',answer:'旧回答'});await run;assert.equal(f.controller.state.answer,null);assert.match(f.controller.state.questionStatus,/证据已变化/);
  value=graph();const second=f.controller.ask();await new Promise(setImmediate);f.controller.cancel();assert.equal(request.signal.aborted,true);release({status:'succeeded',answer:'迟到回答'});await second;assert.equal(f.controller.state.answer,null);assert.equal(f.controller.state.answering,false);
  f.controller.service={run:async()=>({status:'succeeded',answer:'没有明确关系证据。'})};await f.controller.ask();assert.equal(f.controller.state.answer.answer,'没有明确关系证据。');
 }finally{f.close();}
});
test('完整原文按加载时查询读取，切换人物拒绝迟到原文；路径和筛选可重置',async()=>{
 let release;const f=fixture(async(q,m,o)=>o.recordId ? new Promise(resolve=>release=resolve) : graph());
 try{
  await f.controller.refresh();f.controller.select({kind:'entity',id:'a'});const original=f.controller.original('record:a');f.controller.select(null);release({record:{text:'旧原文'}});await original;assert.equal(f.controller.state.original,null);
  f.controller.dispatch({type:'pathTo',value:'a'});assert.equal(f.controller.state.pathTo,'a');f.controller.dispatch({type:'pathTo',value:''});assert.equal(f.controller.state.pathTo,'');
  f.controller.dispatch({type:'layout',value:'invalid'});assert.equal(f.controller.state.layout,'concentric');assert.equal(f.memory.entries.length,0);
 }finally{f.close();}
});
