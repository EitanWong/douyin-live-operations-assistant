import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IdentityReader, identityFromResponse, identityUser, parseIdentityJSON, roomAdminStatus } from '../../src/browser/identity.js';

test('身份解析保留64位ID且不改写昵称里的数字', () => {
  const data = parseIdentityJSON('{"id":9876543210987654321,"nickname":"abc :9876543210987654321}"}');
  assert.equal(data.id,'9876543210987654321'); assert.equal(data.nickname,'abc :9876543210987654321}');
  assert.equal(identityUser({id:9876543210987654321}),null);
  assert.equal(identityUser({id:1,nickname:'主播'}).id,'1');
});
test('主播资料必须属于当前房间；不从观众列表猜身份', () => {
  assert.deepEqual(identityFromResponse('anchor',{data:{data:[{web_rid:'2',owner:{id_str:'99'}}]}},'1'),{});
  assert.equal(identityFromResponse('anchor',{data:{data:[{web_rid:'1',owner:{id_str:'99',nickname:'主播'}}]}},'1').anchor.id,'99');
  const reader = new IdentityReader({page:{SSR_RENDER_DATA:{users:[{id_str:'123'}]}},room:'1'}); reader.readInitial(); assert.deepEqual(reader.value,{});
});
test('只有当前房间明确提供 admin_user_ids 时才返回可核验名单', () => {
  const response = ids => identityFromResponse('anchor', { data:{ data:[{ web_rid:'1', owner:{ id_str:'99', nickname:'主播' }, admin_user_ids:ids }] } }, '1');
  assert.deepEqual(response(['123', 456]).adminUserIds, ['123', '456']);
  assert.deepEqual(response([]).adminUserIds, []);
  assert.equal(response(undefined).adminUserIds, null);
  assert.equal(response(['not-an-id']).adminUserIds, null);
  const missingRoom = identityFromResponse('anchor', { data:{ data:[{ owner:{ id_str:'99' }, admin_user_ids:['123'] }] } }, '1');
  assert.equal(missingRoom.adminUserIds, null);
  assert.equal(roomAdminStatus({ id:'123' }, ['123']), true);
  assert.equal(roomAdminStatus({ id:'124' }, ['123']), false);
  assert.equal(roomAdminStatus({ id:'123' }, null), null);
  assert.equal(roomAdminStatus(null, ['123']), null);
});
test('并发识别合并，成功未登录清除旧账号，失败保留并提示', async () => {
  let calls=0, failed=false;
  const page={AbortController,setTimeout,clearTimeout,fetch:async(path,options)=>{
    calls++; assert.equal(options.credentials,'same-origin');
    await new Promise(r=>setTimeout(r,10));
    return {ok:true,text:async()=>JSON.stringify(path.includes('user/me')?(failed?{status_code:9}:{status_code:0,data:{}}):{data:{data:[{web_rid:'1',owner:{id_str:'99'}}]}})};
  }};
  const reader=new IdentityReader({page,room:'1'}); reader.value.self={id:'88'};
  await Promise.all([reader.refresh(),reader.refresh()]); assert.equal(calls,2); assert.equal(reader.value.self,null);
  reader.value.self={id:'77'}; failed=true; await reader.refresh(); assert.equal(reader.value.self.id,'77'); assert.match(reader.value.warning,/部分资料/); reader.close();
});
test('关闭识别取消请求且不发布晚到资料', async () => {
  let published=0;
  const page={AbortController,setTimeout,clearTimeout,fetch:(_,o)=>new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(new Error('aborted'))))};
  const reader=new IdentityReader({page,room:'1',onIdentity:()=>published++}); const task=reader.refresh(); reader.close(); await task;
  assert.equal(published,0); assert.equal(reader.controllers.size,0);
});
