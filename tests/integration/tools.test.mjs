import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {ToolRuntime} from '../../src/tools/runtime.js';
import {ToolRegistry} from '../../src/tools/registry.js';
import {toolOperations} from '../../src/tools/gateway.js';
import {bundledTools} from '../../src/tools/bundled.js';
import {Panel} from '../../src/ui/panel.js';
import {DEFAULTS,copy} from '../../src/core/engine.js';
import {boot} from '../../src/app.js';
import {GiftLedger} from '../../src/data/gifts.js';
import {webLocks} from '../helpers/web-locks.mjs';

const flush=()=>new Promise(setImmediate);
function page(html='') {
  const dom=new JSDOM(`<body>${html}</body>`,{url:'https://live.douyin.com/123',pretendToBeVisual:true});
  for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:value=>value};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:webLocks()}});
  dom.window.Element.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{width:100,height:30}];};
  return dom;
}
const bag='<section class="gbRklVwV" data-activity-id="bag-1"><div>福袋 总30钻</div><div>倒计时 01:58</div><button data-participate>立即参与</button></section>';
function lotteryServices(page) {
  const now=Math.floor(Date.now()/1000),roomId='7702463172476701483',lotteryId='7702521633959316287';
  return {page,log(){},selfId:()=>'987654321',roomId:()=>roomId,
    rewardEvents:()=>[{type:'activity-signal',activityKind:'lottery-start',roomId,lotteryId,startedAt:String(now-10),drawAt:String(now+120)}]};
}

test('两个真实工具共用宿主，点赞未知结果不重发且不阻塞福袋；重建后活动仍去重',async()=>{
  const dom=page(bag),config=copy(DEFAULTS);config.rewards.enabled=true;
  let clicks=0,commits=0,lotteryCommits=0,guard='';
  dom.window.document.querySelector('[data-participate]').onclick=()=>{clicks++;};
  const host=new ToolRuntime({registry:bundledTools,room:'123',guard:()=>guard,getConfig:id=>config[id],services:lotteryServices(dom.window),
    createLock:()=>{const lock={held:false,acquire:async()=>{lock.held=true;return true;},release:()=>{lock.held=false;}};return lock;},
    operations:toolOperations({transport:{prepareLike:async()=>({available:true,token:'t'}),commitLike:async()=>{commits++;return {submitted:false,reason:'结果未知'};},stopLike:async()=>{},
      prepareLottery:async()=>({available:true,token:'lottery'}),commitLottery:async()=>{lotteryCommits++;return {submitted:false,dispatched:true,unknown:true};},stopLottery:async()=>{}},
      getRewardsConfig:()=>config.rewards,selfId:()=>'987654321',click:node=>node.click(),saveConfig:async(key,value)=>{config[key]=value;}})});
  try {
    await host.start();await host.invoke('auto-like','start',{batch:20,intervalSec:2,target:100});
    assert.equal(commits,1);assert.equal(host.state('auto-like').phase,'stopped');
    host.notify('tick');await flush();assert.equal(lotteryCommits,1);assert.equal(host.state('rewards').submitted,1);assert.equal(clicks,0);
    await host.restart('rewards');host.notify('tick');await flush();assert.equal(lotteryCommits,1,'未知请求跨实例仍不重复');
    await host.disable('auto-like');await host.suspend();await host.resume();
    assert.equal(host.status().find(x=>x.id==='auto-like').phase,'disabled','BFCache 恢复不重启手动停用的工具');
    assert.equal(host.status().find(x=>x.id==='rewards').phase,'active');
    guard='连接中断';await host.invoke('rewards','stop');assert.equal(config.rewards.enabled,false,'断线时仍可关闭自动参与设置');
    assert.equal(commits,1);assert.equal(lotteryCommits,1);assert.equal(clicks,0);
  } finally {await host.close();dom.window.close();}
});

test('新增包内工具通过一份注册信息生成导航、页面、状态与按钮，通用管理可独立停用重启',async()=>{
  const dom=page(),calls=[];
  const sample={id:'sample',label:'样例工具',icon:'heart',version:'1.0.0',apiVersion:1,capabilities:[],mount:()=>({actions:{}}),view:{
    template:()=>'<section class="page" id="page-sample" data-page="sample" role="tabpanel" aria-labelledby="tab-sample" hidden><p data-sample-status></p><button data-action="sample-run" type="button">运行样例</button></section>',
    update:(panel,state)=>panel.text('[data-sample-status]',state.reason),actions:{run:(panel,invoke)=>invoke('run','value')}
  }};
  const panel=new Panel({config:copy(DEFAULTS),room:'123',tools:new ToolRegistry([...bundledTools.list(),sample]),callbacks:{
    toolAction:(...args)=>calls.push(args),toolControl:async(id,action)=>{calls.push([id,action]);panel.updateToolState(id,{phase:'stopped',hostPhase:'disabled',reason:'已停用'});}
  }});
  try {
    panel.node('[data-tab=sample]').click();assert.equal(panel.activeCategory,'tools');assert.equal(panel.node('[data-page=sample]').hidden,false);
    panel.updateToolState('sample',{phase:'idle',hostPhase:'active',reason:'样例就绪'});assert.equal(panel.node('[data-sample-status]').textContent,'样例就绪');
    panel.node('[data-action=sample-run]').click();await flush();assert.deepEqual(calls[0],['sample','run','value']);
    panel.node('[data-tool-id=sample][data-tool-control=disable]').click();await flush();
    assert.deepEqual(calls[1],['sample','disable']);assert.equal(panel.node('[data-action=sample-run]').disabled,true);
    panel.node('[data-tool-id=sample][data-tool-control=restart]').click();await flush();assert.deepEqual(calls[2],['sample','restart']);
  } finally {panel.destroy();dom.window.close();}
});

test('应用层停用和 BFCache 恢复走统一宿主，日志确认与礼物入账仍走原链路',async()=>{
  const dom=page(),values=new Map([['live-assistant:config:123',{mode:'preview',automation:{autoStart:false},gift:{responseMode:'fixed'}}]]);
  let api,onEvent;const acknowledged=[];
  const get=(key,fallback)=>structuredClone(values.get(key)??fallback),set=async(key,value)=>{values.set(key,structuredClone(value));};
  const engine=boot({page:dom.window,get,set,del:key=>values.delete(key),request:()=>assert.fail('不调用 AI'),
    journal:{ackMany:async keys=>{assert.ok(values.get('live-assistant:runtime:123'),'必须先保存检查点');acknowledged.push(...keys);}},
    adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>true};},
    identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>{api=value;}});
  try {
    await api.tools.ready;await api.tools.disable('auto-like');engine.start();
    await onEvent({type:'gift',id:'gift-1',_journalKey:'journal-1',groupId:'g',giftId:'1',giftName:'玫瑰',unitValue:1,count:1,final:true,user:{id:'u',name:'观众'}});
    await new Promise(resolve=>setTimeout(resolve,150));await api.checkpoint();
    assert.ok(acknowledged.includes('journal-1'));assert.equal(new GiftLedger({state:values.get('live-assistant:income:123')}).summary().totalDiamonds,1);
    const deliveries=engine.deliveries.snapshot();
    const hide=new dom.window.Event('pagehide');Object.defineProperty(hide,'persisted',{value:true});dom.window.dispatchEvent(hide);
    await flush();assert.ok(api.tools.status().every(x=>x.phase==='disabled'));
    const show=new dom.window.Event('pageshow');Object.defineProperty(show,'persisted',{value:true});dom.window.dispatchEvent(show);await flush();
    assert.equal(api.tools.status().find(x=>x.id==='auto-like').phase,'disabled');
    assert.equal(api.tools.status().find(x=>x.id==='rewards').phase,'active');
    assert.deepEqual(engine.deliveries.snapshot(),deliveries);assert.equal(engine.stats.submitted,0);
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));await api.tools.close();api.panel.destroy();dom.window.close();}
});


test('应用只用当前场次的下播停止工具，query 切房后不再接收事件',async()=>{
  const dom=page();dom.reconfigure({url:'https://live.douyin.com/?room_id=123'});
  let api,onEvent;const values=new Map();
  const engine=boot({page:dom.window,get:(key,fallback)=>values.get(key)??fallback,set:async(key,value)=>values.set(key,value),del:key=>values.delete(key),request:()=>{},
    adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},sync(){},healthy:()=>true};},
    identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>{api=value;}});
  try {
    await api.tools.ready;const stops=[];const notify=api.tools.notify.bind(api.tools);
    api.tools.notify=(name,value)=>{if(name==='stop')stops.push(value);notify(name,value);};
    const at=Date.now()-10000;
    await onEvent({type:'start',roomId:'session-new',at,startAt:at});
    await onEvent({type:'end',roomId:'session-old',at:at+1000});
    await onEvent({type:'end',roomId:'session-new',at:at-1000});
    assert.equal(stops.length,0,'旧房间和乱序下播均不能停止当前工具');
    const ending=onEvent({type:'end',roomId:'session-new',at:at+2000});
    assert.equal(stops.length,1,'当前场次下播不等待存储才停止工具');await ending;
    dom.window.history.replaceState({},'','/?room_id=456');
    await onEvent({type:'start',roomId:'other-session',at:at+3000});
    assert.equal(engine.liveMode.roomId,'session-new','同 pathname 的房间切换不能污染旧实例');
  } finally {dom.window.dispatchEvent(new dom.window.Event('pagehide'));await api.tools.close();api.panel.destroy();dom.window.close();}
});

test('真实工具按钮处理非法参数、运行中停止和福袋配置落盘，状态与控件保持一致',async()=>{
  const dom=page(bag),config=copy(DEFAULTS),locks=[];config.rewards.enabled=true;
  let commits=0,panel;
  const host=new ToolRuntime({registry:bundledTools,room:'123',getConfig:id=>config[id],services:lotteryServices(dom.window),
    createLock:()=>{const lock={held:false,acquire:async()=>{lock.held=true;return true;},release(){this.held=false;}};locks.push(lock);return lock;},
    operations:toolOperations({transport:{prepareLike:async()=>({available:true,token:'local'}),commitLike:async(token,count)=>{commits++;return {submitted:true,count};},stopLike:async()=>{},
      prepareLottery:async()=>({available:true,token:'lottery'}),commitLottery:async()=>({submitted:true,dispatched:true}),stopLottery:async()=>{}},
      getRewardsConfig:()=>config.rewards,selfId:()=>'987654321',click:node=>node.click(),saveConfig:async(id,value)=>{config[id]=value;}}),
    changed:(id,state)=>panel?.updateToolState(id,state)});
  panel=new Panel({room:'123',config,tools:bundledTools,callbacks:{toolAction:(...args)=>host.invoke(...args)}});
  const until=async(predicate)=>{for(let i=0;i<50&&!predicate();i++)await flush();assert.ok(predicate());};
  try {
    await host.start();const input=panel.node('[data-auto-like=batch]'),start=panel.node('[data-action=auto-like-start]'),stop=panel.node('[data-action=auto-like-stop]');
    input.value='101';start.click();await until(()=>!start.disabled);
    assert.equal(commits,0);assert.match(panel.node('.toast').textContent,/整数/);
    input.value='3';panel.node('[data-auto-like=target]').value='7';start.click();
    await until(()=>host.state('auto-like').accepted===3);
    assert.equal(start.disabled,true);assert.equal(stop.disabled,false);assert.equal(input.disabled,true);
    stop.click();await until(()=>host.state('auto-like').phase==='stopped');
    assert.equal(start.disabled,false);assert.equal(stop.disabled,true);assert.equal(input.disabled,false);assert.equal(commits,1);assert.equal(locks[0].held,false);
    host.notify('tick');await until(()=>host.state('rewards').submitted===1);
    panel.node('[data-action=rewards-stop]').click();await until(()=>!config.rewards.enabled);
    await until(()=>!panel.node('[data-field="rewards.enabled"]').checked);
    assert.equal(host.state('rewards').phase,'stopped');assert.equal(locks[1].held,false);
  }finally{await host.close();panel.destroy();dom.window.close();}
});
