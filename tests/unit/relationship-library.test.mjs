import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {mergeLiveMemory} from '../../src/ai/live-memory.js';
import {createRelationshipLibrary} from '../../src/ai/relationship-library.js';
const at=1800000000000;
test('共享人物只建一个全局节点，在无已识别主播的新房也可查询，更正删除同步生效',async()=>{
 const {profileMemoryEntry}=await import('../../src/services/person-profile.js');
 const f=fixture();f.values['live-assistant:config:3']={ai:{memory:{enabled:true,entries:[]}}};
 const row=profileMemoryEntry({version:1,name:'云杉',key:'',facts:[],relationships:[{name:'阿明',predicate:'助理',negative:false,evidence:[{turn:1,quote:'云杉是阿明的助理。'}]}],analysis:[],knowledge:[],reply:'待核实',turns:[{text:'云杉是阿明的助理。',at}]},{id:'global-person',updatedAt:at});
 row.content='云杉是阿明的助理。';
 f.values['live-assistant:knowledge:global']={version:1,entries:[row],knowledge:''};
 const a=await f.library.query('1','云杉'),b=await f.library.query('3','云杉');
 assert.equal(b.entities.filter(n=>n.name==='云杉').length,1);
 assert.deepEqual(a.entities.filter(n=>n.role.includes('资料人物')).map(n=>n.id),b.entities.filter(n=>n.role.includes('资料人物')).map(n=>n.id));
 assert.equal(b.relations[0]?.predicate,'助理');
 f.values['live-assistant:knowledge:global'].entries=[];
 assert.equal((await f.library.query('3','云杉')).relations.length,0);
});
const chat=(id,user,text)=>({id,type:'chat',source:'socket',receivedAt:at,user,text});
function fixture(){
 const a=new AudienceMemory({anchor:'10',now:()=>at}),b=new AudienceMemory({anchor:'20',now:()=>at});
 a.observe(chat('1',{id:'1',secUid:'sec-account-a',name:'阿青'},'我是小雨的朋友。'));
 b.observe(chat('2',{secUid:'sec-account-a',name:'青哥'},'我是阿明的徒弟。'));
 b.observe(chat('3',{id:'2',name:'小雨'},'我是小张的搭档。'));
 const archive=m=>({version:1,anchor:m.anchor,audience:m.snapshot(),perception:{observations:[],forgetBefore:0}});
 const values={
  'live-assistant:config:1':{anchorId:'10',ai:{assistant:{memoryEnabled:true},contextSources:{audience:true,accounts:true},memory:{enabled:true,entries:[]}}},
  'live-assistant:config:2':{anchorId:'20',ai:{assistant:{memoryEnabled:true},contextSources:{audience:true,accounts:true},memory:{enabled:true,entries:[]}}},
  'live-assistant:live-memory:1:10':archive(a),'live-assistant:live-memory:2:20':archive(b)
 };
 return {a,b,values,archive,library:createRelationshipLibrary({all:async()=>structuredClone(values),now:()=>at})};
}
test('同次观测的 UID/secUID 持久化，重启后跨房间连通；重名提及保持来源范围',async()=>{
 const f=fixture();
 const merged=mergeLiveMemory(f.archive(f.a),f.archive(f.a));
 assert.deepEqual(merged.audience.viewers[0].secUids,['sec-account-a']);
 const result=await f.library.query('1','青哥和小雨和阿明什么关系');
 assert.equal(result.entities.filter(n=>n.name==='阿青' || n.name==='青哥').length,1);
 assert.ok(result.relations.some(r=>r.predicate==='徒弟'));
 assert.ok(result.relations.some(r=>r.predicate==='朋友'));
 const rain=result.entities.filter(n=>n.name==='小雨');assert.equal(rain.length,2,'跨范围同名不绑定');
 assert.ok(result.ambiguities.some(r=>r.name==='小雨'));
 assert.ok(result.relations.flatMap(r=>r.evidence).every(e=>e.scope?.room && e.scope?.anchor));
 assert.ok(result.paths.some(p=>p.length===2),'稳定账号连接跨房间的两跳资料');
});
test('冲突身份不合并，常驻来源不被旧开关隐藏且清空后即时移除；不返回全量档案',async()=>{
 const f=fixture();f.b.observe(chat('4',{id:'9',secUid:'sec-account-a',name:'其他人'},'我是阿明的助理。'));
 f.values['live-assistant:live-memory:2:20']=f.archive(f.b);
 let result=await f.library.query('1','阿青和其他人');
 assert.equal(result.entities.filter(n=>['阿青','其他人'].includes(n.name)).length,2);
 f.values['live-assistant:config:2'].ai.assistant.memoryEnabled=false;
 result=await f.library.query('1','阿明和小雨');assert.ok(result.relations.some(r=>r.predicate==='徒弟'));
 f.b.clear();f.values['live-assistant:live-memory:2:20']=mergeLiveMemory(f.archive(f.b),f.values['live-assistant:live-memory:2:20']);
 f.a.clear();f.values['live-assistant:live-memory:1:10']=mergeLiveMemory(f.archive(f.a),f.values['live-assistant:live-memory:1:10']);
 result=await f.library.query('1','阿青和小雨');assert.equal(result.relations.length,0);
 assert.ok(!JSON.stringify(result).includes('sec-account-a'));
});

test('公开简介、作品自述、实际评论回复及历史弹幕进入有来源的跨账号图谱，画面不认证关系',async()=>{
 const {AccountContext,accountSource,normalizeAccountPayload}=await import('../../src/ai/account-context.js');
 const f=fixture(),accounts=new AccountContext({now:()=>at}),profile=accountSource('https://www.douyin.com/user/sec-account-a');
 accounts.replace('10',profile.url,normalizeAccountPayload({user:{uid:'1',sec_uid:profile.id,nickname:'青哥',signature:'我是小张的朋友。'},aweme_list:[{aweme_id:'70',desc:'我是阿明的徒弟。',author:{uid:'1',sec_uid:profile.id,nickname:'青哥'}}]},profile,at));
 const work=accountSource('https://www.douyin.com/video/70');
 const rows=normalizeAccountPayload({comments:[{cid:'c1',aweme_id:'70',text:'@青哥 你好',user:{uid:'2',nickname:'小雨'},reply_comment:{user:{uid:'1',sec_uid:profile.id,nickname:'青哥'}}}],danmaku_list:[{danmaku_id:'d1',text:'阿明和小张是搭档',offset_time:500}]},work,at,{work:{id:'70',subject:profile.id}});
 accounts.replace('10',work.url,rows.concat([{...rows[1],kind:'visual',id:'v',text:'小雨是青哥的妹妹'}]));
 f.values['live-assistant:runtime:1']={accountSources:accounts.snapshot()};
 const result=await f.library.query('1','青哥和小雨和阿明和小张');
 assert.ok(result.relations.some(r=>r.predicate==='回复' && r.status==='observed'));
 assert.ok(result.relations.some(r=>r.predicate==='朋友' && r.status==='unverified'));
 assert.ok(result.relations.some(r=>r.predicate==='搭档' && r.evidence.some(e=>e.source===work.url)));
 assert.ok(!result.relations.some(r=>r.predicate==='妹妹'));
 assert.ok(result.relations.flatMap(r=>r.evidence).some(e=>e.sample?.positionMs===500));
 f.a.clear();f.values['live-assistant:live-memory:1:10']=f.archive(f.a);
 const later=createRelationshipLibrary({all:async()=>f.values,now:()=>at+25*3600000});
 assert.ok((await later.query('1','阿明和小张')).relations.some(r=>r.predicate==='搭档'),'历史作品证据保持可查');
 accounts.forget('10',work.url);accounts.forget('10',profile.url);f.values['live-assistant:runtime:1'].accountSources=accounts.snapshot();
 assert.ok(!(await later.query('1','小张')).relations.some(r=>r.predicate==='搭档' && r.evidence.some(e=>e.source===work.url)));
});

test('主播已核对的双账号标识经过唯一资料写入者保存，同主播缺字段更新保留，换主播不继承',async()=>{
 const {GiftStore}=await import('../../src/data/gifts.js');const values={};
 const store=new GiftStore({get:async(k,f)=>values[k] || f,set:async(k,v)=>values[k]=v,all:async()=>values});
 await store.profile({room:'1',anchorId:'10',name:'主播',secUid:'anchor-sec-id'});
 assert.equal(values['live-assistant:profile:1'].secUid,'anchor-sec-id');
 await store.profile({room:'1',anchorId:'10',name:'主播新名'});assert.equal(values['live-assistant:profile:1'].secUid,'anchor-sec-id');
 await store.profile({room:'1',anchorId:'20'});assert.equal(values['live-assistant:profile:1'].secUid,undefined);
});

test('本房历史作品删除刷新缓存；不把上个主播的主页名字套给新主播',async()=>{
 const f=fixture();f.values['live-assistant:profile:2']={anchorId:'99',name:'旧主播名字',secUid:'old-anchor-id'};
 assert.ok(!(await f.library.query('1','旧主播名字')).entities.some(n=>n.name==='旧主播名字'));
 const {LiveMemoryArchive}=await import('../../src/ai/live-memory.js');const store=new LiveMemoryArchive({room:'1',get:()=>null,set:async()=>{},now:()=>at+2*86400000});
 const row={kind:'work',id:'1',subject:'a',text:'小张和阿明是搭档',source:'https://www.douyin.com/video/1',observedAt:at,expiresAt:at+86400000};
 assert.equal(store.relationships('10','小张',{accounts:[row],includeAccountHistory:true}).relations.length,1);
 assert.equal(store.relationships('10','小张',{accounts:[],includeAccountHistory:true}).relations.length,0);
});
