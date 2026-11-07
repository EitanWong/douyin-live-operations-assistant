import {test} from 'node:test';
import assert from 'node:assert/strict';
import {networkInsights} from '../../src/ui/network-insights.js';
test('概览按来源去重，邻居按人物统计，未知画像维度不生成虚假分数',()=>{
 const e={text:'原话',at:1,source:'直播弹幕',scope:{room:'1',anchor:'10'}},graph={entities:[{id:'a',name:'甲',role:'主播',dossier:{coverage:{dimensions:['interests'],records:3},facets:[{category:'interests',text:'陶艺'}],events:[e],leads:[]}},{id:'b',name:'乙',role:'观众'}],relations:[{id:'r1',from:'a',to:'b',status:'verified',evidence:[e]},{id:'r2',from:'b',to:'a',status:'conflicted',evidence:[e]}]};
 const all=networkInsights(graph),person=networkInsights(graph,'a');
 assert.equal(all.sources,1);assert.equal(all.evidence,1);assert.equal(all.statuses.conflicted,1);assert.equal(person.neighbors,1);assert.deepEqual(person.dimensions,['interests']);assert.equal(person.records,3);assert.equal(networkInsights(graph,'b').dimensions.length,0);
});
