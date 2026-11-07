import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {boot} from '../../src/app.js';

test('共享连接更新运行配置与未编辑表单，同时保留本主播节奏和正在编辑的草稿',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1234567890',pretendToBeVisual:true});
 for(const key of ['document','window','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];
 globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};let api;const values=new Map(),requests=[];
 try{
  boot({page:dom.window,get:(key,fallback)=>values.get(key) ?? fallback,set:async(key,value)=>values.set(key,value),del:async key=>values.delete(key),request:details=>{requests.push(details);details.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:'测试成功'}}]})});},adapterFactory:()=>({status:{},hook(){},observeDOM(){},stopDOM(){},healthy:()=>false,sync(){}}),identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>api=value});
  const until=Date.now()+3000;while(!api && Date.now()<until)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(api);
  const saved=structuredClone(api.engine.config);saved.ai.model='shared-model';saved.ai.pipeline.workspaceId='shared-space';saved.ai.replyFrequency='every';
  const frequency=api.engine.config.ai.replyFrequency;
  api.sharedKnowledgeChanged(saved);
  assert.equal(api.engine.config.ai.model,'shared-model');assert.equal(api.engine.config.ai.replyFrequency,frequency);
  assert.equal(api.panel.node('[data-field="ai.pipeline.workspaceId"]').value,'shared-space');
  const beforeSearchEndpoint=api.engine.config.ai.search.endpoint,searchKey=api.panel.node('[data-search-key]');searchKey.value='fixture-search-draft';searchKey.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(api.panel.dirty,true,'填写搜索密钥也属于待保存草稿');
  saved.ai.search.endpoint='https://search.example/search';api.sharedKnowledgeChanged(saved);
  assert.equal(api.engine.config.ai.search.endpoint,'https://search.example/search');assert.equal(api.panel.node('[data-field="ai.search.endpoint"]').value,beforeSearchEndpoint);assert.equal(searchKey.value,'fixture-search-draft');
  const persona=api.panel.node('[data-field="ai.persona"]');persona.value='未保存的主播风格';api.panel.markDirty();persona.focus();
  saved.ai.model='new-shared-model';api.sharedKnowledgeChanged(saved);
  assert.equal(api.engine.config.ai.model,'new-shared-model');assert.equal(persona.value,'未保存的主播风格');assert.equal(api.panel.root.activeElement,persona);
  assert.equal(api.panel.read().ai.model,'shared-model','编辑中的服务草稿保留，由保存时三方合并处理');
  await api.panel.callbacks.testAI(api.engine.config,'fixture-key',true);
  values.set('live-assistant:api-key:https://api.deepseek.com','fixture-replaced-key');
  await api.panel.callbacks.testAI(api.engine.config,'',false);
  assert.equal(requests.at(-1).headers.Authorization,'Bearer fixture-replaced-key','已记住的旧密钥不被页面会话副本遮盖');
 }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});

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
      const data=JSON.parse(request.messages[1].content),context=data.live_context;
      assert.equal(context.income.totalDiamonds,30);assert.equal(context.income.estimatedIncome,1.5);
      assert.equal(context.audience.online,15);assert.equal(data.recent_chat.at(-1).text,'今天聊旅行');assert.equal(request.messages[1].content.split('今天聊旅行').length-1,1);
      assert.ok(!JSON.stringify(context).includes('viewer-private'));assert.ok(!JSON.stringify(context).includes('broadcast-private'));
    }
    assert.equal(requests.length,2);
  }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});
