import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPredictionBackground} from '../../extension/prediction-background.js';
import {PredictionService} from '../../src/analytics/service.js';
import {AnalyticsArchive} from '../../src/analytics/archive.js';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
test('background owns persistence and refuses arbitrary scopes/actions; restart retains observed income',async()=>{
 const indexedDB=new IDBFactory(),now=Date.now();
 const create=()=>createPredictionBackground({readRecord:async key=>key==='live-assistant:config:1'?{anchorId:'2'}:null,service:new PredictionService({archive:new AnalyticsArchive({indexedDB,IDBKeyRange}),now:()=>now})});
 let host=create();
 try{
  await assert.rejects(host.handle({action:'report',anchor:'3'},'1'),/范围/);
  await assert.rejects(host.handle({action:'report',anchor:'2'},'9'),/范围/);
  await assert.rejects(host.handle({action:'sql',anchor:'2'},'1'),/无效/);
  await host.handle({action:'event',anchor:'2',value:{type:'gift',id:'gift',groupId:'gift',count:3,unitValue:100,receivedAt:now}},'1');
  host.close();host=create();
  const r=await host.handle({action:'report',anchor:'2'},'1');assert.equal(r.observedDiamonds,300);assert.equal(r.month.point,null);
  await host.handle({action:'clear',anchor:'2'},'1');assert.equal((await host.handle({action:'export',anchor:'2'},'1')).sessions.length,0);
 }finally{host.close();}
});
