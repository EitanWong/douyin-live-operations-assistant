import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {AnalyticsArchive} from '../../src/analytics/archive.js';

const at=Date.parse('2026-11-03T10:00:00Z');
function create(indexedDB=new IDBFactory()){return new AnalyticsArchive({indexedDB,IDBKeyRange});}
const scope={room:'1',anchor:'2'};
const gift=(count,id='event-1',unitValue=10)=>({type:'gift',id,groupId:'combo-1',giftId:'rose',count,unitValue,receivedAt:at+1000,user:{id:'9',name:'观众'}});
test('archive keeps combo increments and late prices across restart without contaminating anchors',async()=>{
 const indexedDB=new IDBFactory(),a=create(indexedDB);
 try{
  await a.ingest(scope,gift(2),at+1000);await a.ingest(scope,gift(2),at+1000);
  await a.ingest(scope,gift(5,'event-2'),at+2000);a.close();
  const b=create(indexedDB);
  try{
   await b.ingest(scope,gift(5,'event-2'),at+3000);
   let d=await b.read(scope,at+4000);assert.equal(d.session.diamonds,50);assert.equal(d.users[0].diamonds,50);
   assert.equal((await b.read({room:'1',anchor:'3'},at+4000)).session,null);
   await b.ingest(scope,{...gift(3,'unknown',null),groupId:'unknown-combo'},at+5000);
   d=await b.read(scope,at+5000);assert.equal(d.session.unknownCount,3);
   await b.ingest(scope,{...gift(3,'priced',20),groupId:'unknown-combo'},at+6000);
   d=await b.read(scope,at+6000);assert.equal(d.session.diamonds,110);assert.equal(d.session.unknownCount,0);
  }finally{b.close();}
 }finally{a.close();}
});
test('only continuous connected pulses count coverage; a restart or gap is not observed zero',async()=>{
 const a=create();try{
  await a.pulse(scope,{connected:true},at);
  for(let n=1;n<=12;n++)await a.pulse(scope,{connected:true},at+n*5000);
  let d=await a.read(scope,at+60000);assert.equal(d.minutes.find(m=>m.at===at).coverageMs,60000);
  await a.pulse(scope,{connected:true},at+180000);
  d=await a.read(scope,at+180000);assert.equal(d.minutes.some(m=>m.at===at+60000 && m.coverageMs>0),false);
  assert.equal(d.session.complete,false);
 }finally{a.close();}
});
test('forecast records are immutable, evaluated only after full target observation',async()=>{
 const a=create();try{
  await a.saveForecasts(scope,[{id:'fixed',asOf:at,target:'diamonds',dueAt:at+60000,startAt:at,point:5,low:0,high:10,modelVersion:'test'}]);
  await a.saveForecasts(scope,[{id:'fixed',asOf:at,target:'diamonds',dueAt:at+60000,startAt:at,point:999}]);
  let d=await a.read(scope,at+30000);assert.equal(d.forecasts[0].point,5);assert.equal(d.forecasts[0].evaluation,undefined);
  await a.pulse(scope,{connected:false},at+120000);
  await a.evaluate(scope,at+120000);
  d=await a.read(scope,at+120000);assert.equal(d.forecasts[0].evaluation.status,'censored');assert.equal(d.forecasts[0].evaluation.actual,null);
 }finally{a.close();}
});
test('rejects malformed events, future samples and settings; scoped forgetting removes identifiers',async()=>{
 const a=create();try{
  await assert.rejects(a.ingest(scope,gift(-1),at),/事件/);
  await assert.rejects(a.ingest(scope,{...gift(1),receivedAt:at+999999},at),/事件/);
  for(const field of ['at','startAt'])for(const value of [-1,'0',at+1,NaN]){
   await assert.rejects(a.ingest(scope,{...gift(1),receivedAt:at,[field]:value},at),/事件/);
  }
  await a.ingest(scope,gift(1),at+1000);await a.forget(scope,'uid:9');
  assert.deepEqual((await a.read(scope,at+2000)).users,[]);
  assert.equal((await a.read(scope,at+2000)).session.diamonds,10,'forgetting identity does not erase accounting totals');
  await a.clear(scope);assert.equal((await a.read(scope,at+2000)).session,null);
 }finally{a.close();}
});

test('protocol missing timestamps remain unknown while receive time preserves observations',async()=>{
 const a=create();try{
  for(const [i,value] of [0,null,undefined].entries()){
   await a.ingest(scope,{type:'chat',id:`missing-${i}`,at:value,startAt:value,text:'支持',receivedAt:at+i},at+i);
  }
  const data=await a.read(scope,at+3);
  assert.equal(data.session.startKnown,false);
  assert.equal(data.minutes[0].chats,3);
 }finally{a.close();}
});

test('offline and ended pulses do not open phantom broadcasts, stable chat IDs ignore receive-time changes',async()=>{
 const a=create();try{
  await a.pulse(scope,{connected:false},at);assert.equal((await a.read(scope,at)).session,null);
  await a.ingest(scope,{type:'start',id:'start',receivedAt:at},at);
  await a.ingest(scope,{type:'chat',id:'chat',text:'支持',receivedAt:at+1000,user:{id:'9'}},at+1000);
  await a.ingest(scope,{type:'chat',id:'chat',text:'支持',receivedAt:at+2000,user:{id:'9'}},at+2000);
  assert.equal((await a.read(scope,at+2000)).users[0].chats,1);
  await a.ingest(scope,{type:'end',id:'end',receivedAt:at+10000},at+10000);
  await a.pulse(scope,{connected:true},at+15000);
  assert.equal((await a.read(scope,at+15000)).sessions.length,1);
 }finally{a.close();}
});
test('evaluation uses exact future windows, coverage is a union, future online samples cannot leak',async()=>{
 const a=create();try{
  await a.pulse(scope,{connected:true},at);
  await a.ingest(scope,{...gift(1),receivedAt:at+1000},at+1000);
  await a.saveForecasts(scope,[{id:'offset',asOf:at+30000,target:'diamonds',startAt:at+30000,dueAt:at+90000,point:20,low:20,high:20},{id:'online',asOf:at+30000,target:'online',startAt:at+30000,dueAt:at+90000,point:20,low:20,high:20}]);
  for(let t=5000;t<=90000;t+=5000){await a.pulse(scope,{connected:true},at+t);if(t===45000)await a.ingest(scope,{...gift(2,'second'),groupId:'second',receivedAt:at+t},at+t);}
  await a.ingest(scope,{type:'room-audience',onlineCount:999,receivedAt:at+95000},at+95000);
  await a.evaluate(scope,at+100000);let d=await a.read(scope,at+100000);
  assert.equal(d.forecasts.find(f=>f.id.endsWith('offset')).evaluation.actual,20);
  assert.equal(d.forecasts.find(f=>f.id.endsWith('online')).evaluation.actual,null);
  assert.equal(d.minutes[0].coverageMs,60000);
 }finally{a.close();}
});
test('history import preserves distinct comparable rows and is idempotent',async()=>{
 const a=create();try{
  const rows=[{month:'2026-10',hours:20,diamonds:1000,grade:'A',source:'授权样本'},{month:'2026-10',hours:20,diamonds:2000,grade:'B',source:'授权样本'}];
  await a.importHistory(scope,rows);await a.importHistory(scope,rows);
  assert.equal((await a.read(scope,at)).history.length,2);
 }finally{a.close();}
});

test('viewer opt-out stops individual collection and known minors never enter training',async()=>{
 const a=create();try{
  await a.configure(scope,{viewerEnabled:false});await a.ingest(scope,gift(1),at+1000);
  assert.equal((await a.read(scope,at+1000)).users.length,0);
  await a.configure(scope,{viewerEnabled:true});await a.ingest(scope,{...gift(1,'minor'),groupId:'minor',user:{id:'10',minor:true}},at+1000);
  assert.equal((await a.read(scope,at+1000)).users.length,0);
  assert.equal((await a.read(scope,at+1000)).session.diamonds,20);
 }finally{a.close();}
});

test('late gift prices correct the original occurrence instead of inventing later revenue',async()=>{
 const a=create();try{
  await a.ingest(scope,{...gift(2,'unknown',null),receivedAt:at+1000},at+1000);
  await a.ingest(scope,{...gift(2,'priced',10),receivedAt:at+61000},at+61000);
  const d=await a.read(scope,at+62000),first=d.minutes.find(m=>m.at===at),second=d.minutes.find(m=>m.at===at+60000);
  assert.equal(first.diamonds,20);assert.equal(first.unknownCount,0);assert.equal(second.diamonds,0);assert.equal(d.session.diamonds,20);
 }finally{a.close();}
});

test('delayed evaluation preserves the online observation at the deadline after newer samples arrive',async()=>{
 const a=create();try{
  await a.pulse(scope,{connected:true},at);for(let t=5000;t<=90000;t+=5000)await a.pulse(scope,{connected:true},at+t);
  await a.ingest(scope,{type:'room-audience',onlineCount:20,receivedAt:at+85000},at+100000);
  await a.ingest(scope,{type:'room-audience',onlineCount:999,receivedAt:at+95000},at+100000);
  await a.saveForecasts(scope,[{id:'online-delayed',asOf:at+30000,target:'online',startAt:at+30000,dueAt:at+90000,point:20,low:10,high:30}]);
  await a.evaluate(scope,at+100000);assert.equal((await a.read(scope,at+100000)).forecasts[0].evaluation.actual,20);
 }finally{a.close();}
});

test('gift propensity trains on completed observed windows and scores the probability issued before gifts',async()=>{
 const a=create();try{
  for(let i=0;i<50;i++)await a.ingest(scope,{type:'chat',id:`chat-${i}`,text:'你好',user:{id:String(100+i)},receivedAt:at},at);
  await a.pulse(scope,{connected:true},at);
  const issued=await a.db.exposures.toArray();assert.equal(issued.length,50);
  for(let i=0;i<5;i++)await a.ingest(scope,{type:'gift',id:`gg${i}`,groupId:`gg${i}`,count:1,unitValue:10,user:{id:String(100+i)},receivedAt:at+10000},at+10000);
  for(let t=5000;t<=300000;t+=5000)await a.pulse(scope,{connected:true},at+t);
  const d=await a.read(scope,at+300000);assert.equal(d.model.trials,50);assert.equal(d.model.positives,5);
  assert.ok(Math.abs(d.model.brier-issued.reduce((sum,e)=>sum+(e.probability-(Number(e.userId.slice(4))<105?1:0))**2,0))<1e-8);
  const before=d.model.trials;await a.pulse(scope,{connected:false},at+900000);assert.equal((await a.read(scope,at+900000)).model.trials,before,'missing windows must not become negative training examples');
 }finally{a.close();}
});
