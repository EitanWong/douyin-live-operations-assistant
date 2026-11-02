import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {validateSkillPack,selectSkills,BUILTIN_SKILLS} from '../../src/ai/skills.js';
import {AgentHarness} from '../../src/ai/harness.js';

const now=1800000000000;
test('观众记忆跨刷新去重、同名不混淆、按主播隔离且只导出当前观众的已观察事实',()=>{
 let time=now;const memory=new AudienceMemory({anchor:'10',now:()=>time});
 const chat={id:'m1',type:'chat',source:'socket',receivedAt:now,user:{id:'1',name:'小雨'},text:'我喜欢陶瓷茶具'};
 memory.observe(chat);memory.observe(chat);memory.observe({...chat,id:'m2',user:{id:'2',name:'小雨'},text:'我喜欢跑步'});
 const restored=new AudienceMemory({anchor:'10',state:memory.snapshot(),now:()=>time});
 const context=restored.context({id:'1'});assert.equal(context.recentStatements.length,1);assert.match(context.recentStatements[0].text,/陶瓷/);assert.ok(!JSON.stringify(context).includes('跑步'));assert.ok(!JSON.stringify(context).includes('"id":"1"'));
 assert.equal(new AudienceMemory({anchor:'11',state:memory.snapshot(),now:()=>time}).context({id:'1'}),null);
 time+=31*86400000;assert.equal(restored.context({id:'1'}),null);
});
test('礼物记忆保留累计连击事实，不把重复广播累加，不推测财富或人格；删除后可纠正',()=>{
 const memory=new AudienceMemory({anchor:'10',now:()=>now});
 for(const count of [1,3,2,3])memory.observe({id:'gift-'+count,type:'gift',source:'socket',receivedAt:now,user:{id:'1',name:'青山'},groupId:'combo',giftId:'g',giftName:'玫瑰',count,unitValue:10});
 const value=memory.context({id:'1'});assert.equal(value.recentGifts[0].count,3);assert.equal(value.observedGiftDiamonds,30);assert.equal(value.personality,undefined);
 memory.forget('uid:1');assert.equal(memory.context({id:'1'}),null);
});
test('技能包只能装声明式提示，拒绝未知能力与代码，场景选择有上限',()=>{
 const skill={version:1,id:'tea',name:'茶具交流',scenes:['ai'],instructions:'只根据已核实资料回答茶具问题。'};
 assert.equal(validateSkillPack(skill).id,'tea');assert.throws(()=>validateSkillPack({...skill,execute:'fetch(...)'}));assert.throws(()=>validateSkillPack({...skill,scenes:['ban-user']}));
 const selected=selectSkills([...BUILTIN_SKILLS,skill],'ai');assert.ok(selected.length<=4);assert.ok(selected.some(row=>row.id==='tea'));
});
const store=()=>{const rows=new Map();return {rows,put:async job=>rows.set(job.id,structuredClone(job)),all:async()=>[...rows.values()].map(j=>structuredClone(j))};};
const until=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,2));}assert.fail('任务未达到预期状态');};
test('Harness提交立即返回，后台执行不阻塞前台；取消会中止执行，迟到结果不写回',async()=>{
 const storage=store();let finish,signal;const h=new AgentHarness({store:storage,execute:(_job,o)=>{signal=o.signal;return new Promise(r=>finish=r);},now:()=>now});
 await h.ready;const job=await h.submit({id:'task-1',scope:'1:10',question:'陶瓷怎么清洗',input:{}});assert.equal(job.status,'queued');
 await until(()=>signal);await h.cancel('task-1','1:10');assert.equal(signal.aborted,true);finish({answer:'迟到'});await until(()=>!h.active.size);assert.equal(storage.rows.get('task-1').status,'cancelled');h.close();
});
test('Harness重启把在途付费步骤标为中断，不自动重试；队列任务可恢复，房间不能越权取消',async()=>{
 const storage=store();await storage.put({id:'old-task',scope:'1:10',status:'running',question:'之前的任务',input:{},createdAt:now});let calls=0;
 const h=new AgentHarness({store:storage,execute:async()=>{calls++;return {answer:'完成'};},now:()=>now});await h.ready;assert.equal(storage.rows.get('old-task').status,'interrupted');assert.equal(calls,0);
 await h.submit({id:'new-task',scope:'2:20',question:'查询',input:{}});await assert.rejects(h.cancel('new-task','1:10'),/范围/);await until(()=>storage.rows.get('new-task').status==='succeeded');assert.equal(calls,1);h.close();
});

test('检索缓存不让同ID更新、停用、来源和房间内容串用',async()=>{
 const {createKnowledgeRetriever}=await import('../../src/services/retrieval.js');const search=createKnowledgeRetriever();
 const row={id:'tea',title:'茶具',content:'陶瓷茶具用温水清洗',source:'旧来源',updatedAt:now,expiresOn:''};
 assert.match(search([row],'茶具').chunks[0].content,/温水/);
 const updated={...row,content:'陶瓷茶具要用冷水清洗',source:'新来源'};
 assert.equal(search([updated],'茶具').chunks[0].source,'新来源');assert.match(search([updated],'茶具').chunks[0].content,/冷水/);assert.equal(search([],'茶具').chunks.length,0);
 search.clear();assert.match(search([row],'茶具').chunks[0].content,/温水/);
});

test('忘记和清空在刷新重放后仍生效，活跃观众的旧内容也按30天过期',()=>{
 let time=now;let memory=new AudienceMemory({anchor:'10',now:()=>time});
 const chat={id:'message-1',type:'chat',source:'socket',receivedAt:time,user:{id:'1',name:'青山'},text:'旧的兴趣'};
 memory.observe(chat);memory.forget('uid:1');memory=new AudienceMemory({anchor:'10',state:memory.snapshot(),now:()=>time});memory.observe(chat);assert.equal(memory.context(chat.user),null);
 time+=1;memory.observe({...chat,id:'message-2',receivedAt:time});assert.equal(memory.context(chat.user).recentStatements.length,1);
 time+=29*86400000;memory.observe({...chat,type:'enter',receivedAt:time});time+=2*86400000;assert.equal(memory.context(chat.user).recentStatements.length,0);
 memory.clear();memory.observe({...chat,type:'enter',receivedAt:time});assert.equal(memory.list().length,0);
});

test('引擎只给目标观众加入记忆；冷场互动需要开关与新鲜媒体且可选择沉默',async()=>{
 const {Engine,mergeConfig}=await import('../../src/core/engine.js');let time=now,prompts=[],observations=[];
 const engine=new Engine({config:mergeConfig({anchorId:'10',ai:{enabled:true,chatEnabled:true,idleEnabled:true,idleSec:60}}),now:()=>time,viewerMemory:user=>({name:user.name,recentStatements:[{text:'喜欢陶瓷'}]}),mediaContext:()=>({observations}),ai:async prompt=>{prompts.push(prompt);return '[SKIP]';}});
 engine.start();await engine.requestAI({type:'chat',user:{id:'1',name:'小雨'},text:'杯子怎么清洗'});assert.equal(prompts[0].target.memory.name,'小雨');assert.equal(prompts[0].target.id,undefined);
 time+=61000;await engine.tick(false);await new Promise(setImmediate);assert.equal(prompts.length,1);
 observations=[{kind:'video',at:time-1000,endedAt:time,text:'主播展示杯子'}];await engine.tick(false);await new Promise(setImmediate);assert.equal(prompts.length,2);assert.match(prompts[1].task.instruction,/自然/);assert.equal(engine.queue.length,0);
 engine.config.ai.idleEnabled=false;time+=61000;observations[0].at=time;observations[0].endedAt=time;await engine.tick(false);await new Promise(setImmediate);assert.equal(prompts.length,2);engine.stop();
});

test('冷场回复等待期间出现新弹幕或关闭主动开关，迟到结果不再排队',async()=>{
 const {Engine,mergeConfig}=await import('../../src/core/engine.js');let time=now,finish;
 const engine=new Engine({config:mergeConfig({ai:{enabled:true,chatEnabled:true,idleEnabled:true,idleSec:60}}),now:()=>time,mediaContext:()=>({observations:[{kind:'video',at:time,text:'主播展示杯子'}]}),ai:()=>new Promise(resolve=>finish=resolve)});
 engine.start();time+=61000;await engine.tick(false);assert.ok(finish);time+=10;engine.ingest({type:'chat',id:'new-chat',user:{id:'2',name:'小雨'},text:'刚刚那款还有吗'});engine.config.ai.idleEnabled=false;finish('这个杯子的花纹挺特别');await new Promise(setImmediate);assert.equal(engine.queue.filter(row=>row.text==='这个杯子的花纹挺特别').length,0);engine.stop();
});

test('Harness恢复拒绝损坏任务，不执行未通过契约的持久输入',async()=>{
 let calls=0;const h=new AgentHarness({store:{all:async()=>[{id:'broken-task',scope:'1:10',status:'queued',createdAt:now,question:null,input:{}}],put:async()=>{}},now:()=>now,execute:async()=>calls++});
 try{await h.ready;await new Promise(setImmediate);assert.equal(calls,0);assert.deepEqual(h.list('1:10'),[]);}finally{h.close();}
});

test('忘记一位观众不丢弃其他观众尚在交接的真实互动，删除水位随快照按人隔离',()=>{
 let time=now;const memory=new AudienceMemory({anchor:'10',now:()=>time});
 const chat=(id,user,receivedAt)=>({id,type:'chat',source:'socket',receivedAt,user:{id:user,name:'观众'+user},text:'喜欢陶瓷'});
 memory.observe(chat('alice-1','1',time-1000));memory.forget('uid:1');
 const restored=new AudienceMemory({anchor:'10',state:memory.snapshot(),now:()=>time});
 assert.equal(restored.observe(chat('bob-1','2',time-500)),true);
 assert.equal(restored.context({id:'2'}).recentStatements.length,1);
 assert.equal(restored.observe(chat('alice-1','1',time-1000)),false);
 time+=1;assert.equal(restored.observe(chat('alice-2','1',time)),true);
 restored.clear();assert.equal(restored.observe(chat('bob-1','2',time-500)),false);
});
