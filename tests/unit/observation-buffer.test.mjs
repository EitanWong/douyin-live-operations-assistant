import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ObservationBuffer} from '../../extension/observation-buffer.js';

test('桥接字节预算包含在途批次，确认后才恢复容量，空读不会保留空批次',()=>{
  const buffer=new ObservationBuffer(),event={type:'chat',text:'x'.repeat(2*1024*1024)};
  assert.equal(buffer.drain().batchId,null);
  assert.equal(buffer.enqueue('events',event),true);
  const first=buffer.drain();assert.equal(first.events.length,1,'允许单条大于分页预算但未超过总预算的消息');
  assert.equal(buffer.enqueue('events',event),false);
  assert.equal(buffer.drain().batchId,first.batchId);
  assert.equal(buffer.drain({ack:first.batchId}).batchId,null);
  assert.equal(buffer.enqueue('events',event),true);
  assert.equal(buffer.drain().status.bridgeGaps,1);
});

test('协议帧独立限流且重读不释放容量，非法观测不妨碍后续批次',()=>{
  const buffer=new ObservationBuffer();
  for(let i=0;i<256;i++)assert.equal(buffer.enqueue('captures',{id:i}),true);
  const first=buffer.drain();assert.equal(first.captures.length,32);
  assert.equal(buffer.enqueue('captures',{id:256}),false);
  assert.equal(buffer.enqueue('events',{type:'gift',id:'ok'}),true);
  assert.equal(buffer.enqueue('events',{id:1n}),false);
  assert.equal(buffer.enqueue('events',undefined),false);
  const next=buffer.drain({ack:first.batchId});
  assert.equal(next.events[0].id,'ok');assert.equal(next.captures[0].id,32);
  assert.equal(next.status.captureBridgePending,224);
  assert.equal(next.status.captureBridgeGaps,1);assert.equal(next.status.bridgeGaps,2);
});
