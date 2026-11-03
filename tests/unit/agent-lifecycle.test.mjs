import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentHarness} from '../../src/ai/harness.js';

test('启动检查点尚未写完时取消或关闭宿主，落盘后也不能再执行任务',async t=>{
  for(const action of ['cancel','close'])await t.test(action,async()=>{
    let release,started;
    const saving=new Promise(resolve=>{started=resolve;});
    const rows=new Map();let executed=0;
    const store={all:async()=>[],put:async job=>{
      if(job.status==='running'){started();await new Promise(resolve=>{release=resolve;});}
      rows.set(job.id,structuredClone(job));
    }};
    const harness=new AgentHarness({store,execute:async()=>{executed++;return '不应执行';}});
    try {
      await harness.submit({id:'startup-task',scope:'1:10',question:'查资料',input:{}});
      await saving;
      const cancelled=action==='cancel' ? harness.cancel('startup-task','1:10') : harness.close();
      release();await cancelled;await harness.writes;await new Promise(setImmediate);
      assert.equal(executed,0,action);
      assert.equal(harness.list('1:10')[0].status,action==='cancel' ? 'cancelled' : 'interrupted');
      assert.equal(rows.get('startup-task').status,action==='cancel' ? 'cancelled' : 'interrupted');
    } finally {release?.();harness.close();await harness.writes;}
  });
});
