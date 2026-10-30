import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LotteryRequests} from '../../src/browser/lottery-requests.js';

const room='7702463172476701483',lottery='7702514039720839955',user='9007199254740993123',anchor='4007055676415213';
const serverNow=1793382029;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
function fixture({conditions,condition,info}={}) {
  const requests=[],events=new Map();let identity={roomId:room,userId:user,path:'260440030123'},sequence=0;
  const current={lottery_id_str:lottery,room_id_str:room,status:1,current_time:serverNow,draw_time:serverNow+120};
  const page={crypto:{randomUUID:()=>`lottery-ticket-${++sequence}`},navigator:{onLine:true},
    addEventListener:(name,callback)=>events.set(name,callback),
    __STORE__:{roomStore:{roomInfo:{anchor:{id_str:anchor},room:{status:2}}},lotteryStore:{currentLottery:current}}};
  const reply={status_code:0,data:{hit_black_list:false,user_customized_condition:[],server_participate_biz_data:'',
    lottery_info:{...current,lottery_id:Number(lottery),room_id:Number(room),owner_type:1,anchor_id:Number(anchor),owner_user_id:Number(anchor),
      conditions:conditions ?? [{type:8,need_diamond_count:1,min_fans_level:0},{type:3,need_diamond_count:0,content:'开心最美唱歌最好听'},{type:6,need_diamond_count:0}],...info},
    user_condition:{is_watching:true,is_fansclub_member:true,fansclub_status_active:true,fans_level:6,has_command:false,has_activated:false,...condition}}};
  const client={request:async request=>{requests.push(request);return {data:request.method==='get'&&request.url.includes('check_user_right')?structuredClone(reply):{status_code:0,data:{}}};}};
  const sender={page,context:()=>identity,client:()=>client};
  return {requests,page,current,reply,client,runner:new LotteryRequests(sender),setIdentity:value=>{identity=value;},identity,events};
}

test('准备只查询资格，提交按原生顺序更新手动条件再发口令且不伪造确认',async()=>{
  const f=fixture(),prepared=await f.runner.prepare(lottery,{allowPassword:true});
  assert.equal(prepared.available,true);assert.equal(f.requests.length,1);
  assert.deepEqual(f.requests[0],{url:'/webcast/lottery/melon/check_user_right/',method:'get',params:{lottery_id:lottery,room_id:room,anchor_id:anchor},timeout:8000});
  const first=f.runner.commit(prepared.token),duplicate=f.runner.commit(prepared.token);
  assert.equal(first,duplicate);const result=await first;
  assert.deepEqual(result,{submitted:true,transport:'request',clicked:true,dispatched:true});assert.equal('confirmed' in result,false);
  assert.deepEqual(f.requests.slice(1),[
    {url:'/webcast/lottery/melon/update_user_condition/',method:'post',data:`condition_type=6&lottery_id=${lottery}`,headers:{'Content-Type':'application/x-www-form-urlencoded'},timeout:8000},
    {url:`/webcast/room/special_chat/${room}/`,method:'get',params:{type:9,room_id:room,content:'开心最美唱歌最好听'},timeout:8000}
  ]);
  assert.equal((await f.runner.prepare(lottery,{allowPassword:true})).available,false);assert.equal(f.requests.length,3);
});

test('已激活但口令未完成可以补交；所有适用条件完成才判为已参与',async()=>{
  for(const hasCommand of [false,true]) {
    const f=fixture({condition:{has_activated:true,has_command:hasCommand}}),p=await f.runner.prepare(lottery,{allowPassword:true});
    assert.equal(p.available,!hasCommand);
    if(!hasCommand)assert.equal((await f.runner.commit(p.token)).submitted,true);
  }
  const f=fixture({condition:{has_command:true}}),p=await f.runner.prepare(lottery);
  assert.equal(p.available,true);await f.runner.commit(p.token);assert.equal(f.requests.length,2);
});

test('未知、付费、未满足粉丝团或未经授权口令条件不产生参与请求',async()=>{
  const cases = [
    [f=>{},false],[f=>f.reply.data.lottery_info.conditions.push({type:7,min_fans_level:1}),true],
    [f=>f.reply.data.lottery_info.conditions.push({type:4,need_diamond_count:1}),true],
    [f=>f.reply.data.user_condition.fansclub_status_active=false,true],
    [f=>f.reply.data.user_condition.is_fansclub_member=false,true],
    [f=>f.reply.data.lottery_info.conditions[1].need_diamond_count=1,true],
    [f=>f.reply.data.lottery_info.conditions[1].content='',true],
    [f=>f.reply.data.hit_black_list=true,true],
    [f=>f.reply.data.user_condition.is_watching=false,true],
    [f=>f.reply.data.user_customized_condition=[{type:50}],true],
    [f=>f.reply.data.lottery_info.conditions.push({type:3,content:'重复口令'}),true]
  ];
  for(const [change,allowPassword] of cases) {
    const f=fixture();change(f);
    assert.equal((await f.runner.prepare(lottery,{allowPassword})).available,false);
    assert.equal(f.requests.length,1);assert.equal(f.requests[0].method,'get');
  }
});

test('响应身份、枚举、时钟和资格形状必须完整且无损',async()=>{
  const changes=[
    f=>delete f.reply.data.lottery_info.lottery_id_str,
    f=>f.reply.data.lottery_info.lottery_id_str='42',
    f=>f.reply.data.lottery_info.room_id_str='42',
    f=>f.reply.data.lottery_info.anchor_id=9007199254740992,
    f=>f.reply.data.lottery_info.owner_user_id=42,
    f=>f.reply.data.lottery_info.status=2,
    f=>f.reply.data.lottery_info.current_time=serverNow+121,
    f=>f.reply.data.lottery_info.draw_time=NaN,
    f=>f.reply.data.lottery_info.conditions=null,
    f=>f.reply.data.user_condition.has_command='false',
    f=>f.reply.data.user_condition.has_activated=undefined,
    f=>f.reply.status_code='0'
  ];
  for(const change of changes){const f=fixture();change(f);assert.equal((await f.runner.prepare(lottery,{allowPassword:true})).available,false);assert.equal(f.requests.length,1);}
});

test('准备与提交前均验证原生当前轮次、账号、房间、主播及开播状态',async()=>{
  const changes=[f=>f.setIdentity({...f.identity,userId:'77'}),f=>f.setIdentity({...f.identity,roomId:'88'}),
    f=>f.setIdentity({...f.identity,path:'99'}),f=>f.current.lottery_id_str='44',f=>delete f.page.__STORE__.lotteryStore.currentLottery,
    f=>f.current.status=2,f=>f.current.draw_time=serverNow+90,f=>f.page.__STORE__.roomStore.roomInfo.anchor.id_str='55',
    f=>f.page.__STORE__.roomStore.roomInfo.room.status=4,f=>f.page.navigator.onLine=false];
  for(const change of changes){const f=fixture(),p=await f.runner.prepare(lottery,{allowPassword:true});assert.equal(p.available,true);change(f);const result=await f.runner.commit(p.token);assert.equal(result.dispatched,false);assert.equal(f.requests.length,1);}
  const f=fixture();f.current.lottery_id_str='44';assert.equal((await f.runner.prepare(lottery,{allowPassword:true})).available,false);assert.equal(f.requests.length,0);
});

test('资格查询等待中切换账号或取消，迟到结果不能创建可提交票据',async()=>{
  for(const change of [(f,c)=>f.setIdentity({...f.identity,userId:'77'}),(f,c)=>c.abort()]){
    const f=fixture(),d=deferred(),c=new AbortController();f.client.request=request=>{f.requests.push(request);return d.promise;};
    const pending=f.runner.prepare(lottery,{allowPassword:true,signal:c.signal});change(f,c);d.resolve({data:f.reply});
    assert.equal((await pending).available,false);assert.equal(f.requests.length,1);
  }
});

test('提交服务端拒绝、网络异常与部分成功均不重发；第二阶段异常是未知结果',async()=>{
  for(const [failureAt,reply] of [[1,{data:{status_code:403}}],[1,null],[1,'throw'],[2,{data:{status_code:403}}],[2,'throw']]){
    const f=fixture(),p=await f.runner.prepare(lottery,{allowPassword:true});let writes=0;
    f.client.request=async request=>{f.requests.push(request);if(++writes===failureAt){if(reply==='throw')throw Error('timeout');return reply;}return {data:{status_code:0}};};
    const result=await f.runner.commit(p.token);assert.equal(result.submitted,false);assert.equal(result.dispatched,true);
    assert.equal(Boolean(result.unknown),failureAt===2||reply===null||reply==='throw');
    await f.runner.commit(p.token);assert.equal(writes,failureAt);
    assert.equal((await f.runner.prepare(lottery,{allowPassword:true})).available,false);
  }
});

test('停止或取消在途第一阶段仍等待响应，但不发送第二阶段',async()=>{
  for(const mode of ['stop','abort','pagehide','account']){
    const f=fixture(),p=await f.runner.prepare(lottery,{allowPassword:true}),d=deferred(),c=new AbortController();let settled=false;
    f.client.request=request=>{f.requests.push(request);return d.promise;};const pending=f.runner.commit(p.token,{signal:c.signal});pending.then(()=>{settled=true;});
    if(mode==='stop')f.runner.stop(p.token);else if(mode==='abort')c.abort();else if(mode==='pagehide')f.events.get('pagehide')();else f.setIdentity({...f.identity,userId:'77'});
    await new Promise(setImmediate);assert.equal(settled,false);assert.equal(f.requests.length,2);
    d.resolve({data:{status_code:0}});const result=await pending;
    assert.equal(result.dispatched,true);assert.equal(result.unknown,true);assert.equal(f.requests.length,2);
  }
});

test('服务端时差决定有效期，准备票据过期和开奖后均不提交',async t=>{
  let now=100000;t.mock.method(Date,'now',()=>now);
  const f=fixture(),p=await f.runner.prepare(lottery,{allowPassword:true});assert.equal(p.available,true);now+=120001;
  assert.equal((await f.runner.commit(p.token)).dispatched,false);assert.equal(f.requests.length,1);
  const g=fixture({info:{draw_time:serverNow+600}}),q=await g.runner.prepare(lottery,{allowPassword:true});now+=300001;
  assert.equal((await g.runner.commit(q.token)).dispatched,false);assert.equal(g.requests.length,1);
});

test('重复准备串行且按轮次账号去重，停止未提交票据后可以重新准备',async()=>{
  const f=fixture(),d=deferred();f.client.request=request=>{f.requests.push(request);return d.promise;};
  const first=f.runner.prepare(lottery,{allowPassword:true});assert.equal((await f.runner.prepare(lottery,{allowPassword:true})).available,false);assert.equal(f.requests.length,1);
  d.resolve({data:f.reply});const p=await first;assert.equal(p.available,true);
  assert.deepEqual(f.runner.stop(p.token),{stopped:true});assert.deepEqual(f.runner.stop(p.token),{stopped:true});
  assert.equal((await f.runner.commit(p.token)).dispatched,false);
  assert.equal((await f.runner.prepare(lottery,{allowPassword:true})).available,true);
});

test('布尔与容器不能伪装时钟数字，本地时间倒退不能提交',async t=>{
  for(const value of [true,false,[],[serverNow],{}]){
    const f=fixture();f.reply.data.lottery_info.current_time=value;
    assert.equal((await f.runner.prepare(lottery,{allowPassword:true})).available,false);assert.equal(f.requests.length,1);
  }
  let now=100000;t.mock.method(Date,'now',()=>now);const f=fixture(),p=await f.runner.prepare(lottery,{allowPassword:true});now--;
  assert.equal((await f.runner.commit(p.token)).dispatched,false);assert.equal(f.requests.length,1);
});

test('当前页离开后不能重新准备，派发后停止不能清除同轮去重',async()=>{
  const f=fixture(),p=await f.runner.prepare(lottery,{allowPassword:true});await f.runner.commit(p.token);f.runner.stop(p.token);
  assert.equal((await f.runner.prepare(lottery,{allowPassword:true})).available,false);
  const g=fixture();g.events.get('pagehide')();assert.equal((await g.runner.prepare(lottery,{allowPassword:true})).available,false);assert.equal(g.requests.length,0);
});

test('BFCache 恢复只允许新准备，离开前的票据失效且已派发轮次仍去重',async()=>{
  const f=fixture(),old=await f.runner.prepare(lottery,{allowPassword:true});
  f.events.get('pagehide')();assert.equal((await f.runner.prepare(lottery,{allowPassword:true})).available,false);
  f.events.get('pageshow')?.({persisted:true});
  assert.equal((await f.runner.commit(old.token)).dispatched,false);
  const fresh=await f.runner.prepare(lottery,{allowPassword:true});assert.equal(fresh.available,true);
  await f.runner.commit(fresh.token);f.events.get('pagehide')();f.events.get('pageshow')({persisted:true});
  assert.equal((await f.runner.prepare(lottery,{allowPassword:true})).available,false);
});

test('同步请求拦截器重入同票据仍只派发一次',async()=>{
  const f=fixture({condition:{has_command:true}}),p=await f.runner.prepare(lottery);let inner;
  f.client.request=async request=>{f.requests.push(request);inner=f.runner.commit(p.token);return {data:{status_code:0}};};
  const outer=f.runner.commit(p.token);assert.equal(inner,outer);assert.equal((await outer).submitted,true);assert.equal(f.requests.length,2);
});

test('票据容量有界，未提交旧记录过期释放容量且旧票据失效',async t=>{
  let now=100000;t.mock.method(Date,'now',()=>now);const f=fixture({condition:{has_command:true},info:{draw_time:serverNow+600}});f.current.draw_time=serverNow+600;
  let first;
  for(let i=0;i<128;i++){
    const id=String(BigInt(lottery)+BigInt(i));f.current.lottery_id_str=id;f.reply.data.lottery_info.lottery_id_str=id;
    const p=await f.runner.prepare(id);assert.equal(p.available,true);first ||= p.token;
  }
  const next=String(BigInt(lottery)+128n);f.current.lottery_id_str=next;f.reply.data.lottery_info.lottery_id_str=next;
  assert.equal((await f.runner.prepare(next)).available,false);assert.equal(f.requests.length,128);
  now+=300001;assert.equal((await f.runner.prepare(next)).available,true);assert.equal(f.requests.length,129);
  assert.equal((await f.runner.commit(first)).dispatched,false);assert.equal(f.requests.length,129);
});

test('资格请求失败与输入非法不会留下不可撤销的准备记录',async()=>{
  for(const response of [null,{data:{status_code:403}},'throw']){
    const f=fixture(),original=f.client.request;f.client.request=async request=>{f.requests.push(request);if(response==='throw')throw Error('offline');return response;};
    assert.equal((await f.runner.prepare(lottery,{allowPassword:true})).available,false);f.client.request=original;
    assert.equal((await f.runner.prepare(lottery,{allowPassword:true})).available,true);
  }
  for(const [id,options] of [[Number(lottery),{}],['0',{}],[lottery,{allowPassword:'true'}],[lottery,{signal:AbortSignal.abort()}]]){
    const f=fixture();assert.equal((await f.runner.prepare(id,options)).available,false);assert.equal(f.requests.length,0);
  }
});

test('原生轮次只有精确ID时，由资格回复提供状态与服务器倒计时',async()=>{
  const f=fixture();delete f.current.current_time;delete f.current.status;delete f.current.draw_time;
  const p=await f.runner.prepare(lottery,{allowPassword:true});assert.equal(p.available,true);
  assert.equal((await f.runner.commit(p.token)).submitted,true);assert.equal(f.requests.length,3);
});
