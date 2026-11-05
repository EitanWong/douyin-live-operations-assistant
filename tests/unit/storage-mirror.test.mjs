import {test} from 'node:test';
import assert from 'node:assert/strict';
import {StorageMirror} from '../../extension/storage-mirror.js';

test('迟到保存成功不覆盖已观察的新存储值，删除失败恢复最后确认值',async()=>{
  let resolve;
  const mirror=new StorageMirror({key:'initial'},()=>new Promise(done=>{resolve=done;}));
  const write=mirror.write('key','local');await Promise.resolve();
  mirror.observe({key:{newValue:'external'}});resolve(true);await write;
  assert.equal(mirror.values.get('key'),'external');
  mirror.send=async()=>{throw Error('denied');};
  await assert.rejects(mirror.write('key',undefined,true),/denied/);
  assert.equal(mirror.values.get('key'),'external');
});

test('保存与删除串行，成功删除释放镜像及登记，失败删除不复活未成功保存的值',async()=>{
  const calls=[],mirror=new StorageMirror({},async request=>{calls.push(request.type);});
  await Promise.all([mirror.write('key',1),mirror.write('key',undefined,true)]);
  assert.deepEqual(calls,['set','delete']);assert.equal(mirror.values.has('key'),false);
  assert.equal(mirror.confirmed.size,0);assert.equal(mirror.latest.size,0);
  mirror.send=async()=>{throw Error('denied');};
  await Promise.allSettled([mirror.write('key',1),mirror.write('key',undefined,true)]);
  assert.equal(mirror.values.has('key'),false);
  mirror.observe({key:{newValue:2}});assert.equal(mirror.values.get('key'),2);
  mirror.observe({key:{}});assert.equal(mirror.values.has('key'),false);assert.equal(mirror.confirmed.size,0);
});
