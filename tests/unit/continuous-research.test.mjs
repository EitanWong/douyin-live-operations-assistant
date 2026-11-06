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
test('相同提问按稳定身份去重，优先研究主播与高等级观众，每三次给普通观众机会',async()=>{
 let now=1800000000000;const submitted=[],loops=new Map();
 const config={anchorId:'10',ai:{enabled:true,assistant:{memoryEnabled:true,research:{enabled:true,intervalSec:60,maxPerHour:10}}}};
 const viewer=(id,level)=>({key:`uid:${id}`,name:'同名',lastAt:now,firstAt:now,platform:{honor:{value:level,at:now}},gifts:[],statements:[{id:'q',text:'茶杯里的茶垢如何清洗？',at:now}]});
 let viewers=[viewer('2',50),viewer('3',0),viewer('10',0)];
 const deps={now:()=>now,configs:async()=>({'live-assistant:config:1':config}),read:async()=>({anchor:'10',audience:{viewers},perception:{observations:[]}}),store:{readLoop:async s=>loops.get(s),writeLoop:async r=>loops.set(r.scope,r)},submit:async j=>submitted.push(j),cancelDisabled:async()=>{},hasPending:()=>false};
 const loop=createContinuousResearch(deps);await loop.tick();now+=60001;await loop.tick();
 viewers.push(viewer('4',60));now+=60001;await loop.tick();
 assert.deepEqual(submitted.map(j=>j.input.subject),['uid:10','uid:2','uid:3']);
 assert.equal(new Set(submitted.map(j=>j.id)).size,3);
 assert.equal(submitted[0].input.context.context[0].identity,'uid:10');
});
test('去重窗口满100条后仍使用持久轮次保留普通候选机会',async()=>{
 const now=1800000000000,submitted=[],viewers=[50,0].map((n,i)=>({key:`uid:${i+2}`,lastAt:now,platform:{honor:{value:n,at:now}},statements:[{text:'陶瓷茶杯怎么清洗？',at:now}]}));
 const old={turn:2,scope:'1:10',nextAt:0,calls:[],seen:Array.from({length:100},(_,i)=>({key:`old-${i}`,at:now-1000}))};
 const config={anchorId:'10',ai:{enabled:true,assistant:{research:{enabled:true,intervalSec:60,maxPerHour:3}}}};
 await createContinuousResearch({now:()=>now,configs:async()=>({'live-assistant:config:1':config}),read:async()=>({anchor:'10',audience:{viewers}}),store:{readLoop:async()=>old,writeLoop:async()=>{}},submit:async j=>submitted.push(j),cancelDisabled:async()=>{},hasPending:()=>false}).tick();
 assert.equal(submitted[0].input.subject,'uid:3');
});
