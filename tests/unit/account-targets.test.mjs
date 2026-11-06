import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankAccountTargets} from '../../src/services/account-targets.js';

const now=1800000000000;
const viewer=(key,chats=0,gifts=[])=>({key,lastAt:now,statements:Array.from({length:chats},(_,i)=>({id:String(i),at:now,text:'交流'})),gifts});
test('research ranks a verified anchor, observed gifts and frequent chat without guessing a profile from a nickname or wealth level',()=>{
 const result=rankAccountTargets({now,anchor:{secUid:'host'},profiles:[{id:'1',secUid:'donor'},{id:'2',secUid:'chatty'},{id:'3',name:'同名',wealthLevel:99}],
  audience:[viewer('uid:1',0,[{key:'g',count:2,unitDiamonds:100,at:now}]),viewer('uid:2',5),viewer('uid:3',20)]});
 assert.deepEqual(result.map(r=>r.url),['https://www.douyin.com/user/host','https://www.douyin.com/user/donor','https://www.douyin.com/user/chatty']);
 assert.equal(result[1].observedDiamonds,200);assert.equal(result[2].chatCount,5);
});
test('replayed chat and cumulative gifts do not inflate priority, stale activity and ambiguous IDs do not select a person',()=>{
 const result=rankAccountTargets({now,profiles:[{id:'1',secUid:'a'},{id:'2',secUid:'b'},{id:'2',secUid:'wrong'},{id:'3',secUid:'old'}],audience:[
  {...viewer('uid:1',0,[{key:'g',count:2,unitDiamonds:30,at:now},{key:'g',count:3,unitDiamonds:30,at:now}]),statements:Array(5).fill({id:'same',at:now,text:'同一句'})},
  viewer('uid:2',10),{...viewer('uid:3',20),lastAt:now-31*86400000}
 ]});
 assert.deepEqual(result,[],'90 diamonds and one unique message are below thresholds; ambiguous and stale viewers are skipped');
});
test('unknown gift prices stay unknown and the result limit includes the anchor',()=>{
 const result=rankAccountTargets({now,anchor:{secUid:'host'},limit:1,profiles:[{secUid:'viewer'}],audience:[viewer('sec:viewer',5,[{key:'g',count:999,unitDiamonds:null,at:now}])]});
 assert.equal(result.length,1);assert.equal(result[0].role,'anchor');
 const unknown=rankAccountTargets({now,profiles:[{secUid:'viewer'}],audience:[viewer('sec:viewer',5,[{key:'g',count:999,unitDiamonds:null,at:now}])]})[0];
 assert.equal(unknown.observedDiamonds,null);assert.equal(unknown.reason,'frequent-chat');
});

test('公开评论和回复按稳定账号扩展两层，不按昵称寻人，不跨身份冲突继续扩展',()=>{
 const record=(actor,depth=0)=>({kind:'comment',actor,researchDepth:depth,observedAt:now});
 const publicRecords=[record({uid:'7',secUid:'related',name:'相关人'}),record({secUid:'third',name:'第三层'},2),record({name:'仅昵称'}),record({uid:'9',secUid:'conflict'}),record({uid:'9',secUid:'other'})];
 const result=rankAccountTargets({now,anchor:{secUid:'host'},publicRecords});
 assert.deepEqual(result.map(r=>r.url),['https://www.douyin.com/user/host','https://www.douyin.com/user/related']);
 assert.equal(result[1].depth,1);assert.equal(result[1].reason,'public-interaction');
});
