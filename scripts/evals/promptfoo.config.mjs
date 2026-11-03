import {AGENT_EVAL_CASES} from './scenarios.mjs';
export default {
 description:'直播场控完整Agent：真实模型、固定搜索资料、Engine调度与预览交付',
 prompts:['{{scenario}}'],
 providers:[new URL('./live-agent-provider.mjs',import.meta.url).pathname],
 tests:AGENT_EVAL_CASES.map(row=>({description:`${row.id} · ${row.label}`,vars:{scenario:row.id},
  metadata:{kind:row.fault ? 'fault-injection' : row.maxCalls===0 ? 'architecture-gate' : 'real-model'},
  assert:[{type:'javascript',value:`const r=JSON.parse(output);
return {pass:r.passed,score:r.checks.filter(c=>c.pass).length/r.checks.length,reason:r.checks.filter(c=>!c.pass).map(c=>c.label).join('; ') || '全部检查通过'};`}]})),
 sharing:false,evaluateOptions:{maxConcurrency:1}
};
