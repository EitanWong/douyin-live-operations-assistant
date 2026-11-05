import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine,mergeConfig} from '../../src/core/engine.js';

test('发送引擎将唯一观众的完整@昵称解析为身份和UTF-16范围，不认昵称前缀或邮箱',async()=>{
  const sent=[];
  const e=new Engine({config:mergeConfig({mode:'auto'}),send:async(text,current,options)=>{sent.push({text,...options});return {submitted:true};}});
  try {
    e.start();e.audience.remember({id:'4143433474648240',name:'懒二🐑'});
    e.audience.remember({id:'123',name:'小  明'});
    e.enqueue('bot','🙂 @懒二🐑 @小 明 你好');await e.tick();
    assert.deepEqual(sent[0].mentions,[{id:'4143433474648240',start:3,length:5},{id:'123',start:9,length:4}]);
  } finally {e.stop();}
});

test('同名、只有secUid、昵称前缀和邮箱不猜UID，任务明确绑定的截短昵称保留目标身份',async()=>{
  let now=1800000000000;const sent=[];
  const e=new Engine({now:()=>now,config:mergeConfig({mode:'auto'}),send:async(text,current,options)=>{sent.push(options);return {submitted:true};}});
  try {
    e.start();
    for(const user of [{id:'123',name:'青山'},{id:'456',name:'青山'},{secUid:'sec',name:'未知'}, {id:'789',name:'小明'}])e.audience.remember(user);
    e.enqueue('bot','@青山 @未知 @小明同学 mail@小明');await e.tick();
    assert.deepEqual(sent[0].mentions,[]);
    now+=10000;e.enqueue('bot','@短昵称 我查一下。',{mentionTargets:[{id:'9007199254740993123',name:'短昵称'}]});await e.tick();
    assert.deepEqual(sent[1].mentions,[{id:'9007199254740993123',start:0,length:4}]);
  } finally {e.stop();}
});
