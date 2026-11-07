import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {createRelationshipRetriever} from '../../src/ai/relationship-memory.js';
import {makeAIRequest} from '../../src/services/ai.js';
import {makeEdgeMessages} from '../../src/ai/edge-prompt.js';
import {mergeConfig} from '../../src/core/engine.js';
import {profileOutputSchema} from '../../src/ai/person-profile.js';
import {withRelationshipEvidence} from '../../src/services/relationship-query.js';
import {createAIClient} from '../../src/services/ai.js';

const at=1800000000000;
const gift=(id,name,count,unitValue=1000)=>({id,type:'gift',source:'socket',receivedAt:at,user:{id,name},giftName:'礼物',count,unitValue});
function fixture(){
 const audience=new AudienceMemory({anchor:'10',now:()=>at});
 audience.observe(gift('1','华哥',5));audience.observe(gift('1','华哥',5));
 audience.observe(gift('2','青哥',3));audience.observe(gift('3','未知单价',99,null));
 const retrieve=createRelationshipRetriever(),input={room:'1',anchor:'10',anchorName:'Lucy小露',audience,now:at};
 return {audience,input,query:q=>retrieve(input,q)};
}

test('人物关系查询通过简称找到主播，送礼构成直接支持关系并按同主播记录排名',()=>{
 const f=fixture(),result=f.query('华哥和小露是什么关系？'),names=new Map(result.entities.map(n=>[n.id,n.name]));
 const edge=result.relations.find(r=>names.get(r.from)==='华哥' && names.get(r.to)==='Lucy小露' && r.predicate==='送礼支持');
 assert.ok(edge,'实际送礼进入可检索的直接关系');assert.equal(edge.status,'observed');
 assert.ok(edge.evidence.some(e=>e.text.includes('5000') && e.source==='直播礼物协议'));
 const board=result.supportRankings.find(b=>names.get(b.anchor)==='Lucy小露');
 assert.equal(board.rows[0].name,'华哥');assert.equal(board.rows[0].rank,1);assert.equal(board.rows[0].knownDiamonds,5000);assert.equal(board.rows[0].count,5);
 assert.equal(board.rows[1].name,'青哥');assert.equal(board.rows.find(r=>r.name==='未知单价').rank,null);assert.equal(board.partial,true);
 assert.ok(result.entities.find(n=>n.name==='华哥').dossier.gifting);
});

test('排名先从全部候选排序，不受12条关系选择顺序影响；遗忘后下次查询即时移除',()=>{
 const f=fixture();for(let i=20;i<45;i++)f.audience.observe(gift(String(i),`支持者${i}`,i));
 let result=f.query('小露的大哥送礼排名'),board=result.supportRankings?.[0];
 assert.ok(board);assert.equal(board.total,28);assert.equal(board.rows[0].name,'支持者44');
 assert.equal(board.rows[0].rank,1);assert.ok(board.omitted>0);
 assert.ok(board.rows.every(r=>result.entities.some(n=>n.id===r.entityId)));
 f.audience.now=()=>at+1;f.audience.forget('uid:44');f.input.now=at+1;
 result=f.query('小露的大哥送礼排名');assert.equal(result.supportRankings[0].rows[0].name,'支持者43');
 assert.ok(!result.entities.some(n=>n.name==='支持者44'));
});

test('同名或简称歧义不并人；别的主播的送礼不混入当前主播排名',()=>{
 const f=fixture(),other=new AudienceMemory({anchor:'20',now:()=>at});other.observe(gift('1','华哥',20));
 const retrieve=createRelationshipRetriever();
 const graph=retrieve({scopes:[f.input,{room:'2',anchor:'20',anchorName:'另一小露',audience:other}],now:at},'华哥和小露');
 const names=new Map(graph.entities.map(n=>[n.id,n.name]));
 const board=graph.supportRankings?.find(b=>names.get(b.anchor)==='Lucy小露');
 assert.ok(board);assert.equal(board.rows.find(r=>r.name==='华哥').knownDiamonds,5000);
 assert.equal(graph.supportRankings.find(b=>names.get(b.anchor)==='另一小露').rows[0].knownDiamonds,20000);
 assert.ok(graph.ambiguities.some(row=>row.name==='小露' && row.candidates.length===2));
});

test('真实人物回复先检索再生成，单问支持者也能获得完整主播排名',async()=>{
 const f=fixture(),order=[],config=mergeConfig().ai;
 const reply=createAIClient({getKey:()=> 'fixture-key',request:details=>{
  order.push('model');const input=JSON.parse(JSON.parse(details.data).messages[1].content),graph=input.evidence_context.relationships;
  const board=graph.supportRankings[0],person=board.rows.find(row=>row.name==='青哥');
  assert.equal(person.rank,2);assert.equal(person.knownDiamonds,3000);
  details.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:JSON.stringify({intent:'chat',query:'',reply:'从送礼记录看，青哥是小露的支持者，已观测3000钻，暂列第2。'})}}]})});
 }});
 const run=withRelationshipEvidence({reply,persist:async()=>order.push('persist'),query:async q=>{order.push('graph');return f.query(q);}});
 const output=await run({task:{kind:'ai'},target:{type:'chat',text:'青哥是谁'},maxLength:80},config);
 assert.match(output,/支持者.*3000钻.*第2/);assert.deepEqual(order,['persist','graph','model','graph']);
});

test('云端与端侧实际请求保留关系依据、排名及运营补充；人物补充接受大哥关系',()=>{
 const f=fixture();f.input.memory={enabled:true,entries:[{id:'note',title:'运营补充',content:'人物：华哥；送礼习惯：节日来支持。华哥是Lucy小露的大哥之一。',source:'运营补充',enabled:true,updatedAt:at,expiresOn:''}]};
 const graph=f.query('华哥和小露是什么关系'),config=mergeConfig().ai,prompt={target:{text:'华哥和小露是什么关系'},task:{kind:'ai'},getRelationshipContext:()=>graph,maxLength:50};
 const cloud=JSON.parse(makeAIRequest(prompt,config).messages[1].content).evidence_context.relationships;
 const local=JSON.parse(makeEdgeMessages(prompt,config)[1].content).relationships;
 for(const data of [cloud,local]){
  assert.ok(data.supportRankings?.length);assert.ok(data.relations.some(r=>r.predicate==='大哥'));
  assert.ok(data.entities.some(n=>n.name==='华哥' && n.dossier?.facets.some(f=>f.text==='节日来支持')));
 }
 assert.equal(profileOutputSchema.safeParse({facts:[],relationships:[{name:'小露',predicate:'大哥',negative:false,evidence:[{turn:1,quote:'华哥是小露的大哥'}]}],analysis:[],knowledge:[],reply:'已整理'}).success,true);
});
