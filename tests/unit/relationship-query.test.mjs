import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withRelationshipEvidence,relationshipEvidenceVersion} from '../../src/services/relationship-query.js';
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

test('只有公开背景原文也必须在生成后复核，删除期间不交付旧来源回答',async()=>{
 let reads=0;const run=withRelationshipEvidence({persist:async()=>{},query:async()=>({entities:[],relations:[],sources:{chunks:reads++ ? [] : [{content:'公开陶瓷资料'}]}}),reply:async()=> '旧资料回答'});
 await assert.rejects(run({target:{text:'怎么清洗陶瓷'}},{}),/资料.*变化/);
});
test('只有人物档案也复核；送礼统计窗口的时钟移动不误判资料变更',async()=>{
 let reads=0;const run=withRelationshipEvidence({persist:async()=>{},query:async()=>({entities:[{name:'小雨',dossier:{events:reads++ ? [] : [{text:'周六带陶土'}]}}],relations:[]}),reply:async()=> '周六带陶土'});
 await assert.rejects(run({target:{text:'小雨的约定'}},{}),/资料.*变化/);
 const graph=t=>({entities:[{dossier:{gifting:{observed:{count:3,from:t-30*86400000,through:t,basis:'deduplicated observed gifts in this room over 30 days; lower bound, not lifetime spending'}}}}]});
 assert.equal(relationshipEvidenceVersion(graph(100)),relationshipEvidenceVersion(graph(200)));
});
