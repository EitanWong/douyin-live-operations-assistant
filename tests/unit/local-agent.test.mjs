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
