import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSupplementEntries} from '../../src/ai/knowledge-supplement.js';
import {createSharedKnowledge} from '../../src/services/shared-knowledge.js';
import {createRelationshipRetriever} from '../../src/ai/relationship-memory.js';
import {retrieveMemories} from '../../src/services/knowledge.js';
import {mergeConfig} from '../../src/core/engine.js';
const text='小雨住杭州，是阿明的助理。茶具用温水清洗。';
const updates=[{title:'小雨',content:'人物：小雨。当前居住地：杭州。小雨是阿明的助理。',evidence:[{source:0,quote:'小雨住杭州，是阿明的助理。'}]},{title:'茶具清洗',content:'茶具用温水清洗。',evidence:[{source:0,quote:'茶具用温水清洗。'}]}];
const build=extra=>buildSupplementEntries({text,updates,sources:[],existing:[],taskId:'test-task',at:Date.now(),...extra});
test('一段文字生成多条待核实知识，人物与关系进入图谱，普通知识可检索，原话保留',()=>{
 const entries=build(),memory={enabled:true,entries};assert.equal(entries.length,2);assert.ok(entries.every(r=>r.trust==='unverified'));assert.equal(entries[0].supplement.text,text);
 assert.ok(retrieveMemories(memory,'茶具怎么清洗').chunks.some(c=>c.content.includes('温水')));
 const graph=createRelationshipRetriever()({anchor:'10',memory,now:Date.now()},'小雨阿明');
 assert.ok(graph.entities.some(n=>n.name==='小雨' && n.dossier.facets.some(f=>f.text==='杭州')));assert.equal(graph.relations.find(r=>r.predicate==='助理').status,'unverified');
});
test('更正使用已有ID更新而非同名合并，保留以前原话；杜撰引用、未知ID和过期来源不能写入',()=>{
 const entries=build();const next=build({text:'小雨现住横店。',existing:entries,updates:[{...updates[0],id:entries[0].id,content:'人物：小雨。当前居住地：横店。',evidence:[{source:0,quote:'小雨现住横店。'}]}]});
 assert.equal(next[0].id,entries[0].id);assert.equal(next[0].supplement.history[0].text,text);
 assert.throws(()=>build({updates:[{...updates[0],id:'unknown'}]}),/条目/);assert.throws(()=>build({updates:[{...updates[0],evidence:[{source:0,quote:'杜撰原话'}]}]}),/原话/);
 assert.throws(()=>build({updates:[{...updates[0],evidence:[{source:1,quote:'内容'}]}],sources:[{index:1,url:'https://example.org',content:'内容',expiresAt:1}]}),/过期/);
});
test('共享知识单写者合并Agent更新，保留并发无关修改，拒绝覆盖同条更正与删除，重放幂等',async()=>{
 const config=mergeConfig({anchorId:'10'}),values={'live-assistant:config:1':config};
 const shared=createSharedKnowledge({read:async k=>values[k],all:async()=>values,commit:async rows=>{for(const [k,v] of rows)values[k]=structuredClone(v);}});
 const base=await shared.config('1'),entries=build();await shared.supplement('1',entries,base.ai.memory.entries);await shared.supplement('1',entries,[]);
 let current=await shared.config('1');assert.equal(current.ai.memory.entries.length,2);
 const before=structuredClone(current),unrelated=build({text:'另一条知识',taskId:'other',updates:[{title:'其他',content:'另一条知识',evidence:[{source:0,quote:'另一条知识'}]}]});await shared.supplement('1',unrelated,current.ai.memory.entries);
 const changed=build({text:'小雨现住横店。',existing:before.ai.memory.entries,updates:[{...updates[0],id:entries[0].id,content:'人物：小雨。当前居住地：横店。',evidence:[{source:0,quote:'小雨现住横店。'}]}]});
 await shared.supplement('1',changed,before.ai.memory.entries);current=await shared.config('1');assert.equal(current.ai.memory.entries.length,3);
 await assert.rejects(shared.supplement('1',entries,before.ai.memory.entries),/其他窗口/);
 const deleted=structuredClone(current);deleted.ai.memory.entries=deleted.ai.memory.entries.filter(e=>e.id!==entries[0].id);await shared.save('1',deleted,current);
 await assert.rejects(shared.supplement('1',changed,current.ai.memory.entries),/其他窗口/);
});
