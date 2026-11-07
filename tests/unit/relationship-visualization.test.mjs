import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRelationshipRetriever} from '../../src/ai/relationship-memory.js';
import {networkElements,projectNetwork} from '../../src/ui/relationship-network.js';
const input={anchor:'1',anchorName:'阿明',now:1800000000000,memory:{enabled:true,entries:[{id:'a',content:'阿明和小雨是朋友。小雨是小李的师傅。',enabled:true,updatedAt:1800000000000}]}};
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
