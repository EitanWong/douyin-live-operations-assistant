import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {RewardAutomation,REWARDS_DEFAULTS} from '../../src/browser/rewards.js';
import {DEFAULTS,mergeConfig,validateConfig} from '../../src/core/engine.js';

function fixture(html='',options={}) {
  const dom=new JSDOM(`<body>${html}</body>`,{url:'https://live.douyin.com/123'}),page=dom.window;
  page.Element.prototype.getClientRects=function(){return this.closest('[hidden]')?[]:[{width:100,height:30}];};
  let now=1800000000000,guard='';const config={...REWARDS_DEFAULTS,enabled:true,entryXPath:'',...options};
  const lock={held:false,acquire:async()=>{lock.held=true;return true;},release:()=>{lock.held=false;}};
  const updates=[],runner=new RewardAutomation({page,room:'123',getConfig:()=>config,lock,guard:()=>guard,now:()=>now,changed:state=>updates.push(state)});
  const step=async(ms=1000)=>{now+=ms;await runner.tick();};
  return {dom,page,document:page.document,runner,lock,config,updates,step,now:()=>now,advance:ms=>{now+=ms;},setGuard:value=>{guard=value;}};
}
const bagPanel=(time='00:58',status='立即参与')=>`<div class="gbRklVwV"><div>总30钻</div><div>3个福袋 12人已参与</div><div>倒计时 ${time}</div><div data-participate>${status}</div></div>`;

test('旧配置补齐默认关闭的福袋红包工具，拒绝错误开关和过长定位',()=>{
  assert.deepEqual(validateConfig(mergeConfig({})).rewards,REWARDS_DEFAULTS);
  assert.equal(DEFAULTS.rewards.enabled,false);
  assert.throws(()=>mergeConfig({rewards:{enabled:'true'}}),/类型/);
  assert.throws(()=>validateConfig(mergeConfig({rewards:{entryXPath:'button'}})),/XPath/);
  assert.throws(()=>validateConfig(mergeConfig({rewards:{entryXPath:'/'+ 'a'.repeat(2000)}})),/XPath/);
});

test('真实页面福袋入口和 div 按钮：打开、点击一次，网页确认后才计成功',async()=>{
  const f=fixture('<div class="QZx73YMI"><div class="LMUtLyr9">01:00</div></div>');let opens=0,clicks=0;
  try {
    f.document.querySelector('.QZx73YMI').addEventListener('click',()=>{opens++;f.document.body.insertAdjacentHTML('beforeend',bagPanel());f.document.querySelector('[data-participate]').addEventListener('click',event=>{clicks++;event.target.textContent='已参与';});});
    await f.step();assert.equal(opens,1);assert.equal(clicks,0);
    await f.step();assert.equal(clicks,1);assert.equal(f.runner.state.submitted,1);assert.equal(f.runner.state.confirmed,0);
    await f.step();assert.equal(f.runner.state.confirmed,1);
    for(let i=0;i<15;i++)await f.step();
    assert.equal(clicks,1);assert.equal(opens,1);assert.equal(f.runner.state.confirmed,1);
  } finally {f.dom.window.close();}
});

test('红包分开开关，领取按钮和新一轮活动 ID 独立去重',async()=>{
  const f=fixture('<div class="QZx73YMI"><div class="redpacket"></div></div>',{luckyBag:false});let clicks=0;
  try {
    f.document.querySelector('.QZx73YMI').addEventListener('click',()=>{f.document.body.insertAdjacentHTML('beforeend','<section role="dialog" data-activity-id="red-1"><h3>直播红包</h3><button>拆红包</button></section>');f.document.querySelector('button').onclick=()=>clicks++;});
    await f.step();await f.step();await f.step();assert.equal(clicks,1);
    f.document.querySelector('[role=dialog]').dataset.activityId='red-2';await f.step();assert.equal(clicks,2);
    f.config.redPacket=false;f.document.querySelector('[role=dialog]').dataset.activityId='red-3';await f.step();assert.equal(clicks,2);assert.equal(f.lock.held,false);
  } finally {f.dom.window.close();}
});

test('倒计时和节点重建不会重复提交，下一轮开奖时间变化后可继续',async()=>{
  const f=fixture(bagPanel());let clicks=0;
  try {
    f.document.body.addEventListener('click',event=>{if(event.target.matches('[data-participate]'))clicks++;});
    await f.step();
    for(let i=0;i<20;i++) {f.document.body.innerHTML=bagPanel(`00:${String(57-i).padStart(2,'0')}`);await f.step();}
    assert.equal(clicks,1);assert.equal(f.runner.state.confirmed,0);
    f.document.body.innerHTML=bagPanel('02:00');await f.step();assert.equal(clicks,2);
  } finally {f.dom.window.close();}
});

test('已参与、任务、付费、登录、禁用、隐藏和结束状态都不提交',async()=>{
  const variants=[bagPanel('00:50','已参与'),bagPanel('00:50','立即参与') .replace('总30钻','参与条件：关注主播'),bagPanel().replace('总30钻','赠送礼物参与'),bagPanel().replace('总30钻','请登录'),bagPanel().replace('data-participate','data-participate aria-disabled="true"'),bagPanel().replace('data-participate','data-participate hidden'),bagPanel('00:00'),bagPanel().replace('总30钻','活动已结束')];
  for(const html of variants) {
    const f=fixture(html);let clicks=0;
    try {f.document.body.onclick=()=>clicks++;await f.step();assert.equal(clicks,0,html);assert.equal(f.runner.state.submitted,0);}
    finally {f.dom.window.close();}
  }
});

test('有条件的福袋不会阻塞同时出现的红包',async()=>{
  const f=fixture(bagPanel().replace('总30钻','参与条件：送礼')+'<div class="QZx73YMI"><div class="redpacket"></div></div>');let claimed=0;
  try {
    f.document.querySelector('.redpacket').parentElement.onclick=()=>{f.document.body.insertAdjacentHTML('beforeend','<section role="dialog" data-activity-id="r"><h3>红包</h3><button>立即领取</button></section>');f.document.querySelector('button').onclick=()=>claimed++;};
    await f.step();await f.step();assert.equal(claimed,1);
  } finally {f.dom.window.close();}
});

test('已满足条件后继续参与；单个已完成条件不能覆盖另一个未完成条件',async()=>{
  const f=fixture('<section role="dialog"><h3>福袋</h3><div>参与条件：</div><div><span>关注主播</span><span>已完成</span></div><button>立即参与</button></section>');let clicks=0;
  try {
    f.document.querySelector('button').onclick=()=>clicks++;
    const requirement=f.document.createElement('div');requirement.innerHTML='<span>发送弹幕</span><span>去完成</span>';f.document.querySelector('section').append(requirement);
    await f.step();assert.equal(clicks,0);
    requirement.remove();await f.step();assert.equal(clicks,1);
  } finally {f.dom.window.close();}
});

test('漂移的 XPath、弹幕、助手面板及普通领取按钮不被误点',async()=>{
  const f=fixture('<button id="unrelated">领取</button><div class="webcast-chatroom"><div>福袋</div><div>立即参与</div></div><div id="douyin-live-assistant"><section role="dialog">红包<button>立即领取</button></section></div>',{entryXPath:'/html/body/button'});let clicks=0;
  try {f.document.body.onclick=()=>clicks++;await f.step();assert.equal(clicks,0);}
  finally {f.dom.window.close();}
});

test('锁等待期间停止、关闭开关或切房都不继续点击',async()=>{
  for(const stop of [f=>f.runner.stop(),f=>{f.config.enabled=false;},f=>f.setGuard('切房')]) {
    const f=fixture(bagPanel());let resolve,clicks=0;
    try {
      f.lock.acquire=()=>new Promise(done=>{resolve=done;});f.document.body.onclick=()=>clicks++;
      const pending=f.step();stop(f);resolve(true);await pending;
      assert.equal(clicks,0);assert.equal(f.lock.held,false);
    } finally {f.dom.window.close();}
  }
});

test('刷新恢复保留未知提交，锁被其他标签页占用时不参与',async()=>{
  const f=fixture(bagPanel());let clicks=0;
  try {
    f.document.body.onclick=()=>clicks++;await f.step();assert.equal(clicks,1);
    const restored=new RewardAutomation({page:f.page,room:'123',getConfig:()=>f.config,lock:f.lock,now:f.now});
    await restored.tick();assert.equal(clicks,1);
    f.lock.acquire=async()=>false;f.document.body.innerHTML=bagPanel('03:00');await f.step();assert.equal(clicks,1);assert.match(f.runner.state.reason,/另一个标签页/);
  } finally {f.dom.window.close();}
});

test('福袋去重在持锁后从共享存储重读，跨标签页接管且按账号隔离',async()=>{
  const a=fixture(bagPanel()),b=fixture(bagPanel()),records=new Map();let clicks=0,account='789';
  const storage={get:async key=>structuredClone(records.get(key)||[]),set:async(key,value)=>records.set(key,structuredClone(value))};
  const runner=f=>new RewardAutomation({page:f.page,room:'123',getConfig:()=>f.config,lock:f.lock,now:f.now,storage,getAccount:()=>account});
  const first=runner(a),second=runner(b);
  try {
    a.document.body.onclick=b.document.body.onclick=()=>clicks++;
    await first.tick();assert.equal(clicks,1);first.stop();
    await second.tick();assert.equal(clicks,1,'接管者必须读取此前预留');
    account='456';b.document.body.innerHTML=bagPanel();b.advance(2000);
    const other=runner(b);await other.tick();assert.equal(clicks,2,'不同账号独立参与');
  } finally {a.dom.window.close();b.dom.window.close();}
});

test('明确未派发的点击可重试；未知点击保留预留，存储失败不点击',async()=>{
  for(const failure of ['before','unknown','storage']) {
    const f=fixture(bagPanel());let clicks=0,calls=0;
    const storage={get:async()=>[],set:async()=>{if(failure==='storage')throw Error('disk');}};
    const runner=new RewardAutomation({page:f.page,room:'123',getConfig:()=>f.config,lock:f.lock,now:f.now,
      ...(failure==='storage'?{storage}:{}),click:async node=>{calls++;if(calls===1)throw Object.assign(Error('click failed'),failure==='before'?{dispatched:false}:{});node.click();}});
    try {
      f.document.body.onclick=()=>clicks++;await runner.tick();
      assert.equal(runner.state.submitted,0,'派发前不能宣称已点击');
      f.advance(2000);await runner.tick();
      assert.equal(clicks,failure==='before'?1:0);
    } finally {f.dom.window.close();}
  }
});

test('升级时保留旧页面未知参与记录，迁移写入失败时不删除旧副本',async()=>{
  for(const fail of [false,true]) {
    const f=fixture(bagPanel());let clicks=0;const records=new Map();
    const key='douyin-live-assistant:rewards:123';
    f.page.sessionStorage.setItem(key,JSON.stringify([{kind:'luckyBag',key:'luckyBag:old',deadline:f.now()+58000,at:f.now(),status:'unknown'}]));
    const runner=new RewardAutomation({page:f.page,room:'123',getConfig:()=>f.config,lock:f.lock,now:f.now,getAccount:()=> '789',
      storage:{get:async name=>records.get(name),set:async(name,value)=>{if(fail)throw Error('disk');records.set(name,structuredClone(value));}}});
    try {
      f.document.body.onclick=()=>clicks++;await runner.tick();assert.equal(clicks,0,'升级不能重复未知参与');
      if(fail)assert.ok(f.page.sessionStorage.getItem(key),'写入失败保留旧数据');
      else {assert.equal(f.page.sessionStorage.getItem(key),null);assert.equal(records.get('live-assistant:rewards:123:789')[0].status,'unknown');}
    } finally {f.dom.window.close();}
  }
});


test('活动预留持久化期间按钮、条件或活动身份改变时不点击，后续有效活动仍可参与',async()=>{
  const variants={text:f=>{f.document.querySelector('[data-participate]').textContent='购买参与';},
    conditions:f=>{f.document.querySelector('.gbRklVwV').insertAdjacentHTML('afterbegin','<div>参与条件：送礼</div>');},
    identity:f=>{f.document.querySelector('.gbRklVwV').dataset.activityId='next';},
    disabled:f=>{f.document.querySelector('[data-participate]').setAttribute('aria-disabled','true');},
    detached:f=>{f.document.querySelector('[data-participate]').remove();},
    hidden:f=>{f.document.querySelector('.gbRklVwV').hidden=true;},
    ended:f=>{f.document.querySelector('.gbRklVwV').insertAdjacentHTML('beforeend','<div>活动已结束</div>');},
    deadline:f=>{f.document.querySelector('.gbRklVwV').children[2].textContent='倒计时 00:00';},
    confirmed:f=>{f.document.querySelector('.gbRklVwV').insertAdjacentHTML('beforeend','<div>已参与</div>');}};
  for(const [kind,mutate] of Object.entries(variants)) {
    const f=fixture(bagPanel());let writes=0,clicks=0;const saved=new Map();
    const runner=new RewardAutomation({page:f.page,room:'123',getConfig:()=>f.config,lock:f.lock,now:f.now,
      storage:{get:async key=>structuredClone(saved.get(key)||[]),set:async(key,value)=>{saved.set(key,structuredClone(value));if(++writes===1)mutate(f);}},
      click:node=>{clicks++;node.click();}});
    try {
      await runner.tick();assert.equal(clicks,0,kind);assert.equal(runner.state.submitted,0,kind);
      f.document.body.innerHTML=bagPanel();f.advance(2000);await runner.tick();assert.equal(clicks,1,kind+' 不应保留明确未派发的预留');
    }finally{f.dom.window.close();}
  }
});

test('等待已参与记录保存期间停用，不会迟到打开另一类活动入口',async()=>{
  const f=fixture(bagPanel('00:58','已参与')+'<button aria-label="红包">红包</button>');let complete,clicks=0;
  const runner=new RewardAutomation({page:f.page,room:'123',getConfig:()=>f.config,lock:f.lock,now:f.now,
    storage:{get:async()=>[],set:()=>new Promise(resolve=>{complete=resolve;})},click:()=>{clicks++;}});
  try {
    const tick=runner.tick();await new Promise(setImmediate);runner.stop();complete();await tick;
    assert.equal(clicks,0);assert.equal(runner.state.phase,'stopped');assert.equal(f.lock.held,false);
  }finally{f.dom.window.close();}
});

test('已派发点击尚未结算时重复 tick 或停用配置不会提前释放房间锁',async()=>{
  const f=fixture(bagPanel());let complete;
  const runner=new RewardAutomation({page:f.page,room:'123',getConfig:()=>f.config,lock:f.lock,now:f.now,
    click:()=>new Promise(resolve=>{complete=resolve;})});
  const first=runner.tick();await new Promise(setImmediate);f.config.enabled=false;
  try {await runner.tick();assert.equal(f.lock.held,true);}
  finally{complete();await first;f.dom.window.close();}
  assert.equal(f.lock.held,false);
});
