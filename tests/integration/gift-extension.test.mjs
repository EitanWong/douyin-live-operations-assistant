import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {JSDOM} from 'jsdom';
import {RequestBridgeClient} from '../../src/browser/request-sender.js';
import {buildFixture} from '../helpers/build.mjs';
import {webLocks} from '../helpers/web-locks.mjs';

const {dist,cleanup}=await buildFixture();after(cleanup);
const source=await readFile(join(dist,'chrome-extension/page.js'),'utf8');
const roomId='7702839019851270938',anchorId='3804784440654216';
function fixture({metadata=false,duplicate=false,redPacket=false}={}) {
  const page=new JSDOM('<body></body>',{url:'https://live.douyin.com/361690799431',runScripts:'outside-only'}).window,calls=[];
  Object.assign(page,{TextDecoder,TextEncoder});Object.defineProperty(page.navigator,'locks',{value:webLocks()});
  page.__STORE__={roomStore:{roomInfo:{roomId,anchor:{id_str:anchorId},room:{web_rid:'361690799431',status:2,room_auth:{Gift:true}}}},userStore:{userInfo:{id_str:'987654321'}}};
  const raw=[{id:463,name:'小心心',diamond_count:1,type:1},{id:3773,name:'热气球',diamond_count:520,type:13},{id:789,name:'嘉年华',diamond_count:30000,type:2},{id:685,name:'粉丝团灯牌',diamond_count:1,type:4}]
    .map(gift=>({...gift,gift_scene:1,is_displayed_on_panel:true,req_extra_type:3}));
  const api={Xq:async()=>({data:{status_code:0,data:{pages:[{page_type:1,page_name:'推荐',display:true,gifts:raw}]}}}),
    sb:async()=>({data:{status_code:0,data:{diamond_x10:1000000,user_id:'987654321'}}}),
    hF:async(payload,options)=>{calls.push({payload,options});return {data:{status_code:0,data:{gift_id:payload.gift_id,gift_struct:{diamond_count:payload.price}}}};}};
  const packetCalls=[];
  const client={defaults:{baseURL:page.location.origin,withCredentials:true},request:async options=>{
    if(!redPacket)assert.fail('普通送礼必须使用原生礼物API');
    packetCalls.push(options);
    if(options.url==='/webcast/luckybox/box/new_meta/')return {data:{status_code:0,data:{box_meta_info:[{box_type:0,tabs:[{tab_type:0,disable_send:false,tab_delay_at_sec:[0,300],tab_box_list:[{same_diamond_box_list:[{id:1009,diamond_count:20,pack_num:15}]}]}]}]}}};
    assert.equal(options.url,'/webcast/luckybox/send/');assert.equal(options.method,'post');
    return {data:'{"status_code":0,"data":{"succeed":true,"box_id":7705119625705048859}}'};
  }};
  const require=id=>id==='metadata'?{k8:{}}:id==='gift' || id==='duplicate'?api:{ZP:client};
  require.m={client:function(){return ['API_DOMAIN','interceptors.request.use','/webcast/privilege/subscribe'];},
    gift:function(){return ['/webcast/gift/list/','/webcast/gift/send/','/webcast/wallet/info/'];}};
  // The live page's error-reporting table also contains all three endpoint
  // literals. Endpoint matches alone do not identify the native gift API.
  if(metadata)require.m.metadata=function(){return {k8:{'/webcast/gift/list/':{},'/webcast/gift/send/':{},'/webcast/wallet/info/':{}}};};
  if(duplicate)require.m.duplicate=require.m.gift;
  page.webpackChunkdouyin_live_v2=[];page.webpackChunkdouyin_live_v2.push=value=>value[2](require);page.eval(source);
  const send=async request=>({ok:true,value:await page.__douyinAssistantPageV2.call(request.command)});
  return {page,api,raw,calls,packetCalls,send,bridge:new RequestBridgeClient(page,send),close:()=>page.close()};
}
test('正式MAIN红包桥读取实时套餐与余额，经固定端点发放并返回精度安全ID',async()=>{
 const f=fixture({redPacket:true});try{
  const snapshot=await f.bridge.redPacketCatalog();assert.equal(snapshot.available,true,snapshot.reason);
  const selected=snapshot.packages[0],packet={...selected,delayTime:300,accountId:snapshot.accountId,roomId:snapshot.roomId,anchorId:snapshot.anchorId,voucher:false};
  const sent=await f.bridge.sendRedPacket({packet});assert.equal(sent.submitted,true,sent.reason);assert.equal(sent.boxId,'7705119625705048859');
  assert.equal(f.packetCalls.filter(row=>row.method==='post').length,1);assert.equal(f.calls.length,0);
 }finally{f.close();}
});
test('正式 MAIN 桥区分含相同接口路径的错误元数据表，正确读取余额且不送礼',async()=>{
  const f=fixture({metadata:true});try {
    const result=await f.bridge.giftSnapshot();
    assert.equal(result.available,true,result.reason);assert.equal(result.balanceUnits,1000000);
    assert.equal(result.gifts.length,4);assert.equal(f.calls.length,0);
  }finally{f.close();}
});
test('正式 MAIN 桥的钱包自动查询仅返回当前账号余额，不加载目录或送礼',async()=>{
  const f=fixture({metadata:true});try {
    f.api.Xq=()=>assert.fail('余额刷新不能加载目录');
    const result=await f.bridge.giftBalance();
    assert.equal(result.available,true,result.reason);assert.equal(result.balanceUnits,1000000);
    assert.equal(result.accountId,'987654321');assert.equal(result.roomId,roomId);
    assert.equal(result.gifts,undefined);assert.equal(f.calls.length,0);
    f.api.sb=async()=>({data:{status_code:0,data:{diamond_x10:0,user_id:'987654321'}}});
    assert.equal((await f.bridge.giftBalance()).balanceUnits,0);
  }finally{f.close();}
});
test('存在多个符合导出契约的礼物模块时仍拒绝选择，不能任意启用付费流程',async()=>{
  const f=fixture({metadata:true,duplicate:true});try {
    assert.equal((await f.bridge.giftSnapshot()).available,false);assert.equal(f.calls.length,0);
  }finally{f.close();}
});
test('正式 MAIN 构建发现原生礼物模块，多种礼物共用受限流程并读取十分之一钻余额',async()=>{
  const f=fixture();try {
    const snapshot=await f.bridge.giftSnapshot();assert.equal(snapshot.available,true,snapshot.reason);assert.equal(snapshot.gifts.length,4);assert.equal(snapshot.balanceUnits,1000000);
    for(const gift of snapshot.gifts) {
      const prepared=await f.bridge.prepareGift({giftId:gift.id,priceUnits:gift.priceUnits,batch:1,target:1,intervalSec:5,budget:gift.priceUnits/10});
      assert.equal(prepared.available,true,prepared.reason);
      const results=await Promise.all([f.bridge.commitGift(prepared.token,1,1),f.bridge.commitGift(prepared.token,1,1)]);
      assert.ok(results.every(result=>result.submitted));await f.bridge.stopGift(prepared.token);
    }
    assert.equal(f.calls.length,4);assert.deepEqual(f.calls.map(call=>call.payload.gift_id),['463','3773','789','685']);
    assert.ok(f.calls.every(call=>call.options.ignoreToast && call.payload.to_user_id===anchorId && call.payload.room_id===roomId));
    const invalid=await f.send({command:{type:'send-api',id:'arbitrary-url',operation:'fetch',token:'token',url:'https://example.test/'}});
    assert.equal(invalid.value.submitted,false);assert.equal(f.calls.length,4);
  }finally{f.close();}
});
test('正式 MAIN 桥仅读取抽奖礼物目录，不调用钱包或付费接口',async()=>{
  const f=fixture();try {
    f.api.sb=()=>assert.fail('抽奖目录不读钱包');
    const result=await f.bridge.giftCatalog();assert.equal(result.available,true,result.reason);
    assert.equal(result.gifts.length,4);assert.equal(result.balanceUnits,undefined);assert.equal(f.calls.length,0);
  }finally{f.close();}
});
test('正式 MAIN 桥在礼物模块未加载时可经原生请求客户端读取目录',async()=>{
  const f=fixture(),reads=[];try {
    delete f.api.hF;
    const client={defaults:{baseURL:f.page.location.origin,withCredentials:true},request:async options=>{reads.push(options);return {data:{status_code:0,data:{gifts:f.raw}}};}};
    const require=id=>({ZP:client});
    require.m={client:function(){return ['API_DOMAIN','interceptors.request.use','/webcast/privilege/subscribe'];}};
    f.page.webpackChunkdouyin_live_v2=[];f.page.webpackChunkdouyin_live_v2.push=value=>value[2](require);
    const result=await f.bridge.giftCatalog();assert.equal(result.available,true,result.reason);assert.equal(result.gifts.length,4);
    assert.equal(reads.length,1);assert.equal(reads[0].url,'/webcast/gift/list/');assert.equal(reads[0].method,'get');assert.equal(f.calls.length,0);
  }finally{f.close();}
});
test('原生模块尚未加载时解释加载步骤，取消迟到准备会回收账号锁且不触发付费',async()=>{
  const f=fixture();let release;try {
    const original=f.api.Xq;f.api.Xq=()=>new Promise(resolve=>{release=()=>resolve(original());});
    const controller=new AbortController();const pending=f.bridge.prepareGift({giftId:'463',priceUnits:10,batch:1,target:1,intervalSec:5,budget:1},{signal:controller.signal});
    for(let i=0;i<100 && !release;i++)await new Promise(resolve=>setTimeout(resolve,1));
    assert.equal(typeof release,'function');controller.abort();release();assert.equal((await pending).available,false);assert.equal(f.calls.length,0);
    f.api.Xq=original;
    const prepared=await f.bridge.prepareGift({giftId:'463',priceUnits:10,batch:1,target:1,intervalSec:5,budget:1});assert.equal(prepared.available,true,prepared.reason);
    await f.bridge.stopGift(prepared.token);
    delete f.api.hF;const snapshot=await f.bridge.giftSnapshot();assert.equal(snapshot.available,false);assert.match(snapshot.reason,/礼物面板/);
  }finally{f.close();}
});
