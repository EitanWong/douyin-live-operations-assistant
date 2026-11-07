import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {EventInbox,failureCode} from '../../src/runtime/inbox.js';
import {StorageMirror} from '../../extension/storage-mirror.js';
import {createDataCapture,runReadOnlyCollector} from '../../extension/data-capture.js';
import {roomFromURL} from '../../src/browser/room-context.js';
import {RequestBridgeClient} from '../../src/browser/request-sender.js';
import {createEdgeClient} from '../../src/browser/edge-client.js';
import {createNativeASRClient} from '../../src/browser/native-asr-client.js';

// Exercise the ordinary content entry and its real bounded inbox, without booting
// unrelated UI/model services. The retained MAIN batch is retried until archived.
for(const pending of [false,true])test(`archive ${pending?'pending':'full'} preserves live delivery and withholds acknowledgement`,async()=>{
 const dom=new JSDOM('',{url:'https://live.douyin.com/1',runScripts:'outside-only'});
 const timers=[],commands=[],events=[],frames=[],writes=[];
 let adapter,fail=true,release;
 const waiting=new Promise(resolve=>{release=resolve;});
 Object.assign(dom.window,{EventInbox,StorageMirror,roomFromURL,createDataCapture,runReadOnlyCollector,RequestBridgeClient,createEdgeClient,createNativeASRClient,failureCode,IdentityReader:class {},
  DouyinAdapter:class {
   constructor(options){Object.assign(this,options);}
   emitStatus(){}
   healthy(){return this.status.connected===true;}
  },setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},
  chrome:{runtime:{onMessage:{addListener(){}},sendMessage:async message=>{
   if(message.type==='init')return {ok:true,value:{}};
   if(message.type==='page-command' && message.command.type==='drain'){
    commands.push(message.command);
    return {ok:true,value:message.command.ack===1 ? {batchId:null,status:{connected:true,frames:2}} :
     {batchId:1,events:[{id:'gift-1',type:'gift'}],captures:[{rawBase64:'AQ==',rawBytes:1}],status:{connected:true,frames:1}}};
   }
   if(message.type==='data-records'){
    writes.push(structuredClone(message.records));
    if(pending && fail)await waiting;
    if(fail)throw Error('本地归档缓冲已满');
   }
   if(message.type==='protocol-append')frames.push(message.record);
   return {ok:true,value:true};
  }}},boot:options=>{adapter=options.adapterFactory({onEvent:async event=>events.push(event.id)});adapter.hook();}
 });
 try {
  let source=await readFile(new URL('../../extension/content.js',import.meta.url),'utf8');
  source=source.replace(/^import .*;\n/gm,'').replace('async function startContent() {\n','').replace(/\n}\nstartContent\(\);\s*$/,'');
  await dom.window.eval(`(async()=>{${source}})()`);await new Promise(setImmediate);
  assert.equal(adapter.healthy(),true,'archive availability must not mark a healthy transport disconnected');
  assert.equal(adapter.status.frames,1);
  assert.deepEqual(events,['gift-1']);assert.equal(frames.length,1);
  if(pending){fail=false;release();await new Promise(setImmediate);}
  else {
   assert.match(adapter.status.archiveError,/缓冲已满/);
   await timers.shift()();await new Promise(setImmediate);
   assert.equal(commands[1].ack,undefined,'a failed archive must retain its MAIN batch');
   assert.deepEqual(events,['gift-1'],'retry must not deliver a gift twice');assert.equal(frames.length,1);
   assert.deepEqual(writes[0],writes[1]);
   fail=false;await timers.shift()();await new Promise(setImmediate);
  }
  await timers.shift()();await new Promise(setImmediate);
  assert.equal(commands.at(-1).ack,1);
  assert.deepEqual(events,['gift-1']);assert.equal(frames.length,1);
  assert.equal(adapter.status.archiveError,undefined);
  assert.equal(adapter.healthy(),true);
 } finally {release();adapter?.closeEvents();dom.window.close();}
});
