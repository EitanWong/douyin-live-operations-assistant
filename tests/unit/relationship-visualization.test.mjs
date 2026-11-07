import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRelationshipRetriever} from '../../src/ai/relationship-memory.js';
import {networkElements,projectNetwork} from '../../src/ui/relationship-network.js';
const input={anchor:'1',anchorName:'阿明',now:1800000000000,memory:{enabled:true,entries:[{id:'a',content:'阿明和小雨是朋友。小雨是小李的师傅。',enabled:true,updatedAt:1800000000000}]}};
test('同一双向关系的语序、方向和重复来源只生成一条边，否定保留为冲突',()=>{
 const retrieve=createRelationshipRetriever(),memory={enabled:true,entries:[
  {id:'a',content:'阿明和小雨是朋友。阿明是小雨的朋友。小雨是阿明的朋友。',enabled:true,updatedAt:input.now},
  {id:'b',content:'小雨和阿明是朋友。',enabled:true,updatedAt:input.now}
 ]};
 const graph=retrieve({...input,memory},'',{browse:true});
 assert.equal(graph.entities.filter(n=>n.name==='阿明').length,1);
 assert.equal(graph.relations.length,1);
 assert.equal(graph.relations[0].evidence.length,2,'独立来源仍保留');
 memory.entries.push({id:'deny',content:'小雨不是阿明的朋友。',enabled:true,updatedAt:input.now});
 const conflict=retrieve({...input,memory},'',{browse:true});
 assert.equal(conflict.relations.length,2);assert.ok(conflict.relations.every(r=>r.status==='conflicted'));
});
test('师徒等有向关系保留方向，两个同名账号保持独立',async()=>{
 const {AudienceMemory}=await import('../../src/ai/audience-memory.js');
 const audience=new AudienceMemory({anchor:'1',now:()=>input.now});
 for(const id of ['2','3'])audience.observe({id,type:'chat',source:'socket',receivedAt:input.now,user:{id,name:'小雨'},text:'我是阿明的徒弟。'});
 const graph=createRelationshipRetriever()({...input,audience,memory:{enabled:false,entries:[]}},'小雨',{browse:true});
 assert.equal(graph.entities.filter(n=>n.name==='小雨').length,2);assert.equal(graph.relations.length,2);
 assert.ok(graph.relations.every(r=>graph.entities.find(n=>n.id===r.from).name==='小雨'));
});
test('无需手工输入即可浏览有界全图，统计总量且筛选不留下断边',()=>{
 const retrieve=createRelationshipRetriever(),graph=retrieve(input,'',{browse:true});
 assert.equal(graph.relations.length,2);assert.equal(graph.stats.relations,2);
 const filtered=retrieve(input,'',{browse:true,status:'observed'});assert.equal(filtered.relations.length,0);
 const elements=networkElements(projectNetwork(graph,{})),edges=elements.filter(e=>e.data.kind==='relation');assert.equal(edges.length,2);assert.ok(edges.every(e=>elements.some(n=>n.data.id===e.data.source) && elements.some(n=>n.data.id===e.data.target)));assert.match(edges[0].data.label,/朋友|师傅/);
});
test('图谱保留冲突和证据等级，未核实连线不表现为确认事实',()=>{
 const retrieve=createRelationshipRetriever(),graph=retrieve({...input,memory:{enabled:false,entries:[]},knowledge:'阿明和小雨是朋友。阿明和小雨不是朋友。'},'',{browse:true});
 const elements=networkElements(projectNetwork(graph,{}));assert.ok(elements.filter(e=>e.data.kind==='relation').every(e=>e.data.status==='conflicted'));
 assert.equal(graph.relations.length,2);assert.ok(graph.relations.every(e=>e.status==='conflicted'));
});
