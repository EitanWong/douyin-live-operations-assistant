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

test('自动准备合并并发请求，缓存就绪结果，释放后允许重新准备',async()=>{
 let finish,calls=0,ready=false;const waiting=new Promise(resolve=>finish=resolve);
 const router=createEdgeRouter({config:()=>({textModel:'auto',audioBackend:'auto'}),browser:{
  ready:async()=>ready,status:async()=>({text:{phase:ready?'ready':'unprepared'}}),
  prepare:async()=>{calls++;await waiting;ready=true;return {phase:'ready'};},release:async()=>{ready=false;}
 }});
 const first=router.ensure('text'),second=router.ensure('text');
 await new Promise(setImmediate);assert.equal(calls,1);finish();
 assert.equal((await first).phase,'ready');await second;await router.ensure('text');assert.equal(calls,1);
 await router.release();await router.ensure('text');assert.equal(calls,2);
});

test('关闭本地 AI 开关后不执行手动弹幕模型复核',async()=>{
 let enabled=false,calls=0;const router=createEdgeRouter({config:()=>({enabled}),browser:{classify:async()=>{calls++;return 'label';}}});
 assert.throws(()=>router.classify('你好'),/启用本地 AI/);assert.equal(calls,0);
 enabled=true;assert.equal(await router.classify('你好'),'label');assert.equal(calls,1);
});

test('浏览器中文识别测速不足时自动尝试可用原生组件，显式选择不被改写',async()=>{
 const calls=[];let selection='auto';
 const router=createEdgeRouter({config:()=>({audioBackend:selection}),browser:{detect:async()=>({}),prepare:async()=>{calls.push('browser');return {phase:'slow',elapsedMs:2800};},ready:async()=>false},
  native:{inspect:async()=>({available:false}),prepare:async()=>{calls.push('native');return {phase:'ready',elapsedMs:220};},ready:async()=>true,transcribe:async()=> '中文原话'}});
 assert.equal((await router.prepare('audio')).backend,'native-sensevoice');assert.equal(await router.transcribe({}),'中文原话');
 selection='browser-whisper';assert.equal((await router.prepare('audio')).phase,'slow');assert.deepEqual(calls,['browser','native','browser']);
});
