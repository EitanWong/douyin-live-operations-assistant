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

test('blocked or quarantined collection cannot establish continuous prediction coverage',()=>{
 const engine={config:{anchorId:'2'},pk:{current:()=>null},anchorStats:{records:new Map()}};
 for(const ingestion of [{blocked:true},{quarantined:50},{state:'retrying'},{state:'buffering'}]){
  assert.equal(predictionPulse({engine,network:{ingestion},identity:{},connected:true}).connected,false);
 }
 assert.equal(predictionPulse({engine,network:{ingestion:{state:'healthy',blocked:false,quarantined:0}},identity:{},connected:true}).connected,true);
});

test('AI receives bounded warehouse and validated local model evidence without viewer identities or database paths',async()=>{
 const {predictionContext}=await import('../../src/analytics/page.js'),now=Date.now();
 const report={scope:'1:2',asOf:now,modelVersion:'v2',warehouse:{room:'1',asOf:now,database:'/private/file',eventCounts:{chat:12},observedUsers:4,opponents:[{room:'3',eventCounts:{chat:8},observedUsers:2}]},
  localModel:{scope:'1:2',asOf:now,rows:[{target:'diamonds',horizonMinutes:5,point:100,low:50,high:150,trainedAt:now-1,calibration:'temporal-holdout',userId:'private'}]}};
 const context=predictionContext(report,'2',now);
 assert.equal(context.warehouse.eventCounts.chat,12);assert.equal(context.warehouse.opponents[0].eventCounts.chat,8);
 assert.equal(context.localModel.rows[0].point,100);assert.ok(!JSON.stringify(context).includes('private'));
 report.localModel.scope='1:9';assert.equal(predictionContext(report,'2',now).localModel,null);
});
