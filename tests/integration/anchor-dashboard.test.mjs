import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {AnchorStats} from '../../src/core/anchor-stats.js';
import {AnchorDashboard} from '../../src/ui/anchor-dashboard.js';
import {anchorPageTemplate} from '../../src/ui/anchor-template.js';

const now = Date.parse('2026-10-23T12:00:00+08:00'), DAY = 86400000;
const battle = (key, endedAt, selfScore=100, opponentScore=50) => ({key,roomId:'1',anchorId:'101',anchorName:'<主播甲>',opponentId:'202',opponentName:'<img src=x>',
  phase:'ended',provisional:false,startedAt:endedAt-60000,endedAt,lastEventAt:endedAt,selfScore,opponentScore,selfScoreObserved:true,opponentScoreObserved:true,
  selfScoreAt:endedAt,opponentScoreAt:endedAt,selfScoreMeta:{final:true},opponentScoreMeta:{final:true}});
function setup() {
  const dom = new JSDOM('<body><div></div></body>');
  const root = dom.window.document.querySelector('div').attachShadow({mode:'open'});
  root.innerHTML = anchorPageTemplate('1');
  const stats = new AnchorStats({now:()=>now}), engine = {config:{anchorId:'101',incomeEnabled:true},anchorStats:stats};
  const income = {anchorId:'101',month:'2026-10',days:[{date:'2026-10-23',estimatedIncome:0,unknownCount:2},{date:'2026-10-22',estimatedIncome:50}]};
  const dashboard = new AnchorDashboard(root,()=>dashboard.render(engine,{income}));
  const select = (selector,value) => {const node=root.querySelector(selector);node.value=value;node.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
  const text = selector => root.querySelector(selector).textContent;
  return {dom,root,stats,engine,dashboard,income,select,text,close:()=>{dashboard.destroy();dom.window.close();}};
}

test('时间筛选统一驱动汇总、趋势和全量导出，分页不截断导出且昵称不执行 HTML',()=>{
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
    assert.equal(view.text('[data-anchor-stat=winRate]'),'0%');
    assert.equal(view.dashboard.exportReport().income,null);
    view.select('[data-anchor-picker]','');
    view.engine.config.incomeEnabled=false;
    view.dashboard.render(view.engine,{income:view.income});
    assert.equal(view.text('[data-anchor-stat=income]'),'未知');
    assert.equal(view.dashboard.exportReport().income,null);
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

test('无关直播刷新不聚合或重建图表；新数据、主播切换和北京时间跨日会更新',()=>{
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
    assert.equal(view.dashboard.exportReport().summary.battles,0);assert.equal(reports,3);
    view.select('[data-anchor-picker]','202');assert.equal(reports,4);
  } finally {view.close();}
});
