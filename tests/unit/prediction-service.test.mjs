import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPredictionClient,PredictionService} from '../../src/analytics/service.js';
import {AnalyticsArchive} from '../../src/analytics/archive.js';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
const at=Date.parse('2026-11-03T10:00:00Z'),context={room:'1',anchor:'2'};
test('queued events keep their original anchor; old reports cannot become new anchor AI facts',async()=>{
 let anchor='2',release;const gate=new Promise(r=>release=r),calls=[];
 const client=createPredictionClient({context:()=>({room:'1',anchor}),clock:()=>at,transport:async(action,value,id)=>{calls.push({action,value,id});if(calls.length===1)await gate;return {scope:`1:${id}`,asOf:at};}});
 const first=client.ingest({type:'chat',id:'1',text:'hello',receivedAt:at});
 const second=client.ingest({type:'chat',id:'2',text:'world',receivedAt:at});
 anchor='3';release();await Promise.all([first,second]);
 assert.deepEqual(calls.map(c=>c.id),['2','2']);assert.equal(client.context(),null);
});
test('service saves every emitted numerical forecast with its own asOf without overwriting earlier outputs',async()=>{
 const indexedDB=new IDBFactory(),archive=new AnalyticsArchive({indexedDB,IDBKeyRange});let now=at;
 const service=new PredictionService({archive,now:()=>now});
 try{
  for(let i=0;i<4;i++){
   now=at+i*60000;await service.call(context,'event',{type:'gift',id:`g${i}`,groupId:`g${i}`,count:1,unitValue:100,receivedAt:now});
   for(let j=0;j<12;j++){now=at+i*60000+j*5000;await service.call(context,'pulse',{connected:true});}
  }
  const a=await service.call(context,'report');now+=15000;await service.call(context,'pulse',{connected:true});const b=await service.call(context,'report');
  assert.notEqual(a.asOf,b.asOf);const data=await archive.read(context,now);
  assert.equal(data.forecasts.filter(f=>f.target==='diamonds').length,2);
  assert.deepEqual(data.forecasts.filter(f=>f.target==='diamonds').map(f=>f.asOf).sort(),[a.asOf,b.asOf].sort());
 }finally{service.close();}
});
test('explicit demo provides simulated comparisons and persists issued calibration without seeding real rooms',async()=>{
 const archive=new AnalyticsArchive({indexedDB:new IDBFactory(),IDBKeyRange}),service=new PredictionService({archive,now:()=>at}),demo={room:'demo',anchor:'2'};
 try{
  await assert.rejects(service.call(context,'demo'),/真实直播间/);
  await service.call(demo,'demo');const report=await service.call(demo,'report');
  assert.equal(report.simulated,true);assert.equal(report.comparisons.length,96);
  assert.ok(report.feedback.calibrations.every(row=>row.status==='applied' && row.samples===24));
  assert.ok(report.comparisons.some(row=>row.point!==row.baseline.point));
  const exported=await service.call(demo,'export');assert.equal(exported.feedback.length,96);assert.equal(exported.simulated,true);
  const online=exported.forecasts.find(row=>row.target==='online' && !row.evaluation);
  assert.equal(online.feedback.status,'applied');assert.notEqual(online.baseline.point,online.point);
  assert.equal((await archive.read(context,at)).feedback.length,0);
 }finally{service.close();}
});

test('real collection reaches hourly charts before a complete session has ended',async()=>{
 const archive=new AnalyticsArchive({indexedDB:new IDBFactory(),IDBKeyRange});let now=at;
 const service=new PredictionService({archive,now:()=>now});
 try{
  await service.call(context,'event',{type:'gift',id:'partial',count:1,unitValue:100,receivedAt:now});
  await service.call(context,'pulse',{connected:true});
  now+=5000;await service.call(context,'pulse',{connected:true});
  const report=await service.call(context,'report');
  assert.equal(report.sessions.length,1);assert.equal(report.sessions[0].complete,false);
  assert.equal(report.sessions[0].coverageMs,5000);assert.equal(report.sessions[0].diamonds,100);
 }finally{service.close();}
});
