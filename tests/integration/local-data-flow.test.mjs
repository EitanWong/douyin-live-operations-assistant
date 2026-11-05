import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {LocalDataEngine,nativeDataRequest} from '../../extension/local-data.js';
import {createDataCapture,runReadOnlyCollector} from '../../extension/data-capture.js';
import {JSDOM} from 'jsdom';

test('real capture -> durable outbox -> framed Python -> SQLite -> bounded AI summary, with no cloud',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'live-data-')),database=join(temp,'live.sqlite3');
 const chrome={runtime:{sendNativeMessage:async(host,message)=>{
  assert.equal(host,'com.douyin_live_assistant.data');
  const child=spawn('python3',[fileURLToPath(new URL('../../native/data_host.py',import.meta.url)),'--database',database]);
  const input=Buffer.from(JSON.stringify(message)),header=Buffer.alloc(4);header.writeUInt32LE(input.length);
  const output=[],errors=[];child.stdout.on('data',b=>output.push(b));child.stderr.on('data',b=>errors.push(b));
  const result=new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>{
   if(code)return reject(Error(Buffer.concat(errors).toString()));
   const raw=Buffer.concat(output);resolve(JSON.parse(raw.subarray(4,4+raw.readUInt32LE(0)).toString()));
  });});child.stdin.end(Buffer.concat([header,input]));return result;
 }}};
 const request=nativeDataRequest(chrome),engine=new LocalDataEngine({indexedDB:new IDBFactory(),IDBKeyRange,request}),now=Date.now();
 try{
  await engine.configure(true);
  const archive=createDataCapture(async m=>{for(const row of m.records)await engine.enqueue({...row,id:`1:document:${row.id}`,room:'1',anchor:'2'});},{now:()=>now});
  const batch={batchId:1,events:[{type:'chat',text:'喜欢吉他',user:{id:'3'}}],status:{connected:true,bridgeGaps:2}};
  await archive(batch);await engine.flush();await archive(batch);await engine.flush();
  const status=await request('status');assert.equal(status.records,2);assert.equal((await engine.status()).pending,0);
  const summary=await engine.summary('1');assert.equal(summary.eventCounts.chat,1);assert.equal(summary.observedUsers,1);assert.equal(summary.coverage.gaps,2);
  assert.deepEqual((await engine.summary('9')).eventCounts,{});
 }finally{engine.close();await rm(temp,{recursive:true,force:true});}
});

test('dedicated opponent page only drains and archives; failed persistence withholds MAIN acknowledgement',async()=>{
 const dom=new JSDOM('<title>直播间</title>',{url:'https://live.douyin.com/9?assistant_data_collector=1'}),calls=[];
 let fail=true,tick,collector;
 dom.window.setTimeout=fn=>{tick=fn;return 1;};dom.window.clearTimeout=()=>{};
 try{
  collector=await runReadOnlyCollector({window:dom.window,document:dom.window.document,room:'9',message:async m=>{
   calls.push(structuredClone(m));
   if(m.type==='data-context')return {readOnly:true,ownerRoom:'1'};
   if(m.command?.type==='drain')return {batchId:1,events:[{type:'chat',text:'冲呀'}],status:{connected:true}};
   if(m.type==='data-records' && fail)throw Error('disk full');
   return true;
  }});collector.start();await new Promise(setImmediate);
  assert.match(dom.window.document.title,/采集等待/);fail=false;await tick();await new Promise(setImmediate);
  const drains=calls.filter(m=>m.command?.type==='drain');assert.equal(drains[0].command.ack,undefined);assert.equal(drains[1].command.ack,undefined);
  await tick();await new Promise(setImmediate);assert.equal(calls.filter(m=>m.command?.type==='drain')[2].command.ack,1);
  assert.equal(calls.some(m=>m.command?.type==='send-api' || m.type==='prediction'),false);
  assert.match(dom.window.document.title,/只读采集/);
 }finally{collector?.stop();dom.window.close();}
});

test('closing a read-only collector during a pending read cannot revive its lease or update the old document',async()=>{
 const dom=new JSDOM('<title>原页面</title>'),calls=[];let release,collector;
 const pending=new Promise(resolve=>{release=resolve;});let timers=0;
 dom.window.setTimeout=()=>{timers++;return 1;};dom.window.clearTimeout=()=>{};
 try{
  collector=await runReadOnlyCollector({window:dom.window,document:dom.window.document,room:'9',message:async m=>{
   calls.push(m);if(m.type==='data-context')return {readOnly:true};
   if(m.command?.type==='drain')return pending;return true;
  }});
  collector.start();await new Promise(setImmediate);collector.stop();
  release({batchId:1,events:[{type:'chat',text:'迟到'}],status:{connected:true}});await new Promise(setImmediate);
  assert.equal(calls.some(m=>m.command?.type==='collection-pulse' || m.type==='data-records' || m.active===true),false);
  assert.equal(dom.window.document.title,'原页面');assert.equal(timers,0);
 }finally{release?.({});collector?.stop();dom.window.close();}
});
