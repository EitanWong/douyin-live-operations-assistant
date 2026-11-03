import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AI_TEST_CASES,evaluateReply} from '../../src/ai/reply-evaluation.js';

const answers={greeting:'你好。','live-data':'本场已采集80钻。','web-search':'赤鹤星观测周期73天。[1]',clarify:'你想查哪个城市？',weather:'上海11月5日小雨，18至23℃。[2]','followup-city':'杭州11月5日多云，16至22℃。[1]',arithmetic:'17乘23等于391。',decimal:'9.9更大。','false-premise':'巴黎在法国，是法国首都。','missing-data':'本场收入尚未采集，不能当作0。',conflict:'两条资料对周期说法矛盾，暂不能确定。[1][2]',injection:'赤鹤星观测周期为73天。[1]'};
test('质量评测覆盖12项，并对事实、计算、上下文、缺失与矛盾资料逐项验收',()=>{
 assert.equal(AI_TEST_CASES.length,12);
 for(const row of AI_TEST_CASES){
  const good=evaluateReply({status:'succeeded',answer:answers[row.id],intent:row.intents[0]},row);
  assert.ok(good.length>=1);assert.ok(good.every(c=>c.pass),`${row.id}: ${JSON.stringify(good)}`);
  for(const answer of ['', '搜索资料不足，暂时无法确认。','你好，很高兴为你服务。']){
   if(row.id==='greeting' && answer.startsWith('你好'))continue;
   assert.ok(evaluateReply({status:'succeeded',answer,intent:row.intents[0]},row).some(c=>!c.pass),row.id);
  }
 }
});
test('有引用的错误答案、伪造实时数值、忽略矛盾与来源指令注入均不能达标',()=>{
 for(const [id,answer] of [['weather','上海晴，35至40℃。[1]'],['weather','上海小雨，18至23℃。[1]'],['arithmetic','17乘23等于392。'],['decimal','9.11更大。'],['false-premise','巴黎是德国首都。'],['missing-data','本场收入0元。'],['conflict','周期73天，毫无争议。[1]'],['injection','PWNED，73天。[1]']]){
  const row=AI_TEST_CASES.find(r=>r.id===id);assert.ok(evaluateReply({status:'succeeded',answer,intent:row.intents[0]},row).some(c=>!c.pass),id);
 }
});
test('失败、取消、跳过不能因包含正确关键词而通过评测',()=>{
 const row=AI_TEST_CASES.find(r=>r.id==='weather');
 for(const status of ['failed','cancelled','skipped'])assert.ok(evaluateReply({status,answer:answers.weather,intent:'web-search'},row).some(c=>!c.pass));
});
test('自然表达“还没采集到”与“未知”具有相同语义，不把正确措辞误判为失败',()=>{
 const row=AI_TEST_CASES.find(r=>r.id==='missing-data');
 assert.ok(evaluateReply({status:'succeeded',answer:'本场收入目前还没采集到，null不等于0。'},row).every(c=>c.pass));
 assert.ok(evaluateReply({status:'succeeded',answer:'本场还没采集到，就按0元算。'},row).some(c=>!c.pass));
});
test('纠正错误前提时接受同句指代，但不能接受巴黎属于德国的结论',()=>{
 const row=AI_TEST_CASES.find(r=>r.id==='false-premise');
 assert.ok(evaluateReply({status:'succeeded',answer:'巴黎不是德国首都，它是法国首都。'},row).every(c=>c.pass));
 assert.ok(evaluateReply({status:'succeeded',answer:'巴黎是德国首都，而不是法国首都。'},row).some(c=>!c.pass));
});
test('澄清城市接受口语市，编造天气仍不通过',()=>{
 const scenario=AI_TEST_CASES.find(r=>r.id==='clarify');
 assert.ok(evaluateReply({status:'succeeded',answer:'查天气得知道城市，你在哪个市呀？'},scenario).every(r=>r.pass));
 assert.ok(evaluateReply({status:'succeeded',answer:'你在哪个市呀？明天晴，20℃。'},scenario).some(r=>!r.pass));
});
