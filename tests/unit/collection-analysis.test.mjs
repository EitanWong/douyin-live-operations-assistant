import {test} from 'node:test';
import assert from 'node:assert/strict';
const load=()=>import('../../src/ai/collection-analysis.js');
const at=1800000000000;
const memory={anchor:'10',audience:{viewers:[]},perception:{observations:[{kind:'audio',id:'a',text:'阿明是小雨的师傅。小雨说喜欢陶艺。',at,endedAt:at+1000}]}};
test('后台整理按持久原文推进，超过5分钟的未处理语音仍进入批次，已完成不重复',async()=>{
 const {nextCollectionBatch,parseCollectionAnalysis}=await load();const records=nextCollectionBatch(memory);
 assert.equal(records.length,1);assert.equal(records[0].text,memory.perception.observations[0].text);
 const row=parseCollectionAnalysis(JSON.stringify({people:[]}),records,{id:'task-a',now:at+600000});
 assert.equal(nextCollectionBatch({...memory,analyses:[row]}).length,0);
});
test('原话支持的关系和行为假设分开保存，未知语音说话人不绑定主播账号',async()=>{
 const {nextCollectionBatch,parseCollectionAnalysis}=await load(),records=nextCollectionBatch(memory);
 const person={name:'阿明',facts:[],relationships:[{name:'小雨',predicate:'师傅',negative:false,evidence:[{turn:1,quote:'阿明是小雨的师傅'}]}],analysis:[{text:'可能偏好教学式交流。',limitations:'仅凭一次原话，不能确定稳定行为模式。',evidence:[{turn:1,quote:'阿明是小雨的师傅'}]}],knowledge:[],reply:'待核实'};
 const row=parseCollectionAnalysis(JSON.stringify({people:[person]}),records,{id:'task-a',now:at});
 assert.equal(row.people[0].key,'');assert.equal(row.people[0].analysis.length,1);
 assert.throws(()=>parseCollectionAnalysis(JSON.stringify({people:[{...person,name:'张三'}]}),records,{id:'unmentioned',now:at}),/原文.*点名/);
 assert.throws(()=>parseCollectionAnalysis(JSON.stringify({people:[{...person,relationships:[{...person.relationships[0],evidence:[{turn:1,quote:'伪造的原话'}]}]}]}),records,{id:'bad',now:at}));
});
test('删除、遗忘或改动原话后衍生资料失效，不能通过合并恢复',async()=>{
 const {nextCollectionBatch,parseCollectionAnalysis,validCollectionAnalyses}=await load(),records=nextCollectionBatch(memory);
 const row=parseCollectionAnalysis('{"people":[]}',records,{id:'a',now:at});
 assert.equal(validCollectionAnalyses({...memory,analyses:[row]}).length,1);
 assert.equal(validCollectionAnalyses({...memory,analyses:[row],perception:{observations:[]}}).length,0);
});
