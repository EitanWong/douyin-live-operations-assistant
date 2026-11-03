import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {RewardAutomation, REWARDS_DEFAULTS} from '../../src/browser/rewards.js';

const room='7702463172476701483',lottery='7702514039720839955',self='9007199254740993123';
const now=1793382030000;
const start=(id=lottery,more={})=>({type:'activity-signal',activityKind:'lottery-start',roomId:room,lotteryId:id,
  startedAt:String(now/1000-10),drawAt:String(now/1000+58),prizeCount:'30',luckyCount:'3',conditions:[],...more});
const candidate=(success=true,more={})=>({type:'activity-signal',activityKind:'lottery-candidate',roomId:room,lotteryId:lottery,
  userId:self,participateSuccess:success,version:'200',...more});
const panel=(id='',extra='')=>`<section class="gbRklVwV" ${id?`data-lottery-id="${id}"`:''}><div>福袋 30钻 3份</div><div>倒计时 00:58</div>${extra}<button>立即参与</button></section>`;
function fixture({html=panel(),events=[start()],config={},storage}={}) {
  const dom=new JSDOM(`<body>${html}</body>`,{url:'https://live.douyin.com/123'});
  dom.window.Element.prototype.getClientRects=function(){return [{width:100,height:30}];};
  const settings={...REWARDS_DEFAULTS,enabled:true,entryXPath:'',...config};let time=now,account=self,clicks=0;
  const lock={acquire:async()=>true,release(){}};
  dom.window.document.body.addEventListener('click',event=>{if(event.target.tagName==='BUTTON')clicks++;});
  const runner=new RewardAutomation({page:dom.window,room:'123',getConfig:()=>settings,lock,storage,now:()=>time,
    getAccount:()=>account,getRoomId:()=>room,getEvents:()=>events});
  return {dom,runner,events,settings,clicks:()=>clicks,setAccount:value=>{account=value;},
    step:async()=>{time+=1000;await runner.tick();},close:()=>dom.window.close()};
}

test('倒计时面板绑定协议轮次，DOM 更换后不重复点击',async()=>{
  const f=fixture();try {
    await f.step();assert.equal(f.clicks(),1);
    assert.equal(f.runner.records[0].activityId,lottery);assert.equal(f.runner.records[0].roomId,room);
    f.dom.window.document.body.innerHTML=panel();await f.step();assert.equal(f.clicks(),1);
  }finally{f.close();}
});

test('本人成功回执无需页面文字变化即可确认，旧版本及其他账号不能覆盖',async()=>{
  const f=fixture();try {
    await f.step();f.events.push(candidate());await f.step();
    assert.equal(f.runner.state.serverConfirmed,1);assert.equal(f.runner.records[0].status,'confirmed');
    assert.equal(f.runner.state.confirmed,0,'页面确认与服务器确认分别计数');
    f.events.push(candidate(),candidate(false,{version:'100'}),candidate(false,{version:'300',userId:'77'}));
    await f.step();assert.equal(f.clicks(),1);assert.equal(f.runner.state.serverConfirmed,1);
    assert.equal(f.runner.state.lottery.participation,'confirmed');
  }finally{f.close();}
});

test('手动参与回执也会去重，切换账号后不沿用本人的成功状态',async()=>{
  const f=fixture({events:[start(),candidate()]});try {
    await f.step();assert.equal(f.clicks(),0);assert.equal(f.runner.state.serverConfirmed,1);
    f.setAccount('77');await f.step();assert.equal(f.clicks(),1);assert.equal(f.runner.state.lottery.participation,'unknown');
  }finally{f.close();}
});

test('晚到的其他轮次和其他房间回执不能确认当前活动',async()=>{
  const f=fixture({events:[start(),candidate(true,{lotteryId:'12345'}),candidate(true,{roomId:'88'})]});try {
    await f.step();assert.equal(f.clicks(),1);assert.equal(f.runner.state.serverConfirmed,0);
    assert.equal(f.runner.state.lottery.lotteryId,lottery);assert.equal(f.runner.state.lottery.participation,'unknown');
  }finally{f.close();}
});

test('服务器明确拒绝或已开奖的轮次不再点击，结果名单不解释为通用中奖结果',async()=>{
  for(const event of [candidate(false),{type:'activity-signal',activityKind:'lottery-result',roomId:room,lotteryId:lottery,reportedUserIds:['77']}]) {
    const f=fixture({events:[start(),event]});try {
      await f.step();assert.equal(f.clicks(),0);assert.equal('won' in f.runner.state.lottery,false);
      assert.match(f.runner.state.reason,/未确认成功|已开奖/);
    }finally{f.close();}
  }
});

test('持久化等待期间到达开奖回执，原生按钮不再派发',async()=>{
  let release;const saved=[];
  const storage={get:async()=>saved,set:async(_,records)=>{saved.splice(0,saved.length,...structuredClone(records));await new Promise(resolve=>{release=resolve;});}};
  const f=fixture({storage});try {
    const tick=f.step();while(!release)await new Promise(setImmediate);
    f.events.push({type:'activity-signal',activityKind:'lottery-result',roomId:room,lotteryId:lottery,reportedUserIds:[]});
    const done=release;storage.set=async()=>{};done();await tick;assert.equal(f.clicks(),0);
  }finally{f.close();}
});

test('先按页面预留、后收到协议轮次时合并记录，不能再提交一次',async()=>{
  const f=fixture({events:[]});try {
    await f.step();f.events.push(start());await f.step();assert.equal(f.clicks(),1);
    f.events.push(candidate());await f.step();assert.equal(f.runner.records.length,1);
    assert.equal(f.runner.records[0].activityId,lottery);assert.equal(f.runner.state.serverConfirmed,1);
  }finally{f.close();}
});

test('口令福袋需明确开关，使用原生参与按钮；其他未完成条件仍阻止点击',async()=>{
  for(const [nativePassword,extra,expected] of [[false,'',0],[true,'',1],[true,'<div>关注主播 去完成</div>',0],
    [true,'<div>加入粉丝团 去完成</div>',0],[true,'<div>送礼参与</div>',0]]) {
    const f=fixture({html:panel('',`<div>发送口令: 示例口令</div>${extra}`),config:{nativePassword}});try {
      await f.step();assert.equal(f.clicks(),expected);
    }finally{f.close();}
  }
});

test('原生口令条目标为未完成时可以一并提交，不扩展为其他任务',async()=>{
  const f=fixture({html:panel('','<div>发送口令: 示例口令 未完成</div>'),config:{nativePassword:true}});try {
    await f.step();assert.equal(f.clicks(),1);
  }finally{f.close();}
});

test('页面与服务器可分别确认同一次参与，重复轮询不能重复累计',async()=>{
  const f=fixture();try {
    await f.step();f.events.push(candidate());await f.step();
    f.dom.window.document.querySelector('button').textContent='已参与';await f.step();
    assert.equal(f.runner.state.confirmed,1);assert.equal(f.runner.state.serverConfirmed,1);assert.equal(f.clicks(),1);
    await f.step();assert.equal(f.runner.state.confirmed,1);
  }finally{f.close();}
});

test('重建实例恢复较新版本后，同一 tick 的界面和提交状态都不能降级',async()=>{
  const f=fixture();try {
    f.events.push(candidate());await f.step();
    f.events.splice(0,f.events.length,start(),candidate(false,{version:'100'}));
    const restored=new RewardAutomation({page:f.dom.window,room:'123',lock:{acquire:async()=>true,release(){}},
      getConfig:()=>f.settings,getAccount:()=>self,getRoomId:()=>room,getEvents:()=>f.events,now:()=>now+10000});
    await restored.tick();assert.equal(restored.state.lottery.participation,'confirmed');
    assert.equal(restored.state.serverConfirmed,0);assert.equal(f.clicks(),0);
  }finally{f.close();}
});

test('页面轮次不明确或与近期协议不一致时等待，更新为明确的新一轮后继续',async()=>{
  for(const html of [panel('88'),panel().replace('00:58','02:58')]) {
    const f=fixture({html});try {
      await f.step();assert.equal(f.clicks(),0);assert.match(f.runner.state.reason,/轮次.*不一致/);
      f.events.push(start('99',{startedAt:String(now/1000+1),drawAt:String(now/1000+178)}));
      f.dom.window.document.body.innerHTML=panel('99');await f.step();assert.equal(f.clicks(),1);
      assert.equal(f.runner.records[0].activityId,'99');
    }finally{f.close();}
  }
});

test('倒计时同时匹配两个协议轮次时，不猜测本次参与对象',async()=>{
  const f=fixture({events:[start(),start('99')]});try {
    await f.step();assert.equal(f.clicks(),0);assert.match(f.runner.state.reason,/轮次.*不一致/);
  }finally{f.close();}
});

test('缓冲区淘汰较新回执后，持久记录仍阻止旧版本降低状态',async()=>{
  const f=fixture();try {
    f.events.push(candidate());await f.step();
    f.events.splice(0,f.events.length,start(),candidate(false,{version:'100'}));await f.step();
    assert.equal(f.runner.records[0].status,'confirmed');assert.equal(f.runner.state.lottery.participation,'confirmed');assert.equal(f.clicks(),0);
  }finally{f.close();}
});

test('红包按自己的预览 ID 与时间去重，福袋成功回执不能算红包领取成功',async()=>{
  const packet={type:'red-packet',roomId:room,packetId:'packet-1',startTime:String(now/1000-10),endTime:String(now/1000+58),count:5,totalAmount:30};
  const f=fixture({html:'<section role="dialog" data-redpacket-id="packet-1"><h3>红包</h3><button>领取红包</button></section>',events:[packet,start(),candidate()]});try {
    await f.step();assert.equal(f.clicks(),1);assert.equal(f.runner.state.confirmed,0);
    const red=f.runner.records.find(row=>row.kind==='redPacket');assert.equal(red.activityId,'packet-1');assert.equal(red.status,'submitted');
    f.events.push({...packet,endTime:String(now/1000-1)});await f.step();assert.equal(f.clicks(),1);
  }finally{f.close();}
});

test('关闭自动参与时仍显示福袋检测信息，并且不点击',async()=>{
  const f=fixture({config:{enabled:false}});try {
    await f.step();assert.equal(f.clicks(),0);assert.equal(f.runner.state.lottery.lotteryId,lottery);
    assert.equal(f.runner.state.lottery.prizeCount,'30');assert.equal(f.runner.state.phase,'idle');
  }finally{f.close();}
});
