import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRelationshipRetriever} from '../../src/ai/relationship-memory.js';
import {relationshipChartOption} from '../../src/ui/relationship-graph.js';
const input={anchor:'1',anchorName:'阿明',now:1800000000000,memory:{enabled:true,entries:[{id:'a',content:'阿明和小雨是朋友。小雨是小李的师傅。',enabled:true,updatedAt:1800000000000}]}};
test('无需手工输入即可浏览有界全图，统计总量且筛选不留下断边',()=>{
 const retrieve=createRelationshipRetriever(),graph=retrieve(input,'',{browse:true});
 assert.equal(graph.relations.length,2);assert.equal(graph.stats.relations,2);
 const filtered=retrieve(input,'',{browse:true,status:'observed'});assert.equal(filtered.relations.length,0);
 const option=relationshipChartOption(graph);assert.equal(option.series[0].type,'graph');assert.equal(option.series[0].roam,true);
 assert.equal(option.series[0].links.length,2);assert.ok(option.series[0].links.every(e=>option.series[0].data.some(n=>n.id===e.source) && option.series[0].data.some(n=>n.id===e.target)));
 assert.match(option.series[0].links[0].label.formatter,/朋友|师傅/);
});
test('图谱保留冲突和证据等级，未核实连线不表现为确认事实',()=>{
 const retrieve=createRelationshipRetriever(),graph=retrieve({...input,memory:{enabled:false,entries:[]},knowledge:'阿明和小雨是朋友。阿明和小雨不是朋友。'},'',{browse:true});
 const option=relationshipChartOption(graph);assert.ok(option.series[0].links.every(e=>e.lineStyle.type==='dashed'));
 assert.equal(graph.relations.length,2);assert.ok(graph.relations.every(e=>e.status==='conflicted'));
});
