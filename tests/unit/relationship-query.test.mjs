import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withRelationshipEvidence} from '../../src/services/relationship-query.js';
test('真实回复先持久化再检索全局资料，云端/本地共用同一份证据',async()=>{
 const order=[],graph={entities:[{id:'p',name:'青哥'}],relations:[]};
 const run=withRelationshipEvidence({query:async(q)=>{order.push(q);return graph;},persist:async()=>order.push('persist'),reply:async(p)=>p.getRelationshipContext('谁是青哥')});
 assert.equal(await run({target:{text:'谁是青哥'}},{}),graph);assert.deepEqual(order,['persist','谁是青哥']);
});
test('检索失败标明仅本房覆盖；取消或上下文变化不能把迟到结果交给模型',async()=>{
 let calls=0;
 const run=withRelationshipEvidence({persist:async()=>{},query:async()=>{throw Error('offline');},reply:async p=>{calls++;return p.getRelationshipContext('人物');}});
 const result=await run({target:{text:'人物'},getRelationshipContext:()=>({coverage:'local',entities:[],relations:[]})},{});
 assert.match(result.coverage,/unavailable/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(run({signal:controller.signal,target:{text:'人物'}},{}),/取消/);assert.equal(calls,1);
 await assert.rejects(run({isCurrent:()=>false,target:{text:'人物'}},{}),/取消/);assert.equal(calls,1);
});

test('生成期间关系证据被删除时，拒绝发送基于旧关系的回答',async()=>{
 let reads=0;const run=withRelationshipEvidence({persist:async()=>{},query:async()=>({entities:[],relations:reads++ ? [] : [{predicate:'朋友',evidence:[]}]}),reply:async()=> '他们是朋友'});
 await assert.rejects(run({target:{text:'谁和谁什么关系'}},{}),/资料.*变化/);
});
