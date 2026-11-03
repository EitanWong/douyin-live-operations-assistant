import {clamp,mean,quantile} from './math.js';

export const FEEDBACK_TARGETS=[{target:'diamonds',horizonMinutes:5},...[1,5,15].map(horizonMinutes=>({target:'online',horizonMinutes}))];
const baseline=row=>row.baseline || {point:row.point,low:row.low,high:row.high};
const mature=(row,now)=>row.evaluation?.status==='scored' && Number.isFinite(row.evaluation.actual) && row.evaluation.actual>=0 &&
 Number.isFinite(row.point) && Number.isFinite(baseline(row).point) && row.asOf<=row.startAt && row.startAt<row.dueAt && row.dueAt<=now && row.evaluation.at<=now;

// Publishing every 15 seconds must not turn one outcome into 20 training samples.
function independent(rows){
 let until=0;
 return [...rows].sort((a,b)=>a.startAt-b.startAt || a.asOf-b.asOf).filter(row=>{
  if(row.startAt<until)return false;
  until=row.dueAt;return true;
 }).slice(-120);
}
const error=(row,shift=0)=>clamp(baseline(row).point+shift,0,1e12)-row.evaluation.actual;
const mae=(rows,shift=0)=>mean(rows.map(row=>Math.abs(error(row,shift))));

export function calibrateForecast(forecast,target,history,now){
 if(forecast.status!=='ready')return forecast;
 const base=baseline(forecast),rows=independent(history.filter(row=>row.target===target && row.horizonMinutes===forecast.horizonMinutes &&
  row.method===forecast.method && mature(row,now)));
 const feedback={status:'collecting',samples:rows.length,required:20,training:0,validation:0,shift:0};
 const result={...forecast,...base,baseline:{...base},feedback};
 if(rows.length<feedback.required)return result;
 const split=Math.floor(rows.length*.75),training=rows.slice(0,split),validation=rows.slice(split);
 const residuals=training.map(row=>-error(row)).sort((a,b)=>a-b),shift=quantile(residuals,.5);
 const baselineMAE=mae(validation),candidateMAE=mae(validation,shift);
 Object.assign(feedback,{status:'baseline',training:training.length,validation:validation.length,shift,baselineMAE,candidateMAE});
 if(!(baselineMAE>0 && candidateMAE<=baselineMAE*.95))return result;
 const radius=quantile(training.map(row=>Math.abs(error(row,shift))).sort((a,b)=>a-b),.8),point=clamp(base.point+shift,0,1e12);
 feedback.status='applied';
 return {...result,point,low:Math.max(0,point-Math.max(base.point-base.low,radius)),high:Math.min(1e12,point+Math.max(base.high-base.point,radius)),
  calibration:'rolling-feedback',calibrationSize:rows.length};
}

export function feedbackMetrics(history,now){
 return FEEDBACK_TARGETS.map(group=>{
  const rows=independent(history.filter(row=>row.target===group.target && row.horizonMinutes===group.horizonMinutes && mature(row,now)));
  const errors=rows.map(row=>row.point-row.evaluation.actual),percentages=rows.filter(row=>row.evaluation.actual>0).map(row=>Math.abs(row.point-row.evaluation.actual)/row.evaluation.actual);
  const paired=rows.filter(row=>row.baseline),baselineMAE=paired.length?mae(paired):null,pairedMAE=paired.length?mean(paired.map(row=>Math.abs(row.point-row.evaluation.actual))):null;
  return {...group,n:rows.length,mae:rows.length?mean(errors.map(Math.abs)):null,bias:rows.length?mean(errors):null,
   rmse:rows.length?Math.sqrt(mean(errors.map(value=>value**2))):null,mape:percentages.length?mean(percentages):null,percentageN:percentages.length,
   coverage:rows.length?mean(rows.map(row=>Number(row.evaluation.actual>=row.low && row.evaluation.actual<=row.high))):null,
   baselineMAE,pairedMAE,pairedN:paired.length,improvement:baselineMAE>0?(baselineMAE-pairedMAE)/baselineMAE:null};
 });
}
