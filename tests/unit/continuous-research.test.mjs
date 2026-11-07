import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createContinuousResearch} from '../../src/ai/continuous-research.js';

test('稳定主页的近期人物每天复查公开资料；冷却去重、开关与遗忘版本仍生效',async()=>{
 let now=1800000000000,enabled=true,epoch=0;const loops=new Map(),submitted=[];
 const config=()=>({anchorId:'10',ai:{enabled:true,contextSources:{accounts:enabled},assistant:{memoryEnabled:true,research:{enabled:true,intervalSec:60,maxPerHour:3}}}});
 const deps={now:()=>now,configs:async()=>({'live-assistant:config:1':config()}),read:async()=>({anchor:'10',audience:{viewers:[{key:'uid:2',name:'小雨',secUids:['rain-account'],firstAt:now-1000,lastAt:now-600000,gifts:[],statements:[]}],forgotten:epoch ? [{key:'uid:2',at:epoch}] : []}}),store:{readLoop:async s=>loops.get(s),writeLoop:async r=>loops.set(r.scope,r)},submit:async j=>submitted.push(j),cancelDisabled:async()=>{},hasPending:()=>false};
 await createContinuousResearch(deps).tick();assert.equal(submitted.length,1);
 assert.equal(submitted[0].input.subject,'uid:2');assert.match(submitted[0].question,/公开/);
 assert.ok(submitted[0].input.sources.includes('https://www.douyin.com/user/rain-account'));
 now+=60001;await createContinuousResearch(deps).tick();assert.equal(submitted.length,1);
 now+=86400000;await createContinuousResearch(deps).tick();assert.equal(submitted.length,2);
 enabled=false;now+=86400000;await createContinuousResearch(deps).tick();assert.equal(submitted.length,2);
 enabled=true;epoch=now;await createContinuousResearch(deps).tick();assert.equal(submitted.length,2,'遗忘后的旧观测不继续调查');
});
test('更名和100条普通话题去重窗口不能使同一人物在24小时内重复复查',async()=>{
 let now=1800000000000,name='小雨',statement='',saved;const submitted=[];
 const config={anchorId:'10',ai:{enabled:true,assistant:{research:{enabled:true,intervalSec:60,maxPerHour:10}}}};
 const deps={now:()=>now,configs:async()=>({'live-assistant:config:1':config}),read:async()=>({anchor:'10',audience:{viewers:[{key:'uid:2',name,secUids:['rain-account'],lastAt:now-1000,gifts:[],statements:statement ? [{text:statement,at:now}] : []}]}}),store:{readLoop:async()=>saved,writeLoop:async r=>saved=r},submit:async j=>submitted.push(j),cancelDisabled:async()=>{},hasPending:()=>false};
 await createContinuousResearch(deps).tick();assert.equal(submitted.length,1);
 now+=60001;name='雨哥';await createContinuousResearch(deps).tick();assert.equal(submitted.length,1,'更名不重置账号冷却');
 saved.seen.push(...Array.from({length:100},(_,i)=>({key:`chat-${i}`,at:now})));now+=60001;
 statement='陶瓷茶杯怎么清洗？';await createContinuousResearch(deps).tick();assert.equal(submitted.length,2);
 assert.ok(saved.seen.some(r=>r.kind==='profile-refresh'),'普通话题淘汰时仍保留复查冷却');
 statement='';now+=60001;await createContinuousResearch(deps).tick();assert.equal(submitted.length,2);
});

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
test('无新数据、关闭AI、不匹配的主播档案不会启动后台调用',async()=>{
 let enabled=true,anchor='20',read=0,submitted=0,cancelled=0;
 const deps={configs:async()=>({'live-assistant:config:1':{anchorId:'10',ai:{enabled,assistant:{memoryEnabled:true,research:{enabled:true,intervalSec:60,maxPerHour:2}}}}}),read:async()=>{read++;return {anchor,audience:{viewers:[]},perception:{observations:[]}};},store:{readLoop:async()=>null,writeLoop:async()=>{}},submit:async()=>submitted++,cancelDisabled:async()=>cancelled++,hasPending:()=>false};
 await createContinuousResearch(deps).tick();anchor='10';await createContinuousResearch(deps).tick();enabled=false;await createContinuousResearch(deps).tick();
 assert.equal(submitted,0);assert.equal(read,2);assert.equal(cancelled,3);
});
test('整理失败重试在穿插公开研究和重启后仍有每日三次上限',async()=>{
 let now=1800000000000,saved;const submitted=[],jobs=new Map();
 const config={anchorId:'10',ai:{enabled:true,assistant:{research:{intervalSec:60,maxPerHour:10}}}};
 const speechAt=now-600000;
 const memory=()=>({anchor:'10',perception:{observations:[{id:'speech',kind:'audio',text:'阿明是小雨的师傅。',at:speechAt}]},audience:{viewers:[{key:'uid:2',name:'小雨',statements:[{id:'chat',text:`陶瓷茶杯怎么清洗？${now}`,at:now}]}]}});
 const deps={collect:true,now:()=>now,configs:async()=>({'live-assistant:config:1':config}),read:async()=>memory(),store:{readLoop:async()=>structuredClone(saved),writeLoop:async r=>saved=r},jobStatus:id=>jobs.get(id),submit:async job=>{submitted.push(job);jobs.set(job.id,'failed');},cancelDisabled:async()=>{},hasPending:()=>false};
 for(let i=0;i<7;i++){await createContinuousResearch(deps).tick();now+=60001;}
 const attempts=submitted.filter(j=>j.input.collection).map(j=>j.id);
 assert.equal(attempts.length,3);assert.equal(new Set(attempts).size,3);
 assert.ok(submitted.some(j=>!j.input.collection),'失败的整理不阻止公开研究');
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
