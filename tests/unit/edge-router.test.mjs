import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEdgeRouter} from '../../src/browser/edge-router.js';
test('auto ASR detects installed native models, recovers to browser and reports the actual ready backend',async()=>{
 let cfg={audioBackend:'auto'},nativeFails=false;const calls=[];
 const router=createEdgeRouter({config:()=>cfg,browser:{detect:async()=>({webgpu:true}),prepare:async(k,s)=>{calls.push(['browser',k,s]);return {phase:'ready'};},ready:async()=>true,status:async()=>({audio:{phase:'ready'}}),transcribe:async()=> '浏览器'},native:{inspect:async()=>({available:true}),prepare:async()=>{if(nativeFails)throw Error('native unavailable');calls.push(['native']);return {phase:'ready'};},ready:async()=>true,status:async()=>({phase:'ready'}),transcribe:async()=> '中文'}});
 assert.equal((await router.detect()).recommendation.audioBackend,'native-sensevoice');
 await router.prepare('audio','auto');assert.equal(await router.transcribe({},null),'中文');assert.equal((await router.status()).audio.backend,'native-sensevoice');
 nativeFails=true;await router.prepare('audio','auto');assert.equal(await router.transcribe({},null),'浏览器');
 cfg={audioBackend:'native-sensevoice'};await assert.rejects(router.prepare('audio','native-sensevoice'),/native unavailable/);
 assert.equal(calls.filter(c=>c[0]==='browser').length,1);
});
