import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createResearchAgent} from '../../src/ai/agent.js';
import {createResearchGraph} from '../../src/ai/research-graph.js';
import {mergeConfig} from '../../src/core/engine.js';

test('长原文渐进披露只发送相关片段，保留末尾条件和出处，不增加压缩模型调用',async()=>{
 const content='无关开场和产品包装介绍。'.repeat(350)+'\n岚叶实验测量值为42，仅在20℃下成立；室温结果尚未测量。';
 const bodies=[],ai=mergeConfig({ai:{endpoint:'https://model.test/chat/completions',model:'test'}}).ai;
 const run=createResearchAgent({getKey:()=>'',readPublicPage:async url=>({url,title:'岚叶实验报告',text:content,readAt:Date.now()}),request:d=>{
  bodies.push(JSON.parse(d.data));d.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:JSON.stringify({action:'finish',answer:'20℃下为42，室温结果尚未测量。',citations:[1]})}}]})});
 }});
 const result=await run({id:'progressive-long',scope:'1:10',question:'岚叶实验测量值和适用温度是什么？',input:{anchor:'10',ai,context:{},sources:['https://example.org/experiment']}},{signal:new AbortController().signal,checkpoint:async()=>{}});
 assert.equal(bodies.length,1);assert.ok(JSON.stringify(bodies[0].messages).length<=16000);
 const input=JSON.parse(bodies[0].messages[1].content),working=input.target.agent_state;
 assert.equal(input.target.public_sources,undefined);assert.equal(working.catalog.length,1);
 const passage=working.evidence.find(r=>r.content.includes('42'));assert.ok(passage);assert.equal(content.slice(passage.start,passage.end),passage.content);
 assert.match(passage.content,/仅在20℃.*尚未测量/);assert.match(result.sources[0].content,/尚未测量/);
 assert.equal(JSON.stringify(working).split('室温结果尚未测量').length-1,1,'同一原文不重复发送');
});

test('Agent可按来源编号展开未选中的原文窗口，不再联网，不改变原始事实',async()=>{
 let calls=0,reads=0;
 const text='不相关的铺垫。'.repeat(400)+'只限冷水，不可加热。';
 const graph=createResearchGraph({question:'茶具材质',initialSources:['https://example.org/a'],read:async url=>{reads++;return {url,title:'茶具说明',text};},plan:async state=>{
  calls++;if(calls===1)return JSON.stringify({action:'inspect',source:1,offset:text.length-15});
  assert.ok(state.workingContext.evidence.some(r=>r.content.includes('不可加热')));
  return JSON.stringify({action:'finish',answer:'只限冷水，不可加热。',citations:[1]});
 }});
 const result=await graph.run({id:'progressive-inspect'});assert.equal(reads,1);assert.equal(calls,2);assert.equal(result.sources[0].content,text);assert.match(result.answer,/不可加热/);
});

test('每轮压缩旧轨迹为执行摘要，完整证据保留且重复压缩幂等',async()=>{
 const {compactResearchState}=await import('../../src/ai/research-context.js');
 const source={index:1,url:'https://example.org/tea',title:'陶瓷茶具',content:'陶瓷茶具只限冷水，不可加热。',at:Date.now()};
 const state={modelCalls:2,sources:[source],observations:[],executed:[],focus:null};
 for(let i=0;i<60;i++){
  state.observations.push({action:'search',query:`线索${i}`,output:{error:'暂未找到'.repeat(300)}});
  const view=compactResearchState(state,'陶瓷茶具如何清洗');assert.ok(JSON.stringify(view).length<=6500);
  assert.equal(view.progress.completedTools,i+1);assert.match(view.evidence[0].content,/只限冷水，不可加热/);
 }
 const original=JSON.stringify(state);assert.deepEqual(compactResearchState(state,'陶瓷茶具如何清洗'),compactResearchState(state,'陶瓷茶具如何清洗'));assert.equal(JSON.stringify(state),original);
});

test('异常长标题与转义字符也受工作集硬预算约束，仍可按编号找回证据',async()=>{
 const {compactResearchState}=await import('../../src/ai/research-context.js');
 const state={sources:Array.from({length:8},(_,i)=>({index:i+1,url:`https://example.org/${i}`,title:'\u0000'.repeat(160),content:'陶瓷茶具不可加热。',at:Date.now()})),observations:[],focus:{source:8,offset:0}};
 const view=compactResearchState(state,'陶瓷茶具');assert.ok(JSON.stringify(view).length<=6500);assert.equal(view.catalog.length,8);assert.ok(view.evidence.some(r=>r.index===8 && r.content.includes('不可加热')));
});

test('完整来源的长覆盖声明和异常发布日期不会挤掉原文或突破工作集预算',async()=>{
 const {compactResearchState}=await import('../../src/ai/research-context.js');
 const state={sources:Array.from({length:10},(_,i)=>({index:i+1,url:`https://example.org/${i}`,title:'\u0000'.repeat(160),content:'陶瓷茶具不可加热。',at:Date.now(),evidenceKind:'public-page',publishedAt:'\u0000'.repeat(80),coverage:'\u0000'.repeat(500)})),observations:[]};
 const view=compactResearchState(state,'陶瓷茶具');assert.ok(JSON.stringify(view).length<=6500);
 assert.equal(view.catalog.length,10);assert.ok(view.evidence.some(r=>r.content.includes('不可加热')));
});

test('研究工作集将完整证据范围与原文一起披露，目录压缩不能丢掉单帧和未知说话人限制',async()=>{
 const {compactResearchState}=await import('../../src/ai/research-context.js');
 const coverage='单张关键帧，图片内三个拼接画格无独立时间戳；机器观察待核实；'+'采样限制。'.repeat(45)+'说话人未知，不证明身份、心理或连续动作。';
 const state={sources:Array.from({length:10},(_,i)=>({index:i+1,url:`https://example.org/${i}`,title:'\u0000'.repeat(160),content:'深色帽子；三帧画面内容一致，无变化。',at:1000,evidenceKind:'public-media',coverage})),observations:[],focus:{source:8,offset:0}};
 const before=structuredClone(state),view=compactResearchState(state,'帽子和动作变化');
 assert.ok(JSON.stringify(view).length<=6500);
 const evidence=view.evidence.find(row=>row.index===8);assert.ok(evidence);
 assert.equal(evidence.evidenceKind,'public-media');assert.equal(evidence.coverage,coverage);
 assert.equal(evidence.content,state.sources[7].content.slice(evidence.start,evidence.end));
 for(const row of view.evidence)assert.equal(row.coverage,coverage);
 assert.deepEqual(state,before);
 assert.deepEqual(compactResearchState(state,'帽子和动作变化'),view);
});

test('覆盖说明的转义字符过长时省略整条证据，不截掉范围说明后单独发送原文',async()=>{
 const {compactResearchState}=await import('../../src/ai/research-context.js');
 const coverage='\u0000'.repeat(490)+'说话人未知';
 const sources=Array.from({length:10},(_,i)=>({index:i+1,url:`https://example.org/${i}`,title:'帽子',content:'深色帽子可见。',at:1000,evidenceKind:'public-media',coverage}));
 const view=compactResearchState({sources,observations:[],focus:{source:10,offset:0}},'帽子');
 assert.ok(JSON.stringify(view).length<=6500);assert.equal(view.catalog.length,10);
 assert.ok(view.evidence.some(row=>row.index===10));assert.ok(view.evidence.length<3);
 for(const row of view.evidence){assert.equal(row.coverage,coverage);assert.equal(row.evidenceKind,'public-media');}
});
