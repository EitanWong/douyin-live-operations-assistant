import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {GiftRequests} from '../../src/browser/gift-requests.js';
import {webLocks} from '../helpers/web-locks.mjs';

const flush=()=>new Promise(setImmediate);
const config={giftId:'463',priceUnits:10,batch:2,target:3,intervalSec:5,budget:3};
function fixture(locks=webLocks()) {
  const dom=new JSDOM('',{url:'https://live.douyin.com/123'}),page=dom.window,calls=[];
  Object.defineProperty(page.navigator,'locks',{value:locks});
  page.__STORE__={roomStore:{roomInfo:{anchor:{id_str:'456'},room:{status:2,room_auth:{Gift:true}}}},giftStore:{}};
  let context={roomId:'7702839019851270938',userId:'789',path:'123'};
  const gift={id:463,name:'小心心',type:1,diamond_count:1,gift_scene:1,is_displayed_on_panel:true};
  const api={Xq:async()=>({data:{status_code:0,data:{pages:[{page_name:'推荐',page_type:1,gifts:[gift]}]}}}),
    sb:async()=>({data:{status_code:0,data:{diamond_x10:500,user_id:'789'}}}),
    hF:async payload=>{calls.push(payload);return {data:{status_code:0,data:{gift_id:463,gift_struct:{diamond_count:1}}}};}};
  const sender={page,context:()=>context,nativeGiftApi:()=>api};
  return {dom,page,api,gift,calls,requests:new GiftRequests(sender),setContext:value=>{context=value;}};
}
test('抽奖只读礼物目录，不依赖钱包或待核对送礼记录，账号变更时拒绝迟到目录',async()=>{
  const f=fixture();try {
    f.api.sb=()=>assert.fail('选择抽奖礼物不读取钱包');
    Object.defineProperty(f.page,'localStorage',{get(){throw Error('无关的送礼存储不可用');}});
    f.page.__STORE__.roomStore.roomInfo.room.room_auth.Gift=false;
    const result=await f.requests.catalog();assert.equal(result.available,true);assert.equal(result.gifts[0].id,'463');
    assert.equal(result.balanceUnits,undefined);assert.equal(f.calls.length,0);
    f.api.Xq=async()=>{f.setContext({roomId:'7702839019851270938',userId:'111',path:'123'});return {data:{status_code:0,data:{gifts:[f.gift]}}};};
    assert.equal((await f.requests.catalog()).available,false);
  }finally{f.dom.window.close();}
});
test('读取礼物及余额，准备绑定礼物/价格/预算，每批和重复桥投递只提交一次',async()=>{
  const f=fixture();try {
    const snapshot=await f.requests.snapshot();assert.equal(snapshot.balanceUnits,500);assert.equal(snapshot.gifts[0].id,'463');
    const p=await f.requests.prepare(config);assert.equal(p.available,true,p.reason);
    const a=f.requests.commit(p.token,2,1);const b=f.requests.commit(p.token,2,1);
    assert.deepEqual(await a,await b);assert.equal((await a).submitted,true);assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].count,2);assert.equal(f.calls[0].to_user_id,'456');assert.equal(f.calls[0].gift_id,'463');
    assert.equal(f.calls[0].price,1);assert.equal(f.calls[0].is_first_combo,true);
    assert.equal(JSON.parse(f.calls[0].extra).total_count,2);assert.equal(f.calls[0].send_scene,1);
    assert.equal((await f.requests.commit(p.token,2,2)).submitted,false,'不能超过目标或预算');
    assert.equal(f.calls.length,1);
  }finally{f.requests.stop();f.dom.window.close();}
});
test('余额读取失败、余额不足、价格变更、锁定与账号切换均在付费请求前停止',async()=>{
  for(const change of [f=>{f.api.sb=async()=>{throw Error('offline');};},f=>{f.api.sb=async()=>({data:{status_code:0,data:{diamond:0}}});},
    f=>{f.gift.diamond_count=2;},f=>{f.gift.gift_preview_info={lock_status:1};},f=>{f.setContext({roomId:'7702839019851270938',userId:'111',path:'123'});}]) {
    const f=fixture();try {const p=await f.requests.prepare(config);assert.equal(p.available,true);change(f);
      assert.equal((await f.requests.commit(p.token,1,1)).submitted,false);assert.equal(f.calls.length,0);
    }finally{f.requests.stop();f.dom.window.close();}
  }
});
test('停止发生在读余额期间不送出；付费请求中停止仍保留账号锁直至结果结算',async()=>{
  const locks=webLocks(),f=fixture(locks),other=fixture(locks);let done;
  try {
    let p=await f.requests.prepare(config);
    f.api.sb=()=>new Promise(resolve=>{done=resolve;});
    const committing=f.requests.commit(p.token,1,1);await flush();f.requests.stop(p.token);
    done({data:{status_code:0,data:{diamond:50}}});assert.equal((await committing).submitted,false);assert.equal(f.calls.length,0);
    f.api.sb=async()=>({data:{status_code:0,data:{diamond:50}}});p=await f.requests.prepare(config);
    f.api.hF=payload=>{f.calls.push(payload);return new Promise(resolve=>{done=resolve;});};
    const inflight=f.requests.commit(p.token,1,1);await flush();f.requests.stop(p.token);
    assert.equal((await other.requests.prepare(config)).available,false);
    done({data:{status_code:0,data:{gift_id:463,gift_struct:{diamond_count:1}}}});assert.equal((await inflight).submitted,true);
    assert.equal((await other.requests.prepare(config)).available,true);
  }finally{f.requests.stop();other.requests.stop();f.dom.window.close();other.dom.window.close();}
});
test('未知付费结果持久保留待核对记录，禁止自动重试；核对后显式解锁',async()=>{
  const f=fixture();try {
    const p=await f.requests.prepare(config);f.api.hF=async()=>{f.calls.push(1);throw Error('lost response');};
    const result=await f.requests.commit(p.token,1,1);assert.equal(result.unknown,true);assert.equal(f.calls.length,1);
    assert.equal((await f.requests.prepare(config)).available,false);
    const snapshot=await f.requests.snapshot();assert.equal(snapshot.pending.giftId,'463');
    const replacement=new GiftRequests({page:f.page,context:()=>({roomId:'7702839019851270938',userId:'789',path:'123'}),nativeGiftApi:()=>f.api});
    assert.equal((await replacement.prepare(config)).available,false,'实例重建仍不能绕过待核对记录');
    assert.equal((await f.requests.acknowledge('wrong')).available,false);
    assert.equal((await f.requests.acknowledge(snapshot.pending.id)).available,true);
    assert.equal((await f.requests.prepare(config)).available,true);
  }finally{f.requests.stop();f.dom.window.close();}
});
test('无法持久记录、余额账号不符或礼物响应畸形时不再发送下一批',async()=>{
  for(const mode of ['storage','account','response']) {
    const f=fixture();try {
      const p=await f.requests.prepare(config);assert.equal(p.available,true);
      if(mode==='storage')Object.defineProperty(f.page,'localStorage',{get(){throw Error('quota');}});
      if(mode==='account')f.api.sb=async()=>({data:{status_code:0,data:{diamond:50,user_id:'111'}}});
      if(mode==='response')f.api.hF=async payload=>{f.calls.push(payload);return {data:{status_code:0,data:{gift_id:789}}};};
      const result=await f.requests.commit(p.token,1,1);assert.equal(result.submitted,false);
      assert.equal(f.calls.length,mode==='response'?1:0);
      assert.equal((await f.requests.commit(p.token,1,2)).submitted,false);assert.equal(f.calls.length,mode==='response'?1:0);
      if(mode==='response')assert.ok((await f.requests.snapshot()).pending);
    }finally{f.requests.stop();f.dom.window.close();}
  }
});
test('开始前拒绝另一个账号或旧场次的界面报价',async()=>{
  const f=fixture();try {
    for(const identity of [{accountId:'111'},{roomId:'999'}]) {
      const prepared=await f.requests.prepare({...config,...identity});assert.equal(prepared.available,false);assert.match(prepared.reason,/账号|场次/);
    }
    assert.equal(f.calls.length,0);
  }finally{f.requests.stop();f.dom.window.close();}
});
test('房间禁止送礼时仍能只读钻石余额，准备发送继续受权限限制',async()=>{
  const f=fixture();try {
    f.page.__STORE__.roomStore.roomInfo.room.room_auth.Gift=false;
    const snapshot=await f.requests.snapshot();assert.equal(snapshot.available,true);assert.equal(snapshot.balanceUnits,500);
    assert.ok(snapshot.gifts.every(gift=>!gift.available));assert.equal((await f.requests.prepare(config)).available,false);assert.equal(f.calls.length,0);
  }finally{f.requests.stop();f.dom.window.close();}
});
