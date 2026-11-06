import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeMemory,retrieveSourceRecords} from '../../src/services/automatic-knowledge.js';
import {createWebKnowledge} from '../../src/services/web-knowledge.js';

test('后台原文库进入前台候选和复核，删除后旧候选不可再回答',async()=>{
 const now=Date.now();let rows=[{id:'a'.repeat(64),title:'赤鹤星报告',source:'https://example.org/star',text:'赤鹤星周期73天。',at:now,expiresAt:now+86400000}];
 const cache=createWebKnowledge({indexedDB:null});const memory=createKnowledgeMemory({cache,anchor:()=> '10',transport:async action=>action==='list' ? rows : 0});
 const config={provider:'tavily',endpoint:'https://search.test/search',maxResults:3,rememberKnowledge:true};
 const candidates=await memory.candidates('赤鹤星周期',config);assert.equal(candidates.length,1);assert.match(candidates[0].results[0].content,/73/);
 assert.equal((await memory.find(candidates[0].query,config,{question:'赤鹤星周期'})).id,candidates[0].id);
 rows=[];assert.equal(await memory.find(candidates[0].query,config),null);cache.close();
});
test('过期、实时问题、显式重新查证和停用记忆不会复用旧后台原文',async()=>{
 const now=Date.now(),row={id:'b'.repeat(64),title:'上海天气',source:'https://example.org/weather',text:'上海晴天30度',at:now-300000,expiresAt:now+86400000};
 const memory=createKnowledgeMemory({cache:createWebKnowledge({indexedDB:null}),anchor:()=> '10',transport:async()=>[row]});
 const config={provider:'tavily',endpoint:'https://search.test/search',maxResults:3};
 for(const q of ['上海现在天气','重新查上海天气'])assert.deepEqual(await memory.candidates(q,config),[]);
 assert.deepEqual(await memory.candidates('上海天气',{...config,rememberKnowledge:false}),[]);
});
test('相对日期在北京时间午夜失效，不能把昨晚的明天预报复用于新的明天',()=>{
 const at=Date.parse('2026-11-06T23:59:40+08:00'),row={id:'c'.repeat(64),title:'北京明天天气',source:'https://example.org/weather',text:'北京明天小雨',at,expiresAt:at+120000};
 assert.equal(retrieveSourceRecords([row],'北京明天天气',at+1000).length,1);
 assert.deepEqual(retrieveSourceRecords([row],'北京明天天气',at+21000),[]);
});
