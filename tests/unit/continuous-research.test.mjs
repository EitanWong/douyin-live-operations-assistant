import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createContinuousResearch} from '../../src/ai/continuous-research.js';

test('持续研究从新对话生成独立任务，重启去重、冷却和每小时任务预算持久生效',async()=>{
 let now=1800000000000;const loops=new Map(),submitted=[];
 const config={anchorId:'10',ai:{enabled:true,assistant:{memoryEnabled:true,research:{enabled:true,intervalSec:60,maxPerHour:2}}}};
 let question='赤鹤星观测周期是多少天？';
 const deps={now:()=>now,configs:async()=>({'live-assistant:config:1':config}),read:async()=>({anchor:'10',audience:{viewers:[{statements:[{text:question,at:now}]}]},perception:{observations:[]}}),
  store:{readLoop:async s=>structuredClone(loops.get(s)),writeLoop:async r=>loops.set(r.scope,structuredClone(r))},submit:async job=>submitted.push(job),cancelDisabled:async()=>{},hasPending:()=>false};
 await createContinuousResearch(deps).tick();assert.equal(submitted.length,1);assert.match(submitted[0].question,/赤鹤星/);
 await createContinuousResearch(deps).tick();assert.equal(submitted.length,1);
 now+=60001;await createContinuousResearch(deps).tick();assert.equal(submitted.length,1);
 question='如何清洗陶瓷茶杯？';await createContinuousResearch(deps).tick();assert.equal(submitted.length,2);
 now+=60001;question='蓝色釉料是什么？';await createContinuousResearch(deps).tick();assert.equal(submitted.length,2);
 now+=3600001;await createContinuousResearch(deps).tick();assert.equal(submitted.length,3);
});
test('无新数据、关闭AI或记忆、不匹配的主播档案不会启动后台调用',async()=>{
 let enabled=true,anchor='20',read=0,submitted=0,cancelled=0;
 const deps={configs:async()=>({'live-assistant:config:1':{anchorId:'10',ai:{enabled,assistant:{memoryEnabled:true,research:{enabled:true,intervalSec:60,maxPerHour:2}}}}}),read:async()=>{read++;return {anchor,audience:{viewers:[]},perception:{observations:[]}};},store:{readLoop:async()=>null,writeLoop:async()=>{}},submit:async()=>submitted++,cancelDisabled:async()=>cancelled++,hasPending:()=>false};
 await createContinuousResearch(deps).tick();anchor='10';await createContinuousResearch(deps).tick();enabled=false;await createContinuousResearch(deps).tick();
 assert.equal(submitted,0);assert.equal(read,2);assert.equal(cancelled,3);
});
