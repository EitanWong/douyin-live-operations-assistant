import {test} from 'node:test';
import assert from 'node:assert/strict';
import {roomFromURL,roomMatchesStore,RoomContext} from '../../src/browser/room-context.js';

test('房间身份统一解析路径与 room_id；无关参数变化不切房',()=>{
  const page={location:new URL('https://live.douyin.com/?room_id=123&from=a')};
  const context=new RoomContext(page);
  assert.equal(context.room,'123');assert.equal(context.current(),true);
  page.location=new URL('https://live.douyin.com/?room_id=123&from=b');assert.equal(context.current(),true);
  page.location=new URL('https://live.douyin.com/?room_id=456');assert.equal(context.current(),false);
  assert.equal(roomFromURL('https://live.douyin.com/789?room_id=123'),'789');
  assert.equal(roomFromURL('https://live.douyin.com/?room_id=bad'),null);
  assert.equal(roomMatchesStore({roomId:'999',room:{web_rid:'123'}},new URL('https://live.douyin.com/?room_id=999')),true);
  assert.equal(roomMatchesStore({roomId:'999',room:{web_rid:'123'}},new URL('https://live.douyin.com/999')),false);
});
