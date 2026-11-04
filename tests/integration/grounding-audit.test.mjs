import {test} from 'node:test';
import assert from 'node:assert/strict';
import {auditGrounding} from '../../scripts/evals/grounding-audit.mjs';
const row={id:'pk',lookups:[{question:'评论能证明通用规则吗',answer:'不能，但没有固定保底标准。',citationIndices:[1],results:[{index:1,title:'用户评论',content:'网友说首翻2倍。',url:'https://example.org/comment'}]}]};
test('来源复核审查实际答案及所引资料，不重写答案或把缺引用当作有依据',async()=>{
 let calls=0;const rows=await auditGrounding([row,{id:'empty',lookups:[]}],async input=>{
  calls++;assert.equal(input.answer,row.lookups[0].answer);assert.equal(input.cited_sources[0].content,'网友说首翻2倍。');
  return {supported:false,reason:'评论不支持没有保底标准',unsupportedClaims:['没有固定保底标准']};
 });
 assert.equal(calls,1);assert.equal(rows.length,1);assert.equal(rows[0].passed,false);assert.equal(rows[0].answer,row.lookups[0].answer);
});
test('审核模型格式无效不能算通过，明确支持且无额外断言才能通过',async()=>{
 await assert.rejects(auditGrounding([row],async()=>({supported:'yes'})),/./);
 const supportedRow={...row,lookups:[{...row.lookups[0],answer:'这只是网友评论，不能证明通用规则。'}]};
 for(const [supported,claims,passed] of [[true,[],true],[true,['额外断言'],false],[false,[],false]]){
  const result=await auditGrounding([supportedRow],async()=>({supported,reason:'逐条核对',unsupportedClaims:claims}));assert.equal(result[0].passed,passed);
 }
});
test('审核模型赞同也不能放过没有来源原文支持的平台不存在断言',async()=>{
 const rows=await auditGrounding([row],async()=>({supported:true,reason:'错误地认作合理概括',unsupportedClaims:[]}));
 assert.equal(rows[0].passed,false);assert.match(rows[0].automaticFlags[0],/保底/);
});
test('后台持久研究的答案与来源也进入同一复核，不只审核公屏问答',async()=>{
 const result=await auditGrounding([{id:'research',question:'测试周期',output:'周期73天。',sources:[{index:1,content:'周期73天。'}],citationIndices:[1]}],async input=>{
  assert.equal(input.answer,'周期73天。');assert.equal(input.cited_sources[0].content,'周期73天。');return {supported:true,reason:'来源直接支持',unsupportedClaims:[]};
 });assert.equal(result.length,1);assert.equal(result[0].passed,true);
});
