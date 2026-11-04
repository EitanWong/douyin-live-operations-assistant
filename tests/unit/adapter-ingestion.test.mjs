import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DouyinAdapter} from '../../src/browser/adapter.js';
import {DEFAULTS,copy} from '../../src/core/engine.js';

const varint=value=>{let n=BigInt(value);const out=[];while(n>127n){out.push(Number(n&127n)|128);n>>=7n;}return Buffer.from([...out,Number(n)]);};
const integer=(field,value)=>Buffer.concat([varint(field*8),varint(value)]);
const bytes=(field,value)=>{const body=Buffer.from(value);return Buffer.concat([varint(field*8+2),varint(body.length),body]);};
const frame=ids=>Buffer.concat(ids.map(id=>bytes(1,Buffer.concat([
  bytes(1,'WebcastControlMessage'),bytes(2,Buffer.concat([bytes(1,integer(2,id)),integer(2,3)])),integer(3,id)
]))));
function adapter(onEvent=()=>{}) {
  const page=Object.assign(new EventTarget(),{location:new URL('https://live.douyin.com/1'),btoa});
  return new DouyinAdapter({page,getConfig:()=>copy(DEFAULTS),onEvent,onLog:()=>{},onStatus:()=>{}});
}

test('解码缓存满载时重解析仍保留首次跨传输去重结果和消息顺序',async()=>{
  const received=[],a=adapter(event=>received.push(event.id));
  a.acceptFrame(frame([101]),'socket');await a.chain;
  // 模拟前面的慢订阅占满缓存；仍走真实协议解析和交付路径。
  a.decodedCacheBytes=16*1024*1024;
  a.acceptFrame(frame([101,102,103]),'http-poll');await a.chain;
  assert.equal(a.status.uncachedFrames,1);
  assert.deepEqual(received,['101','102','103']);
  assert.equal(a.status.duplicateEvents,1);
});

test('重复传输抑制不吞掉同传输更新，续期后按最后观察时间淘汰',t=>{
  let now=1000000;t.mock.method(Date,'now',()=>now);
  const a=adapter(),event=id=>({type:'gift',id:String(id)});
  assert.equal(a.isDuplicateProtocolEvent(event(0),'socket'),false);
  for(let id=1;id<20000;id++)a.isDuplicateProtocolEvent(event(id),'socket');
  now+=60000;assert.equal(a.isDuplicateProtocolEvent(event(0),'socket'),false);
  a.isDuplicateProtocolEvent(event(20000),'socket');
  assert.equal(a.isDuplicateProtocolEvent(event(0),'http-poll'),true,'刚续期的消息应保留在有界窗口内');
  now+=60001;
  assert.equal(a.isDuplicateProtocolEvent(event(2),'http-poll'),false,'过期消息允许再次观察');
  assert.equal(a.isDuplicateProtocolEvent(event(0),'http-poll'),true,'续期不能被过期前缀误删');
  now+=60000;assert.equal(a.isDuplicateProtocolEvent(event(0),'http-poll'),false);
});
