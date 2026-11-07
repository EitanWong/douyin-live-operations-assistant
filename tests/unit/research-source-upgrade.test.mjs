import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createResearchGraph} from '../../src/ai/research-graph.js';

test('读取原文原位升级摘要引用，保留发布日期、采集时间和覆盖范围',async()=>{
 const url='https://example.org/work',at=Date.now()-1000;let calls=0;
 const runtime=createResearchGraph({search:async()=>({results:[{url,title:'公开视频',content:'摘要说周期7天',publishedAt:'2026-10-01',at}]}),
  read:async()=>({url,title:'实际原文',text:'周期73天，仅限本次测量。',at:at+1,coverage:'仅页面文字，未分析视频音轨'}),plan:async state=>{
   if(++calls===1)return JSON.stringify({action:'search',query:'周期'});
   if(calls===2)return JSON.stringify({action:'read',source:1});
   assert.equal(state.sources.length,1);
   assert.equal(state.sources[0].index,1);assert.match(state.sources[0].content,/73天/);
   assert.equal(state.sources[0].publishedAt,'2026-10-01');
   assert.equal(state.sources[0].at,at+1);assert.equal(state.sources[0].evidenceKind,'public-page');
   assert.match(state.workingContext.catalog[0].coverage,/未分析视频/);
   return JSON.stringify({action:'finish',answer:'本次测量周期73天。',citations:[1]});
  }});
 const result=await runtime.run({id:'upgrade'});assert.deepEqual(result.citationIndices,[1]);
 assert.equal(result.sources.length,1);assert.match(result.sources[0].coverage,/仅页面文字/);
});

test('后续搜索不能用相同网址的摘要覆盖已读原文，也不制造第二份证据',async()=>{
 const url='https://example.org/work';let calls=0;
 const runtime=createResearchGraph({initialSources:[url],read:async()=>({url,title:'原文',text:'仅限冷水，不可加热。'}),
  search:async()=>({results:[{url,title:'摘要',content:'可以加热'}]}),plan:async state=>{
   if(++calls===1)return JSON.stringify({action:'search',query:'使用方式'});
   assert.equal(state.sources.length,1);assert.match(state.sources[0].content,/不可加热/);
   return JSON.stringify({action:'finish',answer:'不可加热。',citations:[1]});
  }});
 await runtime.run({id:'no-downgrade'});
});

test('同文摘要升级为原文仍更新证据种类，满额时引用编号不变',async()=>{
 const url='https://example.org/0';let calls=0;
 const runtime=createResearchGraph({search:async()=>({results:Array.from({length:8},(_,i)=>({url:`https://example.org/${i}`,title:'摘要',content:'同一段公开文字'}))}),
  read:async()=>({url,title:'正文',text:'同一段公开文字',coverage:'页面正文'}),plan:async state=>{
   if(++calls===1)return JSON.stringify({action:'search',query:'证据种类'});
   if(calls===2)return JSON.stringify({action:'read',source:1});
   assert.equal(state.sources.length,8);assert.equal(state.sources[0].evidenceKind,'public-page');
   return JSON.stringify({action:'finish',answer:'同一段公开文字',citations:[1]});
  }});
 await runtime.run({id:'same-body-upgrade'});
});

test('同网址的互补检索片段共享引用且不丢旧条件，不刷新旧片段的有效期',async()=>{
 const url='https://example.org/work';let calls=0,searches=0;const at=Date.now()-1000;
 const runtime=createResearchGraph({search:async()=>({results:[{url,title:'茶具',content:++searches===1 ? '陶瓷茶具只限冷水。' : '清洗时不能使用钢丝球。',at:at+searches,expiresAt:at+searches*10000}]}),plan:async state=>{
  if(++calls<3)return JSON.stringify({action:'search',query:calls===1 ? '茶具温度' : '茶具工具'});
  assert.equal(state.sources.length,1);assert.match(state.sources[0].content,/只限冷水/);assert.match(state.sources[0].content,/不能使用钢丝球/);
  assert.equal(state.sources[0].at,at+1);assert.equal(state.sources[0].expiresAt,at+10000);
  return JSON.stringify({action:'finish',answer:'限用冷水，不用钢丝球。',citations:[1]});
 }});
 await runtime.run({id:'complementary-excerpts'});
});

test('研究从原知识库读取机器音画结果时保留种类和待核实范围，联网摘要不能自称原文',async()=>{
 for(const action of ['knowledge','search']){
  const coverage='单张关键帧；拼图画格无独立时间；机器观察待核实，不证明连续动作或人物身份。';
  let calls=0;
  const rows=[{url:'https://example.org/work',title:'公开视频关键帧观察',content:'深色帽子，三帧画面内容一致，无变化。',evidenceKind:'public-media',coverage}];
  const runtime=createResearchGraph({knowledge:async()=>rows,search:async()=>({results:rows}),question:'帽子与动作是否改变',plan:async state=>{
   if(++calls===1)return JSON.stringify({action,query:'帽子与动作是否改变'});
   const expected=action==='knowledge' ? 'public-media' : 'search-snippet';
   assert.equal(state.sources[0].evidenceKind,expected);
   assert.equal(state.workingContext.evidence[0].evidenceKind,expected);
   assert.equal(state.workingContext.evidence[0].coverage,coverage);
   return JSON.stringify({action:'finish',answer:'机器描述提到深色帽子；单张拼图不能证明动作有无变化。',citations:[1]});
  }});
  const result=await runtime.run({id:`preserve-media-${action}`});
  assert.equal(calls,2);assert.deepEqual(result.citationIndices,[1]);
 }
});
