import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Engine, DEFAULTS, copy, validateConfig } from '../../src/core/engine.js';
import { nextChinaMidnight, calculateMidnightPKStart, buildPKStrategyContext } from '../../src/pk/operations.js';
import { readPKTasks, AnchorDataCollector } from '../../src/browser/anchor-data.js';
import { DouyinAdapter } from '../../src/browser/adapter.js';
import { makeAIRequest } from '../../src/services/ai.js';

const at = value => Date.parse(`${value}+08:00`);
function harness(time = at('2026-10-24T23:54:00'), ai = async()=> '[SKIP]') {
  let now=time;
  const config=copy(DEFAULTS);config.anchorId='123';config.mode='preview';config.pkOperations.enabled=true;
  config.pkOperations.reportEnabled=false;config.pkOperations.midnightEnabled=false;
  const logs=[],engine=new Engine({config,now:()=>now,ai,log:(kind,text)=>logs.push({kind,text})});
  engine.start();
  return {engine,logs,time:()=>now,set:time=>{now=time;},advance:ms=>{now+=ms;}};
}
const start = (h,extra={}) => h.engine.ingest({type:'pk-start',id:'start',battleId:'battle',roomId:'456',opponentId:'789',opponentName:'对手',selfScore:10,opponentScore:20,remainingMs:300000,at:h.time(),receivedAt:h.time(),...extra});
let serial=0;
const task = (h,extra={}) => h.engine.ingest({type:'anchor-pk-tasks',source:'native-task-panel',id:`pk-tasks:${h.time()}:${++serial}`,anchorId:'123',valid:2,target:5,firstWin:false,receivedAt:h.time(),...extra});

test('跨零点计划用北京时间，在月年边界按配置时长恰好结束于余量之后',()=>{
  for(const [day,next] of [['2026-10-24','2026-10-25'],['2026-12-31','2027-01-01']]) {
    const now=at(`${day}T23:50:00`),plan=calculateMidnightPKStart(now,300000,5000);
    assert.equal(plan.midnight,at(`${next}T00:00:00`));
    assert.equal(plan.startAt,at(`${day}T23:55:05`));
    assert.equal(plan.endAt-plan.startAt,300000);
    assert.equal(plan.endAt,at(`${next}T00:00:05`));
  }
  assert.equal(nextChinaMidnight(at('2026-10-25T00:00:00')),at('2026-10-26T00:00:00'));
  assert.equal(calculateMidnightPKStart(NaN,300000),null);
  const c=copy(DEFAULTS);c.pkOperations.durationSec=60;c.pkOperations.crossMidnightSec=60;
  assert.throws(()=>validateConfig(c),/余量/);
});

test('原生任务读取排除聊天、隐藏面板、含糊状态和相互矛盾的任务值',()=>{
  const dom=new JSDOM(`<div data-e2e="task-panel"><h3>每日PK任务</h3><div><span>每日有效PK次数</span><b>2 / 5</b></div><div><span>今日首胜</span><b>未完成</b></div></div>`);
  try {
    const d=dom.window.document;
    assert.deepEqual(readPKTasks(d),{valid:2,target:5,firstWin:false,validWins:null,winTarget:null});
    d.querySelector('[data-e2e]').hidden=true;assert.equal(readPKTasks(d),null);
    d.querySelector('[data-e2e]').hidden=false;d.body.id='chatroom';assert.equal(readPKTasks(d),null);
    d.body.removeAttribute('id');d.querySelector('b').textContent='已打完';
    assert.deepEqual(readPKTasks(d),{valid:null,target:null,firstWin:false,validWins:null,winTarget:null});
    d.querySelector('[data-e2e]').insertAdjacentHTML('beforeend','<div><span>今日首胜</span><b>已完成</b></div>');
    assert.equal(readPKTasks(d),null);
  } finally {dom.window.close();}
});

test('没有 HTTP 客户端也读取原生任务，面板移除后发布未知状态',async()=>{
  const dom=new JSDOM('<div role="dialog"><h3>PK任务</h3><div><span>今日首胜</span><b>已完成</b></div></div>',{url:'https://live.douyin.com/456?anchor_id=123'});
  const events=[],collector=new AnchorDataCollector({page:dom.window,sender:{context:()=>({roomId:'456'}),client:()=>null},onEvent:event=>events.push(event)});
  try {
    await collector.refresh();assert.equal(events[0].firstWin,true);assert.equal(events[0].anchorId,'123');
    dom.window.document.body.innerHTML='';await collector.refresh();assert.equal(events[1].firstWin,null);
  } finally {collector.stop();dom.window.close();}
});

test('每日平台任务保持来源、时效和主播隔离，本机胜场不冒充有效PK或首胜任务',()=>{
  const h=harness();start(h);h.engine.ingest({type:'pk-end',battleId:'battle',selfScore:30,opponentScore:20,receivedAt:h.time()});
  let view=h.engine.pkOperations.view();assert.equal(view.daily.wins,1);assert.equal(view.task,null);
  task(h,{source:'chat'});assert.equal(h.engine.pkOperations.view().task,null);
  task(h,{anchorId:'other'});assert.equal(h.engine.pkOperations.view().task,null);
  task(h);view=h.engine.pkOperations.view();assert.equal(view.task.valid,2);assert.equal(view.task.firstWin,false);
  h.advance(120001);assert.equal(h.engine.pkOperations.view().task.stale,true);
  h.set(at('2026-10-25T00:00:00'));view=h.engine.pkOperations.view();assert.equal(view.task,null);assert.equal(view.daily.wins,0);
});

test('开始结束只各播报一次，旧事件、暂停和关闭播报时不补发，恢复后去重仍有效',()=>{
  const h=harness();start(h);start(h,{id:'repeat'});
  assert.equal(h.engine.queue.filter(job=>job.text.startsWith('PK开始')).length,1);
  h.engine.ingest({type:'pk-end',battleId:'battle',selfScore:30,opponentScore:20,receivedAt:h.time()});
  assert.match(h.engine.queue.find(job=>job.text.startsWith('PK结束')).text,/获胜/);
  const snapshot=h.engine.snapshot(),restored=new Engine({config:h.engine.config,now:h.time});restored.restore(snapshot);restored.start();
  restored.ingest({type:'pk-end',battleId:'battle',id:'end-again',selfScore:30,opponentScore:20,receivedAt:h.time()});
  assert.equal(restored.queue.filter(job=>job.text.startsWith('PK结束')).length,1);
  const old=harness();start(old,{at:old.time()-30000});assert.equal(old.engine.queue.length,0);
  const paused=harness();paused.engine.stop();start(paused);assert.equal(paused.engine.queue.length,0);
});

test('临近零点仅在准备和到点窗口提示；活动PK、断线、迟到和跨日不会补开局提醒',()=>{
  const h=harness();h.engine.config.pkOperations.midnightEnabled=true;
  h.engine.pkOperations.tick(true);assert.equal(h.engine.queue.length,0);
  h.set(at('2026-10-24T23:54:05'));h.engine.pkOperations.tick(true);h.engine.pkOperations.tick(true);
  assert.equal(h.engine.queue.length,1);assert.match(h.engine.queue[0].text,/23:55:05/);
  h.set(at('2026-10-24T23:55:05'));h.engine.pkOperations.tick(false);assert.equal(h.engine.queue.length,0);
  h.engine.pkOperations.tick(true);assert.equal(h.engine.queue.length,1);assert.match(h.engine.queue[0].text,/到零点PK/);
  start(h);h.engine.pkOperations.tick(true);assert.ok(h.engine.queue.every(job=>job.pkFeature!=='midnightEnabled'));
  const late=harness(at('2026-10-24T23:55:11'));late.engine.config.pkOperations.midnightEnabled=true;late.engine.pkOperations.tick(true);assert.equal(late.engine.queue.length,0);
  late.set(at('2026-10-25T00:00:00'));late.engine.pkOperations.tick(true);assert.equal(late.engine.queue.length,0);
});

test('多人开局播报名单排除己方，迟到昵称更新尚未发送的提醒，结束分别播报对手分数',()=>{
  const h=harness();
  const event={type:'pk-start',id:'multi-start',battleId:'multi',roomId:'456',remainingMs:60000,receivedAt:h.time(),
    participants:[{anchorId:'123',name:'己方'},{anchorId:'789'},{anchorId:'790'}]};
  h.engine.ingest(event);
  const expires=h.engine.queue[0].expires;
  h.advance(1000);
  h.engine.ingest({type:'pk-score',id:'names',battleId:'multi',participants:[{anchorId:'789',name:'甲'},{anchorId:'790',name:'乙'}],
    scores:[{anchorId:'123',score:30},{anchorId:'789',score:20},{anchorId:'790',score:10}],receivedAt:h.time()});
  const starts=h.engine.queue.filter(job=>job.text.startsWith('PK开始'));
  assert.equal(starts.length,1);assert.match(starts[0].text,/2位对手：甲、乙/);
  assert.doesNotMatch(starts[0].text,/己方|待识别/);assert.equal(starts[0].expires,expires);
  h.engine.ingest({type:'pk-end',battleId:'multi',scores:[{anchorId:'123',score:30},{anchorId:'789',score:20},{anchorId:'790',score:10}],receivedAt:h.time()});
  assert.match(h.engine.queue.find(job=>job.text.startsWith('PK结束')).text,/获胜.*甲20分、乙10分/);
  const sent=harness();sent.engine.ingest(event);sent.engine.queue=[];
  sent.engine.ingest({...event,type:'pk-score',id:'late-names'});
  assert.equal(sent.engine.queue.length,0);
});

test('定时报告只用新鲜页面任务，预览不发送且关闭后撤销排队消息',async()=>{
  const h=harness();h.engine.config.pkOperations.reportEnabled=true;task(h);
  h.engine.pkOperations.tick(true);assert.match(h.engine.queue[0].text,/有效PK 2\/5，首胜未完成/);
  h.engine.pkOperations.tick(true);assert.equal(h.engine.queue.length,2);
  h.advance(300000);h.engine.pkOperations.tick(true);assert.ok(h.engine.queue.some(job=>/待采集.*待确认/.test(job.text)));
  h.engine.config.pkOperations.enabled=false;await h.engine.tick(true);assert.equal(h.engine.queue.length,0);
});

test('新鲜展馆保级信息进入定时报送和 AI 段位上下文，过期后不继续报送',()=>{
  const h=harness();h.engine.config.pkOperations.reportEnabled=true;
  h.engine.ingest({type:'anchor-exhibition-retention',id:'retention',source:'web-exhibition',anchorId:'123',roomId:'456',name:'甄选展馆',remaining:1,receivedAt:h.time()});
  h.engine.pkOperations.tick(true);
  assert.ok(h.engine.queue.some(job=>job.text==='甄选展馆，还差1款保级。'));
  start(h);
  const rank={exhibitionRetention:h.engine.pkOperations.view().exhibitionRetention};
  assert.equal(buildPKStrategyContext(h.engine.pk.current(),{},rank).rank.exhibitionRetention.remaining,1);
  h.engine.queue=[];h.advance(300000);h.engine.pkOperations.tick(true);
  assert.ok(h.engine.queue.every(job=>!job.text.includes('保级')));
});

test('平台拒绝后的重试保留PK原始有效期，异步发送准备期间过期不能提交',async()=>{
  const h=harness();start(h);
  const job=h.engine.queue[0],deadline=job.expires;
  h.engine.queue=[];
  const delivery=h.engine.deliveries.create(job.text,[job],{});h.engine.deliveries.finish(delivery,'failed','平台拒绝');
  h.engine.retryDelivery(delivery);
  assert.equal(h.engine.queue[0].expires,deadline);
  h.advance(15001);h.engine.pkOperations.tick(false);assert.equal(h.engine.queue.length,0);

  const dom=new JSDOM('',{url:'https://live.douyin.com/456'});let current=true,committed=false;
  try {
    const adapter={page:dom.window,healthy:()=>true,requestSender:{prepare:async()=>({available:true,token:'token'}),commit:async()=>{committed=true;}}};
    const result=await DouyinAdapter.prototype.send.call(adapter,'提醒',()=>current,{beforeClick:async()=>{current=false;}});
    assert.equal(result.submitted,false);assert.equal(committed,false);
  } finally {dom.window.close();}
});

test('AI 战略上下文包含双方采样、等级、加成归属和段位，不泄漏ID或编造礼物换分',()=>{
  const h=harness();start(h);
  const pk=h.engine.pk.current();pk.selfUsers=[{id:'viewer-secret',name:'甲',score:3,wealthLevel:40}];pk.opponentUsers=[{id:'rival-secret',name:'乙',score:4,wealthLevel:50}];
  pk.effects=[{active:true,side:'self',name:'加成',multiplier:2,endAt:h.time()+20000}];
  const data=buildPKStrategyContext(pk,{},{beforeRank:{id:'rank-secret',detail:'黄金',level:3}});
  assert.equal(data.competitors[1].contributors[0].wealthLevel,50);assert.equal(data.effects[0].side,'self');
  assert.equal(data.rank.before.detail,'黄金');assert.equal(data.scoreGapToLeader,10);
  const request=makeAIRequest({task:{kind:'pk',data},maxLength:50},h.engine.config.ai),user=JSON.stringify(request.messages[1]);
  for(const secret of ['viewer-secret','rival-secret','rank-secret'])assert.ok(!user.includes(secret));
  assert.match(request.messages[0].content,/钻石不等于PK分/);assert.match(request.messages[0].content,/不可信数据/);
});

test('迟到、结束或领先方变化后的 AI 建议作废，新鲜建议按管理员通道排队并在发送前重新校验',async()=>{
  for(const mode of ['valid','ended','late','leader','disabled']) {
    let resolve;const h=harness(undefined,()=>new Promise(done=>{resolve=done;}));
    h.engine.config.ai.enabled=true;h.engine.config.pkOperations.aiEnabled=true;h.engine.config.pkOperations.announceLifecycle=false;start(h);h.engine.queue=[];
    h.engine.requestPKStrategy(h.engine.pk.current());
    if(mode==='ended')h.engine.ingest({type:'pk-end',battleId:'battle',selfScore:10,opponentScore:20,receivedAt:h.time()});
    if(mode==='late')h.advance(10001);
    if(mode==='leader')h.engine.ingest({type:'pk-score',battleId:'battle',selfScore:100,opponentScore:20,receivedAt:h.time()});
    if(mode==='disabled')h.engine.config.pkOperations.aiEnabled=false;
    resolve('留意己方加成窗口，临近结算预留延迟。');await new Promise(setImmediate);
    const job=h.engine.queue.find(job=>job.pkStrategy);
    if(mode!=='valid'){assert.equal(job,undefined,mode);continue;}
    assert.equal(job.channel,'admin');assert.equal(h.engine.pkOperations.validJob(job),true);
    h.engine.config.pkOperations.aiEnabled=false;assert.equal(h.engine.pkOperations.validJob(job),false);
  }
});

test('请求发送仅在提交前无管理员能力时回退普通弹幕，提交未知结果不重复发送',async()=>{
  const dom=new JSDOM('',{url:'https://live.douyin.com/456'});
  try {
    for(const admin of [true,false]) {
      const calls=[],adapter={page:dom.window,healthy:()=>true};
      adapter.requestSender={prepare:async channel=>{calls.push(channel);return {available:channel==='chat'||admin,token:channel};},commit:async token=>{calls.push(`commit:${token}`);return {submitted:false,clicked:true};}};
      const result=await DouyinAdapter.prototype.send.call(adapter,'PK提醒',()=>true,{channel:'admin'});
      assert.deepEqual(calls,admin?['admin','commit:admin']:['admin','chat','commit:chat']);
      assert.equal(result.channelUsed,admin?'admin':'chat');
      if(!admin)assert.match(result.modeFallback,/管理员/);
    }
  } finally {dom.window.close();}
});

test('无 AI 时战局播报使用固定比分格式，未知或过期比分不生成',()=>{
  const h=harness();h.engine.config.pkOperations.aiEnabled=true;h.engine.config.pkOperations.announceLifecycle=false;start(h);
  h.engine.pkOperations.tick(true);
  assert.match(h.engine.queue[0].text,/PK剩余300秒，己方10分，落后10分/);
  assert.equal(h.engine.pkOperations.strategy.source,'rules');assert.equal(h.engine.stats.aiCalls,0);
  assert.equal(h.engine.pkOperations.validJob(h.engine.queue[0]),true);
  h.advance(120001);h.engine.pkOperations.tick(true);assert.equal(h.engine.queue.length,0);
});

test('开局播报优先 AI 原位替换，失败、跳过、错误数字及繁忙时保留固定格式',async()=>{
  for(const mode of ['success','error','skip','numbers','busy','quota','disabled']){
    let prompt;
    const h=harness(undefined,async value=>{prompt=value;if(mode==='error')throw Error('断网');return mode==='skip'?'[SKIP]':mode==='numbers'?'PK开始，本场第2场，对手对手，剩余300秒。':'PK开始，本场第1场，对手对手，剩余300秒。';});
    h.engine.config.ai.enabled=mode!=='disabled';
    if(mode==='busy')h.engine.aiBusy=true;
    if(mode==='quota')h.engine.calls=Array(h.engine.config.ai.maxPerHour).fill(h.time());
    start(h);const original=h.engine.queue[0],id=original.id;await new Promise(setImmediate);
    assert.equal(h.engine.queue.length,1);assert.equal(h.engine.queue[0].id,id);
    assert.match(original.text,/本场第1场/);assert.match(original.text,/300秒/);assert.ok(!original.aiPending);
    if(mode==='success'){assert.equal(prompt.task.kind,'pk-announcement');assert.equal(prompt.liveContext.pkHistory.session.battles,1);}
  }
});

test('播报 AI 挂起时五秒内保留队列位置，超时用固定格式，迟到结果不追加，暂停后不复活',async()=>{
  for(const mode of ['late','pause']){
    let resolve;const h=harness(undefined,()=>new Promise(done=>{resolve=done;}));h.engine.config.ai.enabled=true;start(h);
    const job=h.engine.queue[0];assert.equal(job.aiPending,true);
    if(mode==='pause')h.engine.stop();
    else {h.advance(5001);await h.engine.tick();assert.equal(h.engine.stats.previews,1);}
    resolve('PK开始，本场第1场，对手对手，剩余300秒。');await new Promise(setImmediate);
    assert.equal(h.engine.queue.length,0);assert.equal(h.engine.aiBusy,false);
  }
});

test('手机段位三项每日任务支持内联括号、拆分节点及有效胜场，拒绝隐藏和冲突值',()=>{
  const dom=new JSDOM(`<section class="userProfile"><h3>PK段位 · 观众英雄榜</h3>
    <div><span>每日首场胜利（0/1）</span></div>
    <div><span>每日8场有效PK</span><b>（4 / 8）</b></div>
    <div><span>每日4场有效PK胜利</span><b>(2/4)</b></div>
    <div hidden><span>每日首场胜利(1/1)</span></div>
    <div id="chatroom"><span>每日8场有效PK(8/8)</span></div></section>`);
  try {
    const d=dom.window.document;
    assert.deepEqual(readPKTasks(d),{valid:4,target:8,firstWin:false,validWins:2,winTarget:4});
    d.querySelector('section').insertAdjacentHTML('beforeend','<div><span>每日首场胜利(1/1)</span></div><div><span>每日8场有效PK(3/8)</span></div>');
    assert.deepEqual(readPKTasks(d),{valid:null,target:null,firstWin:null,validWins:2,winTarget:4});
    d.body.innerHTML='<div role="dialog"><h3>PK段位</h3><div>每日8场有效PK(9/8)</div><div>每日首场胜利(0/2)</div></div>';
    assert.equal(readPKTasks(d),null);
  } finally {dom.window.close();}
});

test('本场胜负平和每局序号按实际直播房间统计，跨日与刷新保留，新开播重置',()=>{
  const h=harness();
  const finish=(battleId,selfScore,opponentScore)=>{
    h.engine.queue=[];h.advance(1000);start(h,{id:`start-${battleId}`,battleId});
    assert.match(h.engine.queue[0].text,new RegExp(`本场第${Number(battleId)}场`));
    h.engine.ingest({type:'pk-end',battleId,selfScore,opponentScore,receivedAt:h.time()});
  };
  finish('1',30,20);finish('2',10,20);finish('3',20,20);
  let s=h.engine.pkOperations.view().session;
  assert.deepEqual([s.battles,s.wins,s.losses,s.draws,s.pendingResults],[3,1,1,1,0]);
  assert.ok(h.engine.queue.some(job=>/本场PK次数3场，胜利1场，失败1场，平局1场/.test(job.text)));
  h.set(at('2026-10-25T00:01:00'));
  const restored=new Engine({config:h.engine.config,now:h.time});restored.restore(h.engine.snapshot());restored.start();
  assert.equal(restored.pkOperations.view().session.battles,3);
  restored.queue=[];restored.ingest({type:'pk-start',id:'four',battleId:'4',roomId:'456',opponentId:'789',receivedAt:h.time()});
  assert.match(restored.queue[0].text,/本场第4场/);
  s=restored.pkOperations.view().session;assert.equal(s.active,1);assert.equal(s.pendingResults,0);
  restored.ingest({type:'pk-end',battleId:'4',receivedAt:h.time()});
  assert.equal(restored.pkOperations.view().session.pendingResults,1);
  restored.ingest({type:'start',roomId:'new-broadcast',receivedAt:h.time(),at:h.time()-3600000});
  assert.equal(restored.pkOperations.view().session.battles,0);
  restored.queue=[];restored.ingest({type:'pk-start',battleId:'5',roomId:'new-broadcast',opponentId:'789',receivedAt:h.time()});
  assert.match(restored.queue[0].text,/本场第1场/);
  restored.config.anchorId='other';assert.equal(restored.pkOperations.view().session.battles,0);
});

test('临时 battle key 升级不重复计数或重复开局通知，迟到名单保留本场序号',()=>{
  const h=harness();start(h,{battleId:undefined,id:'temporary'});
  assert.match(h.engine.queue[0].text,/本场第1场/);
  h.advance(1000);start(h,{id:'real-key',opponentName:'甲'});
  assert.equal(h.engine.pkOperations.view().session.battles,1);
  const jobs=h.engine.queue.filter(job=>job.pkLifecycle==='start');
  assert.equal(jobs.length,1);assert.match(jobs[0].text,/本场第1场.*甲/);
  assert.equal(h.engine.pkOperations.validJob(jobs[0]),true);
});

test('任务有效胜场单独播报，五十字限制内保留本场胜负平且不拿本场胜利填首胜',()=>{
  const h=harness();start(h);h.engine.queue=[];
  task(h,{validWins:2,winTarget:4});h.engine.config.pkOperations.reportEnabled=true;
  h.engine.pkOperations.tick(true);
  assert.ok(h.engine.queue.some(job=>job.text==='平台任务：有效PK胜利2/4场。'));
  assert.ok(h.engine.queue.some(job=>/本场PK次数1场，胜利0场，失败0场，平局0场/.test(job.text)));
  assert.ok(h.engine.queue.every(job=>[...job.text].length<=50 && !/本机结束/.test(job.text)));
  assert.equal(h.engine.pkOperations.view().task.firstWin,false);
});
