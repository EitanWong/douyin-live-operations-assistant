import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {createRelationshipLibrary} from '../../src/ai/relationship-library.js';
import {profileMemoryEntry} from '../../src/services/person-profile.js';

const at=1800000000000;
function fixture(){
 const text='我喜欢陶艺。我是阿明的朋友。';
 const person={version:1,name:'Lucy小露',key:'',turns:[{text,at}],facts:[{field:'interests',value:'陶艺',evidence:[{turn:1,quote:'我喜欢陶艺'}]}],relationships:[{name:'阿明',predicate:'朋友',negative:false,evidence:[{turn:1,quote:'我是阿明的朋友'}]}],analysis:[],knowledge:[],reply:'保留原话'};
 const audience=new AudienceMemory({anchor:'101',now:()=>at});
 audience.observe({id:'self',type:'chat',source:'socket',receivedAt:at,user:{id:'101',secUid:'lucy-account',name:'Lucy小露'},text:'我是阿明的朋友。'});
 const values={
  'live-assistant:config:1001':{anchorId:'101'},
  'live-assistant:profile:1001':{anchorId:'101',name:'Lucy小露',secUid:'lucy-account'},
  'live-assistant:live-memory:1001:101':{version:1,anchor:'101',audience:audience.snapshot(),perception:{observations:[],forgetBefore:0}},
  'live-assistant:knowledge:global':{entries:[{...profileMemoryEntry(person,{id:'person'}),updatedAt:at}],knowledge:''}
 };
 const library=createRelationshipLibrary({all:async()=>structuredClone(values),now:()=>at});
 return {values,person,audience,query:(options={})=>library.query('1001','Lucy小露',{},{browse:true,deduplicate:true,...options})};
}
const lucys=graph=>graph.entities.filter(n=>n.name==='Lucy小露');

test('自动去重把无来源资料和跨范围提及归入唯一账号，原文与未核实状态保留且不改写档案',async()=>{
 const f=fixture();
 f.values['live-assistant:knowledge:global'].entries.push({id:'mention',enabled:true,content:'Lucy小露是阿明的朋友。',updatedAt:at,trust:'unverified'});
 const before=structuredClone(f.values),graph=await f.query(),person=lucys(graph)[0];
 assert.equal(lucys(graph).length,1);assert.equal(person.id,'person:uid%3A101');
 assert.ok(person.dossier.facets.some(row=>row.text==='陶艺' && row.trust==='unverified'));
 assert.equal(graph.relations.filter(r=>r.predicate==='朋友').length,1);
 assert.ok(graph.relations.every(r=>r.status==='unverified'));
 assert.equal(graph.relations[0].evidence.length,2,'关系展示保留现有两条摘要预算');
 assert.equal(person.dossier.coverage.records,3,'全部来源仍留在档案');
 assert.equal(graph.ambiguities.length,0);
 assert.equal(graph.deduplication.mergedProfiles,1);
 assert.ok(graph.deduplication.resolvedMentions>0);
 assert.deepEqual(await f.query({rebuild:true}),graph);
 assert.deepEqual(f.values,before);assert.equal(f.person.key,'');
 assert.match((await f.query({recordId:person.dossier.facets[0].recordId})).record.text,/补充原话：[\s\S]*陶艺/);
 assert.equal(lucys(await f.query({deduplicate:false})).length,2,'保守检索与自动去重缓存隔离');
});

test('多个同名未绑定资料在没有账号时也归档，输入顺序和序列化重启不影响结果',async()=>{
 const f=fixture();delete f.values['live-assistant:profile:1001'];f.values['live-assistant:live-memory:1001:101'].audience.viewers=[];
 const entries=f.values['live-assistant:knowledge:global'].entries;entries.push({...structuredClone(entries[0]),id:'person-2'});
 const graph=await f.query();assert.equal(lucys(graph).length,1);assert.equal(lucys(graph)[0].dossier.events.length,2);
 entries.reverse();const reversed=await f.query();assert.equal(lucys(reversed)[0].id,lucys(graph)[0].id);
 assert.deepEqual(lucys(reversed)[0].dossier.events.map(e=>e.recordId).sort(),lucys(graph)[0].dossier.events.map(e=>e.recordId).sort());
 assert.equal(lucys(reversed)[0].dossier.facets[0].evidenceCount,2);
});

test('同名不同稳定账号不能自动归并；歧义移除后重算，停用删除可撤销',async()=>{
 const f=fixture();f.audience.observe({id:'other',type:'chat',source:'socket',receivedAt:at,user:{id:'202',name:'Lucy小露'},text:'我是阿明的朋友。'});
 const saved=f.values['live-assistant:live-memory:1001:101'];saved.audience=f.audience.snapshot();
 let graph=await f.query();assert.equal(lucys(graph).length,3);assert.ok(graph.deduplication.conflicts.some(row=>row.name==='Lucy小露' && row.accounts===2));
 saved.audience.viewers=saved.audience.viewers.filter(row=>row.key!=='uid:202');assert.equal(lucys(await f.query()).length,1);
 const entry=f.values['live-assistant:knowledge:global'].entries[0];entry.enabled=false;graph=await f.query();assert.equal(graph.deduplication.mergedProfiles,0);assert.ok(!lucys(graph)[0].dossier?.facets.some(row=>row.text==='陶艺'));
 f.values['live-assistant:knowledge:global'].entries=[];assert.deepEqual(await f.query(),graph);
});

test('隐藏昵称与通用占位名不归并；补充知识无来源时仍汇总到同名唯一账号',async()=>{
 for(const name of ['神秘人','主播','公开账号']){
  const f=fixture(),entry=f.values['live-assistant:knowledge:global'].entries[0];
  entry.person.name=name;entry.content=entry.content.replaceAll('Lucy小露',name);
  f.values['live-assistant:profile:1001'].name=name;
  f.values['live-assistant:live-memory:1001:101'].audience.viewers[0].name=name;
  const graph=await f.query();assert.equal(graph.deduplication.mergedProfiles,0);
 }
 const f=fixture();f.values['live-assistant:knowledge:global'].entries=[{id:'supplement',enabled:true,content:'人物：Lucy小露。当前居住地：横店。',updatedAt:at,trust:'unverified',supplement:{personKey:'',history:[],text:'Lucy小露住横店。',evidence:[]}}];
 const graph=await f.query();assert.equal(lucys(graph).length,1);assert.ok(lucys(graph)[0].dossier.facets.some(row=>row.text==='横店' && row.trust==='unverified'));
});

test('归并后自环消失，矛盾关系两侧及各自来源仍保留',async()=>{
 const f=fixture(),entries=f.values['live-assistant:knowledge:global'].entries;
 entries.push({id:'no',enabled:true,content:'Lucy小露不是阿明的朋友。Lucy小露是Lucy小露的朋友。',updatedAt:at,trust:'verified'});
 const graph=await f.query();assert.equal(lucys(graph).length,1);assert.ok(graph.relations.every(r=>r.from!==r.to));
 assert.equal(graph.relations.length,2);assert.ok(graph.relations.every(r=>r.status==='conflicted'));assert.ok(graph.relations.some(r=>r.negative));
});
