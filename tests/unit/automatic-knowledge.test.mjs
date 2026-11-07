import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeCorpus} from '../../src/ai/knowledge-corpus.js';
import {createAutomaticKnowledge,createKnowledgeMemory} from '../../src/services/automatic-knowledge.js';
import {createRelationshipLibrary} from '../../src/ai/relationship-library.js';
const now=1800000000000;
test('全局原文跨直播间检索，保留来源范围；跨房删除与清空阻止旧请求复活',async()=>{
 const values={
  'live-assistant:config:1':{anchorId:'2',ai:{enabled:true,search:{rememberKnowledge:true}}},
  'live-assistant:config:3':{anchorId:'4',ai:{enabled:true,search:{rememberKnowledge:true}}}
 };
 const corpus=createKnowledgeCorpus({read:async k=>values[k],write:async(k,v)=>values[k]=v,now:()=>now});
 const service=createAutomaticKnowledge({corpus,all:async()=>structuredClone(values),readConfig:async room=>values[`live-assistant:config:${room}`],now:()=>now});
 await service.handle('1','remember',{anchor:'2',sources:[{url:'https://example.org/a',content:'陶瓷清洗使用温水'}]});
 const rows=await service.handle('3','list',{anchor:'4'});assert.equal(rows.length,1);assert.deepEqual(rows[0].scope,{room:'1',anchor:'2'});
 const version=await service.handle('1','version',{anchor:'2'});
 await service.handle('3','remove',{anchor:'4',id:rows[0].id});assert.equal((await service.handle('1','list',{anchor:'2'})).length,0);
 assert.equal(await service.handle('1','remember',{anchor:'2',version,sources:[{url:'https://example.org/a',content:'陶瓷清洗使用温水'}]}),false);
 await service.handle('1','remember',{anchor:'2',sources:[{url:'https://example.org/b',content:'新原文'}]});
 await service.handle('3','clear',{anchor:'4'});assert.equal((await service.handle('1','list',{anchor:'2'})).length,0);
});
test('真实搜索原文自动入持久库，重启后可检索和构图；过期、删除、停用不复活',async()=>{
 const values={'live-assistant:config:1':{anchorId:'2',ai:{enabled:true,search:{rememberKnowledge:true},assistant:{memoryEnabled:true}}}};
 const corpus=createKnowledgeCorpus({read:async k=>values[k],write:async(k,v)=>values[k]=v,now:()=>now});
 const service=createAutomaticKnowledge({corpus,readConfig:async room=>values[`live-assistant:config:${room}`],now:()=>now});
 const transport=(action,payload)=>service.handle('1',action,{anchor:'2',...payload});
 const cache={persistent:true,revision:async()=>0,list:async()=>[],remember:async()=>{},clear:async()=>{},remove:async()=>{}};
 const memory=createKnowledgeMemory({cache,transport,anchor:()=> '2'}),revision=await memory.revision();
 await memory.remember({query:'阿明',results:[{url:'https://example.org/a',title:'公开资料',content:'阿明是小雨的师傅。阿明喜欢陶瓷。'}]},{rememberKnowledge:true},{revision,freshness:'stable'});
 assert.equal((await memory.list()).length,1);
 const library=createRelationshipLibrary({all:async()=>structuredClone(values),now:()=>now});
 const graph=await library.query('1','阿明');assert.equal(graph.relations[0]?.predicate,'师傅');assert.equal(graph.relations[0].status,'unverified');assert.match(graph.sources.chunks[0].content,/陶瓷/);
 await memory.clear();await memory.remember({results:[{url:'https://example.org/a',content:'阿明是小雨的师傅'}]},{rememberKnowledge:true},{revision});
 assert.equal((await memory.list()).length,0);assert.equal((await library.query('1','阿明')).relations.length,0);
 await transport('remember',{sources:[{url:'https://example.org/b',text:'青哥是阿明的朋友'}],lifetime:60000});
 values['live-assistant:config:1'].ai.search.rememberKnowledge=false;
 assert.equal((await library.query('1','青哥')).relations.length,0);
 await assert.rejects(transport('remember',{sources:[{url:'https://example.org/b',text:'错误'}]}),/关闭/);
 await assert.rejects(service.handle('1','list',{anchor:'3'}),/主播/);
});

test('删除自动来源也清除短期缓存，其他页面清空后旧缓存不再用于回答',async()=>{
 const rows=[{id:'a'.repeat(64),source:'https://example.org/a',title:'资料',text:'原文',at:now,expiresAt:now+60000}];
 let cached=[{id:'cache',query:'问题',results:[{url:rows[0].source,content:'原文'}]}],remembered=rows;
 const cache={revision:async()=>0,remember:async()=>{},list:async()=>cached,find:async()=>cached[0],candidates:async()=>cached,remove:async id=>{cached=cached.filter(r=>r.id!==id);},clear:async()=>{cached=[];}};
 const memory=createKnowledgeMemory({cache,anchor:()=> '2',transport:async(action)=>{if(action==='list')return remembered;if(action==='remove')remembered=[];}});
 await memory.remove('corpus:'+rows[0].id);assert.deepEqual(await memory.list(),[]);
 cached=[{id:'cache',results:[{url:rows[0].source,content:'原文'}]}];
 assert.equal(await memory.find('问题',{}),null);assert.deepEqual(await memory.candidates('问题',{}),[]);
});
