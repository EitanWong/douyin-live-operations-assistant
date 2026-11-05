import {test} from 'node:test';
import assert from 'node:assert/strict';
import {predictionChartOptions} from '../../src/ui/prediction-charts.js';
test('anchor charts keep units separate, break missing minutes and put prediction bands strictly in the future',()=>{
 const now=Date.now(),r={asOf:now,observedDiamonds:1000,timeline:[{at:now-120000,coverageMs:60000,diamonds:10,online:20,onlineAt:now-60001,chats:3,giftUnits:1,enters:2},{at:now-60000,coverageMs:0,diamonds:0,online:null,chats:0}],flow:{status:'ready',point:500,low:100,high:800},online:[{status:'ready',horizonMinutes:1,point:25,low:10,high:40}],thousand:{rows:[]},semantics:{intents:{}},evaluation:{buckets:[]},sessions:[]};
 const c=predictionChartOptions(r);assert.equal(c.revenue.series[0].data[1][1],null);assert.equal(c.online.yAxis.name,'人');assert.equal(c.revenue.yAxis.name,'钻石');
 const forecast=c.revenue.series.find(s=>s.name==='未来5分钟累计中位数');assert.equal(forecast.data.at(-1)[0],now+300000);assert.equal(forecast.data.at(-1)[1],1500);
 assert.equal(c.revenue.series.find(s=>s.name==='80%区间下界').data.at(-1)[1],1100);
 assert.equal(c.online.series.find(s=>s.name==='预测中位数').data.at(-1)[1],25);
});
test('expired online observations are not moved to the current forecast origin; charts describe their meaning to screen readers',()=>{
 const now=Date.now(),c=predictionChartOptions({asOf:now,timeline:[{at:now-600000,onlineAt:now-600000,online:200}],online:[]});
 assert.equal(c.online.series.find(s=>s.name==='预测中位数').data[0][1],null);
 for(const option of Object.values(c)){
  assert.ok(option.aria.label.description.length>15);
  assert.doesNotMatch(option.aria.label.description,/NaN|undefined/);
 }
 assert.match(c.revenue.aria.label.description,/钻石/);
 assert.match(c.online.aria.label.description,/在线/);
});

test('comparison charts align original prediction, published prediction and later actual by due time and unit',()=>{
 const r={asOf:1000000,comparisons:[
  {target:'online',horizonMinutes:5,dueAt:900000,point:120,baseline:{point:100},evaluation:{status:'scored',actual:130}},
  {target:'online',horizonMinutes:1,dueAt:910000,point:500,evaluation:{status:'scored',actual:600}},
  {target:'diamonds',horizonMinutes:5,dueAt:920000,point:200,evaluation:{status:'scored',actual:0}},
  {target:'online',horizonMinutes:5,dueAt:930000,point:999,evaluation:{status:'censored',actual:null}}
 ]};
 const c=predictionChartOptions(r);
 assert.equal(c.onlineComparison.yAxis.name,'人');assert.equal(c.diamondsComparison.yAxis.name,'钻石');
 assert.deepEqual(c.onlineComparison.series.map(s=>s.data),[[[900000,100]],[[900000,120]],[[900000,130]]]);
 assert.deepEqual(c.diamondsComparison.series.at(-1).data,[[920000,0]]);
});

test('hourly earnings show partial observed sessions separately and keep unobserved hours empty',()=>{
 const startAt=Date.parse('2026-11-05T12:00:00Z');
 const c=predictionChartOptions({asOf:startAt+3600000,sessions:[
  {startAt,endAt:0,coverageMs:1800000,diamonds:300,complete:false,startKnown:false},
  {startAt,endAt:startAt+3600000,coverageMs:3600000,diamonds:900,complete:true},
  {startAt:startAt+3600000,endAt:0,coverageMs:0,diamonds:200,complete:false}
 ]});
 assert.equal(c.hourly.series[0].data[20].value,900);
 assert.equal(c.hourly.series[1].data[20].value,600);
 assert.match(c.hourly.series[1].data[20].name,/采集/);
 assert.equal(c.hourly.series[1].data[21],null);
 assert.equal(c.hourly.series[0].data[19],null);
 const sem=predictionChartOptions({semantics:{intents:{greeting:2,request:3,engagement:4,complaint:1}}}).semantics;
 assert.ok(sem.xAxis.data.includes('问候欢迎'));assert.ok(sem.xAxis.data.includes('内容点播'));
 assert.equal(sem.series[0].data.reduce((a,b)=>a+b,0),10);
});

test('hourly collection rates are duration weighted, retain observed zero and reject missing or future evidence',()=>{
 const startAt=Date.parse('2026-11-05T12:00:00Z'),asOf=startAt+3600000;
 const partial=(extra={})=>({startAt,endAt:0,complete:false,coverageMs:900000,diamonds:100,...extra});
 const c=predictionChartOptions({asOf,sessions:[partial(),partial({coverageMs:2700000,diamonds:500}),partial({startAt:startAt-3600000,diamonds:0}),partial({startAt:startAt+3600000,coverageMs:0}),partial({unknownCount:1}),partial({startAt:asOf+1}),partial({diamonds:NaN})]});
 assert.equal(c.hourly.series[1].data[20].value,600);
 assert.equal(c.hourly.series[1].data[19].value,0);
 assert.equal(c.hourly.series[1].data[21],null);
 assert.ok(c.hourly.series[0].data.every(row=>row===null));
});
