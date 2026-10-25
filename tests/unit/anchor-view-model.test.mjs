import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectAnchorPeriod} from '../../src/ui/anchor-view-model.js';
const at = text => Date.parse(`2026-10-${text}+08:00`);
const session = (id, start, end = 0) => ({id,startAt:at(start),endAt:end ? at(end) : 0});
const battle = (id, start, end) => ({battleKey:id,startedAt:at(start),endedAt:at(end),phase:'ended',score:100,scoreFinal:true,outcome:'win'});

test('同一天多次开播分别统计，跨午夜 PK 按开局归属原场次，不纳入下播后的空档',()=>{
  const first=session('A','22T23:00:00','23T01:00:00'), second=session('B','23T08:00:00','23T10:00:00'), current=session('C','23T12:00:00');
  const income={allSessions:[first,second,current],currentSession:current};
  const report={battles:[battle('overnight','22T23:59:00','23T00:05:00'),battle('late-result','23T00:59:00','23T01:01:00'),battle('gap','23T01:00:00','23T01:02:00'),battle('morning','23T08:00:00','23T08:05:00'),battle('noon','23T12:00:00','23T12:05:00')]};
  assert.deepEqual(selectAnchorPeriod(report,'session',income).rows.map(row=>row.battleKey),['noon']);
  assert.deepEqual(selectAnchorPeriod(report,'session',income,'A').rows.map(row=>row.battleKey),['overnight','late-result']);
  const recent=selectAnchorPeriod(report,'7',income);
  assert.equal(recent.sessions.length,3);assert.equal(recent.summary.battles,4);
  assert.deepEqual(recent.trend.map(row=>row.battles),[2,1,1]);
  assert.equal(selectAnchorPeriod(report,'all',income).summary.battles,5,'累计保留未关联的历史 PK');
});

test('近七场按场次数取样，零礼物直播计一场，月份和日期不参与筛选',()=>{
  const allSessions=Array.from({length:9},(_,i)=>({id:String(i),startAt:at('23T12:00:00')-i*3600000,endAt:i ? at('23T12:30:00')-i*3600000 : 0}));
  const report={battles:allSessions.map(row=>({...battle(row.id,'23T12:00:00','23T12:05:00'),startedAt:row.startAt+1000}))};
  const recent=selectAnchorPeriod(report,'7',{allSessions,currentSession:allSessions[0]});
  assert.equal(recent.sessions.length,7);assert.equal(recent.rows.length,7);
  assert.equal(recent.sessions.at(-1).id,'6');
});
