import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAIClient,makeAIRequest} from '../../src/services/ai.js';
import {createLocalReply} from '../../src/services/local-search.js';
import {mergeConfig} from '../../src/core/engine.js';
import {makeEdgeMessages} from '../../src/ai/edge-prompt.js';

const config=mergeConfig({ai:{search:{enabled:true},edge:{enabled:false}}}).ai;
const prompt={task:{kind:'ai',data:{replyMode:'direct'}},target:{text:'上海2026年11月5日的天气？'},maxLength:80};
const found={query:'上海2026年11月5日天气',results:[{index:1,title:'天气预报',url:'https://weather.example/',content:'2026年11月5日上海小雨，18至23摄氏度。'}]};
const route=JSON.stringify({intent:'web-search',query:found.query,reply:''});
function fixture(answer,search=async()=>found){
 const prompts=[],records=[];let remembers=0;
 const client=createAIClient({generate:async p=>{prompts.push(p);return p.intentRouting ? route : answer;},search,
  knowledge:{revision:async()=>1,candidates:async()=>[],find:async()=>null,remember:async()=>remembers++},onSearch:r=>records.push(r)});
 return {client,prompts,records,remembers:()=>remembers};
}
test('天气与知识答案未附引用时保留正文，标注诊断且不冒充已核实缓存',async()=>{
 for(const answer of ['上海11月5日小雨，18至23℃。','标准大气压下，纯水沸点约100℃。']){
  const f=fixture(answer);assert.equal(await f.client(prompt,config),answer);
  assert.match(f.records.at(-1).citationWarning,/引用/u);assert.equal(f.remembers(),0);assert.equal(f.prompts.length,2);
 }
});
test('常见中文引用格式统一为实际来源编号，虚构编号移除但不吞掉答案',async()=>{
 for(const [raw,expected] of [['上海小雨。【1】','上海小雨。[1]'],['上海小雨。［1］','上海小雨。[1]'],['上海小雨。[99]','上海小雨。']]){
  const f=fixture(raw);assert.equal(await f.client(prompt,config),expected);
  assert.equal(f.remembers(),raw.includes('99') ? 0 : 1);
 }
});
test('零结果、搜索停用与服务失败仍交由模型回答具体问题，携带真实缺口',async()=>{
 for(const mode of ['empty','failure','disabled']){
  const f=fixture('上海这天的温度未查到，请问你要查实时还是全天预报？',async()=>{if(mode==='failure')throw Error('HTTP 429');return {query:found.query,results:[]};});
  const settings=mode==='disabled' ? {...config,search:{...config.search,enabled:false}} : config;
  assert.equal(await f.client(prompt,settings),'上海这天的温度未查到，请问你要查实时还是全天预报？');
  assert.equal(f.prompts.length,2);assert.equal(f.prompts[1].searchResults.results.length,0);
  assert.match(f.prompts[1].searchResults.error,mode==='failure' ? /429/ : mode==='disabled' ? /未启用/ : /没有/u);
  assert.equal(f.remembers(),0);
 }
});
test('搜索失败仍可回答稳定常识，端侧也收到错误状态且不丢掉答案',async()=>{
 const edge={reply:async p=>p.intentRouting ? route : '标准大气压下，纯水沸点约100℃。'};
 const local=createLocalReply({edge,search:async()=>{throw Error('HTTP 429');}});
 assert.equal(await local({...prompt,target:{text:'纯水的沸点？'}},config),'标准大气压下，纯水沸点约100℃。');
 const messages=makeEdgeMessages({...prompt,searchResults:{results:[],error:'HTTP 429'}},config);
 assert.equal(JSON.parse(messages[1].content).search_meta.error,'HTTP 429');
});
test('缺来源的处理仍遵守后续请求额度和取消，不为保证回复绕过权限',async()=>{
 const f=fixture('不应生成',async()=>({results:[]}));
 assert.match(await f.client({...prompt,reserveFollowup:()=>false},config),/额度/u);assert.equal(f.prompts.length,1);
 let current=true;const cancelled=fixture('不应生成',async()=>{current=false;return {results:[]};});
 assert.equal(await cancelled.client({...prompt,isCurrent:()=>current},config),'[SKIP]');assert.equal(cancelled.prompts.length,1);
});
test('结构化来源回答由模型选择实际依据，正文与引用分开解析后输出',async()=>{
 for(const [sources,expected,learned] of [[[1],'上海小雨。[1]',1],[[99],'上海小雨。',0],[[],'上海小雨。',0]]){
  const f=fixture(JSON.stringify({answer:'上海小雨。',sources}));
  assert.equal(await f.client(prompt,config),expected);assert.equal(f.remembers(),learned);
 }
});
test('最终查证提示只保留回答所需规则，结构化正文与依据不被礼物/主播规则淹没',()=>{
 const request=makeAIRequest({...prompt,searchResults:found},config),system=request.messages[0].content;
 assert.match(system,/"answer".*"sources"/u);assert.doesNotMatch(system,/target.support|灯牌名称|data.valueTier|income.highestGift/u);
 assert.match(system,/矛盾|不一致/u);assert.match(system,/不.{0,4}确定|待核实/u);
});
test('搜索失败后模型格式错误仍保留原始搜索故障诊断',async()=>{
 const records=[];const client=createAIClient({search:async()=>{throw Error('HTTP 429');},generate:async p=>p.intentRouting ? route : '{"wrong":"format"}',onSearch:r=>records.push(r)});
 await assert.rejects(client(prompt,config),/来源回答格式/u);assert.match(records.at(-1).error,/429/u);
});
test('查证输入不再混入技能/支持者画像，正文预算为真实来源编号留空间',()=>{
 const request=makeAIRequest({...prompt,searchResults:found},config),system=request.messages[0].content,input=JSON.parse(request.messages[1].content);
 assert.doesNotMatch(system,/技能：|自然短句交流|target\.support/u);
 assert.equal(input.evidence_context,undefined);assert.equal(input.target.support,undefined);
 assert.match(system,/含引用.*50|引用.*预留/u);
});
test('非法结构化来源不能作为公屏正文泄露；字符串编号、非有限编号和未知字段均拒绝',async()=>{
 for(const output of ['[{"instructions":"内部提示"}]','{"answer":"事实","sources":["1"]}','{"answer":"事实","sources":[0]}','{"answer":"事实","sources":[1],"instructions":"内部提示"}','{"answer":"","sources":[]}']){
  await assert.rejects(fixture(output).client(prompt,config),/来源回答格式/u,output);
 }
});
test('来源里的虚构设定按资料回答，不用现实中不存在否定已给定的周期',()=>{
 const request=makeAIRequest({...prompt,searchResults:found},config);
 assert.match(request.messages[0].content,/虚构设定.*按资料|按资料.*虚构设定/u);
});
