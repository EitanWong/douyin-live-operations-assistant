import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProtocolCache} from '../../extension/protocol-cache.js';

test('协议缓存启动仅扫描一次，追加和分页只读取所需帧，重启能重建索引',async()=>{
  const values={},reads=[];
  const local={get:async keys=>{reads.push(keys);return keys===null?{...values}:Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in values).map(key=>[key,values[key]]));},
    set:async input=>Object.assign(values,input),remove:async keys=>{for(const key of keys)delete values[key];}};
  const usage=async()=>({used:0,quota:5000000,ratio:0}),cache=new ProtocolCache({local,usage,now:()=>1000});
  for(let i=0;i<120;i++)await cache.append(`live-assistant:protocol:1:frame-${String(i).padStart(16,'0')}`,{i});
  await cache.append('live-assistant:protocol:2:frame-0000000000000001',{i:999});
  const first=await cache.list('1',null,100),last=first.at(-1),second=await cache.list('1',last,100);
  assert.equal(first.length,100);assert.equal(second.length,20);assert.equal(new Set([...first,...second].map(row=>row.key)).size,120);
  assert.equal(reads.filter(keys=>keys===null).length,1,'不能每次追加复制所有 rawBase64');
  assert.ok(reads.filter(Array.isArray).every(keys=>keys.length<=100),'分页只获取该页原帧');
  const restarted=new ProtocolCache({local,usage,now:()=>1000});assert.equal((await restarted.list('1',null,100)).length,100);
  await restarted.clear();assert.equal(Object.keys(values).length,0);
});
