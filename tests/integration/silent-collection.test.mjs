import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {Panel} from '../../src/ui/panel.js';
import {Engine,mergeConfig} from '../../src/core/engine.js';
import {createAgentTaskStore} from '../../src/ai/task-store.js';
import {createBackgroundAI} from '../../extension/ai-background.js';
import {mergeLiveMemory} from '../../src/ai/live-memory.js';
import {createRelationshipLibrary} from '../../src/ai/relationship-library.js';
import {createPageTools} from '../../src/runtime/tool-host.js';
import {webLocks} from '../helpers/web-locks.mjs';
const until=async predicate=>{for(let i=0;i<200;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,5));}assert.fail('后台整理未到达预期状态');};

test('静默收集在真实工具宿主边界阻止点赞准备和提交，切换中只允许清理旧票据',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1'}),calls=[];
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:webLocks()}});
 const engine=new Engine({config:mergeConfig({mode:'collect'})});let prepared;
 const host=createPageTools({page:dom.window,room:'1',engine,demo:false,current:()=>true,unavailable:()=>false,liveStatus:()=>'live',log(){},changed(){},
  adapter:{healthy:()=>true,requestSender:{prepareLike:async()=>{calls.push('prepare');return new Promise(resolve=>prepared=resolve);},commitLike:async()=>{calls.push('commit');return {submitted:true};},stopLike:async()=>calls.push('stop')}}});
 try{
  await host.start();const input={batch:20,intervalSec:2,target:100};
  await assert.rejects(host.invoke('auto-like','start',input),/静默收集/);assert.deepEqual(calls,[]);
  engine.update({...engine.config,mode:'auto'});const pending=host.invoke('auto-like','start',input);
  for(let i=0;i<20 && !prepared;i++)await new Promise(setImmediate);
  assert.ok(prepared);engine.update({...engine.config,mode:'collect'});prepared({available:true,token:'old'});await assert.rejects(pending,/已停止|静默/);
  assert.deepEqual(calls,['prepare','stop'],'模式切换后不能提交点赞，旧票据仍清理');
 }finally{await host.close();dom.window.close();}
});

test('一处选择静默收集，保存模式与AI，切回保留原互动设置，基础采集不可关闭',()=>{
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/1',pretendToBeVisual:true});
 for(const key of ['window','document','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];
 globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:v=>v};
 const panel=new Panel({room:'1',config:mergeConfig({}),callbacks:{}});
 try{
  const mode=panel.node('[data-field="mode"]');mode.value='collect';mode.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  const c=panel.read();assert.equal(c.mode,'collect');assert.equal(c.ai.enabled,true);assert.equal(c.ai.pipeline.mode,'local-audio');
  assert.equal(c.gift.enabled,true,'原互动偏好不被覆盖');assert.equal(panel.node('[data-field="ai.assistant.memoryEnabled"]').disabled,true);
  assert.match(panel.node('[data-mode-note]').textContent,/静默/);
  const engine=new Engine({config:c});engine.start();panel.open=true;panel.refresh(engine);
  for(const selector of ['.launcher span','[data-state]','[data-shell-state]','[data-overview-state]','[data-summary=ai]'])assert.match(panel.node(selector).textContent,/静默收集/,selector);
  mode.value='auto';mode.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.equal(panel.read().gift.enabled,true);
 }finally{panel.destroy();dom.window.close();}
});

test('旧关闭配置的积压语音→后台AI整理→持久原话关系与行为假设→重启去重→删除失效',async()=>{
 const at=Date.now()-600000,config=mergeConfig({mode:'collect',anchorId:'10',ai:{enabled:true,edge:{enabled:false}}}),key='live-assistant:live-memory:1:10';
 const values={'live-assistant:config:1':config,'live-assistant:api-key:https://api.deepseek.com':'test-key',[key]:{version:1,anchor:'10',audience:{version:2,anchor:'10',viewers:[]},perception:{observations:[{id:'speech',kind:'audio',text:'阿明是小雨的师傅。',at,endedAt:at+1000}],forgetBefore:0}}};
 let calls=0;
 const indexedDB=new IDBFactory(),library=createRelationshipLibrary({all:async()=>values}),options={chrome:{permissions:{contains:async()=>true}},readRecord:async k=>structuredClone(values[k]),readConfigs:async()=>({'live-assistant:config:1':config}),saveAnalysis:async(room,anchor,row)=>{values[key]=mergeLiveMemory(values[key],{...values[key],analyses:[row]});},fetch:async()=>{
  calls++;const content=JSON.stringify({people:[{name:'阿明',facts:[],relationships:[{name:'小雨',predicate:'师傅',negative:false,evidence:[{turn:1,quote:'阿明是小雨的师傅'}]}],analysis:[{text:'可能习惯以师徒称谓交流。',limitations:'仅一段原话，不能证明真实身份或稳定行为模式。',evidence:[{turn:1,quote:'阿明是小雨的师傅'}]}],knowledge:[],reply:'待核实'}]});
  return new Response(JSON.stringify({choices:[{message:{content}}]}));
 }};
 let host=createBackgroundAI({...options,store:createAgentTaskStore({indexedDB,IDBKeyRange})});
 try{
  await host.wake();await until(async()=>{const jobs=await host.handle({type:'agent-list'},'1');if(jobs[0]?.status==='failed')assert.fail(jobs[0].error);return jobs[0]?.status==='succeeded';});
  assert.equal(calls,1);assert.equal(values[key].analyses.length,1);
  let graph=await library.query('1','阿明');assert.equal(graph.relations[0].predicate,'师傅');assert.equal(graph.relations[0].status,'unverified');
  assert.equal(graph.entities.find(n=>n.name==='阿明').dossier.analysis.length,1);assert.equal(graph.relations[0].evidence[0].at,at);
  await host.close();host=createBackgroundAI({...options,store:createAgentTaskStore({indexedDB,IDBKeyRange})});await host.wake();assert.equal(calls,1);
  values[key]=mergeLiveMemory(values[key],{...values[key],perception:{observations:[],forgetBefore:Date.now()}});
  graph=await library.query('1','阿明');assert.equal(graph.relations.length,0);assert.equal(values[key].analyses.length,0);
 }finally{await host.close();}
});

for(const scenario of ['local-only','deleted-inflight'])test(`后台原文整理遵守隐私边界：${scenario}`,async()=>{
 const at=Date.now()-600000,key='live-assistant:live-memory:1:10';
 const config=mergeConfig({mode:'collect',anchorId:'10',ai:{enabled:true,pipeline:{mode:'custom'},edge:{enabled:scenario==='local-only',localOnly:scenario==='local-only'}}});
 const values={'live-assistant:config:1':config,'live-assistant:api-key:https://api.deepseek.com':'fixture',[key]:{anchor:'10',audience:{viewers:[]},perception:{observations:[{id:'speech',kind:'audio',text:'阿明是小雨的师傅。',at}]}}};
 let complete,calls=0,saved=0;
 const host=createBackgroundAI({chrome:{permissions:{contains:async()=>true}},readRecord:async k=>structuredClone(values[k]),readConfigs:async()=>({'live-assistant:config:1':config}),saveAnalysis:async()=>saved++,
  store:createAgentTaskStore({indexedDB:new IDBFactory(),IDBKeyRange}),fetch:async()=>{calls++;return new Promise(resolve=>complete=()=>resolve(new Response(JSON.stringify({choices:[{message:{content:'{"people":[]}'}}]}))));}});
 try{
  await host.wake();
  if(scenario==='deleted-inflight'){await until(()=>complete);values[key].perception.observations=[];complete();}
  let job;await until(async()=>{[job]=await host.handle({type:'agent-list'},'1');return job?.status==='failed';});
  assert.equal(saved,0);assert.equal(calls,scenario==='local-only' ? 0 : 1);
  assert.match(job.error,scenario==='local-only' ? /仅本地/ : /原话已删除/);
 }finally{await host.close();}
});
