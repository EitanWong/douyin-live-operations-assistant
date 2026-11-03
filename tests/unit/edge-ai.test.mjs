import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeEdgeMessages,acceptPerformance,decodePCM16} from '../../src/ai/edge-prompt.js';
import {createEdgeClient} from '../../src/browser/edge-client.js';
test('local short context retains question, current evidence and boundaries within budget',()=>{
 const messages=makeEdgeMessages({target:{text:'蓝色怎么搭？'},maxLength:40,knowledge:'蓝配白。',context:[{text:'x'.repeat(30000)}]},{});
 assert.ok(JSON.stringify(messages).length<7000);assert.match(messages.at(-1).content,/蓝色怎么搭/);assert.match(messages[0].content,/未知|编造/);
 assert.equal(acceptPerformance({firstTokenMs:500,tokensPerSecond:20,totalMs:1000}),'ready');
 assert.equal(acceptPerformance({firstTokenMs:2500,tokensPerSecond:3,totalMs:9000}),'slow');
 assert.throws(()=>decodePCM16('not-wav'),/音频/);
});
test('edge bridge never downloads on ready and cancellation is forwarded once',async()=>{
 const sent=[],listeners=[];const client=createEdgeClient({connect:()=>({postMessage:m=>{sent.push(m);if(m.action==='status')queueMicrotask(()=>listeners.forEach(fn=>fn({id:m.id,value:{text:{phase:'ready'}}})));},onMessage:{addListener:fn=>listeners.push(fn)},onDisconnect:{addListener(){}},disconnect(){}})});
 assert.equal(await client.ready('text'),true);assert.equal(sent[0].action,'status');
 const c=new AbortController();const work=client.reply({signal:c.signal,target:{text:'你好'},maxLength:30},{});c.abort();await assert.rejects(work,/取消/);assert.equal(sent.filter(x=>x.action==='cancel').length,1);client.close();
});
