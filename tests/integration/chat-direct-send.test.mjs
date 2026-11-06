import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {DouyinAdapter} from '../../src/browser/adapter.js';
import {PageRequestSender,RequestBridgeClient} from '../../src/browser/request-sender.js';
import {copy,DEFAULTS,Engine,mergeConfig} from '../../src/core/engine.js';

function fixture() {
  const dom=new JSDOM('<div id="chatInput"><textarea placeholder="与大家互动一下"></textarea><button>发送</button></div>',{url:'https://live.douyin.com/123'});
  const page=dom.window,requests=[];
  const previousDocument=globalThis.document,previousStyle=globalThis.getComputedStyle;
  globalThis.document=page.document;globalThis.getComputedStyle=page.getComputedStyle.bind(page);
  for(const element of page.document.querySelectorAll('*'))element.getClientRects=()=>[{width:100,height:30}];
  page.__STORE__={roomStore:{roomInfo:{roomId:'7698776476925443611',room:{web_rid:'123'}}},userStore:{userInfo:{id_str:'789',user_attr:{is_admin:true}}}};
  const client={defaults:{baseURL:page.location.origin,withCredentials:true},request:async request=>{requests.push(request);return {data:{status_code:0,data:{}}};}};
  const require=()=>({ZP:client});
  require.m={request:function(){return ['API_DOMAIN','interceptors.request.use','/webcast/privilege/subscribe'];}};
  page.webpackChunkdouyin_live_v2=[];page.webpackChunkdouyin_live_v2.push=value=>value[2](require);
  const adapter=new DouyinAdapter({page,getConfig:()=>copy(DEFAULTS),onEvent(){},onLog(){},onStatus(){}});
  adapter.status.connected=true;
  let edits=0,clicks=0;
  const input=page.document.querySelector('textarea');
  input.addEventListener('input',()=>edits++);page.document.querySelector('button').addEventListener('click',()=>{clicks++;input.value='';});
  // Follow the same isolated -> worker -> MAIN request boundary as the extension.
  const sender=new PageRequestSender(page);
  adapter.requestSender=new RequestBridgeClient(page,async message=>{
    const command=message.command;
    if(command.type==='cancel')return {ok:true,value:true};
    const value=command.operation==='prepare'?sender.prepare(command.channel):await sender.commit(command.token,command.text,command.mentions);
    return {ok:true,value};
  });
  return {page,adapter,sender,client,requests,input,activity:()=>({edits,clicks}),close:()=>{
    globalThis.document=previousDocument;globalThis.getComputedStyle=previousStyle;page.close();
  }};
}

test('扩展普通弹幕在网页本地公屏队列缺失时仍直接请求，不写入或聚焦编辑器',async()=>{
  const f=fixture();
  try {
    assert.equal(f.sender.available('chat'),true);
    const focus=f.page.document.activeElement;
    const result=await f.adapter.send('谢谢支持',()=>true);
    assert.equal(result.submitted,true);assert.equal(result.transport,'request');
    assert.match(result.displayWarning,/公屏更新失败/);
    assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'/webcast/room/chat/');
    assert.equal(f.requests[0].params.content,'谢谢支持');
    assert.equal(f.input.value,'');assert.equal(f.page.document.activeElement,focus);
    assert.deepEqual(f.activity(),{edits:0,clicks:0});
  } finally {f.close();}
});

test('直接请求暂不可用时保留队列重试，普通和管理员弹幕都不回退编辑器',async()=>{
  for(const channel of ['chat','admin']) {
    const f=fixture();
    try {
      delete f.page.webpackChunkdouyin_live_v2;
      await assert.rejects(f.adapter.send('等待恢复',()=>true,{channel}),error=>error.retryable===true && /直接发送/.test(error.message));
      assert.equal(f.input.value,'');assert.equal(f.requests.length,0);
      assert.deepEqual(f.activity(),{edits:0,clicks:0});
    } finally {f.close();}
  }
});

test('管理员权限不可用时改用普通直接请求，保留人工草稿和暂停检查',async()=>{
  const f=fixture();
  try {
    f.page.__STORE__.userStore.userInfo.user_attr.is_admin=false;
    f.input.value='人工草稿';
    await assert.rejects(f.adapter.send('欢迎朋友',()=>true,{channel:'admin'}),/人工|手动草稿/);
    assert.equal(f.input.value,'人工草稿');assert.equal(f.requests.length,0);
    f.input.value='';let active=true;
    assert.equal((await f.adapter.send('欢迎朋友',()=>active,{beforeClick:async()=>{active=false;}})).submitted,false);
    const result=await f.adapter.send('欢迎朋友',()=>true,{channel:'admin'});
    assert.equal(result.submitted,true);assert.equal(result.channelUsed,'chat');assert.match(result.modeFallback,/管理员/);
    assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'/webcast/room/chat/');
    assert.deepEqual(f.activity(),{edits:0,clicks:0});
  } finally {f.close();}
});

test('直接请求结果未知时只提交一次，不回退编辑器重发',async()=>{
  const f=fixture();let calls=0;
  try {
    f.client.request=async()=>{calls++;throw Error('timeout');};
    const result=await f.adapter.send('谢谢支持',()=>true);
    assert.equal(result.submitted,false);assert.equal(result.clicked,true);assert.match(result.reason,/不自动重发/);
    assert.equal(calls,1);assert.equal(f.input.value,'');assert.deepEqual(f.activity(),{edits:0,clicks:0});
  } finally {f.close();}
});

test('请求能力恢复后原发送队列自动继续，同一条弹幕仅直接提交一次',async()=>{
  const f=fixture();let now=1800000000000;
  const chunks=f.page.webpackChunkdouyin_live_v2;
  const engine=new Engine({config:mergeConfig({selfId:'789'}),now:()=>now,send:f.adapter.send.bind(f.adapter)});
  try {
    delete f.page.webpackChunkdouyin_live_v2;
    engine.start();engine.enqueue('gift','谢谢支持');await engine.tick();
    assert.equal(engine.running,true);assert.equal(engine.queue.length,1);assert.equal(f.requests.length,0);
    assert.equal(f.input.value,'');assert.deepEqual(f.activity(),{edits:0,clicks:0});
    f.page.webpackChunkdouyin_live_v2=chunks;now+=30000;await engine.tick();
    assert.equal(engine.queue.length,0);assert.equal(f.requests.length,1);assert.equal(engine.stats.submitted,1);
    now+=30000;await engine.tick();assert.equal(f.requests.length,1);
    assert.deepEqual(f.activity(),{edits:0,clicks:0});
  } finally {engine.stop();f.close();}
});

test('提交前异步保存期间新增人工草稿时不发送、不覆盖内容或焦点',async()=>{
  const f=fixture();
  try {
    await assert.rejects(f.adapter.send('谢谢支持',()=>true,{beforeClick:async()=>{
      f.input.value='保存期间输入的草稿';f.input.focus();
    }}),/手动草稿/);
    assert.equal(f.requests.length,0);assert.equal(f.input.value,'保存期间输入的草稿');
    assert.equal(f.page.document.activeElement,f.input);assert.deepEqual(f.activity(),{edits:0,clicks:0});
  } finally {f.close();}
});
