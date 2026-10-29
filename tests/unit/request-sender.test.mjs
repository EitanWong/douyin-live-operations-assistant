import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {PageRequestSender,RequestBridgeClient} from '../../src/browser/request-sender.js';
import {DeliveryTracker} from '../../src/runtime/delivery.js';

function fixture() {
  const dom=new JSDOM('',{url:'https://live.douyin.com/123?anchor_id=456'}), page=dom.window, requests=[], displayed=[];
  page.__STORE__={roomStore:{roomInfo:{roomId:'7698776476925443611',room:{web_rid:'123'}}},userStore:{userInfo:{id_str:'789',user_attr:{is_admin:true}}},singletonStore:{message:{queuePush(message){displayed.push(message);}}}};
  const client={defaults:{baseURL:'https://live.douyin.com',withCredentials:true},request:async value=>{requests.push(value);return {data:{status_code:0,data:{msg_id_str:'7699503115607725858',content:value.params.content,user:{id_str:'789',nickname:'测试账号'},show_identity:1,identity_label:'房管',rtf_content_v2:{text:value.params.content}}}};}};
  const require=()=>({ZP:client});
  // Same distinguishing literals as the observed request module, with no live network.
  require.m={request:function(){return ['API_DOMAIN','interceptors.request.use','/webcast/privilege/subscribe'];}};
  page.webpackChunkdouyin_live_v2=[];
  page.webpackChunkdouyin_live_v2.push=value=>value[2](require);
  return {dom,page,client,require,requests,displayed,sender:new PageRequestSender(page)};
}
test('普通感谢走网页原生本地队列显示一次，本地显示不充当结构化投递回执',async()=>{
  const f=fixture();
  try {
    const tracker=new DeliveryTracker(), delivery=tracker.create('感谢饭饭的热气球',[],{id:'789'});tracker.clicked(delivery);
    const prepared=f.sender.prepare('chat');
    const result=await f.sender.commit(prepared.token,delivery.text);
    await f.sender.commit(prepared.token,delivery.text);
    assert.equal(result.submitted,true);assert.equal(f.requests.length,1);assert.equal(f.displayed.length,1);
    const message=f.displayed[0];
    assert.equal(message.is_mock,true);assert.equal(message.method,'WebcastChatMessage');
    assert.equal(message.msg_id,'7699503115607725858');assert.equal(message.payload.common.msg_id,message.msg_id);
    assert.equal(message.payload.content,delivery.text);assert.equal(message.payload.user.nickname,'测试账号');
    assert.equal(message.identity_label,'房管');assert.equal(message.show_identity,1);
    assert.equal(message.payload.rtf_content_v2.text,delivery.text);
    assert.equal(tracker.observe({...message.payload,type:'chat',text:delivery.text,user:{id:'789'},source:'local'}),null);
    assert.equal(delivery.state,'clicked');
  } finally {f.dom.window.close();}
});
test('缺少网页公屏队列时在请求前回退；服务端拒绝、超时都不插入本地感谢',async()=>{
  const f=fixture();
  try {
    const messages=f.page.__STORE__.singletonStore.message;
    delete f.page.__STORE__.singletonStore.message;
    assert.equal(f.sender.available('chat'),false);assert.equal(f.sender.prepare('chat').available,false);
    assert.equal(f.requests.length,0);
    f.page.__STORE__.singletonStore.message=messages;
    for (const request of [async()=>({data:{status_code:403}}),async()=>{throw Error('timeout');}]) {
      f.client.request=request;const prepared=f.sender.prepare('chat');
      assert.equal((await f.sender.commit(prepared.token,'感谢支持')).submitted,false);
      assert.equal(f.displayed.length,0);
    }
  } finally {f.dom.window.close();}
});
test('平台已接受后本地显示失败保留提交状态，提示问题且不重复请求',async()=>{
  const f=fixture();
  try {
    f.page.__STORE__.singletonStore.message.queuePush=()=>{throw Error('页面重绘');};
    const prepared=f.sender.prepare('chat'), result=await f.sender.commit(prepared.token,'感谢支持');
    assert.equal(result.submitted,true);assert.match(result.displayWarning,/本页公屏更新失败/);
    await f.sender.commit(prepared.token,'感谢支持');assert.equal(f.requests.length,1);
  } finally {f.dom.window.close();}
});
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
test('请求桥忽略页面伪造的成功响应，只消费扩展调用结果',async()=>{
  const f=fixture();let complete,outbound;
  try {
    f.page.postMessage=data=>{outbound=data;};
    const bridge=new RequestBridgeClient(f.page,()=>new Promise(resolve=>{complete=resolve;}));
    const pending=bridge.prepare('admin');
    f.page.dispatchEvent(new f.page.MessageEvent('message',{source:f.page,origin:f.page.location.origin,
      data:{source:'live-assistant-page-v1',type:'send-api-result',room:'123',id:outbound?.id,result:{available:true,token:'forged'}}}));
    complete?.({ok:true,value:{available:true,token:'trusted'}});
    assert.deepEqual(await pending,{available:true,token:'trusted'});
  } finally {f.dom.window.close();}
});

test('扩展上下文失效导致取消同步抛错时，仍等待实际请求结算',async()=>{
  const f=fixture();let cancel,complete,settled=false;
  try {
    f.page.setTimeout=callback=>{cancel=callback;return 1;};
    f.page.clearTimeout=()=>{};
    const bridge=new RequestBridgeClient(f.page,message=>{
      if(message.command.type==='cancel')throw Error('Extension context invalidated');
      return new Promise(resolve=>{complete=resolve;});
    });
    const pending=bridge.commitLike('ticket',1,1).then(result=>{settled=true;return result;});
    assert.doesNotThrow(()=>cancel());
    await Promise.resolve();assert.equal(settled,false);
    complete({ok:true,value:{submitted:true}});
    assert.equal((await pending).submitted,true);
  } finally {f.dom.window.close();}
});

test('管理请求使用原生禁言与拉黑参数，按票据只提交一次并保护主播、管理员和本人',async()=>{
  const f=fixture(), target={id:'9007199254740993123',secUid:'sec-target'};
  try {
    const room=f.page.__STORE__.roomStore.roomInfo.room;
    room.owner={id_str:'456'};room.admin_user_ids_str=['789','888'];
    for(const [action,url,key,sec] of [['mute','/webcast/room/silence/','user_id','sec_user_id'],['ban','/webcast/room/kick/user/','kick_uid','sec_kick_uid']]){
      const prepared=f.sender.prepareModeration(action,target);assert.equal(prepared.available,true);
      const first=f.sender.commitModeration(prepared.token),second=f.sender.commitModeration(prepared.token);
      assert.equal(first,second);assert.equal((await first).submitted,true);
      const request=f.requests.at(-1);assert.equal(request.url,url);assert.equal(request.method,'post');
      assert.equal(request.params[key],target.id);assert.equal(request.params[sec],target.secUid);
      assert.equal(request.params.room_id,'7698776476925443611');
    }
    assert.equal(f.requests.length,2);
    for(const id of ['456','789','888','name:x'])assert.equal(f.sender.prepareModeration('ban',{...target,id}).available,false);
    assert.equal(f.sender.prepareModeration('ban',{id:target.id}).available,false);
    assert.equal(f.sender.prepareModeration('delete',target).available,false);
  }finally{f.dom.window.close();}
});
test('管理提交前重新核对权限、账号和房间；服务端拒绝与未知结果分开，不重试',async()=>{
  for(const mutate of [f=>{f.page.__STORE__.roomStore.roomInfo.room.admin_user_ids_str=[];},f=>{f.page.__STORE__.userStore.userInfo.id_str='10';},f=>{f.page.__STORE__.roomStore.roomInfo.room.web_rid='999';},f=>{f.page.__STORE__.roomStore.roomInfo.room.admin_user_ids_str.push('999');}]){
    const f=fixture();try{
      const room=f.page.__STORE__.roomStore.roomInfo.room;room.owner={id_str:'456'};room.admin_user_ids_str=['789'];
      const p=f.sender.prepareModeration('ban',{id:'999',secUid:'sec-target'});assert.equal(p.available,true);mutate(f);
      assert.equal((await f.sender.commitModeration(p.token)).submitted,false);assert.equal(f.requests.length,0);
    }finally{f.dom.window.close();}
  }
  const f=fixture();try{
    f.page.__STORE__.roomStore.roomInfo.room.owner={id_str:'456'};f.page.__STORE__.roomStore.roomInfo.room.admin_user_ids_str=['789'];
    for(const fail of [false,true]){
      let calls=0;f.client.request=async()=>{calls++;if(fail)throw Error('timeout');return {data:{status_code:403}};};
      const p=f.sender.prepareModeration('mute',{id:'999',secUid:'sec-target'});
      const result=await f.sender.commitModeration(p.token);await f.sender.commitModeration(p.token);
      assert.equal(result.submitted,false);assert.equal(Boolean(result.unknown),fail);assert.equal(calls,1);
    }
  }finally{f.dom.window.close();}
});
