import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeCorpus} from '../../src/ai/knowledge-corpus.js';
import {validateAgentInput} from '../../src/ai/agent.js';
const now=1800000000000;
function fixture(){const values={};return {values,corpus:createKnowledgeCorpus({read:async k=>values[k],write:async(k,v)=>{values[k]=v;},now:()=>now})};}
test('公开原文自动去重沉淀，重复任务和重启不增加副本；模型回答不入库，删除后不复活',async()=>{
 const {values,corpus}=fixture(),sources=[{url:'https://example.org/profile',title:'公开资料',text:'阿明是小雨的师傅'}];
 await Promise.all([corpus.remember('1','2',sources),corpus.remember('1','2',sources)]);
 assert.equal((await corpus.list('1','2')).length,1);
 const again=createKnowledgeCorpus({read:async k=>values[k],write:async(k,v)=>values[k]=v,now:()=>now});assert.equal((await again.list('1','2'))[0].text,sources[0].text);
 await again.remember('1','2',[{answer:'他们是父子'}]);assert.equal((await again.list('1','2')).length,1);
 const version=await again.version('1','2');await again.clear('1','2');await again.remember('1','2',sources,{version});assert.equal((await again.list('1','2')).length,0);
 await assert.rejects(again.remember('1','2',[{url:'file:///etc/passwd',text:'不允许'}]));
});
test('后台研究保留关系上下文，重新验证输入不会丢掉图谱依据',()=>{
 const graph={entities:[],relations:[],ambiguities:[]};
 const input=validateAgentInput({anchor:'2',ai:{endpoint:'https://example.org/v1/chat/completions',model:'model'},context:{relationshipContext:graph}});
 assert.deepEqual(input.context.relationshipContext,graph);
});

test('独立服务暂时无法入队后重启重试同一快照，不丢同步也不改原文身份',async()=>{
 const values={};let fail=true;const delivered=[];
 const options={read:async k=>values[k],write:async(k,v)=>{values[k]=structuredClone(v);},now:()=>now,archive:async row=>{if(fail)throw Error('磁盘缓冲满');delivered.push(row);}};
 let corpus=createKnowledgeCorpus(options);await assert.rejects(corpus.remember('1','2',[{url:'https://example.org/a',text:'阿明是小雨的师傅'}]),/缓冲满/);
 fail=false;corpus=createKnowledgeCorpus(options);assert.equal((await corpus.list('1','2')).length,1);assert.equal(delivered.length,1);
 await corpus.list('1','2');assert.equal(delivered.length,1);assert.equal(delivered[0].sequence,1);
});

test('遗忘立即替代失败的同步快照，磁盘缓冲失败也不能阻止浏览器清空',async()=>{
 const values={};const corpus=createKnowledgeCorpus({read:async k=>values[k],write:async(k,v)=>{values[k]=structuredClone(v);},archive:async()=>{throw Error('缓冲满');},now:()=>now});
 await assert.rejects(corpus.remember('1','2',[{url:'https://example.org/a',text:'阿明是小雨的师傅'}]));
 await assert.rejects(corpus.clear('1','2'));
 assert.equal(values['live-assistant:knowledge:1:2'].rows.length,0);assert.equal(values['live-assistant:knowledge:1:2'].revision,1);
 assert.deepEqual(values['live-assistant:knowledge:1:2'].pending.retained,[]);
});

test('重用搜索缓存保留原采集时间和原有效期，不靠重复回答延长旧资料寿命',async()=>{
 let clock=now;const values={};const corpus=createKnowledgeCorpus({read:async k=>values[k],write:async(k,v)=>{values[k]=v;},now:()=>clock});
 const source={url:'https://example.org/a',text:'历史资料',at:now-30000};await corpus.remember('1','2',[source],{lifetime:60000});
 let row=(await corpus.list('1','2'))[0];assert.equal(row.at,source.at);assert.equal(row.expiresAt,now+30000);
 clock+=40000;await corpus.remember('1','2',[source],{lifetime:60000});assert.equal((await corpus.list('1','2')).length,0);
});

test('研究重复使用已有来源时不能扩大来源原有效期',async()=>{
 const {corpus}=fixture();await corpus.remember('1','2',[{url:'https://example.org/old',text:'旧天气原文',at:now-30000,expiresAt:now+30000}],{lifetime:86400000});
 assert.equal((await corpus.list('1','2'))[0].expiresAt,now+30000);
});
