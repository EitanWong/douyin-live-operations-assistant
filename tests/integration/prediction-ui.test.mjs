import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {predictionView} from '../../src/tools/predictions/view.js';
import {predictionsTool} from '../../src/tools/predictions/index.js';
import {forecastReport} from '../../src/analytics/forecast.js';
import {parseSettings} from '../../src/analytics/schema.js';
test('prediction page explains missing evidence, saves scenarios and never interprets viewer text as HTML',async()=>{
 const dom=new JSDOM(predictionView.template()),root=dom.window.document;
 const panel={root,demo:false,text:(s,t)=>{root.querySelector(s).textContent=t;},disabled:(s,b)=>{root.querySelector(s).disabled=b;},toast(){}};
 const r=forecastReport({scope:'1:2',now:Date.now(),settings:parseSettings({}),minutes:[],sessions:[],users:[],forecasts:[],history:[],outcomes:[],connected:false});
 predictionView.update(panel,{report:r});assert.match(root.querySelector('[data-pred-revenue]').textContent,/不足|需要/);
 r.viewers=[{name:'<img src=x onerror=alert(1)>',id:'uid:9',probability:null,reasons:['缺少样本']}];
 predictionView.update(panel,{report:r});assert.equal(root.querySelectorAll('img').length,0);assert.match(root.querySelector('[data-pred-viewers]').textContent,/<img/);
 const calls=[];root.querySelector('[data-pred-setting=plannedDays]').value='10';
 await predictionView.actions.save(panel,(...args)=>calls.push(args));assert.equal(calls[0][0],'settings');assert.equal(calls[0][1].plannedDays,10);
 dom.window.close();
});
test('read-only prediction tool remains functional when automation is stopped and reports errors without disabling host',async()=>{
 const states=[],calls=[];let fail=false;
 const tool=predictionsTool.mount({services:{predictions:{report:async()=>fail?{phase:'unavailable',reason:'存储暂不可用'}:{phase:'ready'},call:async(a,v)=>calls.push([a,v])}},publish:s=>states.push(s)});
 await tool.actions.refresh();assert.equal(states.at(-1).report.phase,'ready');
 await tool.actions.settings({enabled:false});assert.equal(calls[0][0],'settings');
 fail=true;await tool.actions.refresh();assert.equal(states.at(-1).report.reason,'存储暂不可用');
});

test('prediction analytics live inside anchor data, with no duplicate top-level navigation',async()=>{
 const {Panel}=await import('../../src/ui/panel.js'),{copy,DEFAULTS,Engine}=await import('../../src/core/engine.js');
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1',pretendToBeVisual:true});
 for(const key of ['document','window','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];globalThis.CSS={escape:v=>v};globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);
 const panel=new Panel({config:copy(DEFAULTS),room:'1',callbacks:{}});
 try{
  assert.equal(panel.root.querySelector('[data-tab=predictions]'),null);
  assert.equal(panel.root.querySelector('[data-tab=pk]'),null);
  assert.equal(panel.root.querySelector('[data-page=pk]'),null);
  assert.equal(panel.activeTab,'anchor');
  assert.ok(panel.root.querySelector('[data-page=anchor] [data-tool-panel=predictions]'));
  panel.tab('anchor');assert.equal(panel.root.querySelector('[data-tool-panel=predictions]').hidden,false);
  assert.ok(panel.root.querySelectorAll('[data-pred-chart]').length>=6);
  const engine=new Engine({config:copy(DEFAULTS)}),now=Date.now(),drawn=[];
  engine.pk.ingest({type:'pk-start',battleId:'embedded',anchorId:'1',opponentId:'2',remainingMs:60000,receivedAt:now});
  engine.pk.ingest({type:'pk-score',battleId:'embedded',selfScore:100,opponentScore:80,remainingMs:59000,receivedAt:now});
  panel.charts.render=data=>drawn.push(data);panel.refresh(engine);assert.equal(drawn.length,0);
  const pk=panel.node('[data-anchor-content=pk]'),settings=panel.node('[data-pk-settings]'),interval=panel.node('[data-field="pkOperations.reportSec"]');
  assert.ok(pk.contains(settings));assert.equal(pk.hidden,true);
  panel.node('[data-anchor-view=pk]').click();assert.equal(pk.hidden,false);assert.equal(panel.isPKVisible(),true);
  assert.equal(drawn.at(-1).key,'embedded');assert.equal(panel.node('[data-pk-self-score]').textContent,'100');
  engine.pk.ingest({type:'pk-score',battleId:'embedded',selfScore:150,opponentScore:120,remainingMs:58000,receivedAt:now+1000});panel.refresh(engine);
  assert.equal(panel.node('[data-pk-self-score]').textContent,'150');assert.equal(drawn.at(-1).selfScore,150);
  settings.open=true;interval.value='90';
  panel.setAnchorView('income');assert.equal(panel.isPKVisible(),false);assert.equal(pk.hidden,true);
  panel.tab('pk');assert.equal(panel.activeTab,'anchor');assert.equal(panel.anchorView,'pk');assert.equal(pk.hidden,false);
  assert.equal(settings.open,true);assert.equal(interval.value,'90');assert.equal(panel.dirty,false);
  panel.setAnchorView('overview');panel.revealError(interval);assert.equal(panel.anchorView,'pk');
  assert.equal(panel.root.querySelectorAll('[data-field="pkOperations.reportSec"]').length,1);
 }finally{panel.destroy();dom.window.close();}
});
