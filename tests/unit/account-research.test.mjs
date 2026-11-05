import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAccountResearch} from '../../extension/account-research.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(){
 let budget=[];const entered=[],archived=[],configs=new Map(['1','2'].map(room=>[room,{anchorId:room,ai:{accountCollection:{enabled:true,maxPerHour:2}}}]));
 const dependencies={readConfig:async room=>structuredClone(configs.get(room)),readBudget:async()=>budget,writeBudget:async rows=>{budget=rows;},archive:async row=>archived.push(row),now:()=>1793893500000};
 return {entered,archived,configs,dependencies,service:collect=>createAccountResearch({...dependencies,collect})};
}
test('profile research serializes temporary pages across rooms and keeps its shared hourly budget after worker restart',async()=>{
 const f=fixture(),gate=deferred();const service=f.service(async(url)=>{f.entered.push(url);if(f.entered.length===1)await gate.promise;return [{id:url}];});
 const first=service.collect('1','https://www.douyin.com/user/a');
 const second=service.collect('2','https://www.douyin.com/user/b');
 await new Promise(r=>setImmediate(r));assert.equal(f.entered.length,1);gate.resolve();await Promise.all([first,second]);
 assert.equal(f.archived.length,2);assert.equal(f.entered.length,2);assert.deepEqual(f.archived.map(r=>r.anchor),['1','2']);
 const restarted=f.service(async()=>{throw Error('must not run');});
 await assert.rejects(restarted.collect('1','https://www.douyin.com/user/c'),/每小时/);
});
test('cancellation and a changed anchor reject late profile results before archiving and release the queue',async()=>{
 const f=fixture(),gate=deferred(),cancel=new AbortController();const service=f.service(async url=>{f.entered.push(url);if(url.endsWith('/a'))await gate.promise;return [{id:url}];});
 const first=service.collect('1','https://www.douyin.com/user/a');
 const second=service.collect('2','https://www.douyin.com/user/b',{signal:cancel.signal});
 const failed=assert.rejects(first,/主播|上下文/),cancelled=assert.rejects(second,/取消/);
 await new Promise(r=>setImmediate(r));cancel.abort();f.configs.get('1').anchorId='3';gate.resolve();await Promise.all([failed,cancelled]);
 assert.deepEqual(f.archived,[]);assert.equal(f.entered.length,1);
 assert.equal((await service.collect('2','https://www.douyin.com/user/c')).length,1);
});
test('aborting an in-flight page cannot archive a late successful result',async()=>{
 const f=fixture(),gate=deferred(),cancel=new AbortController(),service=f.service(async()=>{await gate.promise;return [{id:'late'}];});
 const job=service.collect('1','https://www.douyin.com/user/a',{signal:cancel.signal}),failed=assert.rejects(job,/取消/);
 await new Promise(r=>setImmediate(r));cancel.abort();gate.resolve();await failed;assert.deepEqual(f.archived,[]);
});
