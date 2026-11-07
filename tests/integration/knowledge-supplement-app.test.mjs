import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {boot} from '../../src/app.js';
import {mergeConfig} from '../../src/core/engine.js';
import {createSharedKnowledge} from '../../src/services/shared-knowledge.js';

const text='小雨现在住杭州，是阿明的助理。';
const entry=(id,at)=>({id,title:id,content:`${id}的原有知识`,source:'用户填写',updatedAt:at,enabled:true,expiresOn:''});
const until=async check=>{for(let i=0;i<400;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,3));}assert.fail('等待补充知识超时');};
async function setup(){
 const dom=new JSDOM('<body></body>',{url:'https://live.douyin.com/123',pretendToBeVisual:true});
 for(const key of ['document','window','location','MutationObserver','HTMLElement'])globalThis[key]=dom.window[key];
 globalThis.getComputedStyle=dom.window.getComputedStyle.bind(dom.window);globalThis.CSS={escape:s=>s};
 const values={'live-assistant:config:123':mergeConfig({anchorId:'10',ai:{enabled:true,memory:{entries:[entry('older',Date.now()-2000),entry('newer',Date.now()-1000)]}}})};
 const shared=createSharedKnowledge({read:async key=>values[key],all:async()=>values,commit:async rows=>{for(const [key,value] of rows)values[key]=structuredClone(value);}});
 values['live-assistant:config:123']=await shared.config('123');
 let api,job,saves=0;const submitted=[];
 boot({page:dom.window,get:(key,fallback)=>structuredClone(values[key]??fallback),set:async(key,value)=>{values[key]=structuredClone(value);},del:key=>{delete values[key];},all:()=>values,
  saveConfig:async(config,base)=>{saves++;return shared.save('123',config,base);},
  agentTasks:{submit:async input=>{
   submitted.push(input);const before=await shared.config('123');
   const saved=await shared.supplement('123',[{...entry('agent',Date.now()),content:text,trust:'unverified',supplement:{text,history:[],evidence:[]}}],before.ai.memory.entries,{anchor:'10'});
   api.sharedKnowledgeChanged(await shared.config('123'));
   job={id:input.id,status:'succeeded',result:{knowledgeStored:true,entries:saved,answer:'已补充知识'}};return {id:input.id};
  },list:async()=>job ? [job] : [],cancel:async()=>assert.fail('完成的补充不应被取消')},
  adapterFactory:()=>({status:{},hook(){},observeDOM(){},stopDOM(){},healthy:()=>false,sync(){}}),identityFactory:()=>({refresh:async()=>{},close(){}}),onReady:value=>api=value});
 await until(()=>api);
 const submit=async()=>{
  api.panel.tab('knowledge');api.panel.node('[data-person-add]').click();
  const input=api.panel.node('[data-person-message]');input.value=text;input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));api.panel.node('[data-person-send]').click();
  await until(()=>!api.panel.knowledgeLibrary.personEditor.pending);
  assert.equal(api.panel.node('[data-memory-dialog-error]').hidden,true,api.panel.node('[data-memory-dialog-error]').textContent);
  assert.equal(submitted.length,1);assert.equal(submitted[0].input.supplement.text,text);assert.equal(saves,0,'Agent执行不隐式保存手工草稿');
  assert.match(api.panel.node('[data-person-reply]').textContent,/已保存 1 条知识/);assert.equal((await shared.config('123')).ai.memory.entries.find(row=>row.id==='agent').content,text);
 };
 return {dom,api,shared,submit,close(){dom.window.dispatchEvent(new dom.window.Event('pagehide'));api.panel.destroy();dom.window.close();}};
}

test('未做任何编辑时，知识展示排序不阻挡单段文字直接提交Agent',async()=>{
 const f=await setup();try{
  assert.equal(f.api.panel.dirty,false);assert.deepEqual(f.api.panel.knowledgeLibrary.read().entries.map(row=>row.id),['newer','older']);
  assert.deepEqual(f.api.engine.config.ai.memory.entries.map(row=>row.id),['older','newer']);
  await f.submit();assert.equal(f.api.panel.dirty,false);assert.equal(f.api.panel.knowledgeLibrary.read().entries.length,3);
 }finally{f.close();}
});
test('已有手工知识草稿也可直接交给Agent，自动结果与草稿独立保存',async()=>{
 const f=await setup();try{
  const panel=f.api.panel;panel.node('[data-memory-add]').click();
  panel.node('[data-memory-field="title"]').value='未保存草稿';panel.node('[data-memory-field="content"]').value='手工知识保持原样';panel.node('[data-memory-confirm]').click();
  assert.equal(panel.dirty,true);await f.submit();assert.equal(panel.dirty,true);
  assert.ok(panel.knowledgeLibrary.read().entries.some(row=>row.content==='手工知识保持原样'));
  assert.equal((await f.shared.config('123')).ai.memory.entries.length,3,'后台只保存Agent结果');
  panel.node('[data-memory-cancel]').click();panel.node('[data-action="save"]').click();
  await until(async()=>(await f.shared.config('123')).ai.memory.entries.length===4);
  assert.ok((await f.shared.config('123')).ai.memory.entries.some(row=>row.id==='agent'),'稍后保存草稿不会覆盖Agent知识');
 }finally{f.close();}
});
test('补充任务使用已保存设置，不校验或提交其他表单中未完成的设置草稿',async()=>{
 const f=await setup();try{
  const endpoint=f.api.panel.node('[data-field="ai.endpoint"]');endpoint.value='尚未填写完成的地址';endpoint.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));
  await f.submit();assert.equal(endpoint.value,'尚未填写完成的地址');assert.equal(f.api.panel.dirty,true);
  assert.notEqual(f.api.engine.config.ai.endpoint,endpoint.value);
 }finally{f.close();}
});
