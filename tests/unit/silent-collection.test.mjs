import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine,mergeConfig,validateConfig} from '../../src/core/engine.js';

test('两种运行方式都持续记忆与研究，旧关闭值不再关闭底层采集',()=>{
 for(const mode of ['auto','preview','collect']){
  const c=validateConfig(mergeConfig({mode,ai:{assistant:{memoryEnabled:false,research:{enabled:false}}}}));
  assert.equal(c.ai.assistant.memoryEnabled,true);assert.equal(c.ai.assistant.research.enabled,true);
 }
});
test('静默模式继续接收观众和直播统计，但任何规则、AI、管理和队列都不向外操作',async()=>{
 const calls=[];
 const e=new Engine({config:mergeConfig({mode:'collect',ai:{enabled:true,chatEnabled:true,proactiveEnabled:true,replyFrequency:'every'},keyword:{enabled:true,rules:[{keywords:['你好'],reply:'回应',exact:false}]},moderation:{enabled:true}}),send:async()=>calls.push('send'),ai:async()=>{calls.push('ai');return '回应';},manage:async()=>calls.push('manage')});
 e.start();e.ingest({type:'chat',id:'one',user:{id:'2',name:'观众'},text:'你好'});
 e.ingest({type:'room-stats',receivedAt:Date.now(),viewers:100});
 assert.equal(e.enqueue('debug','不能发送'),false);
 await e.tick();await new Promise(setImmediate);
 assert.deepEqual(calls,[]);assert.ok(e.stats.events>=2);assert.equal(e.queue.length,0);
});
test('切入静默撤销旧待发送任务，切回不会补发静默前的内容',async()=>{
 const calls=[],e=new Engine({config:mergeConfig({mode:'auto'}),send:async()=>calls.push('send')});
 e.start();e.enqueue('keyword','旧回应');assert.equal(e.queue.length,1);
 e.update({...e.config,mode:'collect'});await e.tick();
 e.update({...e.config,mode:'auto'});await e.tick();
 assert.equal(e.queue.length,0);assert.deepEqual(calls,[]);
});
