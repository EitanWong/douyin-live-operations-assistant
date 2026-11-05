import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { wire } from '../../src/browser/protocol.js';
import { analyzeLotteryCaptures, decodeLotteryPayload, extractMessages, repeatedInt64 } from '../../scripts/analyze-lottery-capture.mjs';

const cat=(...values)=>Buffer.concat(values.map(x=>Buffer.from(x)));
const v=value=>{let n=BigInt(value),out=[];while(n>127n){out.push(Number(n&127n)|128);n>>=7n;}out.push(Number(n));return Buffer.from(out);};
const i=(n,value)=>cat(v(n*8),v(value));
const b=(n,value)=>{const bytes=Buffer.from(value);return cat(v(n*8+2),v(bytes.length),bytes);};
const room='9007199254740993010',lottery='9007199254740993011',uid='9007199254740993012';
const common=(roomId=room)=>cat(i(3,roomId));
const message=(method,body,id='9007199254740993020')=>cat(b(1,method),b(2,body),i(3,id));
const record=(raw,receivedAt=100,transport='socket')=>({rawBase64:raw.toString('base64'),rawBytes:raw.length,receivedAt,transport});
const response=(...messages)=>cat(...messages.map(x=>b(1,x)));
const candidate=(success=1,version=100,userId=uid,roomId=room)=>cat(b(1,common(roomId)),i(2,lottery),i(3,userId),...(success===null?[]:[i(4,success)]),i(5,version));

test('capture unpacking distinguishes HTTP heartbeat integers from gzip PushFrame payloads',()=>{
  const msg=message('WebcastLotteryCandidateEventMessage',candidate());
  const inner=response(msg),push=cat(b(6,'gzip'),b(7,'msg'),b(8,gzipSync(inner)));
  const poll=cat(inner,b(5,'opaque internal extension'),i(8,10));
  for(const saved of [record(push),record(poll,100,'http-poll')]){
    const [m]=extractMessages(saved);
    assert.equal(m.messageId,'9007199254740993020');assert.equal(m.method,'WebcastLotteryCandidateEventMessage');
    assert.equal(decodeLotteryPayload(m.method,m.body,m.messageId).userId,uid);
  }
});

test('start payload preserves conditions and IDs without translating unknown condition enums',()=>{
  const body=cat(b(1,common()),i(2,lottery),i(3,1),i(4,1000),i(5,1180),b(10,cat(v(3),v(6))),i(10,99),
    b(11,cat(b(1,'participate_type'),b(2,'password'))),i(13,30),i(14,3),b(18,'钻石'),
    b(21,cat(i(1,3),b(2,'示例口令'))),b(21,i(1,6)));
  const e=decodeLotteryPayload('WebcastLotteryEventNewMessage',body);
  assert.equal(e.lotteryId,lottery);assert.deepEqual(e.conditionTypes,['3','6','99']);
  assert.equal(e.conditions[0].content,'示例口令');assert.equal(e.conditions[1].typeRaw,'6');
  assert.equal(e.extra.participate_type,'password');assert.equal(e.drawAtSeconds,'1180');assert.equal(e.awardName,'钻石');
});

test('candidate success distinguishes absent, true and false, retaining version as a string',()=>{
  for(const [raw,expected]of[[null,null],[0,false],[1,true]]){
    const e=decodeLotteryPayload('WebcastLotteryCandidateEventMessage',candidate(raw,'1793126730191'));
    assert.equal(e.participateSuccess,expected);assert.equal(e.version,'1793126730191');
    assert.equal('timestamp'in e,false);assert.equal('at'in e,false);
  }
  assert.equal(decodeLotteryPayload('WebcastLotteryCandidateEventMessage',b(4,'unrecognized')).participateSuccess,null);
});

test('result handles packed and unpacked int64 IDs and preserves count disagreement',()=>{
  const body=cat(b(1,common()),i(2,lottery),b(3,cat(v(uid),v('9223372036854775807'))),i(3,42),b(4,'{"candidate_num":146}'));
  const e=decodeLotteryPayload('WebcastLotteryDrawResultEventMessage',body);
  assert.deepEqual(e.reportedUserIds,[uid,'9223372036854775807','42']);assert.equal(e.candidateCount,'146');
  assert.throws(()=>repeatedInt64(wire(b(3,Buffer.from([128]))),3),/Truncated/);
  assert.throws(()=>repeatedInt64(wire(b(3,Buffer.from([...Array(9).fill(255),2]))),3),/overflow/);
});

test('rounds match the current UID, deduplicate transports, and ignore stale candidate versions',async()=>{
  const one=message('WebcastLotteryCandidateEventMessage',candidate(1,200),'100');
  const stale=message('WebcastLotteryCandidateEventMessage',candidate(0,100),'101');
  const other=message('WebcastLotteryCandidateEventMessage',candidate(1,300,'77'),'102');
  const secondRoom=message('WebcastLotteryCandidateEventMessage',candidate(0,200,uid,'88'),'103');
  const capture={room:'123',collection:{protocolFrames:[record(response(one),100),record(response(one),101,'http-poll'),
    record(response(stale),102),record(response(other),103),record(response(secondRoom),104)]}};
  const result=await analyzeLotteryCaptures([capture],{selfUid:uid});
  assert.equal(result.errors.length,0);assert.equal(result.uniqueEvidenceCount,4);assert.equal(result.events[0].occurrences.length,2);
  assert.equal(result.rounds.length,2);
  const round=result.rounds.find(r=>r.roomId===room);assert.equal(round.selfParticipation,true);assert.equal(round.selfCandidateVersion,'200');
  assert.equal(result.rounds.find(r=>r.roomId==='88').selfParticipation,false);
  const unknown=await analyzeLotteryCaptures([capture],{selfUid:'999'});assert.equal(unknown.rounds[0].selfParticipation,null);
});

test('toast text and runtime snapshots supply evidence without assigning a toast to a lottery',async()=>{
  const text=cat(b(1,'live_plain_text'),b(2,'{0:string}'),b(4,cat(i(1,1),b(11,'已成功参与福袋，开奖前勿离开直播间'))));
  const toast=message('WebcastCommonToastMessage',cat(b(1,cat(common(),b(8,text))),i(4,3)));
  const capture={collection:{protocolFrames:[record(response(toast))]},runtime:{roomData:{activities:[{id:'123',roomId:room,
    receivedAt:90,syncType:'LotteryInfoSyncData',syncDetails:{lotteryId:lottery,prizeCount:'30',luckyCount:'3',candidateCount:'15',startedAt:'1',drawAt:'181'}}]}}};
  const result=await analyzeLotteryCaptures([capture],{selfUid:uid});
  assert.equal(result.successToastMessageIds.length,1);assert.equal(result.rounds[0].selfParticipation,null);
  assert.equal(result.rounds[0].candidateCounts[0].count,'15');
  assert.equal(result.events.find(e=>e.kind==='toast').lotteryId,undefined);
});

test('a damaged message or frame does not suppress later candidate evidence',async()=>{
  const good=message('WebcastLotteryCandidateEventMessage',candidate());
  const raw=response(Buffer.from([0]),good),badRecord={...record(raw),rawBytes:1};
  const result=await analyzeLotteryCaptures([{collection:{protocolFrames:[badRecord,record(raw)]}}],{selfUid:uid});
  assert.equal(result.errors.length,2);assert.equal(result.rounds[0].selfParticipation,true);
});
