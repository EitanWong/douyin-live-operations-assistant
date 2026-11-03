import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rewardActivities,matchRewardActivity,rewardReservation,rewardBlockReason} from '../../src/core/reward-activity.js';

const room='7702463172476701483',id='7702514039720839955',account='9007199254740993123';
const options={roomId:room,account};
const sync=(lotteryId=id,more={})=>({type:'room-sync',roomId:room,syncType:'LotteryInfoSyncData',syncDetails:{lotteryId,
  startedAt:'1000',drawAt:'1180',candidateCount:'25',prizeCount:'30',luckyCount:'3',...more}});
const receipt=(success,version)=>({type:'activity-signal',activityKind:'lottery-candidate',roomId:room,lotteryId:id,userId:account,participateSuccess:success,version});

test('只收到同步也能识别轮次，候选总人数不能确认本人参与，输入保持不变',()=>{
  const events=[sync()],saved=structuredClone(events),round=rewardActivities(events,options).lotteries[0];
  assert.equal(round.lotteryId,id);assert.equal(round.participation,'unknown');assert.equal(round.deadline,1180000);
  assert.equal(round.candidateCount,'25');assert.deepEqual(events,saved);
  assert.deepEqual(rewardReservation(round),{key:`luckyBag:${room}:${id}`,roomId:room,activityId:id,deadline:1180000});
});

test('无版本的新回执不能覆盖有版本或已经观察到的明确结果',()=>{
  for(const version of ['200',null]) {
    const round=rewardActivities([sync(),receipt(true,version),receipt(false,null)],options).lotteries[0];
    assert.equal(round.participation,'confirmed');
  }
});

test('新轮次通过时间排序，旧轮次的晚到回执和开奖不能覆盖它',()=>{
  const next='7702516056363223844';
  const result=rewardActivities([sync(),sync(next,{startedAt:'1200',drawAt:'1380'}),receipt(true,'200'),
    {type:'activity-signal',activityKind:'lottery-result',roomId:room,lotteryId:id,reportedUserIds:[account]}],options);
  assert.equal(result.lotteries[0].lotteryId,next);assert.equal(result.lotteries[0].drawn,false);
  assert.equal(result.lotteries[1].drawn,true);assert.equal(result.lotteries[1].reportedUserCount,1);
  assert.equal('won' in result.lotteries[1],false);
});

test('只有唯一匹配的开奖时间才绑定无编号页面，明确编号不回退到其他活动',()=>{
  const data=rewardActivities([sync(),sync('22',{drawAt:'1185'})],options);
  assert.equal(matchRewardActivity(data,{kind:'luckyBag',deadline:1180000}),null);
  assert.equal(matchRewardActivity(data,{kind:'luckyBag',activityId:'33',deadline:1180000}),null);
  assert.equal(matchRewardActivity(data,{kind:'luckyBag',activityId:id}).lotteryId,id);
});

test('房间、账号和无效身份按边界隔离，0 号轮次不能建立活动',()=>{
  assert.equal(rewardActivities([sync(),receipt(true,'200')],{...options,account:'77'}).lotteries[0].participation,'unknown');
  assert.equal(rewardActivities([sync()],{roomId:'88',account}).lotteries.length,0);
  assert.equal(rewardActivities([sync('0'),sync(123),null],options).lotteries.length,0);
  assert.deepEqual(rewardActivities(null,options),{lotteries:[],redPackets:[]});
});

test('红包预览的开始和结束窗口与福袋开奖状态分别处理',()=>{
  const packet={type:'red-packet',roomId:room,packetId:'red-1',startTime:'1100',endTime:'1180'};
  const data=rewardActivities([sync(),packet],options),red=data.redPackets[0];
  assert.match(rewardBlockReason(red,1000000),/尚未开始/);assert.equal(rewardBlockReason(red,1150000),'');
  assert.match(rewardBlockReason(red,1180000),/倒计时结束/);
  assert.equal(data.lotteries[0].drawn,false);assert.equal(data.lotteries[0].participation,'unknown');
});
