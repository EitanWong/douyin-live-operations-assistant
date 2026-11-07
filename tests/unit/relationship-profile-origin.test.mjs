import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {createRelationshipLibrary} from '../../src/ai/relationship-library.js';
import {profileMemoryEntry} from '../../src/services/person-profile.js';

const at=1800000000000;
function fixture({name='Lucy小露',key='',origin={room:'1001',anchor:'101'}}={}){
 const text='我喜欢陶艺。我是阿明的朋友。';
 const profile={version:1,name,key,turns:[{text,at}],facts:[{field:'interests',value:'陶艺',evidence:[{turn:1,quote:'我喜欢陶艺'}]}],relationships:[{name:'阿明',predicate:'朋友',negative:false,evidence:[{turn:1,quote:'我是阿明的朋友'}]}],analysis:[],knowledge:[],reply:'保留原话'};
 const record={...profileMemoryEntry(profile,{id:'person'}),updatedAt:at,...(origin ? {origin} : {})};
 const audience=new AudienceMemory({anchor:'101',now:()=>at});
 audience.observe({id:'self',type:'chat',source:'socket',receivedAt:at,user:{id:'101',secUid:'lucy-account',name},text:'我喜欢摄影。我是阿明的朋友。'});
 const values={
  'live-assistant:config:1001':{anchorId:'101'},
  'live-assistant:profile:1001':{anchorId:'101',name,secUid:'lucy-account'},
  'live-assistant:live-memory:1001:101':{version:1,anchor:'101',audience:audience.snapshot(),perception:{observations:[],forgetBefore:0}},
  'live-assistant:knowledge:global':{entries:[record],knowledge:''}
 };
 return {values,record,audience,query:()=>createRelationshipLibrary({all:async()=>structuredClone(values),now:()=>at}).query('1001',name,{},{browse:true})};
}

test('共享人物资料沿原始房间与主播范围归入唯一账号，原话、关系和待核实状态保留',async()=>{
 const f=fixture(),before=structuredClone(f.values),graph=await f.query();
 const people=graph.entities.filter(n=>n.name==='Lucy小露');
 assert.equal(people.length,1,'未填账号的资料不能与其来源范围内的唯一账号重复展示');
 const person=people[0];assert.equal(person.id,'person:uid%3A101');assert.equal(person.role,'主播');
 for(const text of ['陶艺','摄影'])assert.ok(person.dossier.facets.some(row=>row.text===text && row.trust==='unverified'));
 assert.equal(graph.relations.filter(r=>r.predicate==='朋友').length,2,'其他未绑定人物仍保留各自来源范围');
 assert.ok(graph.relations.every(r=>(r.from===person.id || r.to===person.id) && r.status==='unverified'));
 assert.equal(graph.ambiguities.filter(row=>row.name==='Lucy小露').length,0);
 assert.deepEqual(await f.query(),graph,'重复查询和序列化重启结果一致');
 assert.deepEqual(f.values,before,'只重建投影，不改写用户资料与账号标识');
 assert.equal(f.record.person.key,'');
});

test('资料没有来源或来源范围不匹配时不以全局同名账号归并',async()=>{
 for(const origin of [null,{room:'1002',anchor:'101'},{room:'1001',anchor:'202'}]){
  const f=fixture({origin});
  assert.equal((await f.query()).entities.filter(n=>n.name==='Lucy小露').length,2);
 }
});

test('原始范围内不同UID同名、隐藏昵称及显式指定其他账号仍分别保留',async()=>{
 const f=fixture();
 f.audience.observe({id:'other',type:'chat',source:'socket',receivedAt:at,user:{id:'202',name:'Lucy小露'},text:'我喜欢跑步。'});
 f.values['live-assistant:live-memory:1001:101'].audience=f.audience.snapshot();
 assert.equal((await f.query()).entities.filter(n=>n.name==='Lucy小露').length,3);
 assert.equal((await fixture({name:'神秘人'}).query()).entities.filter(n=>n.name==='神秘人').length,2);
 assert.equal((await fixture({key:'uid:202'}).query()).entities.filter(n=>n.name==='Lucy小露').length,2);
});

test('原始房间内唯一同名观众不能被当作资料所属主播',async()=>{
 const f=fixture();
 f.values['live-assistant:profile:1001'].name='实际主播';
 f.values['live-assistant:live-memory:1001:101'].audience.viewers[0].name='实际主播';
 f.audience.observe({id:'viewer',type:'chat',source:'socket',receivedAt:at,user:{id:'202',name:'Lucy小露'},text:'我喜欢跑步。'});
 f.values['live-assistant:live-memory:1001:101'].audience.viewers.push(f.audience.snapshot().viewers.find(row=>row.key==='uid:202'));
 assert.equal((await f.query()).entities.filter(n=>n.name==='Lucy小露').length,2);
});

test('来源账号证据撤销后解除归并，人物资料停用或删除后不留下旧档案',async()=>{
 const f=fixture(),library=createRelationshipLibrary({all:async()=>structuredClone(f.values),now:()=>at});
 const query=()=>library.query('1001','Lucy小露',{},{browse:true});
 assert.equal((await query()).entities.filter(n=>n.name==='Lucy小露').length,1);
 delete f.values['live-assistant:profile:1001'];
 f.values['live-assistant:live-memory:1001:101'].audience.viewers=[];
 let graph=await query();
 assert.equal(graph.entities.filter(n=>n.name==='Lucy小露').length,1);
 assert.ok(graph.entities.find(n=>n.name==='Lucy小露').id.includes('manual'));
 f.record.enabled=false;
 assert.ok(!(await query()).entities.some(n=>n.name==='Lucy小露'));
 f.values['live-assistant:knowledge:global'].entries=[];
 assert.ok(!(await query()).entities.some(n=>n.name==='Lucy小露'));
});
