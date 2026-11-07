import {test} from 'node:test';
import assert from 'node:assert/strict';
import {updatePersonProfile,profileMemoryEntry} from '../../src/services/person-profile.js';
import {makeAIRequest,createAIClient} from '../../src/services/ai.js';
import {createRelationshipRetriever} from '../../src/ai/relationship-memory.js';
import {validateMemory} from '../../src/services/knowledge.js';
import {mergeConfig} from '../../src/core/engine.js';
import {makeEdgeMessages} from '../../src/ai/edge-prompt.js';
import {createRelationshipLibrary} from '../../src/ai/relationship-library.js';
const config=mergeConfig().ai;
const evidence=(turn,quote)=>[{turn,quote}];
const output=(facts=[],extra={})=>({facts,relationships:[],analysis:[],knowledge:[],reply:'资料已整理，均保留待核实状态。',...extra});
const fact=(field,value,turn,quote)=>({field,value,evidence:evidence(turn,quote)});
test('多轮更正以新居住地为准，原话保留，职业与关系可进入同一档案和图谱',async()=>{
 const requests=[];let calls=0;
 const client=async p=>{requests.push(makeAIRequest(p,config));return JSON.stringify(++calls===1 ? output([fact('residence','深圳',1,'住深圳')]) : output([fact('residence','横店',2,'现在住横店'),fact('occupation','主业直播，曾做群演',2,'主业直播，曾做群演')],{relationships:[{name:'阿明',predicate:'助理',negative:false,evidence:evidence(2,'是阿明的助理')}],analysis:[{text:'熟悉的小熊可能是一种放松习惯。',limitations:'仅依据补充资料，不能判断人格或心理健康。',evidence:evidence(2,'喜欢抱小熊睡')}]}));};
 let profile=await updatePersonProfile({name:'小雨',message:'小雨住深圳'},config,client);
 profile=await updatePersonProfile({name:'小雨',profile,message:'现在住横店，主业直播，曾做群演，是阿明的助理。喜欢抱小熊睡。'},config,client);
 assert.equal(profile.turns.length,2);assert.equal(profile.facts.find(f=>f.field==='residence').value,'横店');assert.match(profile.turns[0].text,/深圳/);
 const entry=profileMemoryEntry(profile);validateMemory({enabled:true,entries:[entry]});assert.equal(entry.trust,'unverified');assert.doesNotMatch(entry.content,/居住地：深圳/);
 const graph=createRelationshipRetriever()({anchor:'10',anchorName:'当前主播',memory:{enabled:true,entries:[entry]},now:Date.now()},'小雨阿明');
 const node=graph.entities.find(n=>n.name==='小雨');assert.ok(node.dossier.facets.some(r=>r.category==='residence' && r.text==='横店' && r.trust==='unverified'));
 assert.equal(graph.relations.find(r=>r.predicate==='助理').status,'unverified');assert.equal(node.dossier.analysis.length,1);assert.match(node.dossier.analysis[0].limitations,/不能判断/);
 assert.ok(!node.dossier.facets.some(r=>/放松习惯/.test(r.text)),'心理解读独立于事实字段');
 const data=JSON.parse(requests[1].messages[1].content);assert.equal(data.turns.length,2);assert.ok(!JSON.stringify(data).includes('apiKey'));assert.match(requests[1].messages[0].content,/推测|假设/);
});
test('杜撰原话、重复单值字段、非法关系和心理诊断均拒绝，失败不改原档案',async()=>{
 const good=output([fact('residence','横店',1,'住横店')]);
 const profile=await updatePersonProfile({name:'小雨',message:'住横店'},config,async()=>JSON.stringify(good));const before=structuredClone(profile);
 for(const bad of [output([fact('residence','北京',2,'从未说过')]),output([fact('residence','横店',1,'住横店'),fact('residence','北京',2,'住北京')]),output([],{relationships:[{name:'阿明',predicate:'秘密恋人',negative:false,evidence:evidence(1,'住横店')}]}),output([],{analysis:[{text:'她有焦虑症。',limitations:'仅供参考',evidence:evidence(1,'住横店')}]})]){
  await assert.rejects(updatePersonProfile({name:'小雨',profile,message:'没有说住北京'},config,async()=>JSON.stringify(bad)));assert.deepEqual(profile,before);
 }
});
test('名字不同、取消、超额输入、过大输出不能覆写资料；同名人物不自动绑定实际主播',async()=>{
 const profile=await updatePersonProfile({name:'小雨',message:'住横店'},config,async()=>JSON.stringify(output([fact('residence','横店',1,'住横店')])));
 await assert.rejects(updatePersonProfile({name:'别人',profile,message:'补充'},config,()=>assert.fail()));
 const controller=new AbortController();controller.abort();await assert.rejects(updatePersonProfile({name:'小雨',message:'补充',signal:controller.signal},config,()=>assert.fail()),/取消/);
 await assert.rejects(updatePersonProfile({name:'小雨',message:'字'.repeat(4001)},config,()=>assert.fail()),/4000|格式/);
 await assert.rejects(updatePersonProfile({name:'小雨',message:'补充'},config,async()=> ' '.repeat(50001)),/过长/);
 const graph=createRelationshipRetriever()({anchor:'10',anchorName:'小雨',memory:{enabled:true,entries:[profileMemoryEntry(profile)]},now:Date.now()},'小雨');
 assert.equal(graph.entities.filter(n=>n.name==='小雨').length,2);assert.ok(graph.ambiguities.length);
});
test('生产客户端发送专用整理请求，原话完整，结果只用来生成草稿，不调用搜索或发送弹幕',async()=>{
 let body;const client=createAIClient({getKey:()=> 'key',search:()=>assert.fail(),request:d=>{body=JSON.parse(d.data);d.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:JSON.stringify(output([fact('interests','拍照',1,'喜欢拍照')]))}}]})});}});
 const result=await updatePersonProfile({name:'小雨',message:'喜欢拍照'},config,client);
 assert.equal(result.facts[0].value,'拍照');assert.equal(body.temperature,0);assert.ok(!body.messages[0].content.includes('普通对话意图'));
 assert.equal(JSON.parse(body.messages[1].content).turns[0].text,'喜欢拍照');
});
test('人物资料以待核实用户陈述进入云端与端侧回复，修改来源名称不能洗掉可信状态',async()=>{
 const profile=await updatePersonProfile({name:'小雨',message:'喜欢拍照'},config,async()=>JSON.stringify(output([fact('interests','拍照',1,'喜欢拍照')])));
 const ai={...config,memory:{enabled:true,entries:[profileMemoryEntry(profile,{source:'运营补充'})]}};
 const prompt={task:{kind:'ai'},target:{text:'小雨喜欢拍照吗'},maxLength:100};
 const cloud=JSON.parse(makeAIRequest(prompt,ai).messages[1].content);
 const edge=JSON.parse(makeEdgeMessages(prompt,ai)[1].content);
 for(const rows of [cloud.evidence_context.memories,edge.memories]){
  assert.equal(rows.length,1);assert.equal(rows[0].trust,'unverified');assert.equal(rows[0].attribution,'用户补充，经AI整理，未经独立核实');
 }
});
test('大量喜好不能挤掉按字段提问命中的人物经历',async()=>{
 const likes=['草莓','西瓜','芒果','桃子','葡萄','苹果','香蕉','荔枝','梨'];
 const message='喜欢'+likes.join('、')+'。本人经历：曾参加城市摄影展。';
 const profile=await updatePersonProfile({name:'小雨',message},config,async()=>JSON.stringify(output([...likes.map(v=>fact('dietLikes',v,1,v)),fact('experience','曾参加城市摄影展',1,'曾参加城市摄影展')])));
 const graph=createRelationshipRetriever()({anchor:'10',memory:{enabled:true,entries:[profileMemoryEntry(profile)]},now:Date.now()},'小雨有什么本人经历');
 assert.ok(graph.entities.find(n=>n.name==='小雨').dossier.facets.some(f=>f.category==='experience' && f.text.includes('摄影展')));
});
test('保存导入后从后台跨房查询最新人物资料，停用到期删除立即消除关系和旧字段',async()=>{
 let profile=await updatePersonProfile({name:'小雨',message:'住深圳'},config,async()=>JSON.stringify(output([fact('residence','深圳',1,'住深圳')])));
 profile=await updatePersonProfile({name:'小雨',profile,message:'现住横店，是阿明的助理'},config,async()=>JSON.stringify(output([fact('residence','横店',2,'现住横店')],{relationships:[{name:'阿明',predicate:'助理',negative:false,evidence:evidence(2,'是阿明的助理')}]})));
 const values=JSON.parse(JSON.stringify({'live-assistant:config:1':{anchorId:'10',ai:config},'live-assistant:config:2':{anchorId:'20',ai:{...config,memory:{enabled:true,entries:[profileMemoryEntry(profile)]}}}}));
 const library=createRelationshipLibrary({all:async()=>values});
 const graph=await library.query('1','小雨阿明');
 const person=graph.entities.find(n=>n.name==='小雨');assert.ok(person.dossier.facets.some(f=>f.text==='横店'));assert.ok(!person.dossier.facets.some(f=>f.text==='深圳'));assert.ok(person.dossier.events.some(e=>e.scope.room==='2'));assert.equal(graph.relations.find(r=>r.predicate==='助理').status,'unverified');
 const row=values['live-assistant:config:2'].ai.memory.entries[0];
 for(const change of [()=>row.enabled=false,()=>{row.enabled=true;row.expiresOn='2020-01-01';},()=>values['live-assistant:config:2'].ai.memory.entries=[]]){
  change();const next=await library.query('1','小雨阿明');assert.ok(!next.relations.some(r=>r.predicate==='助理'));assert.ok(!next.entities.some(n=>n.name==='小雨'));
 }
});
