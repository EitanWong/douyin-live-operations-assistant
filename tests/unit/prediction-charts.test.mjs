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
