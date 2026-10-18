import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventInbox,failureCode,serializedBytes} from '../../src/runtime/inbox.js';

test('结构化克隆可携带但 JSON 不可序列化的事件不会同步打断 dispatch',async()=>{
  const statuses=[]; let handled=0;
  const inbox=new EventInbox({handle:async()=>{handled++;},onStatus:status=>statuses.push(status)});
  const cyclic={type:'gift',id:'cycle'}; cyclic.self=cyclic;
  const bigint={type:'gift',id:'bigint',count:1n};
  assert.equal(serializedBytes(cyclic),null);
  assert.equal(serializedBytes(bigint),null);
  assert.equal(await inbox.admit(cyclic),false);
  assert.equal(await inbox.admit(bigint),false);
  assert.equal(handled,0);
  assert.equal(inbox.status().blocked,false);
  assert.equal(inbox.status().state,'degraded');
  assert.equal(inbox.status().code,'INVALID_EVENT');
  assert.equal(inbox.status().gaps,2);
  assert.equal(inbox.status().giftGaps,2);
  assert.ok(statuses.length >= 2);
});

test('事件 getter 抛错时仍被视为无效事件而非逃逸异常',async()=>{
  const event={}; Object.defineProperty(event,'type',{enumerable:true,get(){throw new Error('getter failed')}});
  Object.defineProperty(event,'payload',{enumerable:true,get(){throw new Error('payload failed')}});
  const inbox=new EventInbox({handle:async()=>{throw new Error('should not run')}});
  assert.equal(await inbox.admit(event),false);
  assert.equal(inbox.status().code,'INVALID_EVENT');
  assert.equal(inbox.status().gaps,1);
});

test('配额故障立即打开断路，保留当前事件且有限缓冲；恢复后继续原事件',async()=>{
  let fail=true,calls=0;const done=[];
  const inbox=new EventInbox({limit:2,wait:async()=>{},handle:async event=>{calls++;if(fail)throw new Error('QUOTA_BYTES quota exceeded');done.push(event.id);}});
  const first=inbox.admit({id:'one',type:'gift'});await inbox.whenIdle();
  assert.equal(calls,1);assert.equal(inbox.status().blocked,true);assert.equal(inbox.status().code,'STORAGE_QUOTA');
  const second=inbox.admit({id:'two',type:'chat'});
  assert.equal(await inbox.admit({id:'three',type:'gift'}),false);
  assert.equal(inbox.status().pending,2);assert.equal(inbox.status().giftGaps,1);assert.equal(inbox.export().events[0].id,'one');
  fail=false;inbox.recover();await Promise.all([first,second]);await inbox.whenIdle();assert.deepEqual(done,['one','two']);assert.equal(inbox.status().gaps,1);assert.equal(inbox.status().blocked,false);
});

test('毒事件三次后隔离，后续事件继续；导出和显式恢复保留失败原文',async()=>{
  let repaired=false,attempts=0;const done=[];
  const inbox=new EventInbox({wait:async()=>{},handle:async event=>{if(event.id==='bad'&&!repaired){attempts++;throw new Error('不支持的事件');}done.push(event.id);}});
  const bad=inbox.admit({id:'bad',type:'gift'}),good=inbox.admit({id:'good',type:'chat'});
  assert.equal(await bad,false);assert.equal(await good,true);await inbox.whenIdle();assert.equal(attempts,3);assert.deepEqual(done,['good']);assert.equal(inbox.export().quarantine[0].event.id,'bad');
  repaired=true;inbox.recover();await inbox.whenIdle();assert.deepEqual(done,['good','bad']);assert.equal(inbox.status().quarantined,0);assert.equal(inbox.status().bytes,0);
});

test('按字节约束大事件，隔离区也计入容量；隔离区满时保留阻塞事件',async()=>{
  const inbox=new EventInbox({maxBytes:250,quarantineLimit:1,wait:async()=>{},handle:async()=>{throw Object.assign(new Error('无效'),{code:'INVALID_EVENT'});}});
  await inbox.admit({type:'gift',id:'one',text:'x'.repeat(20)});await inbox.whenIdle();
  assert.ok(inbox.status().bytes>0);assert.equal(await inbox.admit({type:'gift',text:'x'.repeat(300)}),false);
  assert.equal(inbox.status().gaps,1);assert.equal(inbox.status().quarantined,1);
  const other=new EventInbox({quarantineLimit:1,wait:async()=>{},handle:async()=>{throw Object.assign(new Error('无效'),{code:'INVALID_EVENT'});}});
  await other.admit({id:'first'});const pending=other.admit({id:'second'});await other.whenIdle();assert.equal(other.status().blocked,true);assert.equal(other.export().events[0].id,'second');other.close();await pending;
});

test('背压故障不隔离也不忙重试；停止时释放等待者，错误分类保持明确',async()=>{
  let calls=0;const inbox=new EventInbox({handle:async()=>{calls++;throw Object.assign(new Error('感谢积压'),{code:'BACKPRESSURE'});}});
  const task=inbox.admit({type:'gift'});await inbox.whenIdle();assert.equal(calls,1);assert.equal(inbox.status().quarantined,0);inbox.close();assert.equal(await task,false);
  assert.equal(failureCode(new Error('Extension context invalidated')),'CONTEXT_INVALID');
});

test('实时缓冲满后仍为持久日志保留恢复槽位，分步恢复不触碰未落盘队首',async()=>{
  const done=[],inbox=new EventInbox({limit:257,handle:async event=>done.push(event.id)});
  inbox.held=true;
  for(let n=0;n<256;n++)void inbox.admit({id:`live-${n}`});
  assert.equal(await inbox.admit({id:'overflow'}),false);
  inbox.recover();
  const recovered=inbox.admit({id:'durable',_journalKey:'saved'},true);
  inbox.held=false;await inbox.drain(1);inbox.held=true;await recovered;
  assert.deepEqual(done,['durable']);assert.equal(inbox.status().pending,256);
  assert.equal(inbox.status().gaps,1);
  inbox.held=false;await inbox.drain();assert.equal(inbox.status().pending,0);
});
