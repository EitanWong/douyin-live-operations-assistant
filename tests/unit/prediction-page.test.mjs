import {test} from 'node:test';
import assert from 'node:assert/strict';
import {predictionPulse} from '../../src/analytics/page.js';
import {parsePulse} from '../../src/analytics/schema.js';
test('page projection bounds PK inputs and only includes current anchor confirmed outcomes',()=>{
 const now=Date.now(),engine={config:{anchorId:'2'},pk:{current:()=>({key:'b',anchorId:'2',phase:'active',remainingMs:20000,competitors:[{anchorId:'2',isSelf:true,score:100,scoreObserved:true,scoreAgeMs:1000},{anchorId:'3',isSelf:false,score:80,scoreObserved:true,scoreAgeMs:1000}],trend:[{at:now,competitorScores:{'2':100,'3':80}}],secret:'no'})},anchorStats:{records:new Map([['x',{battleKey:'x',anchorId:'9',scoreFinal:true,outcome:'win',endedAt:now}],['y',{battleKey:'y',anchorId:'2',scoreFinal:true,outcome:'loss',endedAt:now}]])}};
 const p=predictionPulse({engine,network:{ingestion:{gaps:2}},identity:{live:{roomId:'123'}},connected:true});
 assert.equal(p.outcomes.length,1);assert.equal(p.outcomes[0].battleKey,'y');assert.equal(p.gaps,2);assert.ok(!JSON.stringify(p).includes('secret'));assert.doesNotThrow(()=>parsePulse(p,now));
});

test('AI sees bounded numeric projections only for current fresh anchor',async()=>{
 const {predictionContext}=await import('../../src/analytics/page.js'),now=Date.now();
 const r={scope:'1:2',asOf:now,modelVersion:'v1',revenue:{status:'ready',point:100,low:10,high:200,userId:'private',secret:'password'},viewers:[{id:'private'}]};
 assert.equal(predictionContext(r,'3',now),null);assert.equal(predictionContext(r,'2',now+31000),null);
 const context=predictionContext(r,'2',now);assert.equal(context.revenue.point,100);assert.ok(!JSON.stringify(context).includes('private'));assert.ok(!JSON.stringify(context).includes('password'));
});
