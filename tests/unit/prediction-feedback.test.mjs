import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calibrateForecast,feedbackMetrics} from '../../src/analytics/feedback.js';

const now=Date.parse('2026-11-03T12:00:00Z'),minute=60000;
const forecast={status:'ready',point:100,low:80,high:120,horizonMinutes:5,unit:'people',method:'local-level-damped-trend',calibration:'uncalibrated'};
const samples=(actuals,extra={})=>actuals.map((actual,i)=>({id:`f${i}`,target:'online',horizonMinutes:5,method:forecast.method,
 asOf:now-(actuals.length-i)*5*minute-1000,startAt:now-(actuals.length-i)*5*minute,dueAt:now-(actuals.length-i-1)*5*minute,
 point:100,low:80,high:120,baseline:{point:100,low:80,high:120},evaluation:{status:'scored',actual,at:now,error:actual-100,covered:actual>=80 && actual<=120},...extra}));

test('learns a past bias only when later independent windows improve, without mutating issued evidence',()=>{
 const rows=samples(Array(24).fill(130)),before=structuredClone(rows),result=calibrateForecast(forecast,'online',rows,now);
 assert.equal(result.point,130);assert.ok(result.low<=result.point && result.high>=result.point);
 assert.equal(result.baseline.point,100);assert.equal(result.feedback.status,'applied');
 assert.equal(result.feedback.training,18);assert.equal(result.feedback.validation,6);
 assert.equal(result.feedback.baselineMAE,30);assert.equal(result.feedback.candidateMAE,0);
 assert.deepEqual(rows,before);assert.equal(forecast.point,100);
 // Repeated calibration starts from the immutable baseline, not the corrected point.
 assert.equal(calibrateForecast(result,'online',rows,now).point,130);
});

test('holds the baseline through drift and rejects overlapping, future, missing or incompatible labels',()=>{
 const drift=samples([...Array(18).fill(130),...Array(6).fill(100)]);
 const rejected=calibrateForecast(forecast,'online',drift,now);
 assert.equal(rejected.point,100);assert.equal(rejected.feedback.status,'baseline');
 const valid=samples(Array(19).fill(130));
 const contaminations=[...samples(Array(24).fill(999),{target:'diamonds'}),...samples(Array(24).fill(999),{horizonMinutes:1}),
  ...samples(Array(24).fill(999),{method:'different-model'}),...samples(Array(24).fill(999),{evaluation:{status:'censored',actual:null}}),
  ...samples(Array(24).fill(999),{dueAt:now+minute}),...samples(Array(24).fill(999),{evaluation:{status:'scored',actual:999,at:now+1}})];
 const insufficient=calibrateForecast(forecast,'online',[...valid,...contaminations,...Array(100).fill(valid[0])],now);
 assert.equal(insufficient.point,100);assert.equal(insufficient.feedback.status,'collecting');assert.equal(insufficient.feedback.samples,19);
 const unavailable={...forecast,status:'insufficient-data',point:null,low:null,high:null};
 assert.deepEqual(calibrateForecast(unavailable,'online',samples(Array(24).fill(130)),now),unavailable);
});

test('scores issued and baseline predictions in their own target and horizon, including zero actuals',()=>{
 const rows=samples([0,100]).map(row=>({...row,point:120,baseline:{point:100}}));
 const summary=feedbackMetrics([...rows,...samples([900],{target:'diamonds'})],now);
 const online=summary.find(row=>row.target==='online' && row.horizonMinutes===5);
 assert.equal(online.n,2);assert.equal(online.mae,70);assert.equal(online.bias,70);
 assert.equal(online.mape,.2);assert.equal(online.percentageN,1);
 assert.equal(online.baselineMAE,50);assert.equal(online.pairedMAE,70);assert.equal(online.improvement,-.4);
});
