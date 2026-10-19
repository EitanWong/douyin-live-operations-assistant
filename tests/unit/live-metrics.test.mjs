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

test('没有PK时活动图仍使用自身时间轴，贡献分排序不使用礼物钻石替代',()=>{
  const now=1000000;
  const options=pkChartOptions({activity:{buckets:[{at:now-20000,chat:3,enter:1,gift:2}]},selfUsers:[{id:'gift-only',value:10000},{id:'score',name:'实名',score:20,value:0}],opponentUsers:[{name:'对方',score:50}]},{now});
  assert.equal(options.contributorCount,2);assert.equal(options.contributions.series[0].data.at(-1).value,50);
  assert.equal(options.activity.xAxis.min,now-20000);assert.deepEqual(options.activity.series[0].data,[[now-20000,3],[now-10000,0],[now,0]]);
});
