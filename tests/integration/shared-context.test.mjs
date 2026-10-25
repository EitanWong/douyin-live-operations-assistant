import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {boot} from '../../src/app.js';

test('应用将当前场次账本、暂停时弹幕和观众数据传给话术生成与连接测试',async()=>{
  const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890?anchor_id=123',pretendToBeVisual:true});
  for(const key of ['document','window','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];
  globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
  const values=new Map(),requests=[];let api,onEvent;
  const waitFor=async predicate=>{
    const until=Date.now()+3000;
    while(!predicate() && Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(predicate(),'等待应用采集上下文超时');
  };
  try{
    boot({page:dom.window,get:(key,fallback)=>structuredClone(values.get(key) ?? fallback),set:async(key,value)=>values.set(key,structuredClone(value)),del:key=>values.delete(key),all:()=>Object.fromEntries(values),
      request:details=>{const request=JSON.parse(details.data);requests.push(request);details.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:requests.length===1 ? '["欢迎{user}"]':'你好'}}]})});},
      adapterFactory:options=>{onEvent=options.onEvent;return {status:{},hook(){},observeDOM(){},stopDOM(){},healthy:()=>false,sync(){}};},
      identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>api=value});
    await waitFor(()=>api);
    const at=Date.now();
    await onEvent({type:'start',roomId:'broadcast-private',at,receivedAt:at,source:'platform'});
    await onEvent({type:'gift',id:'gift1',roomId:'broadcast-private',giftId:'gift-private',giftName:'星星',count:3,unitValue:10,final:true,user:{id:'viewer-private',name:'小鱼'},receivedAt:Date.now()});
    await onEvent({type:'room-audience',onlineCount:15,receivedAt:Date.now(),ranks:[{rank:1,score:30,user:{id:'viewer-private',name:'小鱼',wealthLevel:20}}]});
    await onEvent({type:'chat',id:'chat1',user:{id:'viewer-private',name:'小鱼'},text:'今天聊旅行',receivedAt:Date.now()});
    await waitFor(()=>api.engine.aiContext().liveContext.income?.source==='durable-ledger' && api.engine.aiContext().liveContext.income?.totalDiamonds===30);
    assert.equal(api.engine.running,false);
    const c=structuredClone(api.engine.config);c.ai.endpoint='http://localhost:11434/v1/chat/completions';c.ai.model='test';
    assert.deepEqual(await api.panel.callbacks.generatePhrases(c,'',false,{kind:'welcome'}),['欢迎{user}']);
    await api.panel.callbacks.testAI(c,'',false);
    for(const request of requests){
      const context=JSON.parse(request.messages[1].content).live_context;
      assert.equal(context.income.totalDiamonds,30);assert.equal(context.income.estimatedIncome,1.5);
      assert.equal(context.audience.online,15);assert.equal(context.recentChat.at(-1).text,'今天聊旅行');
      assert.ok(!JSON.stringify(context).includes('viewer-private'));assert.ok(!JSON.stringify(context).includes('broadcast-private'));
    }
    assert.equal(requests.length,2);
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});
