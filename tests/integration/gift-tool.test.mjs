import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {ToolRuntime} from '../../src/tools/runtime.js';
import {ToolRegistry} from '../../src/tools/registry.js';
import {toolOperations,ToolGateway} from '../../src/tools/gateway.js';
import {ToolScope} from '../../src/tools/scope.js';
import {autoGiftTool} from '../../src/tools/auto-gift/index.js';
import {Panel} from '../../src/ui/panel.js';
import {DEFAULTS,copy} from '../../src/core/engine.js';

const flush=()=>new Promise(setImmediate),config={giftId:'463',priceUnits:10,batch:2,target:4,intervalSec:5,budget:3};
test('送礼网关在传输前验证序号、账号及预算，不允许调用方提高数量或重用批次',async()=>{
  const scope=new ToolScope(),lock={held:true,release(){}},calls=[];let account='789';
  const gateway=new ToolGateway({definition:autoGiftTool,scope,room:'123',guard:()=>'',createLock:()=>lock,
    operations:toolOperations({selfId:()=>account,transport:{prepareGift:async()=>({available:true,token:'t'}),
      commitGift:async(...args)=>{calls.push(args);return {submitted:false,unknown:true};},stopGift:async()=>{}}})});
  try {
    await gateway.call('gift.prepare',config);
    await assert.rejects(gateway.call('gift.commit',{token:'t',count:3,sequence:1}),/批次/);
    await gateway.call('gift.commit',{token:'t',count:2,sequence:1});
    await assert.rejects(gateway.call('gift.commit',{token:'t',count:2,sequence:1}),/批次/);
    await assert.rejects(gateway.call('gift.commit',{token:'t',count:2,sequence:2}),/上限/);
    account='other';await assert.rejects(gateway.call('gift.commit',{token:'t',count:1,sequence:2}),/账号/);
    assert.equal(calls.length,1);
  }finally{await scope.close();await gateway.call('gift.stop','t');await gateway.close();}
});
test('送礼界面搜索全部目录、展示锁定原因、要求预算，发送与停止的控件状态一致',async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123',pretendToBeVisual:true});
  for(const name of ['document','window','location','MutationObserver','HTMLElement'])globalThis[name]=dom.window[name];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:value=>value};
  const gifts=[{id:'463',name:'小心心',priceUnits:10,available:true,categories:['推荐']},{id:'789',name:'嘉年华',priceUnits:300000,available:true,categories:['特效']},
    {id:'685',name:'粉丝团灯牌',priceUnits:10,available:false,reason:'请先点亮粉丝团',categories:['粉丝团']}];
  let panel,commits=0;
  const lock={held:false,acquire:async()=>{lock.held=true;return true;},release:()=>{lock.held=false;}};
  const host=new ToolRuntime({registry:new ToolRegistry([autoGiftTool]),room:'123',createLock:()=>lock,changed:(id,state)=>panel?.updateToolState(id,state),
    operations:toolOperations({selfId:()=>'789',transport:{giftSnapshot:async()=>({available:true,balanceUnits:1234,gifts,at:Date.now()}),
      prepareGift:async()=>({available:true,token:'t',balanceUnits:1234}),
      commitGift:async(token,count)=>{commits++;return {submitted:true,count,costUnits:10*count,balanceUnits:1224};},stopGift:async()=>{}}})});
  panel=new Panel({config:copy(DEFAULTS),room:'123',tools:new ToolRegistry([autoGiftTool]),callbacks:{toolAction:(...args)=>host.invoke(...args)}});
  const until=async predicate=>{for(let i=0;i<60 && !predicate();i++)await flush();assert.ok(predicate());};
  try {
    await host.start();panel.node('[data-tab=auto-gift]').click();panel.node('[data-action=auto-gift-refresh]').click();
    await until(()=>panel.node('[data-auto-gift-balance]').textContent.includes('123.4'));
    assert.match(panel.root.querySelector('[data-page=auto-gift]').textContent,/共 3 种 · 当前显示 3 种/);
    const select=panel.node('[data-auto-gift=giftId]'),search=panel.node('[data-auto-gift-search]');
    assert.equal(select.options.length,4);search.value='嘉年华';search.dispatchEvent(new dom.window.Event('input'));
    assert.equal(select.options.length,2);assert.match(select.options[1].text,/30000/);
    search.value='';search.dispatchEvent(new dom.window.Event('input'));select.value='685';select.dispatchEvent(new dom.window.Event('change'));
    assert.match(panel.node('[data-auto-gift-selection]').textContent,/点亮/);assert.equal(panel.node('[data-action=auto-gift-start]').disabled,true);
    select.value='463';select.dispatchEvent(new dom.window.Event('change'));
    panel.node('[data-action=auto-gift-start]').click();await until(()=>!panel.node('[data-action=auto-gift-start]').disabled);
    assert.equal(commits,0);assert.match(panel.node('.toast').textContent,/消费上限/);
    panel.node('[data-auto-gift=budget]').value='3';panel.node('[data-auto-gift=target]').value='4';panel.node('[data-action=auto-gift-start]').click();
    await until(()=>commits===1 && host.state('auto-gift').accepted===1);
    assert.equal(select.disabled,true);assert.equal(panel.node('[data-action=auto-gift-start]').disabled,true);
    panel.node('[data-action=auto-gift-stop]').click();await until(()=>host.state('auto-gift').phase==='stopped');
    assert.equal(select.disabled,false);assert.equal(lock.held,false);assert.match(panel.node('[data-auto-gift-progress]').textContent,/消费 1 钻/);
  }finally{await host.close();panel.destroy();dom.window.close();}
});
