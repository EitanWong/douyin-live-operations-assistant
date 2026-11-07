import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLocalAgentTasks} from '../../src/ai/local-agent.js';
import {mergeConfig} from '../../src/core/engine.js';
const until=async check=>{for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,2));}assert.fail('未达到状态');};
test('本地宿主恢复任务前重新核对启用状态，不用旧快照绕过关闭AI',async()=>{
 const ai=mergeConfig().ai,values=new Map([['live-assistant:config:1',{anchorId:'10',ai:{...ai,enabled:false}}],['live-assistant:ai-tasks:1',[{id:'queued-task',scope:'1:10',question:'茶具',input:{anchor:'10',ai,context:{},sources:[]},createdAt:Date.now(),status:'queued',trace:[]}]]]);let requests=0;
 const tasks=createLocalAgentTasks({room:'1',anchor:()=> '10',get:(k,f)=>values.get(k) ?? f,set:(k,v)=>values.set(k,v),getKey:()=> 'key',request:()=>requests++});
 try{await until(async()=> (await tasks.list())[0]?.status==='failed');assert.match((await tasks.list())[0].error,/关闭/);assert.equal(requests,0);}finally{tasks.close();}
});

test('本地宿主保留超过30项仍在排队的长任务',async()=>{
 const values=new Map(),tasks=createLocalAgentTasks({room:'1',anchor:()=> '10',get:(k,f)=>values.get(k) ?? f,set:(k,v)=>values.set(k,v),getKey:()=>'',request:()=>{}});
 try{
  for(let i=0;i<40;i++)await tasks.submit({id:'local-task-'+i,question:'核对资料',input:{}});
  const saved=values.get('live-assistant:ai-tasks:1');assert.equal(saved.filter(row=>row.status==='queued').length,40);
 }finally{await tasks.close();}
});

test('本地研究的手动每小时搜索限额跨任务生效',async()=>{
 const config=mergeConfig({anchorId:'10',ai:{enabled:true,endpoint:'https://model.test/chat/completions',model:'test',assistant:{research:{searchesPerHour:1}},search:{enabled:true,provider:'tavily',endpoint:'https://search.test/search'}}});
 const values=new Map([['live-assistant:config:1',config]]);let models=0,searches=0;
 const tasks=createLocalAgentTasks({room:'1',anchor:()=> '10',get:(k,f)=>values.get(k) ?? f,set:(k,v)=>values.set(k,v),getKey:()=> 'fixture',request:details=>{
  const search=details.operation==='search';if(search)searches++;else models++;
  const content=models%2 ? {action:'search',query:'陶瓷茶杯'} : {action:'finish',answer:'资料尚不足。',citations:searches===1 && models===2 ? [1] : []};
  details.onload({status:200,responseText:JSON.stringify(search ? {results:[{url:'https://example.org/cup',content:'陶瓷茶杯资料'}]} : {choices:[{message:{content:JSON.stringify(content)}}]})});return {abort(){}};
 }});
 try{
  for(const id of ['local-search-a','local-search-b']){await tasks.submit({id,question:'陶瓷茶杯资料',input:{anchor:'10',context:{}}});await until(async()=>['succeeded','failed'].includes((await tasks.list()).find(row=>row.id===id)?.status));}
  assert.equal(searches,1);const second=(await tasks.list())[0];assert.equal(second.status,'succeeded',second.error);assert.match(JSON.stringify(second.result.observations),/额度/);
 }finally{await tasks.close();}
});
