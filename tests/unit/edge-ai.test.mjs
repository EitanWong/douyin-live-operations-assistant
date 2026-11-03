import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeEdgeMessages,fitEdgeMessages,acceptPerformance,acceptChineseSelfTest,decodePCM16} from '../../src/ai/edge-prompt.js';
import {createEdgeClient} from '../../src/browser/edge-client.js';
test('local short context retains question, current evidence and boundaries within budget',()=>{
 const messages=makeEdgeMessages({target:{text:'蓝色怎么搭？'},maxLength:40,knowledge:'蓝配白。',context:[{text:'x'.repeat(30000)}]},{});
 assert.ok(JSON.stringify(messages).length<7000);assert.match(messages.at(-1).content,/蓝色怎么搭/);assert.match(messages[0].content,/未知|编造/);
 assert.equal(acceptPerformance({firstTokenMs:500,tokensPerSecond:20,totalMs:1000}),'ready');
 assert.equal(acceptPerformance({firstTokenMs:2500,tokensPerSecond:3,totalMs:9000}),'slow');
 assert.throws(()=>decodePCM16('not-wav'),/音频/);
});
test('edge context keeps aggregate live facts, PK and target identity even when histories are large',async()=>{
 const messages=makeEdgeMessages({target:{name:'小鱼',address:'小鱼',text:'现在领先多少分'},task:{kind:'ai'},liveContext:{income:{totalDiamonds:100,dailyHistory:Array.from({length:31},()=>({note:'历史'.repeat(1000)}))},pk:{selfScore:200,opponentScore:180,remainingMs:5000,estimates:{analysis:{gap:20}}},audience:{online:50}},accountContext:[{content:'资料'.repeat(500),source:'https://www.douyin.com/user/test'}]},{});
 const data=JSON.parse(messages[1].content);assert.equal(data.live_context.income.totalDiamonds,100);assert.equal(data.live_context.pk.selfScore,200);assert.equal(data.target.address,'小鱼');assert.equal(data.live_context.pk.scoreSummary,'己方领先20分');
 const fitted=await fitEdgeMessages(messages,async rows=>JSON.stringify(rows).length,1000);
 assert.ok(JSON.stringify(fitted).length<=1000);assert.equal(JSON.parse(fitted[1].content).live_context.income.totalDiamonds,100);
});
test('edge bridge never downloads on ready and cancellation is forwarded once',async()=>{
 const sent=[],listeners=[];const client=createEdgeClient({connect:()=>({postMessage:m=>{sent.push(m);if(m.action==='status')queueMicrotask(()=>listeners.forEach(fn=>fn({id:m.id,value:{text:{phase:'ready'}}})));},onMessage:{addListener:fn=>listeners.push(fn)},onDisconnect:{addListener(){}},disconnect(){}})});
 assert.equal(await client.ready('text'),true);assert.equal(sent[0].action,'status');
 const c=new AbortController();const work=client.reply({signal:c.signal,target:{text:'你好'},maxLength:30},{});c.abort();await assert.rejects(work,/取消/);assert.equal(sent.filter(x=>x.action==='cancel').length,1);client.close();
});

test('edge score summaries compute observed differences and leave stale or unknown scores uncalculated',()=>{
 const data=pk=>JSON.parse(makeEdgeMessages({target:{text:'分差多少'},liveContext:{pk}},{}).at(-1).content).live_context.pk;
 assert.equal(data({selfScore:12,opponentScore:35}).scoreSummary,'己方落后23分');
 assert.equal(data({selfScore:0,opponentScore:0}).scoreSummary,'当前持平');
 assert.equal(data({selfScore:12,opponentScore:null}).scoreSummary,null);
 assert.equal(data({selfScore:12,opponentScore:10,stale:true}).scoreSummary,null);
});

test('local readiness requires the known Chinese fact check as well as token speed',()=>{
 assert.equal(acceptChineseSelfTest('蓝色。'),true);
 assert.equal(acceptChineseSelfTest('蓝色'),true);
 assert.equal(acceptChineseSelfTest('红色'),false);
 assert.equal(acceptChineseSelfTest('"{}!!!!!!!!!!!!!!!!!!!!'),false);
 assert.equal(acceptChineseSelfTest(''),false);
});
