import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGiveaway, enterGiveaway, drawGiveaway, validateGiveawayConfig, giveawayCSV,parseGiveawayState,secureRandomInt,matchesGiveawayChat} from '../../src/core/giveaway.js';

const config = overrides => ({prize:'直播周边',winners:2,durationSec:60,chatEnabled:true,keyword:'参与抽奖',giftEnabled:true,gifts:'玫瑰, 小心心',giftMin:3,...overrides});
const round = overrides => createGiveaway(config(overrides),{id:'round-1',room:'123',broadcastId:'room-1',now:1000});
const chat = (id,text='参与抽奖',at=2000) => ({type:'chat',id:`chat-${id}`,source:'socket',roomId:'room-1',at,text,user:{id,name:`观众${id}`}});
const gift = (id,count,groupId='combo-1',extra={}) => ({...chat(id),type:'gift',id:`gift-${id}-${count}`,giftId:'1',giftName:'玫瑰',count,groupId,...extra});

test('真实采集时间支持空平台时间、秒级开轮边界和平台时钟略快，仍拒绝旧消息与其他房间',()=>{
  const r=round();
  for(const at of [0,999,2500]) {
    const event={...chat('1','参与抽奖',at),receivedAt:2000};
    assert.equal(matchesGiveawayChat(r,event,2000),true,`平台时间 ${at}`);
    assert.equal(enterGiveaway(r,event,2000).entrants.length,1);
  }
  const later=createGiveaway(config(),{id:'later',room:'123',broadcastId:'room-1',now:100000});
  for(const event of [
    {...chat('1','参与抽奖',1),receivedAt:101000},
    {...chat('1','参与抽奖',101000),receivedAt:99999},
    {...chat('1','参与抽奖',101000),receivedAt:101001},
    {...chat('1','参与抽奖',101000),receivedAt:101000,roomId:'other'}
  ])assert.equal(enterGiveaway(later,event,101000),later);
});

test('UID 为零时回退安全 UID，不能按昵称或零 UID 合并观众',()=>{
  const r=round(),event={...chat('0'),user:{id:'0',secUid:'stable-viewer',name:'观众'}};
  const entered=enterGiveaway(r,event,2000);
  assert.equal(entered.entrants.length,1);assert.equal(entered.entrants[0].userId,'sec:stable-viewer');
  assert.equal(enterGiveaway(entered,event,2000),entered);
  assert.equal(enterGiveaway(r,{...event,user:{id:'0',name:'观众'}},2000),r);
});

test('抽奖口令识别与入池使用相同的轮次、房间、时间和精确匹配规则',()=>{
  const r=round();
  const cases=[
    [r,chat('1',' 参与抽奖 '),2000,true],
    [r,chat('1','我要参与抽奖'),2000,false],
    [r,{...chat('1'),roomId:'other'},2000,false],
    [r,chat('1','参与抽奖',999),2000,false],
    [r,chat('1','参与抽奖',2001),2000,false],
    [r,chat('1'),61000,false],
    [round({chatEnabled:false}),chat('1'),2000,false],
    [r,gift('1',3),2000,false],
    [null,chat('1'),2000,false]
  ];
  for(const [current,event,now,expected] of cases) {
    assert.equal(matchesGiveawayChat(current,event,now),expected);
    if(current && event.type==='chat')assert.equal(enterGiveaway(current,event,now)!==current,expected);
  }
});

test('抽奖规则校验与快照固定，至少开放一种参与方式',()=>{
  const input=config();const r=createGiveaway(input,{id:'r',room:'123',now:1000});input.prize='已改';
  assert.equal(r.config.prizes[0].name,'直播周边');assert.equal(r.endsAt,61000);
  for(const invalid of [{prize:''},{winners:0},{winners:1.5},{durationSec:0},{chatEnabled:false,giftEnabled:false},{keyword:' '},{gifts:''},{giftMin:0}]) {
    assert.throws(()=>validateGiveawayConfig(config(invalid)));
  }
});
test('指定弹幕精确匹配、去空格；按真实用户去重，两种途径只有一个名额',()=>{
  const r=round();assert.equal(enterGiveaway(r,chat('1','我想参与抽奖'),2000),r);
  const one=enterGiveaway(r,chat('1',' 参与抽奖 '),2000);
  const duplicate=enterGiveaway(one,chat('1'),2000);assert.equal(duplicate,one);
  const both=enterGiveaway(one,gift('1',3),2000);
  assert.equal(r.entrants.length,0);assert.equal(both.entrants.length,1);assert.deepEqual(both.entrants[0].sources,['chat','gift']);
  assert.equal(enterGiveaway(r,{...chat('x'),user:{name:'匿名'}},2000),r);
});
test('指定礼物累计数量；连击累计帧、结束帧与重放不重复计算',()=>{
  let r=round({chatEnabled:false});r=enterGiveaway(r,gift('1',1),2000);
  r=enterGiveaway(r,gift('1',2),2000);r=enterGiveaway(r,gift('1',2),2000);
  assert.equal(r.entrants.length,0);
  r=enterGiveaway(r,gift('1',1,'combo-2'),2000);
  assert.equal(r.entrants.length,1);assert.equal(r.entrants[0].giftCount,3);
  assert.equal(enterGiveaway(r,gift('2',100,'other',{giftName:'不匹配'}),2000),r);
  assert.equal(enterGiveaway(r,gift('2',100,'other',{source:'dom'}),2000),r);
  assert.equal(enterGiveaway(r,gift('2',100,'' ,{id:''}),2000),r);
});
test('礼物支持 ID；报名拒绝旧轮次、其他房间与过期事件',()=>{
  const r=round({gifts:'463',giftMin:1});assert.equal(enterGiveaway(r,gift('1',1,'g',{giftId:'463'}),2000).entrants.length,1);
  for(const event of [chat('1','参与抽奖',999),chat('1','参与抽奖',61000),{...chat('1'),roomId:'other'}])assert.equal(enterGiveaway(r,event,2000),r);
  assert.equal(enterGiveaway(r,chat('1'),61000),r);
});
test('倒计时结束才开奖、无放回抽取，人数不足或无人参与也保留结果',()=>{
  let r=round();for(const id of ['1','2','3'])r=enterGiveaway(r,chat(id),2000);
  assert.equal(drawGiveaway(r,60000,()=>0),r);
  const drawn=drawGiveaway(r,61000,()=>0);
  assert.equal(drawn.status,'drawn');assert.equal(drawn.awards.length,2);assert.equal(new Set(drawn.awards.map(row=>row.userId)).size,2);
  assert.equal(drawGiveaway(drawn,62000,()=>{throw Error('不可重抽');}),drawn);
  assert.equal(drawGiveaway(enterGiveaway(round(),chat('1'),2000),61000,()=>0).awards.length,1);
  assert.deepEqual(drawGiveaway(round(),61000,()=>0).awards,[]);
});
test('CSV 包含每轮规则、参与方式、用户标识与中奖记录，防止公式注入',()=>{
  const r=drawGiveaway(enterGiveaway(round({prize:'礼盒,"特别版"'}),{...chat('1'),user:{id:'1',name:'=SUM(1,2)'}},2000),61000,()=>0);
  const csv=giveawayCSV({version:2,rounds:[r,drawGiveaway(round(),61000,()=>0)]});
  assert.ok(csv.startsWith('\ufeff'));assert.match(csv,/用户ID/);assert.match(csv,/'=SUM/);assert.match(csv,/礼盒,""特别版""/);assert.match(csv,/中奖/);assert.match(csv,/无人参与/);
});

test('拒绝冲突或损坏的持久轮次，历史结果不能包含陌生中奖者',()=>{
  const r=round();assert.deepEqual(parseGiveawayState(null,'123'),{version:2,rounds:[]});
  assert.deepEqual(parseGiveawayState({version:2,rounds:[r]},'123').rounds[0],r);
  for(const bad of [{version:3,rounds:[]},{version:2,rounds:[r,r]},{version:2,rounds:[{...r,room:'other'}]},{version:2,rounds:[{...r,awards:[{userId:'stranger',prizeIndex:0}]}]},{version:2,rounds:[{...r,entrants:[{userName:'匿名'}]}]}])assert.throws(()=>parseGiveawayState(bad,'123'));
  const entered=enterGiveaway(r,chat('1'),2000);
  assert.throws(()=>parseGiveawayState({version:2,rounds:[{...entered,awards:[{userId:'1',prizeIndex:0}]}]},'123'));
  assert.throws(()=>parseGiveawayState({version:2,rounds:[{...entered,status:'drawn',closedAt:2000,awards:[{userId:'1',prizeIndex:0}]}]},'123'));
});

test('安全随机抽取通过拒绝采样去掉取模偏差',t=>{
  const samples=[0xffffffff,8];const mock=t.mock.method(crypto,'getRandomValues',buffer=>{buffer[0]=samples.shift();return buffer;});
  assert.equal(secureRandomInt(3),2);assert.equal(mock.mock.callCount(),2);
});
test('加权抽取支持超过 32 位的整数总权重，非法范围直接拒绝',t=>{
  const values=[[0x1fffff,0xffffffff],[1,5]];t.mock.method(crypto,'getRandomValues',buffer=>{buffer.set(values.shift());return buffer;});
  assert.equal(secureRandomInt(0x100000001),4);
  for(const max of [0,-1,NaN,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>secureRandomInt(max));
});
