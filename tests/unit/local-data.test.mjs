import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {LocalDataEngine} from '../../extension/local-data.js';

const row={id:'journal-a',room:'1',anchor:'2',kind:'event',receivedAt:1000,payload:{type:'chat',text:'喜欢吉他'}};
test('local archive retains unacknowledged data across worker restart and retries idempotently',async()=>{
 const indexedDB=new IDBFactory();let available=false,calls=0;
 const request=async(action,value)=>{calls++;if(!available)throw Error('not installed');return action==='append'?{acknowledged:value.map(r=>r.id),inserted:value.length}:{records:1};};
 const create=()=>new LocalDataEngine({indexedDB,IDBKeyRange,request});let engine=create();
 try{
  await engine.enqueue(row);assert.equal((await engine.status()).pending,0);assert.equal(calls,0);
  await engine.configure(true,{probe:false});await engine.enqueue(row);await engine.flush();
  assert.equal((await engine.status()).pending,1);
  engine.close();engine=create();assert.equal((await engine.status()).pending,1);
  available=true;await engine.flush();assert.equal((await engine.status()).pending,0);
  await engine.enqueue(row);await engine.flush();assert.equal((await engine.status()).pending,0);
 }finally{engine.close();}
});

test('native failure or mismatched acknowledgement never deletes queued records; disabling preserves backlog',async()=>{
 const engine=new LocalDataEngine({indexedDB:new IDBFactory(),IDBKeyRange,request:async()=>({acknowledged:['wrong']})});
 try{
  await engine.configure(true,{probe:false});await engine.enqueue(row);await engine.flush();
  assert.equal((await engine.status()).pending,1);
  await engine.configure(false);await engine.enqueue({...row,id:'b'});
  assert.equal((await engine.status()).pending,1);
  assert.equal((await engine.status()).enabled,false);
 }finally{engine.close();}
});

test('local archive validates room and size, and makes a failed enable visible',async()=>{
 const engine=new LocalDataEngine({indexedDB:new IDBFactory(),IDBKeyRange,request:async()=>{throw Error('missing');}});
 try{
  await assert.rejects(engine.configure(true),/本地/);
  assert.equal((await engine.status()).enabled,false);
  await engine.configure(true,{probe:false});
  await assert.rejects(engine.enqueue({...row,room:'../x'}),/无效/);
  await assert.rejects(engine.enqueue({...row,payload:{text:'x'.repeat(700000)}}),/过大/);
 }finally{engine.close();}
});

test('a full outbox retries native draining before accepting another record',async()=>{
 let calls=0;
 const engine=new LocalDataEngine({indexedDB:new IDBFactory(),IDBKeyRange,request:async(action,records)=>{
  calls++;return {acknowledged:records.map(r=>r.id)};
 }});
 try {
  await engine.configure(true,{probe:false});
  // Existing durable work fills the budget while the native host is offline.
  await engine.db.queue.add({id:row.id,room:row.room,receivedAt:row.receivedAt,size:256*1024*1024,record:row});
  await engine.db.meta.put({id:'usage',bytes:256*1024*1024});
  await assert.rejects(engine.enqueue({...row,id:'next'}),/缓冲已满/);
  await engine.flushing;
  assert.equal(calls,1,'a failed admission must still wake the recovered native host');
  assert.equal((await engine.status()).pending,0);
  assert.equal(await engine.enqueue({...row,id:'next'}),true);
  await engine.flush();assert.equal((await engine.status()).pending,0);
 }finally{engine.close();}
});
