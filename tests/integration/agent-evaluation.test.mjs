import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runAgentCase} from '../../scripts/evals/live-agent-provider.mjs';
import {AGENT_EVAL_CASES} from '../../scripts/evals/scenarios.mjs';

const reply=(d,text)=>d.onload({status:200,responseText:JSON.parse(d.data).stream ? `data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n` : JSON.stringify({choices:[{message:{content:text}}]})});
test('开源评测入口跑真实Engine→搜索客户端→AI→队列→预览，原始模型错误不能由评测器修饰',async()=>{
 const scenario=AGENT_EVAL_CASES.find(r=>r.id==='weather');let calls=0;
 const result=await runAgentCase(scenario,{key:'fake-key',workspaceId:'test-space',request:d=>reply(d,++calls===1 ? '{"intent":"web-search","query":"上海天气"}' : '{"answer":"上海11月5日小雨，18至23℃。","sources":[2]}')});
 assert.equal(result.passed,true);assert.equal(result.calls,2);assert.equal(result.searches,1);assert.match(result.output,/18至23℃。\[2\]/u);assert.equal(result.sent,0);assert.equal(result.pending,0);
 const wrong=await runAgentCase(scenario,{key:'fake-key',workspaceId:'test-space',request:d=>reply(d,JSON.parse(JSON.parse(d.data).messages[1].content).web_search ? '{"answer":"上海11月5日晴，35至40℃。","sources":[1]}' : '{"intent":"web-search","query":"上海天气"}')});
 assert.equal(wrong.passed,false);assert.match(wrong.output,/35至40/u);assert.ok(wrong.checks.some(c=>!c.pass));
});
test('整套架构评测包括静默、去重、额度与取消；不需要真实模型的门控不得产生付费请求',async()=>{
 for(const id of ['ai-disabled','mentions-only','other-address','quota-exhausted']){
  const result=await runAgentCase(AGENT_EVAL_CASES.find(r=>r.id===id),{key:'fake-key',workspaceId:'test-space',request:()=>assert.fail('不应请求模型')});
  assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.calls,0);assert.equal(result.sent,0);
 }
 const duplicate=await runAgentCase(AGENT_EVAL_CASES.find(r=>r.id==='duplicate-event'),{key:'fake-key',workspaceId:'test-space',request:d=>reply(d,'{"intent":"chat","reply":"你好。"}')});
 assert.equal(duplicate.passed,true);assert.equal(duplicate.calls,1);assert.equal(duplicate.replies.length,1);
});
test('取消和畸形输出是可复现的边界测试，不把模拟服务失败算作真实模型成绩',async()=>{
 for(const id of ['cancel-inflight','model-auth','malformed-intent','overlong-answer']){
  const result=await runAgentCase(AGENT_EVAL_CASES.find(r=>r.id===id),{key:'fake-key',workspaceId:'test-space',request:()=>assert.fail('故障注入不调用真实模型')});
  assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.faultInjected,true);
 }
});
test('实际直播账本的0、缺失、过期不混淆；主播语音与资料缓存经调度交付',async()=>{
 for(const [id,text] of [['zero-income','本场已采集0钻。'],['stale-income','本场账本已过期，当前钻石未知。']]){
  let seen;
  const result=await runAgentCase(AGENT_EVAL_CASES.find(r=>r.id===id),{key:'fake',workspaceId:'space',request:d=>{
   seen=JSON.parse(JSON.parse(d.data).messages[1].content).live_context.income;
   reply(d,JSON.stringify({intent:'live-data',reply:text}));
  }});
  assert.equal(result.passed,true,JSON.stringify(result));assert.equal(seen.totalDiamonds,id==='zero-income' ? 0 : null);assert.equal(seen.stale,id==='stale-income');
 }
 for(const id of ['host-question','speech-duplicate']){
  const result=await runAgentCase(AGENT_EVAL_CASES.find(r=>r.id===id),{key:'fake',workspaceId:'space',request:d=>{assert.equal(JSON.parse(JSON.parse(d.data).messages[1].content).media_context.moment.alignment,'overlapping');reply(d,'{"intent":"chat","reply":"蓝白搭配很清爽。"}');}});
  assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.calls,1);assert.equal(result.replies.length,1);
 }
 const cached=await runAgentCase(AGENT_EVAL_CASES.find(r=>r.id==='memory-cache'),{key:'fake',workspaceId:'space',request:d=>{
  const input=JSON.parse(JSON.parse(d.data).messages[1].content),candidate=input.knowledge_candidates?.[0];
  reply(d,input.web_search ? '{"answer":"赤鹤星周期73天。","sources":[1]}' : candidate ? JSON.stringify({intent:'knowledge',query:candidate.id,reply:'周期73天。[1]'}) : '{"intent":"web-search","query":"赤鹤星周期","freshness":"stable"}');
 }});
 assert.equal(cached.passed,true,JSON.stringify(cached));assert.equal(cached.searches,1);assert.equal(cached.replies.length,2);assert.equal(cached.lookups.at(-1).cached,true);
});
test('Promptfoo评分以原始链路结果为准，空答案和错误天气不能获得通过分',async()=>{
 const {default:config}=await import('../../scripts/evals/promptfoo.config.mjs');
 assert.equal(config.tests.length,AGENT_EVAL_CASES.length);
 for(const r of config.tests){
  const judge=new Function('output',r.assert[0].value);
  assert.equal(judge(JSON.stringify({passed:false,checks:[{pass:false,label:'错误事实'}]})).pass,false);
  assert.equal(judge(JSON.stringify({passed:true,checks:[{pass:true,label:'正确事实'}]})).pass,true);
 }
});
test('零钻支持相同语义表达，但非零和缺失不能被评测器误放行',async()=>{
 const {assessAgentResult}=await import('../../scripts/evals/scenarios.mjs');
 const scenario=AGENT_EVAL_CASES.find(r=>r.id==='zero-income');
 const assess=text=>assessAgentResult({sent:0,pending:0,replies:[{text,valid:true}],output:text},scenario).every(c=>c.pass);
 assert.equal(assess('本场已采集钻石为0，当前无礼物入账。'),true);
 assert.equal(assess('本场已采集80钻。'),false);assert.equal(assess('尚未采集到本场数据。'),false);
});
test('未知价格和搜索故障的口语表达通过，通用发送失败不冒充有用天气答复',async()=>{
 const {assessAgentResult}=await import('../../scripts/evals/scenarios.mjs');
 const assess=(id,text)=>assessAgentResult({sent:0,pending:0,replies:[{text,valid:true}],output:text},AGENT_EVAL_CASES.find(r=>r.id===id)).every(c=>c.pass);
 assert.equal(assess('price-unknown','杯子价格这边没查到，具体得看主播怎么说了。'),true);
 assert.equal(assess('price-unknown','售价128元。'),false);
 for(const text of ['未查到上海明天天气，接口报错，建议稍后查询。','搜索失败，缺上海明日预报，建议查气象网站。','搜索报错，暂无上海明日降雨数据。'])assert.equal(assess('weather-rate-limit',text),true);
 assert.equal(assess('weather-rate-limit','查询结果暂时无法发送，请稍后再试。'),false);
});
test('后台Agent真实任务宿主贯通持久任务、研究路由、来源和幂等提交',async()=>{
 for(const id of ['durable-research','durable-duplicate']){
  const scenario=AGENT_EVAL_CASES.find(r=>r.id===id);assert.ok(scenario);
  let calls=0;
  const result=await runAgentCase(scenario,{key:'fake-key',workspaceId:'test-space',request:d=>reply(d,++calls===1 ? '{"intent":"web-search","query":"赤鹤星周期"}' : '{"answer":"赤鹤星周期73天。","sources":[1]}')});
  assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.calls,2);assert.equal(result.searches,1);assert.equal(result.taskCount,1);assert.equal(result.sent,0);assert.equal(result.secretStored,false);
 }
});
test('除零的正确否定解释不会因出现等于1而误判，错误算式仍失败',async()=>{
 const {assessAgentResult}=await import('../../scripts/evals/scenarios.mjs');
 const scenario=AGENT_EVAL_CASES.find(r=>r.id==='division-zero');
 const assess=text=>assessAgentResult({sent:0,pending:0,replies:[{text,valid:true}],output:text},scenario).every(c=>c.pass);
 assert.equal(assess('1除以0在数学上没有定义，因为找不到一个数乘0能等于1。'),true);
 assert.equal(assess('1除以0等于1。'),false);assert.equal(assess('1除以0等于0。'),false);
});
