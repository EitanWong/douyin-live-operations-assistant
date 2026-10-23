import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LiveMetrics} from '../../src/runtime/live-metrics.js';
import {Engine, mergeConfig} from '../../src/core/engine.js';
import {pkChartOptions} from '../../src/ui/live-charts.js';

test('直播活动按10秒分桶，连击只算增量，未知礼物不伪造钻石',()=>{
  let now=1800000000000;const metrics=new LiveMetrics({now:()=>now});
  const gift={type:'gift',roomId:'room',groupId:'combo',giftId:'rose',user:{id:'u'},unitValue:10,receivedAt:now};
  for(const count of [1,2,2,3])metrics.ingest({...gift,count});
  metrics.ingest({type:'gift',groupId:'unknown',count:2,receivedAt:now});
  metrics.ingest({type:'chat',receivedAt:now});metrics.ingest({type:'enter',receivedAt:now});metrics.ingest({type:'like',count:30,receivedAt:now});
  assert.deepEqual(metrics.snapshot().buckets,[{at:now,chat:1,enter:1,like:30,gift:5,diamonds:30,unknownGifts:2}]);
  const restored=new LiveMetrics({now:()=>now});restored.restore(metrics.snapshot());
  restored.ingest({...gift,count:4});assert.equal(restored.snapshot().buckets[0].gift,6);
  now+=610000;assert.equal(restored.snapshot().buckets.length,0);assert.equal(restored.combos.size,0);
});

test('暂停时仍采集活动，重复事件不增加，PK快通道不阻塞普通消息',()=>{
  const now=1800000000000,engine=new Engine({config:mergeConfig({anchorId:'10'}),now:()=>now});
  const chat={type:'chat',id:'chat',roomId:'room',text:'加油',receivedAt:now};
  engine.ingest(chat);engine.ingest(chat);
  assert.equal(engine.liveMetrics.snapshot().buckets[0].chat,1);assert.equal(engine.pk.states.size,0);
  const pk={type:'pk-score',id:'score',battleId:'battle',roomId:'room',scores:[{anchorId:'10',score:100},{anchorId:'20',score:200}],receivedAt:now};
  assert.equal(engine.ingestPK(pk),true);engine.ingest(pk);
  assert.equal(engine.pk.current().dataQuality.scoreSamples,1);
  const board={type:'pk-contribution',id:'board',battleId:'battle',roomId:'room',anchorId:'20',contributors:[{user:{id:'u',name:'对方大哥'},score:200}],receivedAt:now};
  engine.ingestPK(board);engine.ingest(board);
  assert.equal(engine.pk.current().opponentUsers[0].score,200);assert.equal(engine.pk.current().selfUsers.length,0);
  assert.equal(engine.queue.length,0);
});

test('图表保留未知侧空值、精确分差和时间窗口的前一基线',()=>{
  const now=1000000;
  const options=pkChartOptions({trend:[{at:now-120000,selfScore:10,opponentScore:null},{at:now-70000,selfScore:20,opponentScore:5},{at:now-30000,selfScore:40,opponentScore:50}]},{now,windowMs:60000});
  assert.deepEqual(options.scores.series[0].data,[[now-70000,20],[now-30000,40]]);
  assert.deepEqual(options.gap.series[0].data,[[now-70000,15],[now-30000,-10]]);
  const partial=pkChartOptions({trend:[{at:now,selfScore:10,opponentScore:null}]},{now});
  assert.equal(partial.scores.series[1].data[0][1],null);assert.equal(partial.gapCount,0);
  assert.equal(partial.scores.tooltip.renderMode,'richText');
});

test('多人比分图按每位参战主播绘制独立走势并保留未知分数空值',()=>{
  const now=1000000;
  const options=pkChartOptions({competitors:[{anchorId:'a',name:'甲'},{anchorId:'b',name:'乙'},{anchorId:'c',name:'丙'}],trend:[
    {at:now-1000,competitorScores:{a:100,b:80}},
    {at:now,competitorScores:{a:120,b:90,c:75}}
  ]},{now,windowMs:60000});
  assert.equal(options.scores.series.length,3);
  assert.deepEqual(options.scores.series.map(series=>series.name),['甲','乙','丙']);
  assert.deepEqual(options.scores.series[2].data,[[now-1000,null],[now,75]]);
  assert.deepEqual(options.gap.series[0].data,[[now-1000,null],[now,null]]);
});

test('没有PK时活动图仍使用自身时间轴，贡献分排序不使用礼物钻石替代',()=>{
  const now=1000000;
  const options=pkChartOptions({activity:{buckets:[{at:now-20000,chat:3,enter:1,gift:2}]},selfUsers:[{id:'gift-only',value:10000},{id:'score',name:'实名',score:20,value:0}],opponentUsers:[{name:'对方',score:50}]},{now});
  assert.equal(options.contributorCount,2);assert.equal(options.contributions.series[0].data.at(-1).value,50);
  assert.equal(options.activity.xAxis.min,now-20000);assert.deepEqual(options.activity.series[0].data,[[now-20000,3],[now-10000,0],[now,0]]);
});

test('各图表独立调整刻度密度，紧凑视图保留全部样本与贡献者',()=>{
  const now=1000000,data={trend:[{at:now,selfScore:20,opponentScore:null}],selfUsers:Array.from({length:8},(_,i)=>({name:`观众${i}`,score:i+1}))};
  const compact=pkChartOptions(data,{now,widths:{scores:280,gap:300,activity:280,contributions:280}});
  const wide=pkChartOptions(data,{now,widths:{scores:760,gap:400,activity:760,contributions:500}});
  assert.equal(compact.scores.xAxis.splitNumber,2);assert.equal(wide.scores.xAxis.splitNumber,6);
  assert.equal(wide.gap.xAxis.splitNumber,4);
  assert.ok(compact.contributions.yAxis.axisLabel.width<wide.contributions.yAxis.axisLabel.width);
  assert.equal(compact.contributorCount,8);
  assert.deepEqual(compact.scores.series,wide.scores.series);
  assert.equal(compact.scores.series[1].data[0][1],null);
});
