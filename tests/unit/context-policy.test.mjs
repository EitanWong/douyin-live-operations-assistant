import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine,mergeConfig} from '../../src/core/engine.js';
import {makeAIRequest} from '../../src/services/ai.js';
test('room context includes structured group, shopping and rank observations without identifiers or hidden values',()=>{
 const now=Date.now(),engine=new Engine({now:()=>now});
 engine.ingest({type:'group-live-members',receivedAt:now,members:[{user:{id:'private-id',name:'合唱嘉宾'},score:'42',showScore:true},{user:{name:'隐藏嘉宾'},score:'99999',showScore:false}]});
 engine.ingest({type:'product-change',receivedAt:now,text:'换成茶杯',total:3,categories:[{name:'茶具',promotionIds:['private-id']}],products:[{promotionId:'private-id',index:1}]});
 const c=engine.aiContext().liveContext;
 assert.equal(c.roomSignals.find(r=>r.type==='group-live-members').members[0].name,'合唱嘉宾');
 assert.equal(c.roomSignals.find(r=>r.type==='group-live-members').members[1].score,null);
 assert.equal(c.roomSignals.find(r=>r.type==='product-change').total,3);
 assert.ok(!JSON.stringify(c).includes('private-id'));assert.ok(!JSON.stringify(c.roomSignals).includes('99999'));
});
test('saved source switches apply to actual AI payloads and do not fabricate absent forecasts',()=>{
 const engine=new Engine({config:mergeConfig({ai:{contextSources:{income:false,audience:false,roomEvents:false,predictions:false,accounts:false}}}),accountContext:()=>[{content:'should not leak'}]});
 engine.ingest({type:'room-audience',onlineCount:42,receivedAt:Date.now()});
 const shared=engine.aiContext(),body=JSON.parse(makeAIRequest({...shared,maxLength:40},engine.config.ai).messages[1].content);
 assert.equal(body.live_context.audience,null);assert.equal(body.live_context.income,null);assert.deepEqual(body.live_context.roomSignals,[]);assert.deepEqual(body.evidence_context.accounts,[]);
 assert.ok(body.live_context.coverage.disabledSources.includes('predictions'));assert.equal(body.live_context.forecasts,undefined);
 const snapshot=JSON.parse(makeAIRequest({liveContext:{income:{totalDiamonds:999},pk:{selfScore:20,estimates:{prediction:{selfWin:.99}}}},accountContext:[{content:'hidden'}]},engine.config.ai).messages[1].content);
 assert.equal(snapshot.live_context.income,null);assert.equal(snapshot.live_context.pk.estimates,null);assert.deepEqual(snapshot.evidence_context.accounts,[]);
});
