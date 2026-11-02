import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {DurableStorage} from '../../extension/durable-storage.js';
const local={get:async()=>({}),remove:async()=>{}};
const create=(indexedDB=new IDBFactory())=>new DurableStorage({indexedDB,IDBKeyRange,local});
test('同批重复写入和删除保持准确计数，失败的批次原子回滚后仍能继续使用',async()=>{
 const d=create(),key='live-assistant:config:1';
 await d.putRecords([[key,{value:1}],[key,{value:2}]]);
 assert.deepEqual(await d.get(key),{value:2});assert.equal((await d.usage()).categories.settings.count,1);
 await assert.rejects(d.putRecords([['live-assistant:config:2',{ok:true}],['bad',()=>{}]]));
 assert.equal(await d.get('live-assistant:config:2'),undefined);assert.equal((await d.usage()).categories.settings.count,1);
 await d.remove([key,key]);assert.equal((await d.usage()).categories.settings.count,0);
 await d.set(key,{value:3});assert.equal((await d.usage()).categories.settings.count,1);
});
test('兼容原生 version 1 的原库和 journalOrder 索引，重开后按房间与游标读取',async()=>{
 const indexedDB=new IDBFactory();
 await new Promise((resolve,reject)=>{const r=indexedDB.open('douyin-live-assistant',1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('records',{keyPath:'key'});s.createIndex('journalOrder',['room','savedAt','key']);r.result.createObjectStore('metadata');s.put({key:'live-assistant:config:1',value:{old:true},bytes:10,category:'settings'});};r.onerror=()=>reject(r.error);r.onsuccess=()=>{r.result.close();resolve();};});
 const first=create(indexedDB);assert.deepEqual(await first.get('live-assistant:config:1'),{old:true});
 await first.putRecords([['live-assistant:event:1:b',{savedAt:10,event:{id:'b'}}],['live-assistant:event:1:a',{savedAt:10,event:{id:'a'}}],['live-assistant:event:2:c',{savedAt:11,event:{id:'c'}}]]);
 const reopened=create(indexedDB),rows=await reopened.listEvents('1',null,1);assert.equal(rows[0].event.id,'a');
 assert.deepEqual((await reopened.listEvents('1',rows[0],10)).map(r=>r.event.id),['b']);
 const native=await new Promise(resolve=>{const r=indexedDB.open('douyin-live-assistant');r.onsuccess=()=>resolve(r.result);});assert.equal(native.version,1);assert.equal(native.transaction('records').objectStore('records').indexNames.contains('journalOrder'),true);native.close();
});

test('新建数据库也保持原生版本和索引命名，旧版读取器可回退读取事件',async()=>{
 const indexedDB=new IDBFactory(),d=create(indexedDB);await d.set('live-assistant:event:1:old-reader',{savedAt:20,event:{id:'kept'}});
 const db=await new Promise(resolve=>{const r=indexedDB.open('douyin-live-assistant',1);r.onsuccess=()=>resolve(r.result);});
 try{assert.equal(db.version,1);const store=db.transaction('records').objectStore('records');assert.equal(store.indexNames.contains('journalOrder'),true);const result=await new Promise(resolve=>{const r=store.index('journalOrder').getAll();r.onsuccess=()=>resolve(r.result);});assert.equal(result[0].value.event.id,'kept');}finally{db.close();}
});

test('不同数据库连接并发写入仍原子更新用量，迁移中断重试不覆盖已提交数据',async()=>{
 const indexedDB=new IDBFactory(),a=create(indexedDB),b=create(indexedDB);
 await Promise.all(Array.from({length:20},(_,i)=>(i%2 ? a : b).set(`live-assistant:config:${i}`,{i})));
 const all=await a.getAll(['live-assistant:config:']);assert.equal(Object.keys(all).length,20);
 const usage=(await b.usage()).categories.settings;assert.equal(usage.count,20);assert.equal(usage.bytes,Object.entries(all).reduce((sum,[k,v])=>sum+new TextEncoder().encode(k+JSON.stringify(v)).byteLength,0));
 let attempts=0;const old={'live-assistant:config:99':{kept:true}},d=new DurableStorage({indexedDB,IDBKeyRange,local:{get:async()=>old,remove:async keys=>{if(++attempts===1)throw new Error('中断');for(const key of keys)delete old[key];}}});
 await assert.rejects(d.migrate(),/中断/);assert.deepEqual(await a.get('live-assistant:config:99'),{kept:true});assert.equal(await d.migrate(),1);assert.equal((await a.usage()).categories.settings.count,21);
});
