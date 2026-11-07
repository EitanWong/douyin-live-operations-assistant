import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeCorpus} from '../../src/ai/knowledge-corpus.js';
import {sourcePassages} from '../../src/ai/source-evidence.js';
import {createKnowledgeMemory,retrieveSourceRecords} from '../../src/services/automatic-knowledge.js';
import {createWebKnowledge} from '../../src/services/web-knowledge.js';
import {createAIClient} from '../../src/services/ai.js';
import {mergeConfig} from '../../src/core/engine.js';
import {makeEdgeMessages,fitEdgeMessages} from '../../src/ai/edge-prompt.js';

const question='整个夏天和贝雷帽',url='https://example.org/video';
async function fixture(){
 const now=Date.now(),values={};
 const options={read:async k=>values[k],write:async(k,v)=>{values[k]=structuredClone(v);}};
 const corpus=createKnowledgeCorpus(options);
 const sources=[
  {url,title:'音轨',content:'整个夏天的歌词由未知说话人唱出。',at:now-2000,expiresAt:now+60000,coverage:'完整音轨0–4000ms；机器转录待核实，说话人未知'},
  {url,title:'画面',content:'贝雷帽出现在单张关键帧，无法确认人物身份。',at:now-1000,expiresAt:now+120000,coverage:'单帧9400ms；非连续视频；不证明心理、身份或帧外事件'}
 ].map(r=>({...r,evidenceKind:'public-media'}));
 await corpus.remember('1','10',sources,{subject:'uid:10'});
 let anchor='10',rows=await createKnowledgeCorpus(options).list('1','10');
 const cache=createWebKnowledge({indexedDB:null}),config=mergeConfig({ai:{enabled:true,search:{enabled:true,rememberKnowledge:true}}}).ai;
 const memory=createKnowledgeMemory({cache,anchor:()=>anchor,transport:async action=>action==='list' ? rows : 0});
 return {now,sources,corpus,options,config,memory,close:()=>cache.close(),rows:()=>rows,setRows:value=>{rows=value;},setAnchor:value=>{anchor=value;}};
}

test('同视频音画一次检索成为一个可复核候选，单次前台回答保留两段原文与独立限定',async()=>{
 const f=await fixture();let calls=0,observed;
 try{
  const before=await f.corpus.list('1','10');
  const reply=createAIClient({knowledge:f.memory,search:()=>assert.fail('原文有效，无需重复联网'),onSearch:r=>{observed=r;},generate:async p=>{
   calls++;assert.equal(p.knowledgeCandidates.length,1);
   const candidate=p.knowledgeCandidates[0],source=candidate.results[0];
   assert.match(source.content,/整个夏天/);assert.match(source.content,/贝雷帽/);
   assert.equal(candidate.query.length<=300,true);
   assert.deepEqual(new Set(sourcePassages(source).map(r=>r.coverage)),new Set(f.sources.map(r=>r.coverage)));
   return JSON.stringify({intent:'knowledge',query:candidate.id,reply:'音轨有“整个夏天”，单帧见贝雷帽；说话人与身份未确认。',sources:[1]});
  }});
  assert.equal(await reply({task:{kind:'ai'},target:{text:question,memory:{key:'uid:3'}},maxLength:100},f.config),'音轨有“整个夏天”，单帧见贝雷帽；说话人与身份未确认。');
  assert.equal(calls,1);assert.deepEqual(observed.citationIndices,[1]);assert.equal(observed.results.length,1);
  const source=observed.results[0],passages=sourcePassages(source);
  assert.equal(source.subject,'uid:10');assert.equal(source.sourceId,undefined,'不同原文不能共用一个sourceId');
  assert.equal(source.coverage,undefined,'不同限定不能压成一个标量');
  assert.equal(source.at,Math.min(...before.map(r=>r.at)));assert.equal(source.expiresAt,Math.min(...before.map(r=>r.expiresAt)));
  for(const p of passages){const original=before.find(r=>r.id===p.sourceId);assert.ok(original);assert.equal(source.content.slice(p.start,p.end),original.text);assert.equal(p.coverage,original.coverage);}
  await f.corpus.remember('1','10',observed.results,{subject:'uid:3'});
  assert.deepEqual(await createKnowledgeCorpus(f.options).list('1','10'),before,'复用不能改属观众、延寿或复制知识');
 }finally{f.close();}
});

test('复合候选任何一段被删除、到期或移出主体范围，整体复核拒绝旧回答',async()=>{
 const f=await fixture();
 try{
  const original=f.rows(),candidate=(await f.memory.candidates(question,f.config.search,{subject:'uid:3'}))[0];
  assert.match(candidate.results[0].content,/贝雷帽/);
  for(const changed of [original.slice(1),original.map((r,i)=>i ? {...r,expiresAt:Date.now()-1} : r),original.map((r,i)=>i ? {...r,subject:'uid:99'} : r)]){
   f.setRows(changed);assert.equal(await f.memory.find(candidate.query,f.config.search,{question,subject:'uid:3'}),null);
  }
  f.setRows(original);f.setAnchor('11');assert.equal(await f.memory.find(candidate.query,f.config.search,{question,subject:'uid:3'}),null);
  f.setAnchor('10');assert.equal(await f.memory.find(candidate.query,{...f.config.search,rememberKnowledge:false},{question}),null);
  assert.equal((await f.memory.find(candidate.query,f.config.search,{question,subject:'uid:3'})).id,candidate.id);
 }finally{f.close();}
});

test('复合引用拒绝跨网址拼接、重复/重叠范围、越界和尾随数据；旧单片段引用仍可读',async()=>{
 const f=await fixture();
 try{
  const [a,b]=f.rows(),ref=r=>`${r.id}:0-${r.text.length}`,lookup=q=>f.memory.find(q,f.config.search,{question});
  const single=`corpus:${ref(a)}`;assert.equal((await lookup(single)).id,single);
  for(const suffix of [`,${ref(a)}`,`,${a.id}:1-3`,`,${b.id}:0-99999`,`,${ref(b)}:extra`,',',`,${ref(b)},${ref(a)},${ref(b)}`])assert.equal(await lookup(single+suffix),null);
  f.setRows([a,{...b,source:'https://example.org/other'}]);assert.equal(await lookup(`${single},${ref(b)}`),null);
 }finally{f.close();}
});

test('复合检索每网址至多三片段，总数与字符有界，其他网址仍能进入候选',()=>{
 const now=Date.now(),rows=Array.from({length:12},(_,i)=>({id:i.toString(16).padStart(64,'0'),title:'茶具',source:`https://example.org/${Math.floor(i/4)}`,text:`茶具第${i}段原文。`+'甲'.repeat(650),at:now-i,expiresAt:now+60000}));
 const found=retrieveSourceRecords(rows,'茶具',now);assert.equal(found.length,3);
 let count=0,chars=0;
 for(const record of found){assert.equal(record.query.length<=300,true);assert.equal(record.results.length,1);const source=record.results[0],parts=sourcePassages(source);assert.ok(parts.length<=3);assert.ok(source.content.length<=1802);count+=parts.length;chars+=parts.reduce((n,r)=>n+r.end-r.start,0);}
 assert.ok(count<=8);assert.ok(chars<=6000);
});

test('端侧压缩完整保留所选复合原文和偏移，预算不足时整项省略',async()=>{
 const f=await fixture();
 try{
  f.setRows(f.rows().map(r=>({...r,text:JSON.stringify({mediaHash:'原媒体标识'.repeat(50),text:r.text})})));
  const candidates=await f.memory.candidates(question,f.config.search),candidate=candidates[0];
  const messages=makeEdgeMessages({task:{kind:'ai'},target:{text:question},maxLength:50,intentRouting:true,knowledgeCandidates:candidates},f.config);
  const delivered=JSON.parse(messages[1].content).knowledge_candidates[0].results[0];
  assert.equal(delivered.content,candidate.results[0].content);assert.match(delivered.content,/整个夏天/);assert.match(delivered.content,/贝雷帽/);
  assert.deepEqual(sourcePassages(delivered),sourcePassages(candidate.results[0]));
  const fitted=await fitEdgeMessages(messages,async m=>JSON.stringify(m).length,Math.floor(JSON.stringify(messages).length*.9));
  assert.deepEqual(JSON.parse(fitted[1].content).knowledge_candidates || [],[]);
 }finally{f.close();}
});
