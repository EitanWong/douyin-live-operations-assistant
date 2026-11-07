import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {createBackgroundAI} from '../../extension/ai-background.js';
import {createAgentTaskStore} from '../../src/ai/task-store.js';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {createRelationshipLibrary} from '../../src/ai/relationship-library.js';
import {mergeConfig} from '../../src/core/engine.js';

const until=async fn=>{for(let i=0;i<200;i++){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,5));}assert.fail('任务未完成');};
test('同域独立密钥贯通持续研究、人物整理和关系图谱，重启去重且遗忘即失效',async()=>{
 const model=kind=>({enabled:true,endpoint:`https://model.test/${kind}/chat/completions`,model:kind});
 const config=mergeConfig({anchorId:'10',ai:{enabled:true,taskModels:{research:model('deep'),profile:model('profile')},assistant:{research:{enabled:true,profileEnabled:true,intervalSec:60,maxPerHour:3}}}});
 const memory=new AudienceMemory({anchor:'10'});memory.observe({type:'chat',source:'socket',id:'one',text:'我喜欢陶瓷，阿明是我的朋友。',receivedAt:Date.now(),user:{id:'2',name:'小雨'}});
 const values={'live-assistant:config:1':config,'live-assistant:task-key:research:https://model.test':'deep-secret','live-assistant:task-key:profile:https://model.test':'profile-secret'};
 const archive=()=>({version:1,anchor:'10',audience:memory.snapshot(),perception:{observations:[]}});
 const all=async()=>({...values,'live-assistant:live-memory:1:10':archive()}),library=createRelationshipLibrary({all});
 const readRecord=async key=>key==='live-assistant:live-memory:1:10' ? archive() : structuredClone(values[key]);
 const storeOptions={indexedDB:new IDBFactory(),IDBKeyRange},requests=[];
 let knowledgeWritten=false;
 const options={chrome:{permissions:{contains:async()=>true}},readRecord,writeRecord:async(k,v)=>values[k]=structuredClone(v),readConfigs:async()=>({'live-assistant:config:1':config}),knowledge:{handle:async(_room,action)=>{if(action==='version')return 0;if(action==='remember'){knowledgeWritten=true;return true;}return [];}},relationships:async(room,q)=>({...await library.query(room,q),...(knowledgeWritten ? {sources:{newResearchSource:true}} : {})}),fetch:async(url,opts)=>{
  const body=JSON.parse(opts.body);requests.push({url,model:body.model,key:opts.headers.Authorization});
  const output=body.model==='deep' ? {action:'finish',answer:'已有原话，关系和爱好仍待核实。',citations:[]} : {facts:[{field:'interests',value:'陶瓷',evidence:[{turn:1,quote:'我喜欢陶瓷'}]}],relationships:[{name:'阿明',predicate:'朋友',negative:false,evidence:[{turn:1,quote:'阿明是我的朋友'}]}],analysis:[{text:'可能乐于交流陶瓷',limitations:'仅依据一次发言，不能判断心理状态。',evidence:[{turn:1,quote:'我喜欢陶瓷'}]}],knowledge:[],reply:'已整理原话。'};
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}));
 }};
 let host=createBackgroundAI({...options,store:createAgentTaskStore(storeOptions)});
 try{
  await host.wake();const task=await until(async()=>{const row=(await host.handle({type:'agent-list'},'1'))[0];return ['succeeded','failed'].includes(row?.status) && row;});
  assert.equal(task.status,'succeeded',task.error);assert.equal(task.result.profileUpdated,true,task.result.profileError);
  assert.deepEqual(requests.map(r=>[r.model,r.key]),[['deep','Bearer deep-secret'],['profile','Bearer profile-secret']]);
  const graph=await library.query('1','小雨的爱好和朋友'),person=graph.entities.find(n=>n.name==='小雨');
  assert.ok(person.dossier.facets.some(r=>r.category==='interests' && r.text==='陶瓷'));
  assert.ok(person.dossier.analysis.some(r=>r.text.includes('可能') && r.limitations && r.evidence[0].quote==='我喜欢陶瓷'));
  assert.ok(graph.relations.some(r=>r.predicate==='朋友' && r.status==='unverified'));
  assert.equal(JSON.stringify(await host.handle({type:'agent-list'},'1')).includes('deep-secret'),false);
  await host.close();host=createBackgroundAI({...options,store:createAgentTaskStore(storeOptions)});await host.wake();assert.equal(requests.length,2);
  memory.forget('uid:2');await host.pruneProfiles('1','10');
  assert.deepEqual(values['live-assistant:profile-insights:1:10'].rows,[]);
  assert.equal((await library.query('1','小雨的朋友')).relations.length,0);
 }finally{await host.close();}
});
