import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine,mergeConfig} from '../../src/core/engine.js';
import {GiftLedger} from '../../src/data/gifts.js';
import {giftHistoryContext,giftSessionContext,pkPeriodContext} from '../../src/core/live-statistics.js';
import {createAIClient} from '../../src/services/ai.js';

const now=Date.parse('2026-10-26T12:00:00+08:00'), DAY=86400000;
const settle=()=>new Promise(setImmediate);

test('真实账本连击去重、榜单补差和并列最高单价礼物进入问答，不传原始标识',()=>{
  const ledger=new GiftLedger({now:()=>now});
  ledger.startSession(now-3600000,'platform','broadcast-private');
  const event={id:'combo-private',groupId:'combo-private',giftId:'rose-private',giftName:'玫瑰',count:2,unitValue:10,user:{id:'1',name:'甲'}};
  ledger.observe(event,'1','uid:1');ledger.observe({...event,count:5,final:true},'1','uid:1');
  ledger.observe({...event,id:'castle',groupId:'castle',giftId:'castle-private',giftName:'城堡',count:1,unitValue:100,final:true},'1','uid:1');
  ledger.observe({...event,id:'ship',groupId:'ship',giftId:'ship-private',giftName:'飞船',count:1,unitValue:100,final:true},'1','uid:1');
  ledger.observeContribution({userId:'uid:1',name:'甲',score:300,capturedAt:now,roomId:'broadcast-private',rate:0.05});
  const session=ledger.calibratedSession(ledger.currentSession());
  const engine=new Engine({config:mergeConfig({anchorId:'123'}),now:()=>now,liveData:()=>({income:{...session,anchorId:'123',at:now}})});
  const data=engine.aiContext().liveContext.income;
  assert.equal(data.giftCount,7);assert.equal(data.totalDiamonds,300);assert.equal(data.calibrationDiamonds,50);
  assert.equal(data.durationMs,3600000);assert.equal(data.durationEstimated,false);
  assert.equal(data.highestGift.unitDiamonds,100);assert.equal(data.highestGift.tiedCount,2);
  assert.deepEqual(data.highestGift.gifts.map(row=>row.name).sort(),['城堡','飞船']);
  assert.deepEqual(data.highestGift.gifts[0].senders.names,['甲']);
  assert.equal(data.contributors.users[0].totalDiamonds,300);
  assert.doesNotMatch(JSON.stringify(data),/private|uid:1|userId|giftId/);
  assert.equal(giftSessionContext({startAt:now-1000},now).durationMs,null);
  assert.equal(giftSessionContext({},now).contributors,null);
});

test('历史周期按北京时间场次开播日期，汇总不受20条采样影响，未采集历史保留为空',()=>{
  const sessions=Array.from({length:25},(_,i)=>({id:`private-${i}`,startAt:now-i*DAY,endAt:now-i*DAY+1000,totalDiamonds:10,giftCount:1,estimatedIncome:0.5}));
  const history=giftHistoryContext({at:now,sessions},now);
  assert.equal(history.history.sessions.length,20);assert.equal(history.history.truncated,true);
  assert.equal(history.periods.all.sessions,25);assert.equal(history.periods.all.totalDiamonds,250);
  assert.equal(history.periods.day.sessions,1);assert.equal(history.periods.yesterday.sessions,1);
  assert.equal(history.periods.week.sessions,1);assert.equal(history.periods.month.sessions,25);
  assert.equal(history.periods.day.startAt,Date.parse('2026-10-26T00:00:00+08:00'));
  assert.equal(giftHistoryContext(null,now),null);
  const engine=new Engine({config:mergeConfig({anchorId:'123'}),now:()=>now,liveData:()=>({giftHistory:{anchorId:'456',at:now,sessions}})});
  assert.equal(engine.aiContext().liveContext.giftHistory,null);
  engine.liveData=()=>({giftHistory:{anchorId:'123',at:now-120001,sessions}});
  assert.equal(engine.aiContext().liveContext.giftHistory.stale,true);
});

test('跨零点PK按所属开播场次归属，缺少边界明确标记，未知终局不算胜场',()=>{
  const midnight=Date.parse('2026-10-26T00:00:00+08:00');
  const rows=[{roomId:'A',startedAt:midnight+1000,endedAt:midnight+2000,phase:'ended',scoreFinal:true,score:30,outcome:'win'},
    {roomId:'B',startedAt:midnight+3000,phase:'active',scoreFinal:false,outcome:null}];
  const calendar=pkPeriodContext(rows,[{roomId:'A',startAt:midnight-3600000,endAt:midnight+2500}],now);
  assert.equal(calendar.periods.yesterday.wins,1);assert.equal(calendar.periods.day.wins,0);
  assert.equal(calendar.periods.day.active,1);assert.equal(calendar.periods.day.estimatedAssignments,1);
});

test('观众的数据问题经真实AI客户端识别后进入回复队列，明确零值能回答',async()=>{
  const requests=[];
  const ai=createAIClient({getKey:()=> 'model-key',request:details=>{
    requests.push(JSON.parse(details.data));details.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:JSON.stringify({intent:'live-data',query:'',reply:'本场已采集0件礼物。'})}}]})});
  }});
  const engine=new Engine({ai,now:()=>now,config:mergeConfig({anchorId:'123',mode:'preview',ai:{enabled:true,chatEnabled:true}}),
    liveData:()=>({income:{anchorId:'123',at:now,giftCount:0,totalDiamonds:0}})});
  engine.setIdentity({self:{id:'self',name:'助手'}});engine.start();
  engine.ingest({type:'chat',id:'question',user:{id:'viewer',name:'观众'},text:'@助手 这场一件礼物都没收到吗'});await settle();
  assert.equal(engine.queue[0].text,'本场已采集0件礼物。');
  assert.equal(JSON.parse(requests[0].messages[1].content).live_context.income.giftCount,0);
  assert.match(requests[0].messages[0].content,/自动区分主播直播数据/);
  assert.match(requests[0].messages[0].content,/意图 JSON/);
});

test('切换主播、切场、下播后，等待中的查询及已生成的旧回复全部失效',async()=>{
  for(const change of [engine=>engine.config.anchorId='456',engine=>engine.ingest({type:'start',roomId:'B',at:now+1,receivedAt:now+1}),engine=>engine.ingest({type:'end',roomId:'A',at:now+1})]){
    let time=now,resolve;
    const engine=new Engine({now:()=>time,config:mergeConfig({anchorId:'123',mode:'preview',ai:{enabled:true,chatEnabled:true}}),ai:()=>new Promise(done=>resolve=done)});
    engine.setIdentity({self:{id:'self',name:'助手'}});engine.start();engine.ingest({type:'start',roomId:'A',at:now});
    const chat=id=>engine.ingest({type:'chat',id,user:{id:'viewer',name:'观众'},text:'@助手 本场多少钻石'});
    chat('first');resolve('本场已采集100钻。');await settle();assert.equal(engine.queue.length,1);
    chat('second');chat('waiting');time++;change(engine);resolve('旧场数据');await settle();
    await engine.tick(false);assert.equal(engine.queue.length,0);assert.equal(engine.chatAIQueue.length,0);
  }
});
