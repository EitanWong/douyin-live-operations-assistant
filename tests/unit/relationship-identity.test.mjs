import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {createRelationshipLibrary} from '../../src/ai/relationship-library.js';
import {createRelationshipRetriever} from '../../src/ai/relationship-memory.js';
import {mergeLiveMemory} from '../../src/ai/live-memory.js';

const at=1800000000000;
const entry=(id,content,trust='verified')=>({id,content,trust,enabled:true,updatedAt:at});
const memory=entries=>({enabled:true,entries});
const chat=(id,user,text)=>({id,type:'chat',source:'socket',receivedAt:at,user,text});
const archive=audience=>({version:1,anchor:audience.anchor,audience:audience.snapshot(),perception:{observations:[],forgetBefore:0}});

test('三位人物各自的主播、用户和协议@记录合为三个账号节点，重启后不会按角色重复展示',()=>{
 const names=['Lucy小露','一只开心🎀','张二要自律'];
 const host=new AudienceMemory({anchor:'10',now:()=>at}),viewer=new AudienceMemory({anchor:'20',now:()=>at});
 for(const [i,name] of names.entries()){
  const id=String(101+i),secUid=`person-account-${i}`;
  host.observe({id:`link-${i}`,type:'link-state',source:'socket',receivedAt:at,channelId:`channel-${i}`,linkedUsers:[{id,name,secUid}]});
  viewer.observe(chat(`viewer-${i}`,{secUid,name},'我喜欢陶艺。'));
  viewer.observe({...chat(`mention-${i}`,{id:'900',name:'记录者'},`@${name} 今天好早`),atUser:{id,name,secUid}});
 }
 const restored=new AudienceMemory({anchor:'20',state:JSON.parse(JSON.stringify(viewer.snapshot())),now:()=>at});
 const input={now:at,scopes:[{room:'1001',anchor:'10',audience:host},{room:'1002',anchor:'20',audience:restored}]};
 const graph=createRelationshipRetriever()(input,names.join('、'),{browse:true});
 const people=graph.entities.filter(n=>names.includes(n.name));
 assert.equal(people.length,3,'三个不同的人，各自只留一个节点');
 assert.deepEqual(new Set(people.map(n=>n.id)),new Set(['101','102','103'].map(id=>`person:uid%3A${id}`)));
 assert.ok(!graph.ambiguities.some(row=>names.includes(row.name)));
 for(const person of people){
  assert.ok(graph.relations.some(r=>r.predicate==='同场连麦' && (r.from===person.id || r.to===person.id)));
  assert.ok(graph.relations.some(r=>r.predicate==='提及' && r.to===person.id));
  assert.ok(person.dossier.facets.some(f=>f.category==='interests' && f.text==='陶艺'));
 }
});

test('已存在两个同名UID时按每条弹幕被@的账号分别归档，不用昵称选第一个',()=>{
 const audience=new AudienceMemory({anchor:'10',now:()=>at});
 for(const id of ['101','102'])audience.observe({...chat(`mention-${id}`,{id:'900',name:'记录者'},'@Lucy小露 今天好早'),atUser:{id,secUid:`person-account-${id}`,name:'Lucy小露'}});
 const graph=createRelationshipRetriever()({anchor:'10',audience,now:at},'Lucy小露',{browse:true});
 assert.equal(graph.entities.filter(n=>n.name==='Lucy小露').length,2);
 assert.deepEqual(new Set(graph.relations.filter(r=>r.predicate==='提及').map(r=>r.to)),new Set(['person:uid%3A101','person:uid%3A102']));
 assert.ok(!graph.entities.some(n=>n.id.includes('mention')));
});

test('被@账号的遗忘水位阻止旧身份重放，删除原话后身份线索不独立复活',()=>{
 const audience=new AudienceMemory({anchor:'10',now:()=>at});
 const event={...chat('mention',{id:'900',name:'记录者'},'@Lucy小露 今天好早'),atUser:{id:'101',name:'Lucy小露'}};
 audience.observe(event);audience.forget('uid:101');audience.observe(event);
 const retrieve=createRelationshipRetriever(),input={anchor:'10',audience,now:at};
 assert.ok(!retrieve(input,'Lucy小露',{browse:true}).entities.some(n=>n.id==='person:uid%3A101'));
 audience.forget('uid:900');
 assert.equal(retrieve(input,'Lucy小露',{browse:true}).relations.length,0);
});

test('同一弹幕后补协议身份后，旧页面写回不丢失线索；遗忘secUID后旧存档不能复活配对',()=>{
 let now=at;
 const audience=new AudienceMemory({anchor:'10',now:()=>now});
 const event=chat('mention',{id:'900',name:'记录者'},'@Lucy小露 今天好早');
 audience.observe(chat('viewer',{secUid:'person-account-101',name:'Lucy小露'},'我喜欢陶艺。'));
 audience.observe(event);const stale=archive(audience);
 audience.observe({...event,atUser:{id:'101',name:'Lucy小露',secUid:'person-account-101'}});const enriched=archive(audience);
 for(const [a,b] of [[stale,enriched],[enriched,stale]]){
  const merged=mergeLiveMemory(a,b),restored=new AudienceMemory({anchor:'10',state:merged.audience,now:()=>now});
  const graph=createRelationshipRetriever()({anchor:'10',audience:restored,now},'Lucy小露',{browse:true});
  assert.deepEqual(graph.entities.filter(n=>n.name==='Lucy小露').map(n=>n.id),['person:uid%3A101']);
  now++;restored.forget('sec:person-account-101');
  const forgotten=mergeLiveMemory(archive(restored),enriched);
  assert.equal(forgotten.audience.viewers.find(row=>row.key==='uid:900').statements[0].mentions?.length || 0,0);
  const after=new AudienceMemory({anchor:'10',state:forgotten.audience,now:()=>now});
  assert.ok(!createRelationshipRetriever()({anchor:'10',audience:after,now},'Lucy小露',{browse:true}).entities.some(n=>n.id==='person:uid%3A101'));
 }
});

test('同名连麦重放与旧页合并保留新补充secUID，PK双方也保留协议配对',()=>{
 const audience=new AudienceMemory({anchor:'10',now:()=>at});
 const link={id:'link',type:'link-state',source:'socket',receivedAt:at,channelId:'channel',linkedUsers:[{id:'101',name:'Lucy小露'}]};
 audience.observe(link);const stale=archive(audience);
 assert.equal(audience.observe({...link,linkedUsers:[{...link.linkedUsers[0],secUid:'person-account-101'}]}),true);
 const enriched=archive(audience);
 for(const [a,b] of [[stale,enriched],[enriched,stale]]){
  const restored=new AudienceMemory({anchor:'10',state:mergeLiveMemory(a,b).audience,now:()=>at});
  restored.observe(chat('viewer',{secUid:'person-account-101',name:'Lucy小露'},'我喜欢陶艺。'));
  assert.equal(createRelationshipRetriever()({anchor:'10',audience:restored,now:at},'Lucy小露',{browse:true}).entities.filter(n=>n.name==='Lucy小露').length,1);
 }
 const pk=new AudienceMemory({anchor:'101',now:()=>at});
 pk.observe({id:'pk',type:'pk-start',battleId:'battle',source:'socket',receivedAt:at,participants:[{anchorId:'101',name:'Lucy小露',secUid:'person-account-101'},{anchorId:'102',name:'一只开心🎀',secUid:'person-account-102'}]});
 for(const [id,name] of [['101','Lucy小露'],['102','一只开心🎀']])pk.observe(chat(id,{secUid:`person-account-${id}`,name},'我喜欢陶艺。'));
 const graph=createRelationshipRetriever()({anchor:'101',audience:pk,now:at},'Lucy小露 一只开心🎀',{browse:true});
 assert.equal(graph.entities.filter(n=>['Lucy小露','一只开心🎀'].includes(n.name)).length,2);
});

test('被@昵称隐藏或缺失仍保存UID/secUID配对，后续公开账号资料恢复其归档',()=>{
 for(const name of ['神秘人','']){
 const audience=new AudienceMemory({anchor:'10',now:()=>at});
 audience.observe(chat('viewer',{secUid:'person-account-101',name:'Lucy小露'},'我喜欢陶艺。'));
 audience.observe({...chat('mention',{id:'900',name:'记录者'},'@Lucy小露 今天好早'),atUser:{id:'101',secUid:'person-account-101',name}});
 const restored=new AudienceMemory({anchor:'10',state:audience.snapshot(),now:()=>at});
 const graph=createRelationshipRetriever()({anchor:'10',audience:restored,now:at},'Lucy小露',{browse:true});
 assert.deepEqual(graph.entities.filter(n=>n.name==='Lucy小露').map(n=>n.id),['person:uid%3A101']);
 assert.equal(restored.snapshot().viewers.find(row=>row.key==='uid:900').statements[0].mentions[0].key,'uid:101');
 }
});

test('PK明确提供的主播房间归属连接旧房间资料，不把普通观众所在房间当身份',()=>{
 const audience=new AudienceMemory({anchor:'101',now:()=>at});
 audience.observe({id:'pk',type:'pk-start',battleId:'battle',source:'socket',receivedAt:at,participants:[{anchorId:'101',name:'Lucy小露',roomId:'1001'},{anchorId:'102',name:'一只开心🎀',roomId:'1002'}]});
 const graph=createRelationshipRetriever()({anchor:'101',audience,now:at,memory:memory([entry('a','人物：Lucy小露；直播间号：1001。Lucy小露是阿明的朋友。'),entry('b','人物：一只开心🎀；直播间号：1002。一只开心🎀是阿明的朋友。')])},'Lucy小露 一只开心🎀',{browse:true});
 assert.deepEqual(new Set(graph.entities.filter(n=>['Lucy小露','一只开心🎀'].includes(n.name)).map(n=>n.id)),new Set(['person:uid%3A101','person:uid%3A102']));
});

test('一个UID关联多个已采集secUID时仍自动归档为一人，保留旧名、原话和独立来源',()=>{
 const a=new AudienceMemory({anchor:'10',now:()=>at}),b=new AudienceMemory({anchor:'20',now:()=>at});
 a.observe(chat('a',{id:'1',secUid:'account-old',name:'旧昵称'},'我是阿明的朋友。'));
 a.observe(chat('b',{id:'1',secUid:'account-new',name:'新昵称'},'我喜欢陶艺。'));
 b.observe(chat('c',{secUid:'account-old',name:'旧昵称'},'我是阿明的朋友。'));
 const graph=createRelationshipRetriever()({now:at,scopes:[{room:'11',anchor:'10',audience:a},{room:'22',anchor:'20',audience:b}]},'旧昵称新昵称',{browse:true});
 const people=graph.entities.filter(n=>['旧昵称','新昵称'].includes(n.name));
 assert.equal(people.length,1);assert.equal(people[0].id,'person:uid%3A1');
 assert.ok(people[0].aliases.includes('旧昵称'));
 assert.ok(!graph.ambiguities.some(row=>['旧昵称','新昵称'].includes(row.name)));
 assert.equal(people[0].dossier.coverage.records,3);
});

test('隐藏昵称从持续采集的相同UID/secUID恢复公开昵称，后来的隐藏名称不覆盖，重启保留',async()=>{
 const {AccountContext,accountSource,normalizeAccountPayload}=await import('../../src/ai/account-context.js');
 let time=at;const a=new AudienceMemory({anchor:'10',now:()=>time});
 a.observe(chat('a',{secUid:'account-lucy',name:'神秘人'},'我是阿明的朋友。'));
 a.observe(chat('b',{secUid:'account-other',name:'神秘人'},'我是小张的朋友。'));
 const retrieve=createRelationshipRetriever(),input={anchor:'10',audience:a,now:time};
 let graph=retrieve(input,'',{browse:true});
 assert.equal(graph.entities.filter(n=>n.name==='神秘人').length,2,'未知身份独立保存');
 assert.ok(!graph.ambiguities.some(row=>row.name==='神秘人'),'不用隐藏占位名要求用户辨认');
 const profile=accountSource('https://www.douyin.com/user/account-lucy'),accounts=new AccountContext({now:()=>time});
 accounts.replace('10',profile.url,normalizeAccountPayload({user:{uid:'123',sec_uid:profile.id,nickname:'Lucy小露',signature:'我喜欢陶艺。',web_rid:'1001'}},profile,time));
 input.accounts=accounts.list('10');
 graph=retrieve(input,'Lucy小露神秘人',{browse:true});
 const lucy=graph.entities.find(n=>n.id==='person:uid%3A123');
 assert.equal(lucy?.name,'Lucy小露');assert.equal(lucy.dossier.coverage.records,2);
 assert.equal(graph.entities.filter(n=>n.name==='神秘人').length,1);
 time++;
 a.observe({...chat('c',{id:'123',secUid:profile.id,name:'Lucy小露'},'我喜欢摄影。'),receivedAt:time});
 time++;
 a.observe({...chat('d',{id:'123',secUid:profile.id,name:'神秘人'},'我是小张的同事。'),receivedAt:time});
 const restored=new AudienceMemory({anchor:'10',state:JSON.parse(JSON.stringify(a.snapshot())),now:()=>time});
 graph=createRelationshipRetriever()({...input,audience:restored,now:time},'Lucy小露',{browse:true});
 assert.equal(graph.entities.find(n=>n.id==='person:uid%3A123')?.name,'Lucy小露');
 assert.equal(graph.entities.filter(n=>n.name==='Lucy小露').length,1);
 assert.ok(graph.relations.some(r=>r.predicate==='同事'));
});

test('公开账号的直播间号自动补齐UID连接；同UID多房间无需用户核对',async()=>{
 const {AccountContext,accountSource,normalizeAccountPayload}=await import('../../src/ai/account-context.js');
 const source=accountSource('https://www.douyin.com/user/account-lucy'),accounts=new AccountContext({now:()=>at});
 accounts.replace('10',source.url,normalizeAccountPayload({user:{uid:'123',sec_uid:source.id,nickname:'Lucy小露',web_rid:'1001'}},source,at));
 const values={
  'live-assistant:config:1002':{anchorId:'123'},'live-assistant:profile:1002':{anchorId:'123',name:'Lucy小露'},
  'live-assistant:config:1003':{anchorId:'10'},'live-assistant:runtime:1003':{accountSources:accounts.snapshot()},
  'live-assistant:knowledge:global':{entries:[entry('room','人物：旧资料名；直播间号：1001。旧资料名是阿明的朋友。')],knowledge:''}
 };
 const graph=await createRelationshipLibrary({all:async()=>values,now:()=>at}).query('1003','Lucy小露旧资料名',{},{browse:true});
 assert.equal(graph.entities.filter(n=>n.id==='person:uid%3A123').length,1);
 assert.equal(graph.entities.filter(n=>['Lucy小露','旧资料名'].includes(n.name)).length,1);
 assert.ok(graph.entities.find(n=>n.id==='person:uid%3A123').dossier.profiles.includes(source.url));
});

test('隐藏账号的UID 0不作为身份，后续secUID相同时才连接，不同匿名账号保持独立',()=>{
 const a=new AudienceMemory({anchor:'10',now:()=>at});
 a.observe(chat('a',{id:'0',secUid:'account-one',name:'神秘人'},'我是阿明的朋友。'));
 a.observe(chat('b',{id:'0',secUid:'account-two',name:'神秘人'},'我是小张的朋友。'));
 a.observe(chat('c',{id:'0',name:'神秘人'},'无法归属的弹幕'));
 const graph=createRelationshipRetriever()({anchor:'10',audience:a,now:at},'',{browse:true});
 assert.equal(graph.entities.filter(n=>n.name==='神秘人').length,2);
 assert.ok(!graph.entities.some(n=>n.id==='person:uid%3A0'));
 assert.equal(a.snapshot().unattributed.length,1);
});

test('多页面存档合并不以更晚的隐藏昵称覆盖已观察公开昵称；清空水位仍优先',async()=>{
 const {mergeLiveMemory}=await import('../../src/ai/live-memory.js');
 let time=at;const a=new AudienceMemory({anchor:'10',now:()=>time}),b=new AudienceMemory({anchor:'10',now:()=>time});
 a.observe(chat('a',{id:'123',name:'Lucy小露'},'我喜欢陶艺。'));
 time++;
 b.observe({...chat('b',{id:'123',name:'神秘人'},'我是阿明的朋友。'),receivedAt:time});
 let merged=mergeLiveMemory(archive(a),archive(b));
 assert.equal(merged.audience.viewers[0].name,'Lucy小露');
 assert.equal(merged.audience.viewers[0].statements.length,2);
 a.clear();merged=mergeLiveMemory(merged,archive(a));
 assert.equal(merged.audience.viewers.length,0);
});

test('核实UID及直播间号归并三组同名来源，刷新和重启幂等，关系按统一端点去重',async()=>{
 const names=['Lucy小露','一只开心🎀','张二要自律'];
 const values={'live-assistant:knowledge:global':{entries:[],knowledge:''}};
 for(const [i,name] of names.entries()){
  const room=String(1001+i),anchor=String(101+i);
  values[`live-assistant:config:${room}`]={anchorId:anchor};
  values[`live-assistant:profile:${room}`]={anchorId:anchor,name};
  values['live-assistant:knowledge:global'].entries.push(
   entry(`uid-${i}`,`人物：${name}；UID：${anchor}；直播间号：${room}。${name}是阿明的朋友。`),
   entry(`room-${i}`,`人物：${name}；直播间号：${room}。${name}是阿明的朋友。`)
  );
 }
 const original=structuredClone(values),library=createRelationshipLibrary({all:async()=>structuredClone(values),now:()=>at});
 const query=()=>library.query('1001',names.join('、'),{}, {browse:true});
 let graph=await query();
 for(const name of names)assert.equal(graph.entities.filter(n=>n.name===name).length,1,name);
 assert.equal(graph.relations.length,3);assert.equal(graph.ambiguities.length,0);
 assert.ok(graph.relations.every(r=>r.evidence.length===2));
 assert.deepEqual(await query(),graph);
 assert.deepEqual(await createRelationshipLibrary({all:async()=>JSON.parse(JSON.stringify(values)),now:()=>at}).query('1001',names.join('、'),{}, {browse:true}),graph);
 assert.deepEqual(values,original,'保留来源存档，不破坏原始数据');
 values['live-assistant:knowledge:global'].entries.push(entry('new','人物：新名字；UID：101。新名字是阿明的朋友。'));
 graph=await query();
 assert.equal(graph.relations.length,3);
 assert.ok(graph.entities.find(n=>n.id==='person:uid%3A101').aliases.includes('新名字'));
});

test('直播间是主播所属房间，不是观众所在房间；换主播和不同UID不因同名合并',async()=>{
 const audience=new AudienceMemory({anchor:'10',now:()=>at});
 audience.observe(chat('a',{id:'1',name:'同名'},'我是阿明的朋友。'));
 audience.observe(chat('b',{id:'2',name:'同名'},'我是阿明的朋友。'));
 const values={
  'live-assistant:config:1001':{anchorId:'10'},
  'live-assistant:profile:1001':{anchorId:'10',name:'同名'},
  'live-assistant:live-memory:1001:10':archive(audience),
  'live-assistant:knowledge:global':{entries:[entry('room','人物：同名；直播间号：1001。同名是阿明的朋友。')],knowledge:''}
 };
 const library=createRelationshipLibrary({all:async()=>values,now:()=>at});
 let graph=await library.query('1001','同名',{},{browse:true});
 assert.equal(graph.entities.filter(n=>n.name==='同名').length,3);
 assert.ok(graph.ambiguities.some(row=>row.name==='同名'));
 values['live-assistant:config:1001'].anchorId='20';
 values['live-assistant:profile:1001']={anchorId:'20',name:'新主播'};
 graph=await library.query('1001','同名新主播',{},{browse:true});
 assert.ok(graph.relations.some(r=>r.from==='person:uid%3A20' || r.to==='person:uid%3A20'));
 assert.ok(!graph.relations.some(r=>r.from==='person:uid%3A10' || r.to==='person:uid%3A10'));
});

test('冲突UID连接不传递合并；未核实正文、昵称、来源房间不能充当身份标识',()=>{
 const a=new AudienceMemory({anchor:'10',now:()=>at});
 a.observe(chat('a',{id:'1',secUid:'same-account',name:'同名'},'我是阿明的朋友。'));
 a.observe(chat('b',{id:'2',secUid:'same-account',name:'同名'},'我是阿明的朋友。'));
 const entries=[entry('a','人物：同名；UID：1；直播间号：1001。同名是小张的朋友。'),entry('b','人物：同名；UID：2；直播间号：1001。同名是小张的朋友。'),entry('unverified','人物：待核实；UID：1。待核实是小张的朋友。','unverified')];
 const graph=createRelationshipRetriever()({anchor:'10',audience:a,memory:memory(entries),now:at},'同名待核实',{browse:true});
 assert.equal(graph.entities.filter(n=>n.name==='同名').length,2);
 assert.ok(graph.ambiguities.some(r=>r.name==='同名'));
 assert.ok(graph.entities.some(n=>n.name==='待核实' && n.id.includes('mention')));
 assert.ok(graph.relations.some(r=>r.from==='person:uid%3A1' || r.to==='person:uid%3A1'));
 assert.ok(graph.relations.some(r=>r.from==='person:uid%3A2' || r.to==='person:uid%3A2'));
});

test('身份来源停用、删除、过期后立即撤销连接，不让缓存保留旧归档',()=>{
 const retrieve=createRelationshipRetriever(),entries=[entry('uid','人物：小露；UID：1；secUID：account-sec。小露是阿明的朋友。')];
 const a=new AudienceMemory({anchor:'10',now:()=>at});
 a.observe(chat('a',{secUid:'account-sec',name:'小露'},'我是阿明的朋友。'));
 const input={anchor:'10',audience:a,memory:memory(entries),now:at};
 const query=()=>retrieve(input,'小露',{browse:true});
 assert.ok(query().entities.some(n=>n.id==='person:uid%3A1'));
 for(const change of [()=>entries[0].enabled=false,()=>{entries[0].enabled=true;entries[0].expiresOn='2020-01-01';},()=>entries.splice(0)]){
  change();const graph=query();
  assert.ok(!graph.entities.some(n=>n.id==='person:uid%3A1'));
  assert.ok(graph.entities.some(n=>n.id==='person:sec%3Aaccount-sec'));
 }
});
