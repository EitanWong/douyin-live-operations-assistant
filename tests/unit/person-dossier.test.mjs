import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {createRelationshipLibrary} from '../../src/ai/relationship-library.js';
import {createRelationshipRetriever} from '../../src/ai/relationship-memory.js';
import {makeAIRequest} from '../../src/services/ai.js';
import {makeEdgeMessages} from '../../src/ai/edge-prompt.js';
import {mergeConfig} from '../../src/core/engine.js';
const at=1800000000000;
const chat=(id,text)=>({id,type:'chat',source:'socket',receivedAt:at,user:{id:'1',name:'小雨',secUid:'rain-account'},text});
function fixture(){
 const audience=new AudienceMemory({anchor:'10',now:()=>at});
 audience.observe(chat('old','我喜欢陶艺。我的性格：慢热。我的说话风格：简短直接。'));
 audience.observe(chat('event','昨天和阿明在陶艺展见面，约好周六一起练习。'));
 audience.observe(chat('relation','我是阿明的朋友。'));
 audience.observe({id:'gift',type:'gift',source:'socket',receivedAt:at,user:{id:'1',name:'小雨',secUid:'rain-account'},giftName:'玫瑰',count:3,unitValue:1});
 const input={anchor:'10',audience,now:at},retrieve=createRelationshipRetriever();
 return {audience,input,retrieve,query:q=>retrieve(input,q)};
}
test('人物档案汇总明确自述、完整事件原话、说话样本、主页和礼物观测，事实都有来源',()=>{
 const f=fixture(),result=f.query('小雨的性格兴趣和昨天的约定'),person=result.entities.find(n=>n.name==='小雨');
 assert.ok(person.dossier,'人物节点提供可检索档案');
 assert.ok(person.dossier.facets.some(r=>r.category==='interests' && r.text.includes('陶艺') && r.trust==='unverified'));
 assert.ok(person.dossier.facets.some(r=>r.category==='personality' && r.text==='慢热'));
 assert.ok(person.dossier.facets.some(r=>r.category==='speechStyle' && r.text==='简短直接'));
 assert.ok(person.dossier.events.some(e=>e.text==='昨天和阿明在陶艺展见面，约好周六一起练习。' && e.at===at && e.source==='直播弹幕'));
 assert.ok(person.dossier.speechSamples.some(e=>e.text.includes('陶艺')));
 assert.deepEqual(person.dossier.profiles,['https://www.douyin.com/user/rain-account']);
 assert.equal(person.dossier.gifting.observed.count,3);
 assert.equal(person.dossier.gifting.prediction,null,'不凭采样礼物编造下次送礼概率');
 assert.ok(!person.dossier.facets.some(r=>r.category==='consumption'),'礼物不推导现实消费能力');
 assert.equal(result.relations.length,1,'事件一起出现不能推断额外关系');
 assert.ok(person.dossier.events.every(e=>e.recordId && e.source && Number.isFinite(e.at)));
 const prompt={target:{text:'小雨喜欢什么'},getRelationshipContext:f.query,maxLength:50},config=mergeConfig().ai;
 assert.ok(JSON.parse(makeAIRequest(prompt,config).messages[1].content).evidence_context.relationships.entities.some(n=>n.dossier));
 assert.ok(JSON.parse(makeEdgeMessages(prompt,config)[1].content).relationships.entities.some(n=>n.dossier));
});
test('无关系的独立人物也能浏览；长事件保留原档，只向AI披露相关片段及原文位置',()=>{
 const f=fixture();f.audience.clear();f.audience.now=()=>at+1;
 const text='一次完整活动记录。'+'活动细节。'.repeat(200)+'最后约定周六带陶土。';
 f.audience.observe({...chat('long',text),receivedAt:at+1});f.input.now=at+1;
 const graph=f.retrieve(f.input,'',{browse:true});
 assert.ok(graph.entities.some(n=>n.name==='小雨'));
 const person=f.query('小雨最后约定周六带陶土').entities.find(n=>n.name==='小雨');
 assert.ok(person.dossier.events.some(e=>e.text.includes('周六带陶土')));
 assert.equal(f.audience.snapshot().viewers[0].statements[0].text,text);
 assert.ok(person.dossier.events.every(e=>e.range && e.originalChars===text.length));
 assert.ok(JSON.stringify(person.dossier).length<=6500);
});
test('同名不混合档案，第三方搜索材料只能作待查线索；遗忘即时生效且回复上下文开关不隐藏档案',async()=>{
 const f=fixture(),archive=()=>({version:1,anchor:'10',audience:f.audience.snapshot(),perception:{observations:[]}});
 const values={'live-assistant:config:1':{anchorId:'10',ai:{assistant:{memoryEnabled:true},contextSources:{audience:true,accounts:true}}},'live-assistant:live-memory:1:10':archive()};
 const corpus={version:1,revision:0,rows:[{id:'a',subject:'uid:1',subjectEpoch:0,source:'https://example.org/rain',title:'公开线索',text:'我喜欢滑雪。小雨是阿明的妹妹。',at,expiresAt:at+60000,trust:'unverified'}]};
 values['live-assistant:knowledge:1:10']=corpus;
 const library=createRelationshipLibrary({all:async()=>values,now:()=>at+2});
 let result=await library.query('1','小雨');
 let dossier=result.entities.find(n=>n.name==='小雨').dossier;
 assert.ok(dossier.leads.some(e=>e.source==='https://example.org/rain'));
 assert.ok(!dossier.facets.some(e=>e.text.includes('滑雪')),'研究目标不等于原文说话人');
 assert.ok(!result.relations.some(r=>r.predicate==='妹妹'));
 f.audience.now=()=>at+1;f.audience.forget('uid:1');f.audience.now=()=>at+2;f.audience.observe({...chat('new','今天来听歌。'),receivedAt:at+2});
 values['live-assistant:live-memory:1:10']=archive();
 result=await library.query('1','小雨');dossier=result.entities.find(n=>n.name==='小雨').dossier;
 assert.equal(dossier.leads.length,0);assert.equal(dossier.facets.length,0);
 values['live-assistant:config:1'].ai.contextSources.audience=false;
 result=await library.query('1','小雨');assert.equal(result.entities.length,1);
});
test('运营明确字段可建模，同字段矛盾原样并列，否定和疑问不被提取成正向爱好',()=>{
 const f=fixture();f.audience.observe(chat('no','我不喜欢滑雪。我喜欢爬山吗？'));
 f.input.memory={enabled:true,entries:[{id:'p',title:'人物',content:'人物：小雨；兴趣爱好：不喜欢陶艺；消费习惯：只记录本人确认的预算；送礼习惯：节日送花。',enabled:true,source:'本人核对',updatedAt:at,expiresOn:''}]};
 const dossier=f.query('小雨').entities.find(n=>n.name==='小雨').dossier;
 assert.ok(dossier.facets.some(e=>e.category==='interests' && e.text==='不喜欢陶艺' && e.trust==='verified'));
 assert.ok(dossier.facets.some(e=>e.category==='interests' && e.text.includes('陶艺') && e.trust==='unverified'));
 assert.ok(!dossier.facets.some(e=>e.text==='滑雪' || e.text==='爬山'));
 assert.match(dossier.policy,/矛盾|冲突/);
});
test('完整事件按原文编号逐条读取；到期研究线索与删除原文不被缓存复活',()=>{
 const f=fixture(),doc=f.query('小雨').entities.find(n=>n.name==='小雨').dossier.events[0];
 const expanded=f.retrieve(f.input,'小雨',{recordId:doc.recordId});
 assert.ok(expanded.record?.text);assert.equal(expanded.record.recordId,doc.recordId);
 f.input.corpus=[{id:'lead',subject:'uid:1',subjectEpoch:0,text:'公开陶艺活动资料',source:'https://example.org/pottery',at,expiresAt:at+100}];
 assert.equal(f.query('小雨').entities.find(n=>n.name==='小雨').dossier.leads.length,1);
 f.input.now=at+101;
 assert.equal(f.query('小雨').entities.find(n=>n.name==='小雨').dossier.leads.length,0);
 f.audience.forget('uid:1');assert.equal(f.retrieve(f.input,'小雨',{recordId:doc.recordId}).record,null);
});
test('长事件命中末尾条件时不在二次截断中丢掉条件，同一记录不挤占全部事件名额',()=>{
 const f=fixture(),text='活动记录：昨天和阿明在陶艺展见面。'+'公开活动原始细节，用于检验完整正文和键盘阅读。'.repeat(70)+'周六带陶土。';
 f.audience.observe(chat('tail',text));
 const events=f.query('小雨的兴趣和周六约定').entities.find(n=>n.name==='小雨').dossier.events;
 assert.ok(events.some(e=>e.text.includes('周六带陶土')));
 assert.equal(new Set(events.map(e=>e.recordId)).size,events.length);
 for(const e of events){const full=f.retrieve(f.input,'小雨',{recordId:e.recordId}).record.text;assert.equal(full.slice(e.range.start,e.range.end),e.text);}
});
test('明确人物字段保留完整否定和条件，不把截断前半段写成性格或消费结论',()=>{
 const f=fixture(),value='性格描述'.repeat(70)+'但这只是角色表演，不代表本人性格';
 f.audience.observe(chat('qualified',`我的性格：${value}。`));
 const facets=f.query('小雨性格').entities.find(n=>n.name==='小雨').dossier.facets;
 assert.ok(facets.some(e=>e.category==='personality' && e.text===value));
});
