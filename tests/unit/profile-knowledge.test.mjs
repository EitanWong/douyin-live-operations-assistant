import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeCorpus} from '../../src/ai/knowledge-corpus.js';
import {createAutomaticKnowledge,createKnowledgeMemory,retrieveSourceRecords} from '../../src/services/automatic-knowledge.js';
import {createWebKnowledge} from '../../src/services/web-knowledge.js';
const now=1800000000000;
test('人物研究来源按房间、主播、稳定身份隔离，遗忘后旧资料和迟到写入不复活',async()=>{
 const values={},corpus=createKnowledgeCorpus({read:async k=>values[k],write:async(k,v)=>values[k]=v,now:()=>now});
 let audience={viewers:[{key:'uid:2',lastAt:now}],forgotten:[]};
 const knowledge=createAutomaticKnowledge({corpus,readConfig:async()=>({anchorId:'10',ai:{enabled:true}}),readAudience:async()=>audience,now:()=>now});
 const sources=[{url:'https://example.org/tea',text:'茶杯限用冷水清洗。'}];
 await knowledge.handle('1','remember',{anchor:'10',subject:'uid:2',subjectEpoch:0,sources});
 let rows=await knowledge.handle('1','list',{anchor:'10'});
 assert.equal(rows[0].subject,'uid:2');
 assert.equal(retrieveSourceRecords(rows,'茶杯',now).length,0);
 assert.equal(retrieveSourceRecords(rows,'茶杯',now,{subject:'uid:3'}).length,0);
 assert.equal(retrieveSourceRecords(rows,'茶杯',now,{subject:'uid:2'}).length,1);
 await corpus.remember('1','10',sources);assert.equal((await corpus.list('1','10')).length,2,'同文通用来源与个人来源不得覆盖');
 audience={viewers:[],forgotten:[{key:'uid:2',at:now+1}]};
 assert.equal((await knowledge.handle('1','list',{anchor:'10'})).filter(r=>r.subject).length,0);
 await assert.rejects(knowledge.handle('1','remember',{anchor:'10',subject:'uid:2',subjectEpoch:0,sources}),/观众|人物|画像/);
 audience.viewers.push({key:'uid:2',lastAt:now+2});
 assert.equal((await knowledge.handle('1','list',{anchor:'10'})).filter(r=>r.subject).length,0);
 await assert.rejects(knowledge.handle('1','remember',{anchor:'10',subject:'uid:2',subjectEpoch:0,sources}),/观众|人物|画像/);
});
test('前台按当前观众复用个人原文；同源重复片段不会挤掉独立或冲突来源',async()=>{
 const at=Date.now(),row=(id,source,text,subject)=>({id:id.repeat(64),source,title:'陶瓷茶杯',text,at,expiresAt:at+86400000,...(subject ? {subject,subjectEpoch:0} : {})});
 const rows=[row('a','https://a.example/report','陶瓷茶杯只能冷水洗。'.repeat(120),'uid:2'),row('b','https://b.example/report','陶瓷茶杯耐高温，允许热水洗。'),row('c','https://c.example/report','陶瓷茶杯釉料脱落必须停用。')];
 const memory=createKnowledgeMemory({cache:createWebKnowledge({indexedDB:null}),anchor:()=> '10',transport:async action=>action==='list' ? rows : 0});
 const config={rememberKnowledge:true,provider:'tavily',endpoint:'https://search.test/search',maxResults:3};
 assert.equal((await memory.candidates('陶瓷茶杯',config)).some(r=>r.results.some(s=>s.sourceId==='a'.repeat(64))),false);
 const candidates=await memory.candidates('陶瓷茶杯',config,{subject:'uid:2'});
 assert.equal(new Set(candidates.flatMap(r=>r.results.map(s=>s.url))).size,3);
 const own=candidates.find(r=>r.results.some(s=>s.sourceId==='a'.repeat(64)));
 assert.ok(own);assert.equal(await memory.find(own.query,config,{question:'陶瓷茶杯',subject:'uid:3'}),null);
 assert.ok(await memory.find(own.query,config,{question:'陶瓷茶杯',subject:'uid:2'}));
});
test('主播无需虚构弹幕行即可保存个人原文，遗忘隐藏旧资料并拒绝迟到写入',async()=>{
 const values={},corpus=createKnowledgeCorpus({read:async k=>values[k],write:async(k,v)=>values[k]=v,now:()=>now});
 const audience={anchor:'10',viewers:[],forgotten:[]};let profile={room:'1',anchorId:'10',secUid:'anchor-sec',updatedAt:now};
 const knowledge=createAutomaticKnowledge({corpus,readConfig:async()=>({anchorId:'10',ai:{enabled:true}}),readAudience:async()=>audience,readProfile:async()=>profile,now:()=>now});
 const input={anchor:'10',subject:'uid:10',subjectEpoch:0,sources:[{url:'https://www.douyin.com/video/70',text:'主播的茶杯分享。'}]};
 await knowledge.handle('1','remember',input);assert.equal((await knowledge.handle('1','list',{anchor:'10'})).length,1);
 audience.forgotten=[{key:'uid:10',at:now+1}];assert.deepEqual(await knowledge.handle('1','list',{anchor:'10'}),[]);
 await assert.rejects(knowledge.handle('1','remember',input),/人物|画像/);
 profile={...profile,updatedAt:now+2};assert.deepEqual(await knowledge.handle('1','list',{anchor:'10'}),[]);
 await knowledge.handle('1','remember',{...input,subjectEpoch:now+1});assert.equal((await knowledge.handle('1','list',{anchor:'10'})).length,1);
 profile={...profile,anchorId:'20'};assert.deepEqual(await knowledge.handle('1','list',{anchor:'10'}),[]);
});
test('回答观众关于本房主播的问题可检索主播原文，同时保持其他观众资料隔离',async()=>{
 const at=Date.now(),row=(id,subject)=>({id:id.repeat(64),source:`https://${id}.example/tea`,title:'陶瓷茶杯',text:'陶瓷茶杯清洗分享。',at,expiresAt:at+86400000,subject,subjectEpoch:0});
 const cache=createWebKnowledge({indexedDB:null}),memory=createKnowledgeMemory({cache,anchor:()=> '10',transport:async()=>[row('a','uid:10'),row('b','uid:2')]});
 const config={rememberKnowledge:true,provider:'tavily',endpoint:'https://search.test/search',maxResults:3};
 try{
  const found=await memory.candidates('主播陶瓷茶杯',config,{subject:'uid:3'});
  assert.equal(found.length,1);assert.equal(found[0].results[0].subject,'uid:10');
  assert.ok(await memory.find(found[0].query,config,{question:'主播陶瓷茶杯',subject:'uid:3'}));
 }finally{cache.close();}
});
test('存档个人来源缺少遗忘版本时不能因人物不存在而误变为可见',async()=>{
 const values={},corpus=createKnowledgeCorpus({read:async key=>values[key],write:async(key,value)=>values[key]=value,now:()=>now});
 await corpus.remember('1','10',[{url:'https://example.org/tea',text:'陶瓷茶杯冷水洗。'}],{subject:'uid:2'});
 delete values['live-assistant:knowledge:1:10'].rows[0].subjectEpoch;
 const service=createAutomaticKnowledge({corpus,readConfig:async()=>({anchorId:'10',ai:{enabled:true}})});
 assert.deepEqual(await service.handle('1','list',{anchor:'10'}),[]);
});
