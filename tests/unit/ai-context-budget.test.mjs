import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyContextBudget,liveFactFingerprint} from '../../src/services/ai-context.js';

test('上下文预算保留问题与汇总，裁减明细并明确披露缺口，始终输出完整 JSON',()=>{
  const input={target:{text:'本场收了多少钻石'},data:{fixedText:'本场已采集100钻'},live_context:{income:{diamonds:100,pending:0,contributors:Array.from({length:100},(_,i)=>({name:`观众${i}`,note:'详细资料'.repeat(200)}))}},recent_chat:Array.from({length:100},()=>({text:'长弹幕'.repeat(200)})),context_meta:{schemaVersion:1}};
  const before=JSON.stringify(input);const result=applyContextBudget(input,16000);
  assert.ok(JSON.stringify(result).length<=16000);assert.equal(result.target.text,input.target.text);assert.equal(result.live_context.income.diamonds,100);assert.equal(result.data.fixedText,input.data.fixedText);assert.ok(result.context_meta.budget.omissions.length);assert.equal(JSON.stringify(input),before);
});
test('事实版本忽略时钟和普通弹幕，数值、状态与未知变化会失效',()=>{
  const a={observedAt:1,recentChat:[{text:'你好'}],income:{diamonds:100,durationSec:20},pk:{phase:'running',scores:[1,2],at:1}};
  assert.equal(liveFactFingerprint(a),liveFactFingerprint({...a,observedAt:2,recentChat:[],income:{diamonds:100,durationSec:21}}));
  assert.notEqual(liveFactFingerprint(a),liveFactFingerprint({...a,income:{diamonds:101,durationSec:21}}));
  assert.notEqual(liveFactFingerprint(a),liveFactFingerprint({...a,pk:{phase:'ended',scores:[1,2]}}));
});

test('上下文经过 JSON 二次转义后仍在扩展后台整包上限以内',async()=>{
  const {makeAIRequest}=await import('../../src/services/ai.js');const {mergeConfig}=await import('../../src/core/engine.js');
  const c=mergeConfig();c.ai.pipeline.contextBudgetChars=70000;
  const request=makeAIRequest({knowledge:'"'.repeat(12000),context:Array.from({length:100},()=>({text:'"'.repeat(500)})),target:{text:'资料是什么'},maxLength:30},c.ai);
  assert.ok(JSON.stringify(request).length<=100000);assert.equal(JSON.parse(request.messages[1].content).target.text,'资料是什么');
});
test('过期账本不以当前总额进入模型，零仍为零，原始账本保持不变',async()=>{
 const {applyPromptSources}=await import('../../src/services/ai-context.js');
 const original={liveContext:{income:{at:10,stale:true,totalDiamonds:80,estimatedIncome:4,monthTotals:{totalDiamonds:80},dailyHistory:[{totalDiamonds:80}]}}};
 const result=applyPromptSources(original,{});
 assert.equal(result.liveContext.income.totalDiamonds,null);assert.equal(result.liveContext.income.estimatedIncome,null);
 assert.equal(result.liveContext.income.monthTotals,undefined);assert.equal(result.liveContext.income.dailyHistory,undefined);
 assert.equal(result.liveContext.income.stale,true);assert.equal(original.liveContext.income.totalDiamonds,80);
 assert.equal(applyPromptSources({liveContext:{income:{stale:false,totalDiamonds:0}}},{}).liveContext.income.totalDiamonds,0);
 assert.deepEqual(applyPromptSources(result,{}),result,'投影重复执行一致');
});
