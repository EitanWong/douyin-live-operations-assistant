import {test} from 'node:test';
import assert from 'node:assert/strict';
import {offlineReply} from '../../src/ai/offline-reply.js';
import {mergeConfig} from '../../src/core/engine.js';
const answer=(text,liveContext={},config=mergeConfig())=>offlineReply({event:{type:'chat',text},task:{kind:'ai',data:{replyMode:'direct'}},config,liveContext,unavailable:true});
test('离线仅回答来源开启且未过期的确切在线/本场钻石值，零有效、待入账明示',()=>{
 assert.equal(answer('现在在线多少人？',{audience:{online:0}}).text,'当前已采集在线0人。');
 assert.equal(answer('本场收了多少钻石',{income:{totalDiamonds:500,pending:2}}).text,'本场已采集500钻，还有待入账。');
 for(const income of [null,{totalDiamonds:null},{totalDiamonds:500,stale:true}])assert.doesNotMatch(answer('本场收了多少钻石',{income}).text,/500|0钻/);
 assert.doesNotMatch(answer('本场收了多少钻石',{income:{totalDiamonds:500}},mergeConfig({ai:{contextSources:{income:false}}})).text,/500/);
 assert.doesNotMatch(answer('昨天收了多少钻石',{income:{totalDiamonds:500}}).text,/500/);
});
test('故障不抢其他人的对话，语音自言自语不回应，资料不足时不编造答案',()=>{
 const base={config:mergeConfig(),unavailable:true};
 assert.equal(offlineReply({...base,event:{type:'chat',text:'你好'},task:{kind:'ai',data:{replyMode:'direct',addressedToOther:true}}}),null);
 assert.equal(offlineReply({...base,event:{type:'speech',text:'我先把东西放好'},task:{kind:'ai'}}),null);
 assert.match(answer('这件衣服多少钱').text,/还不能确认/);
});
