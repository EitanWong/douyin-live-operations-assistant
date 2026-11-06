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
    const value=command.operation==='prepare'?sender.prepare(command.channel):command.operation==='release'?sender.release(command.token):await sender.commit(command.token,command.text,command.mentions);
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

test('多次复查仍无请求能力才回退网页，下一条重新优先直接请求',async()=>{
  for(const channel of ['chat','admin']) {
    const f=fixture();
    try {
      const chunks=f.page.webpackChunkdouyin_live_v2;
      delete f.page.webpackChunkdouyin_live_v2;
      let prepares=0;const prepare=f.sender.prepare.bind(f.sender);
      f.sender.prepare=channel=>{prepares++;return prepare(channel);};
      const result=await f.adapter.send('网页回退',()=>true,{channel});
      assert.equal(result.submitted,true);assert.ok(prepares>=5);
      assert.equal(f.input.value,'');assert.equal(f.requests.length,0);
      assert.equal(f.activity().clicks,1);
      f.page.webpackChunkdouyin_live_v2=chunks;
      assert.equal((await f.adapter.send('恢复直接请求',()=>true,{channel})).transport,'request');
      assert.equal(f.requests.length,1);assert.equal(f.activity().clicks,1);
    } finally {f.close();}
  }
});

test('前两次请求准备不可用时继续复查，恢复后直接发送且不触碰输入框',async()=>{
  const f=fixture();let prepares=0;
  try {
    const prepare=f.sender.prepare.bind(f.sender);
    f.sender.prepare=channel=>++prepares<3?{available:false}:prepare(channel);
    const result=await f.adapter.send('恢复直发',()=>true);
    assert.equal(result.transport,'request');assert.equal(prepares,3);assert.equal(f.requests.length,1);
    assert.equal(f.input.value,'');assert.deepEqual(f.activity(),{edits:0,clicks:0});
  } finally {f.close();}
});

test('回退准备和网页点击前仍复查请求，能力恢复即切回请求发送',async()=>{
  for(const recoveredAt of [4,5,6]) {
    const f=fixture();let prepares=0,checkpoints=0;
    try {
      const prepare=f.sender.prepare.bind(f.sender);
      f.sender.prepare=channel=>++prepares<recoveredAt?{available:false}:prepare(channel);
      const result=await f.adapter.send('优先直接请求',()=>true,{beforeClick:async()=>{checkpoints++;}});
      assert.equal(result.transport,'request');assert.equal(prepares,recoveredAt);assert.equal(checkpoints,1);
      assert.equal(f.requests.length,1);assert.equal(f.input.value,'');assert.equal(f.activity().clicks,0);
      if(recoveredAt===4)assert.equal(f.activity().edits,0);
    } finally {f.close();}
  }
});

test('异步保存后等待网页控件恢复期间请求已可用，点击前仍切回请求',async()=>{
  const f=fixture();let ready=false,timer;
  try {
    const prepare=f.sender.prepare.bind(f.sender),button=f.page.document.querySelector('button');
    f.sender.prepare=channel=>ready?prepare(channel):{available:false};
    const result=await f.adapter.send('最后确认直接请求',()=>true,{beforeClick:async()=>{
      button.disabled=true;
      timer=f.page.setTimeout(()=>{ready=true;button.disabled=false;},100);
    }});
    assert.equal(result.transport,'request');assert.equal(f.requests.length,1);
    assert.equal(f.input.value,'');assert.equal(f.activity().clicks,0);
  } finally {f.page.clearTimeout(timer);f.close();}
});

test('最后一次请求复查期间人工改写网页草稿时不点击或清除人工内容',async()=>{
  const f=fixture();let prepares=0;
  try {
    f.sender.prepare=()=>{
      if(++prepares===6)f.input.value='人工正在编辑';
      return {available:false};
    };
    await assert.rejects(f.adapter.send('自动候选',()=>true),/不一致|变更/);
    assert.equal(f.input.value,'人工正在编辑');assert.equal(f.requests.length,0);assert.equal(f.activity().clicks,0);
  } finally {f.close();}
});

test('反复准备请求期间暂停或断线时停止检查，不执行网页回退',async()=>{
  for(const reason of ['pause','disconnect']) {
    const f=fixture();let active=true,prepares=0;
    try {
      f.sender.prepare=()=>{prepares++;if(reason==='pause')active=false;else f.adapter.status.connected=false;return {available:false};};
      assert.equal((await f.adapter.send('取消发送',()=>active)).submitted,false);
      assert.equal(prepares,1);assert.equal(f.requests.length,0);assert.deepEqual(f.activity(),{edits:0,clicks:0});
    } finally {f.close();}
  }
});

test('网页填入后复查请求期间暂停或断线，清理本条草稿且恢复后仍直接请求',async()=>{
  for(const [cancelAt,reason] of [[5,'pause'],[6,'disconnect']]) {
    const f=fixture();let active=true,prepares=0;
    try {
      const prepare=f.sender.prepare.bind(f.sender);
      f.sender.prepare=()=>{
        if(++prepares===cancelAt) {
          if(reason==='pause')active=false;else f.adapter.status.connected=false;
        }
        return {available:false};
      };
      assert.equal((await f.adapter.send('取消网页回退',()=>active)).submitted,false);
      assert.equal(f.input.value,'');assert.equal(f.requests.length,0);assert.equal(f.activity().clicks,0);
      active=true;f.adapter.status.connected=true;f.sender.prepare=prepare;
      assert.equal((await f.adapter.send('恢复直接请求',()=>active)).transport,'request');
      assert.equal(f.requests.length,1);assert.equal(f.activity().clicks,0);
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

test('发送准备后被草稿、暂停或保存失败拦下时释放票据，重复取消不耗尽直发容量',async()=>{
  const f=fixture();
  try {
    const prepare=f.sender.prepare.bind(f.sender);
    for(let i=0;i<132;i++) {
      f.sender.prepare=channel=>{
        const result=prepare(channel);
        assert.equal(result.available,true,`第${i+1}次取消不应占满容量`);
        return result;
      };
      if(i%3===0) {
        f.input.value='人工草稿';
        await assert.rejects(f.adapter.send('自动候选',()=>true),/手动草稿/);
        f.input.value='';
      } else if(i%3===1) {
        let active=true;
        f.sender.prepare=channel=>{const result=prepare(channel);active=false;return result;};
        assert.equal((await f.adapter.send('自动候选',()=>active)).submitted,false);
      } else await assert.rejects(f.adapter.send('自动候选',()=>true,{beforeClick:async()=>{throw Error('保存失败');}}),/保存失败/);
      assert.equal(f.sender.tickets.size,0);
    }
    f.sender.prepare=prepare;
    assert.equal((await f.adapter.send('恢复正常直发',()=>true)).transport,'request');
    assert.equal(f.requests.length,1);assert.deepEqual(f.activity(),{edits:0,clicks:0});
  } finally {f.close();}
});

test('网页按钮一直不可用时仍探测请求恢复并直发，不必等待按钮启用',async()=>{
  const f=fixture();let ready=false,timer,checkpoints=0;
  try {
    const prepare=f.sender.prepare.bind(f.sender),button=f.page.document.querySelector('button');
    f.sender.prepare=channel=>ready?prepare(channel):{available:false};
    f.input.addEventListener('input',()=>{
      if(!f.input.value)return;
      button.disabled=true;
      timer=f.page.setTimeout(()=>{ready=true;},150);
    });
    const result=await f.adapter.send('按钮等待中切回请求',()=>true,{beforeClick:async()=>{checkpoints++;}});
    assert.equal(result.transport,'request');assert.equal(button.disabled,true);
    assert.equal(f.requests.length,1);assert.equal(f.input.value,'');assert.equal(f.activity().clicks,0);assert.equal(checkpoints,1);
  } finally {f.page.clearTimeout(timer);f.close();}
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

test('请求与网页回退都不可用时保留队列，请求恢复后原消息仅提交一次',async()=>{
  const f=fixture();let now=1800000000000;
  const chunks=f.page.webpackChunkdouyin_live_v2;
  const engine=new Engine({config:mergeConfig({selfId:'789'}),now:()=>now,send:f.adapter.send.bind(f.adapter)});
  try {
    delete f.page.webpackChunkdouyin_live_v2;
    f.input.remove();f.page.document.querySelector('button').remove();
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

test('保存发送意图后被人工草稿拦下仍保留原消息，清空草稿后只直发一次',async()=>{
  const f=fixture();let now=1800000000000,blocked=true;
  const engine=new Engine({config:mergeConfig({selfId:'789'}),now:()=>now,send:f.adapter.send.bind(f.adapter),checkpoint:async()=>{
    if(blocked && engine.deliveries.records.at(-1)?.state==='clicked')f.input.value='保存期间的人工草稿';
  }});
  try {
    engine.start();engine.enqueue('gift','谢谢支持');await engine.tick();
    assert.equal(f.requests.length,0);assert.equal(f.input.value,'保存期间的人工草稿');
    assert.equal(engine.queue.length,1);assert.equal(engine.deliveries.records.at(-1).state,'cancelled');
    blocked=false;f.input.value='';now+=30000;await engine.tick();
    assert.equal(engine.queue.length,0);assert.equal(f.requests.length,1);
    now+=30000;await engine.tick();assert.equal(f.requests.length,1);assert.equal(f.activity().clicks,0);
  } finally {engine.stop();f.close();}
});

test('请求提交开始后桥接抛错仍标记未知，不把原消息当成未提交重发',async()=>{
  const f=fixture();let now=1800000000000,commits=0;
  const engine=new Engine({config:mergeConfig({selfId:'789'}),now:()=>now,send:f.adapter.send.bind(f.adapter)});
  try {
    f.adapter.requestSender.commit=async()=>{commits++;throw Error('提交后桥接响应丢失');};
    engine.start();engine.enqueue('gift','谢谢支持');await engine.tick();
    assert.equal(commits,1);assert.equal(engine.queue.length,0);assert.equal(engine.deliveries.records.at(-1).state,'unknown');
    now+=30000;await engine.tick();assert.equal(commits,1);assert.equal(f.activity().clicks,0);
  } finally {engine.stop();f.close();}
});
