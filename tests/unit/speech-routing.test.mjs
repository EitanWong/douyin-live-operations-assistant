import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechRecognizer} from '../../src/services/speech-routing.js';
test('prepared Chinese local ASR avoids network latency and preserves original audio interval',async()=>{
 let cloud=0;const recognize=createSpeechRecognizer({cloud:async()=>cloud++,edge:{ready:async()=>true,transcribe:async()=> '蓝色怎么搭？'},config:()=>({audioEnabled:true,audioBackend:'native-sensevoice'})});
 const row=await recognize({kind:'audio',at:100,endedAt:200,data:'wav'},{},{});assert.equal(cloud,0);assert.equal(row.text,'蓝色怎么搭？');assert.equal(row.at,100);assert.equal(row.endedAt,200);assert.equal(row.model,'native-sensevoice');assert.equal(row.data,undefined);
});
test('local failures recover to cloud, cancellation never changes provider and local-only never calls cloud',async()=>{
 let cloud=0;const c=new AbortController();
 const recognize=createSpeechRecognizer({cloud:async()=>{cloud++;return {text:'云端语音'};},edge:{ready:async()=>true,transcribe:async()=>{throw Error('local error');}},config:()=>({audioEnabled:true})});
 assert.equal((await recognize({kind:'audio'},{},{})).text,'云端语音');assert.equal(cloud,1);
 await assert.rejects(recognize({kind:'audio'},{localAudio:true},{}),/local error/);assert.equal(cloud,1);
 c.abort();await assert.rejects(recognize({kind:'audio'},{},{signal:c.signal}),/取消/);assert.equal(cloud,1);
});
