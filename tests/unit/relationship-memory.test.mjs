import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LiveMemoryArchive} from '../../src/ai/live-memory.js';
import {Engine,mergeConfig} from '../../src/core/engine.js';
import {makeAIRequest} from '../../src/services/ai.js';
import {makeEdgeMessages} from '../../src/ai/edge-prompt.js';
const at=1800000000000;
const entry=(id,content)=>({id,title:'人物关系',content,source:'运营核对',enabled:true,updatedAt:at,expiresOn:''});
const memory=entries=>({enabled:true,entries});
function fixture(){
 const rows=new Map(),options={room:'1',get:(k,f)=>rows.get(k) ?? f,set:async(k,v)=>rows.set(k,structuredClone(v)),now:()=>at};
 return {store:new LiveMemoryArchive(options),options,rows};
}
const chat=(id,text,user='1',name='小雨')=>({id,type:'chat',source:'socket',receivedAt:at,user:{id:user,name},text});

test('人物图谱从持久原话恢复，稳定ID分人，重复弹幕不增加可信度，不将问句变为事实',async()=>{
 const f=fixture(),scope=f.store.current('10');
 scope.audience.observe(chat('a','我是阿明的徒弟。'));scope.audience.observe(chat('a','我是阿明的徒弟。'));
 scope.audience.observe(chat('b','阿明是小李的师傅吗？'));
 await f.store.persist(f.store.capture());
 const store=new LiveMemoryArchive(f.options),result=store.relationships('10','小雨和阿明是什么关系？');
 assert.equal(result.relations.length,1);assert.equal(result.relations[0].predicate,'徒弟');
 assert.equal(result.relations[0].status,'unverified');assert.equal(result.relations[0].evidence.length,1);
 assert.equal(result.relations[0].evidence[0].text,'我是阿明的徒弟');assert.equal(result.relations[0].evidence[0].at,at);
 assert.doesNotMatch(JSON.stringify(result),/uid:|"10"/);
 assert.equal(store.relationships('20','小雨和阿明').relations.length,0);
 scope.audience.observe(chat('other','你好','2','小雨'));
 const duplicate=f.store.relationships('10','小雨是谁');
 assert.ok(duplicate.ambiguities.some(row=>row.name==='小雨'));assert.equal(duplicate.entities.filter(row=>row.name==='小雨').length,2);
});

test('知识库核实关系、别名及两跳路径可用于人物问答，保留否认和冲突且不传递推断朋友',()=>{
 const {store}=fixture(),options={memory:memory([
  entry('person','人物：阿明；别名：明哥、阿明哥；身份：主播。'),
  entry('one','阿明是小雨的师傅。小雨和小李是朋友。'),
  entry('deny','阿明不是小雨的师傅。')
 ])};
 const result=store.relationships('10','明哥和小李什么关系',options);
 assert.equal(result.relations.length,3);assert.ok(result.relations.some(r=>r.status==='conflicted'));
 assert.ok(result.paths.some(path=>path.length===2));
 assert.ok(!result.relations.some(r=>r.predicate==='朋友' && result.entities.find(n=>n.id===r.from)?.name==='阿明'));
 assert.ok(result.entities.find(n=>n.name==='阿明').aliases.includes('明哥'));
 assert.equal(result.entities.find(n=>n.name==='阿明').role,'主播');
 assert.match(result.policy,/不能|不得/);
 options.memory.entries[1].enabled=false;options.memory.entries[2].expiresOn='2020-01-01';
 assert.equal(store.relationships('10','明哥和小李',options).relations.length,0);
});

test('画面不能识别人际关系，语音自述不认证主播，忘记与关闭来源即时移除图谱',()=>{
 const {store}=fixture(),scope=store.current('10');
 scope.perception.observe({id:'v',kind:'video',at,endedAt:at,text:'阿明是小雨的师傅'});
 scope.perception.observe({id:'a',kind:'audio',at,endedAt:at,text:'我是阿明的徒弟。小李是小雨的朋友。'});
 const result=store.relationships('10','小李和小雨');
 assert.equal(result.relations.length,1);assert.equal(result.relations[0].status,'unverified');
 assert.equal(store.relationships('10','阿明是谁').relations.length,0);
 assert.equal(store.relationships('10','小李和小雨',{includePerception:false}).relations.length,0);
 scope.perception.clear();assert.equal(store.relationships('10','小李和小雨').relations.length,0);
 scope.audience.observe(chat('a','我是阿明的徒弟'));scope.audience.forget('uid:1');
 assert.equal(store.relationships('10','阿明和小雨').relations.length,0);
});

test('真实云端和本地请求都带有有界关系证据，尊重记忆与观众来源开关',()=>{
 const {store}=fixture();store.current('10').audience.observe(chat('a','我是阿明的徒弟'));
 const config=mergeConfig(),engine=new Engine({config,relationshipContext:(q,c)=>store.relationships('10',q,{includeAudience:c.ai.contextSources.audience})});
 const prompt={...engine.aiContext(),target:{text:'小雨和阿明什么关系'},maxLength:50};
 const input=JSON.parse(makeAIRequest(prompt,config.ai).messages[1].content);
 assert.equal(input.evidence_context.relationships.relations.length,1);
 const local=JSON.parse(makeEdgeMessages(prompt,config.ai)[1].content);assert.equal(local.relationships.relations.length,1);
 engine.config.ai.contextSources.audience=false;
 assert.equal(JSON.parse(makeAIRequest({...engine.aiContext(),target:prompt.target,maxLength:50},config.ai).messages[1].content).evidence_context.relationships.relations.length,0);
 config.ai.assistant.memoryEnabled=false;
 assert.equal(JSON.parse(makeAIRequest({...engine.aiContext(),target:prompt.target,maxLength:50},config.ai).messages[1].content).evidence_context.relationships,null);
});

test('协议PK和已连接连麦形成有来源的历史互动边，邀请和同场弹幕不能推断朋友',async()=>{
 const f=fixture(),scope=f.store.current('10');
 scope.audience.observe({type:'pk-start',source:'socket',battleId:'b',receivedAt:at,participants:[{anchorId:'10',name:'阿明'},{anchorId:'20',name:'小李'}]});
 scope.audience.observe({type:'link-state',source:'socket',id:'link',channelId:'c',receivedAt:at,linkedUsers:[{id:'30',name:'小雨'}]});
 scope.audience.observe(chat('mention','@小雨 今天好早','40','小张'));
 await f.store.persist(f.store.capture());
 const store=new LiveMemoryArchive(f.options),result=store.relationships('10','小李和小雨和小张与主播');
 assert.ok(result.relations.some(r=>r.predicate==='PK对局' && r.status==='observed'));
 assert.ok(result.relations.some(r=>r.predicate==='同场连麦' && r.status==='observed'));
 assert.ok(result.relations.some(r=>r.predicate==='提及' && r.status==='observed'));
 assert.ok(!result.relations.some(r=>r.predicate==='朋友'));
 const before=store.current('10').audience.snapshot();store.current('10').audience.clear();
 assert.equal(store.relationships('10','小雨与主播').relations.length,0);
 const {mergeLiveMemory}=await import('../../src/ai/live-memory.js');
 const old={version:1,anchor:'10',audience:before,perception:{observations:[],forgetBefore:0}};
 const cleared=store.capture()[0].state;assert.equal(mergeLiveMemory(cleared,old).audience.interactions.length,0);
});

test('重名片段不抢占完整人物名，高度连接的人物仍优先返回问题两端的直接关系和两跳证据',()=>{
 const {store}=fixture(),options={memory:memory([entry('many',Array.from({length:30},(_,i)=>`观众300和路人${i}是朋友。`).join('')+'观众3和路人甲是朋友。观众30和路人乙是朋友。观众300是小雨的师傅。小雨和小李是朋友。')])};
 const result=store.relationships('10','观众300和小李什么关系',options);
 assert.ok(result.entities.some(row=>row.name==='观众300'));
 assert.ok(!result.entities.some(row=>['观众3','观众30'].includes(row.name)));
 assert.ok(result.paths.some(path=>path.length===2));
 const direct=store.relationships('10','观众300和小雨什么关系',options);
 assert.ok(direct.relations.some(row=>row.predicate==='师傅'));
});

test('中文口语省略“的”和反向自述仍绑定实际说话账号，第三人称不猜身份',()=>{
 const {store}=fixture(),scope=store.current('10');
 scope.audience.observe(chat('a','阿明是我师父。小李的朋友是我。','1','小雨'));
 scope.audience.observe(chat('b','我是阿明徒弟。','2','青哥'));
 const result=store.relationships('10','小雨和阿明和小李和青哥');
 const names=new Map(result.entities.map(n=>[n.id,n.name]));
 assert.ok(result.relations.some(r=>names.get(r.from)==='阿明' && names.get(r.to)==='小雨' && r.predicate==='师傅'));
 assert.ok(result.relations.some(r=>names.get(r.from)==='青哥' && names.get(r.to)==='阿明' && r.predicate==='徒弟'));
 assert.ok(result.relations.some(r=>names.get(r.from)==='小雨' && names.get(r.to)==='小李' && r.predicate==='朋友'));
});

test('口语省略不把“甲和乙是好朋友”误解为“甲和乙”与“好”的关系',()=>{
 const {store}=fixture();const result=store.relationships('10','阿明和小雨',{memory:memory([entry('f','阿明和小雨是好朋友。')])});
 assert.equal(result.relations.length,1);assert.deepEqual(new Set(result.entities.map(n=>n.name)),new Set(['阿明','小雨']));assert.equal(result.relations[0].predicate,'朋友');
});
