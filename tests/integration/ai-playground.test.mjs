import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {Panel} from '../../src/ui/panel.js';
import {copy,DEFAULTS} from '../../src/core/engine.js';
import {AI_TEST_CASES} from '../../src/services/ai-playground.js';
import {AIPlayground} from '../../src/ui/ai-playground.js';
import {createWorkspaceBridge} from '../../src/ui/product/bridge.js';
import {boot} from '../../src/app.js';
const flush=()=>new Promise(setImmediate);
const walk=node=>[node,...(node?.children || []).flatMap(walk)];
function page(){
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123',pretendToBeVisual:true});
 for(const key of ['document','window','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];
 globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};return dom;
}
const result=(question,extra={})=>({question,status:'succeeded',answer:'答案。[1]',intent:'web-search',provider:'cloud',model:'test-model',calls:{cloud:2,local:0},elapsedMs:321,checks:[{label:'有效来源',pass:true}],sources:[{index:1,title:'公开资料',url:'https://source.example/',content:'依据正文'}],query:'问题检索',searchedAt:1800000000000,...extra});
function fixture(service){
 const dom=page(),panel=new Panel({room:'123',config:copy(DEFAULTS),callbacks:{}});let exported;
 const ui=new AIPlayground(panel.root,{service,describe:()=> '已保存 · test-model',exportReport:value=>exported=value});
 return {dom,panel,ui,exported:()=>exported,close(){ui.close();panel.destroy();dom.window.close();}};
}
test('扩展工具的AI问答支持真实可见投影、任意问题、连续对话、选项和来源',async()=>{
 const inputs=[],f=fixture({run:async value=>{inputs.push(value);value.onProgress({stage:'search',query:'查资料'});return result(value.question);}});
 const bridge=createWorkspaceBridge(f.panel);
 try{
  f.panel.tab('ai');f.panel.node('[data-ai-section-tab="playground"]').click();await flush();assert.equal(f.panel.activeCategory,'settings');
  assert.equal(f.panel.node('[data-tab="ai-playground"]'),null);assert.equal(f.panel.node('[data-ai-section="playground"]').hidden,false);
  const controls=()=>walk(bridge.getSnapshot().content);
  const question=controls().find(row=>row.kind==='field' && row.label==='测试问题');assert.ok(question);
  bridge.change(question.id,'怎么查询规则？');bridge.activate(controls().find(row=>row.kind==='button' && row.text==='测试回复').id);await flush();
  assert.equal(inputs[0].question,'怎么查询规则？');assert.equal(inputs[0].mode,'direct');assert.match(f.panel.node('[data-playground-results]').textContent,/答案|公开资料|321/u);
  assert.equal(f.panel.node('[data-playground-results] a').href,'https://source.example/');
  f.panel.node('[data-playground-question]').value='继续问';f.panel.node('[data-playground-fresh]').checked=true;
  f.panel.node('[data-playground-mode]').value='contextual';f.panel.node('[data-playground-run]').click();await flush();
  assert.equal(inputs[1].turns.length,1);assert.equal(inputs[1].fresh,true);assert.equal(inputs[1].mode,'contextual');assert.equal(f.panel.dirty,false);
  f.panel.node('[data-playground-export]').click();assert.equal(f.exported().results.length,2);assert.ok(!JSON.stringify(f.exported()).includes('test-key'));
 }finally{bridge.destroy();f.close();}
});
test('重复点击只运行一次，取消、清空与迟到结果不污染新会话',async()=>{
 let resolve,calls=0;const f=fixture({run:value=>{calls++;return new Promise(done=>resolve=()=>done(result(value.question)));}});
 try{
  const run=f.panel.node('[data-playground-run]');f.panel.node('[data-playground-question]').value='待取消';run.click();run.click();await flush();assert.equal(calls,1);assert.equal(run.disabled,true);
  f.panel.node('[data-playground-cancel]').click();f.panel.node('[data-playground-clear]').click();resolve();await flush();
  assert.equal(f.ui.records.length,0);assert.doesNotMatch(f.panel.node('[data-playground-results]').textContent,/待取消/u);assert.equal(run.disabled,false);
  f.panel.node('[data-playground-question]').value='';run.click();await flush();assert.equal(calls,1);assert.match(f.panel.node('[data-playground-status]').textContent,/问题/u);
 }finally{f.close();}
});
test('预设场景串行运行且相互独立，显示基本检查与人工核对提示',async()=>{
 const calls=[];let active=0,max=0;const f=fixture({run:async value=>{active++;max=Math.max(max,active);calls.push(value);await flush();active--;return result(value.question);}});
 try{
  f.panel.node('[data-playground-suite]').click();for(let i=0;i<100 && calls.length<AI_TEST_CASES.length;i++)await flush();await flush();
  assert.equal(calls.length,AI_TEST_CASES.length);assert.equal(max,1);assert.ok(calls.every(c=>c.turns.length===0 && c.testCase));
  assert.equal(f.ui.records.length,AI_TEST_CASES.length);assert.match(f.panel.node('[data-ai-section="playground"]').textContent,/人工核对/u);
  assert.equal(f.panel.node('[data-playground-suite]').disabled,false);
  f.panel.node('[data-playground-question]').value='手动继续';f.panel.node('[data-playground-run]').click();await flush();await flush();
  assert.equal(calls[AI_TEST_CASES.length].turns.length,0,'批量测试结果不混入连续问答');
 }finally{f.close();}
});
test('服务失败可重试，恶意模型内容按纯文本显示，危险来源不生成链接',async()=>{
 let fail=true;const f=fixture({run:async({question})=>{if(fail)throw Error('测试断网');return result(question,{answer:'<img src=x onerror=bad()>',sources:[{index:1,title:'<script>bad</script>',url:'javascript:alert(1)',content:'正文'}]});}});
 try{
  f.panel.node('[data-playground-question]').value='测试';f.panel.node('[data-playground-run]').click();await flush();assert.match(f.panel.node('[data-playground-results]').textContent,/测试断网/u);
  fail=false;f.panel.node('[data-playground-run]').click();await flush();const results=f.panel.node('[data-playground-results]');
  assert.equal(results.querySelector('img,script,a'),null);assert.match(results.textContent,/<img/u);assert.equal(f.ui.records.length,2);
 }finally{f.close();}
});

test('关闭工具中止在途测试，取消场景组不再启动后续付费调用',async()=>{
 let finish,calls=0,signal;const f=fixture({run:options=>{calls++;signal=options.signal;return new Promise(resolve=>finish=()=>resolve(result(options.question)));}});
 try{
  f.panel.node('[data-playground-suite]').click();await flush();f.panel.node('[data-playground-cancel]').click();assert.equal(signal.aborted,true);
  finish();await flush();assert.equal(calls,1);assert.equal(f.ui.records[0].status,'cancelled');
  f.panel.node('[data-playground-question]').value='关闭测试';f.panel.node('[data-playground-run]').click();await flush();f.ui.close();assert.equal(signal.aborted,true);
  finish();await flush();assert.equal(f.ui.records.length,1);assert.equal(calls,2);
 }finally{f.close();}
});
test('质量汇总将内容检查失败计为待改进，重新运行和清空会重置本轮统计',async()=>{
 let calls=0;const f=fixture({run:async({question})=>result(question,{checks:[{label:'给出正确低温',pass:++calls%2===0}]})});
 try{
  f.panel.node('[data-playground-suite]').click();for(let i=0;i<100 && f.ui.busy;i++)await flush();
  assert.match(f.panel.node('[data-playground-summary]').textContent,/已运行 12\/12，达标 6，待改进 6/u);
  f.panel.node('[data-playground-clear]').click();assert.match(f.panel.node('[data-playground-summary]').textContent,/尚未运行/u);
  assert.equal(f.ui.records.length,0);
 }finally{f.close();}
});
test('应用内入口贯通当前密钥、搜索、模型与预览，暂停场控也能测且没有发送',async()=>{
 const dom=page(),values=new Map([['live-assistant:config:demo',{ai:{search:{enabled:true},edge:{enabled:false}},automation:{autoStart:false}}],['live-assistant:api-key:https://api.deepseek.com','model-key'],['live-assistant:search-key:https://api.bochaai.com','search-key']]);
 let api,searches=0,calls=0;const sent=[];
 boot({demo:true,get:(key,fallback)=>structuredClone(values.get(key)??fallback),set:async(key,value)=>values.set(key,structuredClone(value)),del:key=>values.delete(key),all:()=>Object.fromEntries(values),
  request:d=>{
   let output;if(d.operation==='search'){searches++;assert.equal(d.headers.Authorization,'Bearer search-key');output={code:200,data:{webPages:{value:[{name:'测量资料',url:'https://source.example/',summary:'赤鹤星周期73天。'}]}}};}
   else{calls++;assert.equal(d.headers.Authorization,'Bearer model-key');const input=JSON.parse(JSON.parse(d.data).messages[1].content);output={choices:[{message:{content:input.web_search ? '赤鹤星周期73天。[1]' : '{"intent":"web-search","query":"赤鹤星周期","reply":""}'}}]};}
   d.onload({status:200,responseText:JSON.stringify(output)});
  },send:text=>sent.push(text),adapterFactory:()=>({status:{},sync(){},observeDOM(){},stopDOM(){},healthy:()=>true}),onReady:value=>api=value});
 try{
  for(let i=0;i<50 && !api;i++)await flush();assert.ok(api);api.panel.tab('ai');api.panel.node('[data-ai-section-tab="playground"]').click();
  api.panel.node('[data-playground-question]').value='赤鹤星周期是多少？';api.panel.node('[data-playground-run]').click();
  for(let i=0;i<100 && !api.panel.node('[data-playground-results]').textContent.includes('73天');i++)await flush();
  assert.match(api.panel.node('[data-playground-results]').textContent,/赤鹤星周期73天。\[1\]/u);
  assert.equal(calls,2);assert.equal(searches,1);assert.equal(api.engine.running,false);assert.equal(api.engine.queue.length,0);assert.deepEqual(sent,[]);
  assert.equal(api.engine.calls.length,0);assert.equal(api.engine.config.ai.enabled,false);
 }finally{dom.window.dispatchEvent(new dom.window.Event('pagehide'));api?.panel.destroy();dom.window.close();}
});
