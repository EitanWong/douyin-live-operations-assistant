import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {PageRequestSender,RequestBridgeClient} from '../../src/browser/request-sender.js';

function fixture() {
  const dom=new JSDOM('',{url:'https://live.douyin.com/123?anchor_id=456'}), page=dom.window, requests=[];
  page.__STORE__={roomStore:{roomInfo:{roomId:'7698776476925443611',room:{web_rid:'123'}}},userStore:{userInfo:{id_str:'789',user_attr:{is_admin:true}}}};
  const client={defaults:{baseURL:'https://live.douyin.com',withCredentials:true},request:async value=>{requests.push(value);return {data:{status_code:0,data:{}}};}};
  const require=()=>({ZP:client});
  // Same distinguishing literals as the observed request module, with no live network.
  require.m={request:function(){return ['API_DOMAIN','interceptors.request.use','/webcast/privilege/subscribe'];}};
  page.webpackChunkdouyin_live_v2=[];
  page.webpackChunkdouyin_live_v2.push=value=>value[2](require);
  return {dom,page,client,require,requests,sender:new PageRequestSender(page)};
}
test('请求发送区分普通和管理员接口，保留64位房间ID且同一票据不重复发送',async()=>{
  const f=fixture();
  try {
    const chat=f.sender.prepare('chat'); assert.equal(chat.available,true);
    assert.equal((await f.sender.commit(chat.token,'欢迎朋友')).submitted,true);
    assert.equal(f.requests[0].url,'/webcast/room/chat/'); assert.equal(f.requests[0].method,'get'); assert.equal(f.requests[0].params.type,0);
    const admin=f.sender.prepare('admin');
    const first=f.sender.commit(admin.token,'欢迎贵宾'), second=f.sender.commit(admin.token,'不要重复');
    assert.equal(first,second); assert.equal((await first).channelUsed,'admin');
    assert.equal(f.requests.length,2); assert.equal(f.requests[1].url,'/webcast/screen_chat/'); assert.equal(f.requests[1].method,'post');
    assert.equal(f.requests[1].params.room_id,'7698776476925443611'); assert.equal(f.requests[1].params.content,'欢迎贵宾');
    assert.ok(f.requests.every(r=>!r.url.includes('/privilege/screen_chat/send/')));
  } finally {f.dom.window.close();}
});
test('请求能力不确定时不准备发送；账号、房间和管理员权限变更会撤销准备',async()=>{
  const f=fixture();
  try {
    f.client.defaults.baseURL='https://other.example'; assert.equal(f.sender.prepare('chat').available,false);
    f.client.defaults.baseURL='https://live.douyin.com';
    const account=f.sender.prepare('chat'); f.page.__STORE__.userStore.userInfo.id_str='100';
    assert.equal((await f.sender.commit(account.token,'不应发送')).clicked,undefined);
    const admin=f.sender.prepare('admin'); f.page.__STORE__.userStore.userInfo.user_attr.is_admin=false;
    assert.equal((await f.sender.commit(admin.token,'不应发送')).clicked,undefined); assert.equal(f.sender.prepare('admin').available,false);
    const room=f.sender.prepare('chat'); f.page.__STORE__.roomStore.roomInfo.room.web_rid='999';
    assert.equal((await f.sender.commit(room.token,'不应发送')).clicked,undefined); assert.equal(f.requests.length,0);
  } finally {f.dom.window.close();}
});
test('请求拒绝和网络结果未知分开报告，不因异常执行第二次请求',async()=>{
  const f=fixture();
  try {
    let calls=0; f.client.request=async()=>{calls++;throw Error('timeout');};
    const unknown=f.sender.prepare('admin'), result=await f.sender.commit(unknown.token,'欢迎');
    assert.equal(result.clicked,true); assert.equal(result.failed,undefined); assert.match(result.reason,/不自动重发/);
    await f.sender.commit(unknown.token,'欢迎'); assert.equal(calls,1);
    f.client.request=async()=>({data:{status_code:403,data:{prompts:'不可发送'}}});
    const denied=f.sender.prepare('admin'); assert.equal((await f.sender.commit(denied.token,'欢迎')).failed,true);
  } finally {f.dom.window.close();}
});
test('请求桥只接受同页面同房间同请求ID的结果',async()=>{
  const f=fixture();
  try {
    const bridge=new RequestBridgeClient(f.page); let outbound;
    f.page.postMessage=data=>{outbound=data;};
    const pending=bridge.prepare('admin');
    const reply=(changes={},source=f.page)=>f.page.dispatchEvent(new f.page.MessageEvent('message',{source,origin:f.page.location.origin,data:{source:'live-assistant-page-v1',type:'send-api-result',room:'123',id:outbound.id,result:{available:true,token:'ok'},...changes}}));
    reply({room:'other'}); reply({id:'other'}); reply({},null); reply();
    assert.deepEqual(await pending,{available:true,token:'ok'});
  } finally {f.dom.window.close();}
});
