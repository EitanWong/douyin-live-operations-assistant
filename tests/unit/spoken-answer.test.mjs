import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchAnswer,unavailableCurrentAnswer} from '../../src/services/search-answer.js';
import {createAIClient,makeAIRequest} from '../../src/services/ai.js';
import {makeEdgeMessages} from '../../src/ai/edge-prompt.js';
import {mergeConfig} from '../../src/core/engine.js';

const found={query:'上海明天天气',results:[{index:1,content:'上海明天小雨。'}]};
const prompt={task:{kind:'ai'},target:{text:'上海明天天气？'},maxLength:50};
const config=mergeConfig({ai:{search:{enabled:true}}}).ai;
test('公屏正文移除中英文角标，实际依据单独保留且虚构编号不能通过校验',()=>{
 for(const output of ['上海明天小雨。[1]','上海明天小雨。【1】','上海明天小雨。［1］','{"answer":"上海明天小雨。","sources":[1]}']){
  assert.deepEqual(searchAnswer(output,found),{answer:'上海明天小雨。',citationIndices:[1],grounded:true});
 }
 assert.deepEqual(searchAnswer('上海明天小雨。[99]',found),{answer:'上海明天小雨。',citationIndices:[99],grounded:false});
 assert.deepEqual(searchAnswer('{"answer":"上海明天小雨。[99]","sources":[1]}',found),{answer:'上海明天小雨。',citationIndices:[1],grounded:true});
});
test('没查到时自然说明未知，原始查询故障不进入公屏正文',()=>{
 for(const error of ['HTTP 429','联网搜索未启用','搜索没有返回相关资料']){
  const answer=unavailableCurrentAnswer({...found,error,results:[]},50);
  assert.match(answer,/上海.*天气.*(?:没查到|未查到)/u);
  assert.doesNotMatch(answer,/联网|搜索|限流|429|失败|启用|本地|接口/u);
  assert.ok([...answer].length<=50);
 }
});
test('非搜索对话也不把数字角标发到公屏，跳过标记保持有效',async()=>{
 for(const [reply,expected] of [['你好。[1]','你好。'],['[SKIP]','[SKIP]']]){
  const ai=createAIClient({generate:async()=>JSON.stringify({intent:reply==='[SKIP]' ? 'skip' : 'chat',reply:reply==='[SKIP]' ? '' : reply,query:''})});
  assert.equal(await ai(prompt,config),expected);
 }
});
test('复用知识的答案也支持独立来源字段，无需把角标写进正文',async()=>{
 const id='00000000-0000-4000-8000-000000000001',records=[];
 const ai=createAIClient({generate:async()=>JSON.stringify({intent:'knowledge',query:id,reply:'上海明天小雨。',sources:[1]}),
  knowledge:{revision:async()=>0,candidates:async()=>[{id}],find:async()=>({...found,id,cached:true})},onSearch:row=>records.push(row)});
 assert.equal(await ai(prompt,config),'上海明天小雨。');
 assert.deepEqual(records.at(-1).citationIndices,[1]);assert.equal(records.at(-1).citationWarning,'');
});
test('云端与端侧各阶段要求直接回答，把来源编号放在独立字段',()=>{
 for(const build of [(p)=>makeAIRequest(p,config).messages,(p)=>makeEdgeMessages(p,config)]){
  for(const phase of [{intentRouting:true},{searchResults:found},{}]){
   const system=build({...prompt,...phase})[0].content;
   assert.match(system,/不.*(?:本地回答|本地给出回答)/u);
   assert.match(system,/没查到/u);
   assert.doesNotMatch(system,/每个事实结论标|有效 web_search 时据所给来源回答并标注|说明当前无法联网|说明未联网核实/u);
   if(phase.searchResults)assert.match(system,/"answer".*"sources"/u);
  }
 }
});
