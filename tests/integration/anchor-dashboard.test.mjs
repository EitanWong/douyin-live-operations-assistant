import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {AnchorStats} from '../../src/core/anchor-stats.js';
import {AnchorDashboard} from '../../src/ui/anchor-dashboard.js';
import {anchorPageTemplate} from '../../src/ui/anchor-template.js';

const now = Date.parse('2026-10-23T12:00:00+08:00'), DAY = 86400000;
test('主播数据展示粉丝团人数、点亮人数、成员等级亲密度和数据范围，导出保留且切主播隔离',()=>{
  const view=setup();
  try {
    view.stats.ingest({type:'anchor-fanclub',source:'native-fanclub',anchorId:'101',roomId:'100',receivedAt:now,
      title:'一只开心的粉丝团',fansCount:'14343',lightedCount:'88',hiddenInactive:true,
      members:[{position:1,name:'<img src=x>',level:18,badgeName:'只开心',intimacy:'1609000',intimacyDisplay:'160.9万',intimacyApproximate:true}]});
    view.dashboard.render(view.engine,{income:view.income});
    assert.equal(view.text('[data-anchor-fanclub-count]'),'14,343');
    assert.equal(view.text('[data-anchor-fanclub-lighted]'),'88');
    assert.match(view.text('[data-anchor-fanclub-members]'),/18.*160.9万/);
    assert.equal(view.root.querySelector('[data-anchor-fanclub-members] img'),null);
    assert.match(view.text('[data-anchor-fanclub-note]'),/不活跃成员.*隐藏/);
    assert.equal(view.dashboard.exportReport().fanclub.members.length,1);
    view.stats.ingest({type:'fansclub-statistics',anchorId:'999',roomId:'999',receivedAt:now,fansCount:'0',name:'另一团'});
    view.dashboard.render(view.engine,{income:view.income});view.select('[data-anchor-picker]','999');
    assert.equal(view.text('[data-anchor-fanclub-count]'),'0');
    assert.equal(view.text('[data-anchor-fanclub-lighted]'),'未知');
    assert.doesNotMatch(view.text('[data-anchor-fanclub-members]'),/160.9万/);
  } finally {view.close();}
});
test('主播数据页展示匹配直播场次的点赞，保留缩略口径、零值、历史隔离与导出',()=>{
  const view=setup();
  try {
    view.income.allSessions.forEach((row,i)=>{row.roomId=String(100+i);});
    const event={type:'room-likes',source:'native-room',anchorId:'101',roomId:'100',total:15000,display:'1.5万',approximate:true,receivedAt:now};
    view.stats.ingest(event);view.dashboard.render(view.engine,{income:view.income});
    assert.equal(view.text('[data-anchor-likes]'),'1.5万');
    assert.match(view.text('[data-anchor-likes-note]'),/缩略/);
    assert.equal(view.dashboard.exportReport().likes[0].total,15000);
    view.stats.ingest({...event,type:'like',source:'websocket',total:15432,approximate:false});
    view.dashboard.render(view.engine,{income:view.income});
    assert.equal(view.text('[data-anchor-likes]'),'15,432');
    view.select('[data-anchor-session-picker]','live-1');
    assert.equal(view.text('[data-anchor-likes]'),'未知');
    view.stats.ingest({...event,roomId:'101',total:0,display:'0',approximate:false});
    view.dashboard.render(view.engine,{income:view.income});
    assert.equal(view.text('[data-anchor-likes]'),'0');
    view.stats.ingest({type:'pk-rank-season',anchorId:'999',id:'other-rank',receivedAt:now,afterRank:{detail:'钻石'}});
    view.dashboard.render(view.engine,{income:view.income});
    view.select('[data-anchor-picker]','999');
    assert.equal(view.text('[data-anchor-likes]'),'未知');
  } finally {view.close();}
});
const battle = (key, endedAt, selfScore=100, opponentScore=50) => ({key,roomId:'1',anchorId:'101',anchorName:'<主播甲>',opponentId:'202',opponentName:'<img src=x>',
  phase:'ended',provisional:false,startedAt:endedAt-60000,endedAt,lastEventAt:endedAt,selfScore,opponentScore,selfScoreObserved:true,opponentScoreObserved:true,
  selfScoreAt:endedAt,opponentScoreAt:endedAt,selfScoreMeta:{final:true},opponentScoreMeta:{final:true}});
function setup() {
  const dom = new JSDOM('<body><div></div></body>');
  const root = dom.window.document.querySelector('div').attachShadow({mode:'open'});
  root.innerHTML = anchorPageTemplate('1');
  const stats = new AnchorStats({now:()=>now}), engine = {config:{anchorId:'101',incomeEnabled:true},anchorStats:stats};
  const sessions = Array.from({length:35},(_,i)=>({id:`live-${i}`,roomId:`broadcast-${i}`,startAt:now-i*DAY-3600000,endAt:i ? now-i*DAY+1000 : 0,startSource:'platform',endSource:i ? 'platform' : '',estimatedIncome:i ? 50 : 0,unknownCount:i ? 0 : 2}));
  const income = {anchorId:'101',month:'2026-10',days:[{date:'2026-10-23',estimatedIncome:99999}],allSessions:sessions,currentSession:sessions[0]};
  const dashboard = new AnchorDashboard(root,()=>dashboard.render(engine,{income}));
  const select = (selector,value) => {const node=root.querySelector(selector);node.value=value;node.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
  const text = selector => root.querySelector(selector).textContent;
  return {dom,root,stats,engine,dashboard,income,select,text,close:()=>{dashboard.destroy();dom.window.close();}};
}

test('主播段位区关联展馆保级观测，保留实际 PK 段位并提示过期',()=>{
  const view=setup();
  try {
    view.stats.ingest({type:'pk-rank-season',anchorId:'101',id:'rank',receivedAt:now,afterRank:{detail:'钻石'}});
    view.stats.ingest({type:'anchor-exhibition-retention',source:'web-exhibition',anchorId:'101',roomId:'1',receivedAt:now-130000,name:'甄选展馆',remaining:1});
    view.dashboard.render(view.engine,{income:view.income});
    assert.equal(view.text('[data-anchor-rank]'),'钻石');
    assert.match(view.text('[data-anchor-rank-note]'),/甄选展馆.*还差1款.*过期/);
    assert.equal(view.dashboard.exportReport().exhibitionRetention.remaining,1);
  } finally {view.close();}
});

test('直播场次筛选统一驱动汇总、趋势和全量导出，分页不截断导出且昵称不执行 HTML',()=>{
  const view=setup();
  try {
    for(let i=0;i<25;i++) view.stats.ingestBattle(battle(`today-${i}`,now-i*1000));
    view.stats.ingestBattle(battle('yesterday',now-DAY,0,0));
    view.stats.ingestBattle(battle('old',now-40*DAY,10,50));
    view.dashboard.render(view.engine,{income:view.income});
    assert.equal(view.text('[data-anchor-stat=battles]'),'25');
    assert.equal(view.text('[data-anchor-stat=winRate]'),'100%');
    assert.equal(view.root.querySelectorAll('[data-anchor-battles] tr').length,20);
    assert.equal(view.root.querySelector('img'),null);
    assert.match(view.text('[data-anchor-battles]'),/<img src=x>/);
    view.root.querySelector('[data-anchor-page="1"]').click();
    assert.equal(view.root.querySelectorAll('[data-anchor-battles] tr').length,5);
    assert.equal(view.dashboard.exportReport().battles.length,25);
    view.root.querySelector('[data-anchor-period="7"]').click();
    const exported=view.dashboard.exportReport();
    assert.equal(exported.summary.battles,26);assert.equal(exported.summary.draws,1);assert.equal(exported.trend.length,7);
    assert.equal(exported.period,'7');assert.equal(exported.battles.length,26);
    exported.battles[0].score=99999;
    assert.equal(view.dashboard.exportReport().battles[0].score,100);
    view.root.querySelector('[data-anchor-period=all]').click();
    assert.equal(view.dashboard.exportReport().summary.battles,27);
    assert.equal(view.dashboard.exportReport().trend.length,30);
  } finally {view.close();}
});

test('收入按 UID 隔离，零收入可展示，关闭统计后不能继续导出旧金额',()=>{
  const view=setup();
  try {
    view.stats.ingestBattle(battle('round',now));
    view.dashboard.render(view.engine,{income:view.income});
    assert.match(view.text('[data-anchor-stat=income]'),/0\.00/);
    assert.match(view.text('[data-anchor-income-note]'),/2.*未知/);
    view.select('[data-anchor-picker]','202');
    assert.equal(view.text('[data-anchor-stat=income]'),'未知');
    assert.equal(view.text('[data-anchor-stat=winRate]'),'未知');
    assert.equal(view.dashboard.exportReport().income,null);
    view.select('[data-anchor-picker]','');
    view.engine.config.incomeEnabled=false;
    view.dashboard.render(view.engine,{income:view.income});
    assert.equal(view.text('[data-anchor-stat=income]'),'未知');
    assert.equal(view.dashboard.exportReport().income,null);
    assert.equal(view.dashboard.exportReport().sessions[0].estimatedIncome,undefined);
    assert.match(view.text('[data-anchor-income-note]'),/未启用/);
  } finally {view.close();}
});

test('展馆进度支持零值和任务分页筛选，段位数字字符串可视化，分块未完整返回有提示',()=>{
  const view=setup();
  try {
    view.stats.ingest({type:'pk-rank-season',id:'rank',anchorId:'101',receivedAt:now,afterRank:{detail:'璀璨钻石',starCount:'0',targetStarCount:'5'}});
    for(let chunk=0;chunk<2;chunk++)view.stats.ingest({type:'anchor-exhibition',anchorId:'101',snapshotId:'snapshot',receivedAt:now,section:'lighted_items',chunk,chunks:3,totalItems:21,
      summary:{level:0,gradeLevel:0,stars:{current:0,target:20}},items:Array.from({length:10},(_,i)=>({giftId:`${chunk*10+i+1}`,name:'<script>礼物</script>',lighted:chunk===0,received:0,threshold:2,
        task:chunk===0?{current:0,target:3,rewardStars:5,finished:false}:null}))});
    view.dashboard.render(view.engine,{income:view.income});
    assert.match(view.text('[data-anchor-exhibition-level]'),/等级 0.*0 层/);
    assert.equal(view.root.querySelector('[data-anchor-rank-progress] [role=progressbar]').getAttribute('aria-valuenow'),'0');
    assert.equal(view.root.querySelectorAll('[data-anchor-gifts] li').length,12);
    assert.equal(view.root.querySelector('[data-anchor-gifts] script'),null);
    assert.match(view.text('[data-anchor-exhibition-note]'),/未完整/);
    view.root.querySelector('[data-anchor-gift-page="1"]').click();
    assert.equal(view.root.querySelectorAll('[data-anchor-gifts] li').length,8);
    view.select('[data-anchor-gift-filter]','tasks');
    assert.equal(view.root.querySelectorAll('[data-anchor-gifts] li').length,10);
    assert.match(view.text('[data-anchor-gifts]'),/奖励 5 星/);
    view.select('[data-anchor-gift-filter]','unlighted');
    assert.equal(view.root.querySelectorAll('[data-anchor-gifts] li').length,10);
  } finally {view.close();}
});

test('无关直播刷新不聚合或重建图表；新数据会更新，跨日不重置本场统计',()=>{
  const view=setup();
  try {
    let observedAt=now, reports=0;
    view.stats.now=()=>observedAt;
    const report=view.stats.report.bind(view.stats);view.stats.report=(...args)=>{reports++;return report(...args);};
    view.stats.ingestBattle(battle('round',now));view.dashboard.render(view.engine,{income:view.income});
    const bar=view.root.querySelector('[data-anchor-trend] .stat-bar');
    for(let i=0;i<100;i++)view.dashboard.render(view.engine,{income:view.income});
    assert.equal(reports,1);assert.equal(view.root.querySelector('[data-anchor-trend] .stat-bar'),bar);
    view.stats.ingestBattle(battle('round2',now));view.dashboard.render(view.engine,{income:view.income});
    assert.equal(view.text('[data-anchor-stat=battles]'),'2');assert.equal(reports,2);
    observedAt+=DAY;view.dashboard.render(view.engine,{income:view.income});
    assert.equal(view.dashboard.exportReport().summary.battles,2);assert.equal(reports,3);
    view.select('[data-anchor-picker]','202');assert.equal(reports,4);
  } finally {view.close();}
});


test('选择历史单场同步收入和 PK，开播下播时长与导出保留整场边界',()=>{
  const view=setup();
  try {
    view.stats.ingestBattle(battle('latest',now));
    view.stats.ingestBattle(battle('older',now-DAY));
    view.dashboard.render(view.engine,{income:view.income});
    assert.match(view.text('[data-anchor-end]'),/直播中/);
    view.select('[data-anchor-session-picker]','live-1');
    assert.match(view.text('[data-anchor-stat=income]'),/50\.00/);
    assert.equal(view.text('[data-anchor-stat=battles]'),'1');
    assert.match(view.text('[data-anchor-period-note]'),/所选场次/);
    assert.match(view.text('[data-anchor-start]'),/2026.*10.*22.*11:00:00/);
    assert.match(view.text('[data-anchor-end]'),/12:00:01/);
    assert.match(view.text('[data-anchor-duration]'),/1 小时/);
    const exported=view.dashboard.exportReport();
    assert.equal(exported.sessions.length,1);
    assert.equal(exported.session.id,'live-1');
    assert.equal(exported.income.sessions[0].estimatedIncome,50);
    view.root.querySelector('[data-anchor-period=session]').click();
    assert.match(view.text('[data-anchor-stat=income]'),/0\.00/);
    assert.match(view.text('[data-anchor-end]'),/直播中/);
  } finally {view.close();}
});

test('没有场次边界的旧日账不用于当前收入，零礼物场次仍显示开播记录',()=>{
  const view=setup();
  try {
    view.dashboard.render(view.engine,{income:{anchorId:'101',days:[{date:'2026-10-23',estimatedIncome:999}]}});
    assert.equal(view.text('[data-anchor-stat=income]'),'未知');
    assert.equal(view.text('[data-anchor-start]'),'未采集');
    view.dashboard.render(view.engine,{income:view.income});
    assert.match(view.text('[data-anchor-stat=income]'),/0\.00/);
    assert.match(view.text('[data-anchor-start]'),/11:00:00/);
  } finally {view.close();}
});
