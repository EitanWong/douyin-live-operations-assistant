import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEdgeClient} from '../../src/browser/edge-client.js';
import {createNativeASRClient} from '../../src/browser/native-asr-client.js';
for(const [name,create,query] of [['browser',createEdgeClient,c=>c.status()],['native',createNativeASRClient,c=>c.inspect()]])test(`${name} stale disconnect cannot tear down a newly connected inference port`,async()=>{
 const ports=[];const client=create({connect:()=>{const messages=[],disconnects=[];const port={messages,disconnects,onMessage:{addListener:f=>messages.push(f)},onDisconnect:{addListener:f=>disconnects.push(f)},postMessage:m=>queueMicrotask(()=>messages.forEach(f=>f({id:m.id,value:{phase:'ready'}}))),disconnect(){}};ports.push(port);return port;}});
 await query(client);client.close();const next=query(client);ports[0].disconnects.forEach(f=>f());assert.equal((await next).phase,'ready');client.close();
});
