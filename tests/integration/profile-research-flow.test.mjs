import {test} from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {createAgentTaskStore} from '../../src/ai/task-store.js';
import {createBackgroundAI} from '../../extension/ai-background.js';
import {createKnowledgeCorpus} from '../../src/ai/knowledge-corpus.js';
import {createAutomaticKnowledge,createKnowledgeMemory} from '../../src/services/automatic-knowledge.js';
import {createWebKnowledge} from '../../src/services/web-knowledge.js';
import {createAIClient} from '../../src/services/ai.js';
import {mergeConfig} from '../../src/core/engine.js';
const until=async check=>{for(let i=0;i<200;i++){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,5));}assert.fail('人物研究未完成');};
const response=action=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(action)}}]}));
function setup(){
 const config=mergeConfig({anchorId:'10',ai:{enabled:true,endpoint:'https://model.test/chat/completions',model:'test',search:{enabled:true,provider:'tavily',endpoint:'https://search.test/search'}}});
 const memory=new AudienceMemory({anchor:'10'});memory.observe({source:'socket',type:'chat',id:'q',text:'陶瓷茶杯该怎么清洗？',user:{id:'2',name:'茶友',secUid:'viewer_2',wealthLevel:50},receivedAt:Date.now()});
 const values={'live-assistant:config:1':config,'live-assistant:api-key:https://model.test':'test','live-assistant:search-key:https://search.test':'test'};
 const readRecord=async key=>key==='live-assistant:live-memory:1:10' ? {anchor:'10',audience:memory.snapshot()} : structuredClone(values[key]);
 const corpus=createKnowledgeCorpus({read:readRecord,write:async(k,v)=>values[k]=structuredClone(v)});
 const knowledge=createAutomaticKnowledge({corpus,readConfig:async()=>config,readAudience:async()=>memory.snapshot()});
 const store=createAgentTaskStore({indexedDB:new IDBFactory(),IDBKeyRange});
 return {config,memory,values,corpus,knowledge,store,options:{readRecord,knowledge,store,chrome:{permissions:{contains:async()=>true}}}};
}
test('后台由真实等级决定深度，读取已配对主页，个人原文让前台单次调用有据回复',async()=>{
 const f=setup();let models=0,searches=0,collected=[];
 const host=createBackgroundAI({...f.options,collectAccount:async(_room,url)=>{collected.push(url);return [{title:'茶友',text:'公开主页描述：分享陶瓷茶杯清洗方法'}];},fetch:async(url,opts)=>{
  if(url.includes('search.test')){searches++;return new Response(JSON.stringify({results:[{url:`https://example.org/${searches}`,title:'陶瓷茶杯',content:`陶瓷茶杯第${searches}项清洗说明，限用冷水。`}]}));}
  models++;const target=JSON.parse(JSON.parse(opts.body).messages[1].content).target;
  assert.equal(target.profile.key,'uid:2');assert.equal(target.profile.platform.honor.value,50);assert.equal(target.agent_state.budget.modelCalls,0);
  return response(models===6 ? {action:'finish',answer:'使用冷水清洗。',citations:[2]} : models>6 ? {action:'finish',answer:'主页已有采样资料。',citations:[1]} : {action:'search',query:`陶瓷茶杯第${models}项清洗说明`});
 }});
 try{
  await host.handle({type:'agent-submit',id:'profile-deep',question:'陶瓷茶杯清洗',input:{subject:'uid:2',context:{profile:{wealthLevel:0}}}},'1');
  const task=await until(async()=>{const row=(await host.handle({type:'agent-list'},'1'))[0];return ['succeeded','failed'].includes(row?.status) && row;});
  assert.equal(task.status,'succeeded',task.error);assert.equal(models,6);assert.equal(searches,5);assert.equal(task.result.researchTier,'deep');
  assert.deepEqual(collected,['https://www.douyin.com/user/viewer_2']);
  assert.ok((await f.corpus.list('1','10')).every(r=>r.subject==='uid:2'));
  let frontCalls=0;const cache=createWebKnowledge({indexedDB:null}),knowledge=createKnowledgeMemory({cache,anchor:()=> '10',transport:(action,input)=>f.knowledge.handle('1',action,input)});
  const client=createAIClient({knowledge,getKey:()=> 'test',request:d=>{frontCalls++;const candidate=JSON.parse(JSON.parse(d.data).messages[1].content).knowledge_candidates.find(r=>r.results[0].url.includes('example.org'));assert.ok(candidate);d.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:JSON.stringify({intent:'knowledge',query:candidate.id,reply:'用冷水清洗。',sources:[1]})}}]})});}});
  assert.equal(await client({task:{kind:'ai'},target:{text:'陶瓷茶杯清洗',memory:f.memory.context({id:'2'})},maxLength:100},f.config.ai),'用冷水清洗。');assert.equal(frontCalls,1);
  assert.equal((await knowledge.candidates('陶瓷茶杯清洗',f.config.ai.search,{subject:'uid:3'})).length,0);cache.close();
  await host.handle({type:'agent-submit',id:'profile-reuse',question:'茶杯主页资料',input:{subject:'uid:2',context:{}}},'1');
  await until(async()=>(await host.handle({type:'agent-list'},'1')).find(r=>r.id==='profile-reuse')?.status==='succeeded');
  assert.equal(collected.length,1,'仍有效的同人主页原文应先复用，避免重复采集');
 }finally{await host.close();}
});
test('客户端伪造深度无效；生成期间遗忘观众使旧任务失效，不写回原文',async()=>{
 const f=setup();let release,calls=0;
 const host=createBackgroundAI({...f.options,fetch:async()=>{calls++;return new Promise(resolve=>{release=()=>resolve(response({action:'finish',answer:'此前资料',citations:[]}));});}});
 try{
  await host.handle({type:'agent-submit',id:'forgotten-profile',question:'茶杯',input:{subject:'uid:2',context:{}}},'1');
  await until(()=>release);f.memory.forget('uid:2');release();
  const task=await until(async()=>{const r=(await host.handle({type:'agent-list'},'1'))[0];return r?.status==='failed' && r;});
  assert.match(task.error,/人物|观众|画像/);assert.deepEqual(await f.corpus.list('1','10'),[]);
  await host.handle({type:'agent-submit',id:'forged-profile',question:'茶杯',input:{subject:'uid:999',context:{profile:{research:{tier:'deep'}}}}},'1');
  await until(async()=>(await host.handle({type:'agent-list'},'1')).find(r=>r.id==='forged-profile')?.status==='failed');assert.equal(calls,1);
 }finally{await host.close();}
});

test('作品评论和音画进入真实研究请求及记忆时保留发言人、时间和采样边界',async()=>{
 const f=setup(),at=Date.now(),url='https://www.douyin.com/video/70';
 const host=createBackgroundAI({...f.options,collectAccount:async()=>[
  {kind:'comment',title:'评论者',text:'我喜欢陶瓷茶杯',actor:{uid:'3',name:'评论者'},subject:'viewer_2',workId:'70',url,observedAt:at,expiresAt:at+86400000,coverage:'仅加载到的评论'},
  {kind:'transcript',title:'作品语音片段',text:'陶瓷茶杯只限冷水',subject:'viewer_2',workId:'70',url,positionMs:4200,observedAt:at,expiresAt:at+86400000,coverage:'约4秒音轨采样，不代表完整视频'}
 ],fetch:async(_url,options)=>{
  const target=JSON.parse(JSON.parse(options.body).messages[1].content).target;
  const evidence=JSON.stringify(target.agent_state);
  assert.match(evidence,/uid:3/);assert.match(evidence,/说话人未确认/);assert.match(evidence,/4200/);assert.match(evidence,/4秒/);
  assert.match(evidence,/不等于发言人|不能当作本人自述/);
  return response({action:'finish',answer:'公开片段提到陶瓷茶杯限用冷水，语音说话人未确认。',citations:[1]});
 }});
 try{
  await host.handle({type:'agent-submit',id:'media-attribution',question:'陶瓷茶杯',input:{subject:'uid:2',context:{}}},'1');
  const task=await until(async()=>{const row=(await host.handle({type:'agent-list'},'1'))[0];return ['succeeded','failed'].includes(row?.status) && row;});
  assert.equal(task.status,'succeeded',task.error);
  const rows=await f.corpus.list('1','10');assert.match(rows[0].text,/uid:3/);assert.match(rows[0].text,/说话人未确认/);
  assert.match(rows[0].coverage,/不是完整/);
 }finally{await host.close();}
});

test('后台读取同人缓存音轨保留原证据种类和引用，回存不将机器结果升级为网页或刷新原知识',async()=>{
 const f=setup(),url='https://www.douyin.com/video/70',at=Date.now()-1000,coverage='音轨0–4000ms；机器转录待核实，说话人未确认；画面仅采样';
 await f.corpus.remember('1','10',[{url,title:'作品音轨',text:'整个夏天的歌词片段',at,expiresAt:at+60000,evidenceKind:'public-media',coverage}],{subject:'uid:2'});
 const [original]=await f.corpus.list('1','10');let collected=0,models=0,disclosed;
 const host=createBackgroundAI({...f.options,collectAccount:async(_room,link)=>{collected++;assert.equal(link,'https://www.douyin.com/user/viewer_2');return [{kind:'profile',title:'茶友',text:'公开主页文字'}];},fetch:async(_url,options)=>{
  models++;const state=JSON.parse(JSON.parse(options.body).messages[1].content).target.agent_state;
  disclosed=state.evidence.find(r=>r.index===2);
  return response({action:'finish',answer:'机器音轨有歌词片段，说话人未知。',citations:[2]});
 }});
 try{
  await host.handle({type:'agent-submit',id:'cache-media-reference',question:'整个夏天音轨',input:{subject:'uid:2',context:{},sources:[url]}},'1');
  const task=await until(async()=>{const row=(await host.handle({type:'agent-list'},'1'))[0];return ['succeeded','failed'].includes(row?.status) && row;});
  assert.equal(task.status,'succeeded',task.error);assert.equal(models,1);assert.equal(collected,1);
  assert.ok(disclosed);assert.equal(disclosed.evidenceKind,'public-media');assert.equal(disclosed.coverage,coverage);assert.equal(task.result.knowledgeError,undefined);
  const source=task.result.sources.find(r=>r.url===url);assert.equal(source.evidenceKind,'public-media');assert.equal(source.passages[0].sourceId,original.id);
  const rows=await f.corpus.list('1','10');assert.equal(rows.length,2);assert.deepEqual(rows.find(r=>r.id===original.id),original);
 }finally{await host.close();}
});
