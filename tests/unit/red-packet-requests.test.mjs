import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {PageRequestSender} from '../../src/browser/request-sender.js';
import {webLocks} from '../helpers/web-locks.mjs';

function fixture(){
 const page=new JSDOM('',{url:'https://live.douyin.com/123'}).window;
 Object.defineProperty(page.navigator,'locks',{value:webLocks()});
 page.__STORE__={roomStore:{roomInfo:{roomId:'7705062446398376730',room:{web_rid:'123',status:2},anchor:{id_str:'3804784440654216'}}},userStore:{userInfo:{id_str:'987654321'}}};
 const sender=new PageRequestSender(page),calls=[];
 let balance=1000,response='{"status_code":0,"data":{"succeed":true,"box_id":7705119625705048859}}';
 const meta={box_meta_info:[{box_type:0,tabs:[{tab_type:0,disable_send:false,tab_delay_at_sec:[0,300],tab_box_list:[{same_diamond_box_list:[{id:1009,diamond_count:20,pack_num:15}]}]}]}]};
 sender.client=()=>({request:async options=>{calls.push(options);if(options.method==='get')return {data:{status_code:0,data:meta}};if(response instanceof Error)throw response;return {data:response};}});
 sender.nativeGiftApi=()=>({sb:async()=>({data:{status_code:0,data:{diamond_x10:balance,user_id:'987654321'}}})});
 const packet={metaId:'1009',diamondCount:20,packNum:15,delayTime:300,accountId:'987654321',roomId:'7705062446398376730',anchorId:'3804784440654216',voucher:false};
 return {page,sender,calls,meta,packet,balance:v=>balance=v,response:v=>response=v,close:()=>page.close()};
}
test('余额足够才允许红包，发送前实时核对，经固定原生客户端表单发送并保留64位红包ID',async()=>{
 const f=fixture();try{
  const snapshot=await f.sender.redPacketCatalog();assert.equal(snapshot.available,true,snapshot.reason);assert.equal(snapshot.balanceUnits,1000);
  const result=await f.sender.sendRedPacket({packet:f.packet});assert.equal(result.submitted,true,result.reason);assert.equal(result.boxId,'7705119625705048859');
  const posts=f.calls.filter(row=>row.method==='post');assert.equal(posts.length,1);assert.equal(posts[0].url,'/webcast/luckybox/send/');
  assert.equal(new URLSearchParams(posts[0].data).get('box_meta_id'),'1009');assert.equal(posts[0].responseType,'text');
  assert.equal(f.sender.gifts.pendingRecord(f.sender.gifts.context(false)),null);
 }finally{f.close();}
});
test('余额不足、套餐变价、账号变化或取消均不发送；未知结果留下跨工具待核对记录',async()=>{
 for(const mode of ['balance','price','account','abort','timeout','reject','unsafe']){
  const f=fixture(),controller=new AbortController();try{
   if(mode==='balance')f.balance(100);
   if(mode==='price')f.meta.box_meta_info[0].tabs[0].tab_box_list[0].same_diamond_box_list[0].diamond_count=30;
   if(mode==='account')f.packet.accountId='123';
   if(mode==='abort')controller.abort();
   if(mode==='timeout')f.response(Error('network'));
   if(mode==='reject')f.response('{"status_code":40001,"data":{}}');
   if(mode==='unsafe')f.response({status_code:0,data:{succeed:true,box_id:7705119625705048859}});
   const result=await f.sender.sendRedPacket({packet:f.packet},{signal:controller.signal});assert.equal(result.submitted,false,mode);
   assert.equal(f.calls.filter(row=>row.method==='post').length,['timeout','reject','unsafe'].includes(mode)?1:0,mode);
   if(['timeout','unsafe'].includes(mode)){
    assert.equal(result.unknown,true);assert.ok(f.sender.gifts.pendingRecord(f.sender.gifts.context(false)));
    assert.equal((await f.sender.sendRedPacket({packet:f.packet})).submitted,false);assert.equal(f.calls.filter(row=>row.method==='post').length,1);
   }
  }finally{f.close();}
 }
});
test('缓存恢复允许重新读取并发放，但缓存前尚在核价的红包不会继续发送',async()=>{
 const f=fixture();let resume;
 try{
  const request=f.sender.client().request,gate=new Promise(resolve=>{resume=resolve;});let paused=true;
  f.sender.client=()=>({request:async options=>{const response=await request(options);if(options.method==='get' && paused)await gate;return response;}});
  const pending=f.sender.sendRedPacket({packet:f.packet});
  while(!f.calls.length)await new Promise(resolve=>setImmediate(resolve));
  f.page.dispatchEvent(new f.page.PageTransitionEvent('pagehide',{persisted:true}));
  assert.equal((await f.sender.redPacketCatalog()).available,false);
  f.page.dispatchEvent(new f.page.PageTransitionEvent('pageshow',{persisted:true}));
  paused=false;resume();
  assert.equal((await pending).submitted,false);
  assert.equal(f.calls.filter(row=>row.method==='post').length,0);
  const catalog=await f.sender.redPacketCatalog();assert.equal(catalog.available,true,catalog.reason);
  const sent=await f.sender.sendRedPacket({packet:f.packet});assert.equal(sent.submitted,true,sent.reason);
  assert.equal(f.calls.filter(row=>row.method==='post').length,1);
 }finally{resume?.();f.close();}
});
