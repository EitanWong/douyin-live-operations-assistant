import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeMessage, decodeFrame} from '../../src/browser/protocol.js';

const cat=(...values)=>Buffer.concat(values.map(Buffer.from));
const v=value=>{let n=BigInt(value);const out=[];while(n>127n){out.push(Number(n&127n)|128);n>>=7n;}out.push(Number(n));return Buffer.from(out);};
const i=(field,value)=>cat(v(field*8),v(value));
const b=(field,value)=>{const bytes=Buffer.from(value);return cat(v(field*8+2),v(bytes.length),bytes);};
const room='7702463172476701483',lottery='7702514039720839955',user='9007199254740993123';
const common=b(1,i(3,room));

test('福袋开局保留真实轮次、时间及条件原码，不推断未知条件',()=>{
  const event=decodeMessage('WebcastLotteryEventNewMessage',cat(common,i(2,lottery),i(3,1),i(4,1793382000),i(5,1793382447),
    b(10,cat(v(3),v(6))),i(10,99),i(13,30),i(14,3),b(18,'钻石'),
    b(21,cat(i(1,3),b(2,'示例口令'))),b(21,i(1,6))), '9007199254740993999');
  assert.equal(event.type,'activity-signal');assert.equal(event.activityKind,'lottery-start');
  assert.equal(event.lotteryId,lottery);assert.equal(event.roomId,room);assert.equal(event.id,'9007199254740993999');
  assert.equal(event.startedAt,'1793382000');assert.equal(event.drawAt,'1793382447');
  assert.deepEqual(event.conditionTypes,['3','6','99']);assert.equal(event.conditions[0].content,'示例口令');
  assert.equal(event.conditions[1].typeRaw,'6');assert.equal(event.prizeCount,'30');assert.equal(event.luckyCount,'3');
});

test('本人候选回执区分 true、false、缺失与未知编码，版本和 UID 保持字符串',()=>{
  for(const [value,expected] of [[null,null],[0,false],[1,true],[2,null]]) {
    const event=decodeMessage('WebcastLotteryCandidateEventMessage',cat(common,i(2,lottery),i(3,user),
      ...(value===null?[]:[i(4,value)]),i(5,'1793382031399')));
    assert.equal(event.activityKind,'lottery-candidate');assert.equal(event.lotteryId,lottery);
    assert.equal(event.userId,user);assert.equal(event.participateSuccess,expected);assert.equal(event.version,'1793382031399');
    assert.equal(event.at,0,'version 不能用作消息时间');
  }
});

test('开奖支持 packed/unpacked ID 并保留人数差异，不输出通用中奖结论',()=>{
  const event=decodeMessage('WebcastLotteryDrawResultEventMessage',cat(common,i(2,lottery),
    b(3,cat(v(user),v('9223372036854775807'))),i(3,42),b(4,'{"candidate_num":25}')));
  assert.deepEqual(event.reportedUserIds,[user,'9223372036854775807','42']);assert.equal(event.candidateCount,'25');
  assert.equal(event.lotteryId,lottery);assert.equal('won' in event,false);
  for(const extra of ['{"candidate_num":1.5}','{"candidate_num":-1}','bad']) {
    assert.equal(decodeMessage('WebcastLotteryDrawResultEventMessage',cat(common,b(4,extra))).candidateCount,null);
  }
});

test('畸形 packed 名单只隔离坏消息，后续本人成功回执仍被解码',async()=>{
  const message=(method,body,id)=>b(1,cat(b(1,method),b(2,body),i(3,id)));
  const raw=cat(message('WebcastLotteryDrawResultEventMessage',cat(common,i(2,lottery),b(3,Buffer.from([128]))),11),
    message('WebcastLotteryCandidateEventMessage',cat(common,i(2,lottery),i(3,user),i(4,1),i(5,100)),12));
  const events=await decodeFrame(raw);
  assert.equal(events.length,1);assert.equal(events[0].id,'12');assert.equal(events[0].participateSuccess,true);
});
