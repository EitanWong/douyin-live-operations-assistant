import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import {IDBFactory,IDBKeyRange} from 'fake-indexeddb';
import {AnalyticsArchive} from '../src/analytics/archive.js';
import {seedPredictionDemo} from '../src/analytics/demo.js';
import {forecastReport} from '../src/analytics/forecast.js';
import {predictionChartOptions} from '../src/ui/prediction-charts.js';
const archive=new AnalyticsArchive({indexedDB:new IDBFactory(),IDBKeyRange}),context={room:'demo',anchor:'2'},now=Date.now();
try{
 await seedPredictionDemo(archive,context,now);const data=await archive.read(context,now),times=[];
 for(let i=0;i<116;i++){
  const start=performance.now(),r=forecastReport(data);r.timeline=data.minutes;r.sessions=data.sessions;predictionChartOptions(r);
  if(i>=16)times.push(performance.now()-start);
 }
 times.sort((a,b)=>a-b);const percentile=p=>times[Math.floor((times.length-1)*p)];
 const result={measuredAt:new Date().toISOString(),runtime:process.version,platform:process.platform,arch:process.arch,fixture:{simulated:true,minutes:data.minutes.length,users:data.users.length,completeSessions:data.sessions.filter(s=>s.complete).length,paths:192},samples:times.length,warmup:16,scope:'Pure numeric forecast plus seven chart option generation; excludes IndexedDB, DOM, rendering and language-model inference',milliseconds:{p50:percentile(.5),p95:percentile(.95),max:times.at(-1)},accuracy:'Not measured. Synthetic fixtures verify behavior and latency only; no production accuracy or device-wide guarantee.'};
 const path=new URL('../docs/reviews/live-prediction-benchmarks-2026-11-03.json',import.meta.url);await writeFile(path,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{archive.close();}
