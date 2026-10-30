import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {JSDOM} from 'jsdom';
import {RequestBridgeClient} from '../../src/browser/request-sender.js';
import {buildFixture} from '../helpers/build.mjs';

const {dist,cleanup}=await buildFixture();after(cleanup);
const source=await readFile(join(dist,'chrome-extension/page.js'),'utf8');
const roomId='7702463172476701483',lotteryId='7702521633959316287',anchorId='4007055676415213';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture() {
  const page=new JSDOM('<body></body>',{url:'https://live.douyin.com/260440030123',runScripts:'outside-only'}).window;
  const requests=[],now=Math.floor(Date.now()/1000);
  const current={lottery_id_str:lotteryId,room_id_str:roomId,status:1,draw_time:now+120};
  const qualification={data:{status_code:0,data:{hit_black_list:false,user_customized_condition:[],server_participate_biz_data:'',
    lottery_info:{...current,current_time:now,owner_type:1,anchor_id:anchorId,owner_user_id:anchorId,
      conditions:[{type:8,need_diamond_count:1,min_fans_level:0},{type:3,need_diamond_count:0,content:'开心最美唱歌最好听'},{type:6,need_diamond_count:0}]},
    user_condition:{is_watching:true,is_fansclub_member:true,fansclub_status_active:true,fans_level:6,has_command:false,has_activated:false}}}};
  Object.assign(page,{TextDecoder,TextEncoder});
  page.__STORE__={roomStore:{roomInfo:{roomId,anchor:{id_str:anchorId},room:{web_rid:'260440030123',status:2}}},
    userStore:{userInfo:{id_str:'987654321'}},lotteryStore:{currentLottery:current}};
  let respond=request=>request.url.includes('check_user_right')?qualification:{data:{status_code:0,data:{}}};
  const client={defaults:{baseURL:page.location.origin,withCredentials:true},request:async request=>{requests.push(request);return respond(request);}};
  const require=()=>({ZP:client});
  require.m={request:function(){return ['API_DOMAIN','interceptors.request.use','/webcast/privilege/subscribe'];}};
  page.webpackChunkdouyin_live_v2=[];page.webpackChunkdouyin_live_v2.push=value=>value[2](require);
  page.eval(source);
  const send=async request=>({ok:true,value:await page.__douyinAssistantPageV2.call(request.command)});
  return {page,requests,qualification,bridge:new RequestBridgeClient(page,send),send,respond:value=>{respond=value;},close:()=>page.close()};
}

test('构建后的 MAIN 福袋桥按资格、条件、口令顺序提交，重复票据不重发，网页消息不能指定请求',async()=>{
  const f=fixture();try {
    const prepared=await f.bridge.prepareLottery(lotteryId,{allowPassword:true});assert.equal(prepared.available,true);
    const results=await Promise.all([f.bridge.commitLottery(prepared.token),f.bridge.commitLottery(prepared.token)]);
    assert.ok(results.every(row=>row.submitted===true));assert.ok(results.every(row=>row.confirmed===undefined));
    assert.deepEqual(f.requests.map(row=>[row.method,row.url]),[
      ['get','/webcast/lottery/melon/check_user_right/'],['post','/webcast/lottery/melon/update_user_condition/'],['get',`/webcast/room/special_chat/${roomId}/`]
    ]);
    assert.equal(f.requests[1].data,`condition_type=6&lottery_id=${lotteryId}`);
    assert.deepEqual(structuredClone(f.requests[2].params),{type:9,room_id:roomId,content:'开心最美唱歌最好听'});
    await f.bridge.stopLottery(prepared.token);
    assert.equal((await f.bridge.prepareLottery(lotteryId,{allowPassword:true})).available,false);
    f.page.dispatchEvent(new f.page.MessageEvent('message',{data:{type:'send-api',operation:'commit-lottery',token:prepared.token,url:'https://example.test/'},origin:f.page.location.origin,source:f.page}));
    const invalid=await f.send({command:{type:'send-api',id:'unlisted',operation:'fetch',token:prepared.token,url:'https://example.test/'}});
    assert.equal(invalid.value.submitted,false);assert.equal(f.requests.length,3);
  }finally{f.close();}
});

test('构建后的福袋桥取消迟到资格不留票据，首阶段派发后取消阻止口令且不释放轮次去重',async()=>{
  const f=fixture();try {
    const query=deferred(),preparing=new AbortController();f.respond(()=>query.promise);
    const pending=f.bridge.prepareLottery(lotteryId,{allowPassword:true,signal:preparing.signal});
    preparing.abort();query.resolve(f.qualification);assert.equal((await pending).available,false);
    f.respond(()=>f.qualification);
    const prepared=await f.bridge.prepareLottery(lotteryId,{allowPassword:true});assert.equal(prepared.available,true);
    const post=deferred(),committing=new AbortController();f.respond(()=>post.promise);
    const commit=f.bridge.commitLottery(prepared.token,{signal:committing.signal});
    committing.abort();assert.equal(f.requests.at(-1).signal.aborted,true);
    post.resolve({data:{status_code:0}});const result=await commit;
    assert.equal(result.unknown,true);assert.equal(result.dispatched,true);
    assert.equal(f.requests.filter(row=>row.url.includes('special_chat')).length,0);
    await f.bridge.stopLottery(prepared.token);
    assert.equal((await f.bridge.prepareLottery(lotteryId,{allowPassword:true})).available,false);
    assert.equal(f.requests.filter(row=>row.method==='post').length,1);
  }finally{f.close();}
});
