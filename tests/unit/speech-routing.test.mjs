import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechRecognizer} from '../../src/services/speech-routing.js';
test('云端中文识别优先，本地就绪也不抢占',async()=>{
 let local=0;const recognize=createSpeechRecognizer({cloud:async()=>({text:'云端语音'}),edge:{ready:async()=>true,transcribe:async()=>{local++;return '本地';}},config:()=>({enabled:true,audioEnabled:true})});
 assert.equal((await recognize({kind:'audio'},{},{})).text,'云端语音');assert.equal(local,0);
});
test('云端识别失败才用本地，保留原音频时间区间与实际模型',async()=>{
 const recognize=createSpeechRecognizer({cloud:async()=>{throw Error('offline');},edge:{ready:async()=>true,transcribe:async()=> '蓝色怎么搭？'},config:()=>({enabled:true,audioEnabled:true,audioBackend:'native-sensevoice'})});
 const row=await recognize({kind:'audio',at:100,endedAt:200,data:'wav'},{},{});
 assert.equal(row.text,'蓝色怎么搭？');assert.equal(row.at,100);assert.equal(row.endedAt,200);assert.equal(row.model,'native-sensevoice');assert.equal(row.data,undefined);
});
for(const enabled of [true,false])test(`本地开关${enabled}约束语音兜底和显式本地识别`,async()=>{
 let local=0,cloud=0;const recognize=createSpeechRecognizer({cloud:async()=>{cloud++;throw Error('cloud failed');},edge:{ready:async()=>true,transcribe:async()=>{local++;return '本地';}},config:()=>({enabled,audioEnabled:true})});
 if(enabled){assert.equal((await recognize({kind:'audio'},{localAudio:true})).text,'本地');assert.equal(cloud,0);}
 else {await assert.rejects(recognize({kind:'audio'},{}),/cloud failed/);await assert.rejects(recognize({kind:'audio'},{localAudio:true}),/本地/);assert.equal(local,0);}
});
test('取消、非音频和未就绪模型不启动本地兜底',async()=>{
 let local=0;const c=new AbortController();
 const recognize=createSpeechRecognizer({cloud:async()=>{c.abort();throw Error('cancelled');},edge:{ready:async()=>true,transcribe:async()=>local++},config:()=>({enabled:true,audioEnabled:true})});
 await assert.rejects(recognize({kind:'audio'},{},{signal:c.signal}));assert.equal(local,0);
 for(const kind of ['audio','video']){
  const unavailable=createSpeechRecognizer({cloud:async()=>{throw Error('cloud failed');},edge:{ready:async()=>false,transcribe:async()=>local++},config:()=>({enabled:true,audioEnabled:true})});
  await assert.rejects(unavailable({kind},{}),/cloud failed/);assert.equal(local,0);
 }
});
