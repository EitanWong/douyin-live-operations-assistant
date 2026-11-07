import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRelationshipResearch} from '../../src/services/relationship-research.js';
const config={anchorId:'10',ai:{enabled:true}};
test('人物问答提交后台任务，保留稳定人物范围，交付真实检索步骤和来源',async()=>{
 let job,calls=0;const trace=[{step:'tool:relationships',detail:'核对人物原话',at:1}];
 const service=createRelationshipResearch({getConfig:()=>config,getContext:()=>({}),tasks:async()=>({submit:async row=>{job=row;return {id:row.id,status:'queued'};},list:async()=>[{id:job.id,status:'succeeded',trace,result:{answer:'证据结论',sources:[{url:'https://example.org/a'}],runtime:'langgraph'}}],cancel:async()=>{}})});
 const context={focus:{scope:'group',entityIds:['person:a','person:b'],names:['阿明','小雨']}};
 const result=await service.run({question:'比较两人兴趣',relationshipContext:context,onProgress:p=>{assert.deepEqual(p.trace,trace);calls++;}});
 assert.deepEqual(job.input.context.relationshipContext,context);assert.equal(job.question,'比较两人兴趣');assert.equal(result.answer,'证据结论');assert.equal(result.runtime,'langgraph');assert.equal(result.sources.length,1);assert.equal(calls,1);
});
test('取消发生在提交完成前，回执到达后也取消后台任务且不交付答案',async()=>{
 let release,cancelled;const controller=new AbortController();
 const service=createRelationshipResearch({getConfig:()=>config,getContext:()=>({}),tasks:async()=>({submit:()=>new Promise(resolve=>release=resolve),list:async()=>[],cancel:async id=>{cancelled=id;}})});
 const run=service.run({question:'画像',relationshipContext:{focus:{scope:'global',entityIds:[],names:[]}},signal:controller.signal});
 await new Promise(setImmediate);controller.abort();release({id:'late-job',status:'queued'});
 await assert.rejects(run,{name:'AbortError'});assert.equal(cancelled,'late-job');
});
