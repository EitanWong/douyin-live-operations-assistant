import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {mergeLiveMemory} from '../../src/ai/live-memory.js';
import {supportContext} from '../../src/ai/support-context.js';
import {rankAccountTargets} from '../../src/services/account-targets.js';
import {resolveResearchProfile} from '../../src/ai/research-profile.js';
const now=1800000000000,day=86400000;
const event=(id,extra={})=>({source:'socket',type:'gift',roomId:'1',id,receivedAt:now,user:{id:'2',name:'同名',secUid:'viewer_2',wealthLevel:45,fanClubs:[{anchorId:'10',level:16}]},giftName:'花',count:1,unitValue:300,...extra});
test('画像使用全部近期礼物下限、累计连击去重和本房等级，恢复后仍可按问题披露',()=>{
 const memory=new AudienceMemory({anchor:'10',now:()=>now});
 for(let i=0;i<4;i++)memory.observe(event(`g${i}`));
 memory.observe(event('g3',{count:2}));memory.observe(event('unknown',{count:7,unitValue:null}));
 const restored=new AudienceMemory({anchor:'10',state:memory.snapshot(),now:()=>now});
 const context=restored.context({id:'2'},'花');
 assert.equal(context.profile.gifts.knownDiamonds,1500);assert.equal(context.profile.gifts.count,12);
 assert.equal(context.profile.gifts.unknownPriceCount,7);assert.equal(context.profile.research.tier,'deep');
 assert.equal(context.profile.platform.honor.value,45);assert.equal(context.profile.platform.fan.value,16);
 assert.equal(context.recentGifts.length,3);
 const support=supportContext({memory:context},{kind:'ai'},{assistant:{memoryEnabled:true}},now);
 assert.equal(support.knownRecentDiamonds,1500);assert.equal(support.partial,true);
 assert.equal(support.platform.honor.value,45);
 assert.equal(restored.context({id:'3'}),null);
});
test('等级逐字段按观测时间合并，不把旧等级、他房粉丝或未来记录用于研究优先级',()=>{
 const memory=new AudienceMemory({anchor:'10',now:()=>now});
 memory.observe(event('enter',{type:'enter',user:{id:'2',wealthLevel:45,fanClubs:[{anchorId:'99',level:30}]}}));
 const archive=()=>({version:1,anchor:'10',audience:memory.snapshot(),perception:{observations:[]}}),old=archive();
 memory.observe(event('chat',{type:'chat',text:'茶杯怎么清洗',receivedAt:now+1,user:{id:'2'}}));
 const merged=mergeLiveMemory(old,archive());
 const context=new AudienceMemory({anchor:'10',state:merged.audience,now:()=>now+2}).context({id:'2'});
 assert.equal(context.profile.platform.honor.value,45);assert.equal(context.profile.platform.fan,null);
 assert.equal(new AudienceMemory({anchor:'10',state:merged.audience,now:()=>now+2*day}).context({id:'2'}).profile.research.tier,'standard');
 memory.forget('uid:2');assert.equal(memory.context({id:'2'}),null);
});
test('公开账号优先级保留未知单价中的已知下限，并使用无冲突的持久账号标识和等级',()=>{
 const memory=new AudienceMemory({anchor:'10',now:()=>now});
 memory.observe(event('known'));memory.observe(event('unknown',{unitValue:null}));
 memory.observe(event('high',{type:'enter',user:{id:'3',secUid:'viewer_3',wealthLevel:50}}));
 const rows=rankAccountTargets({now,audience:memory.snapshot().viewers});
 assert.equal(rows.length,2);assert.equal(rows.find(r=>r.url.endsWith('viewer_2')).observedDiamonds,300);
 assert.equal(rows.find(r=>r.url.endsWith('viewer_3')).reason,'observed-level');
 const conflict=rankAccountTargets({now,audience:memory.snapshot().viewers,profiles:[{id:'9',secUid:'viewer_2'}]});
 assert.ok(!conflict.some(r=>r.url.endsWith('viewer_2')));
});
test('长画像只披露当前问题所需片段，为每轮研究证据留出固定预算',async()=>{
 const memory=new AudienceMemory({anchor:'10',now:()=>now});
 for(let i=0;i<4;i++){memory.observe(event(`c${i}`,{type:'chat',text:'陶瓷茶杯清洗。'.repeat(1000)}));memory.annotate('uid:2','核实补充'.repeat(100));}
 const resolved=await resolveResearchProfile({room:'1',anchor:'10',subject:'uid:2',ai:{},question:'陶瓷茶杯',now,read:async key=>key.includes('live-memory') ? {anchor:'10',audience:memory.snapshot()} : null});
 assert.ok(JSON.stringify(resolved.profile).length<=2200);
 assert.equal(memory.snapshot().viewers[0].statements[0].text.length,7000);
});
test('遗忘后重新观测的同一账号不能承接旧队列中的人物任务',async()=>{
 let clock=now;const memory=new AudienceMemory({anchor:'10',now:()=>clock});
 memory.observe(event('old',{type:'enter'}));memory.forget('uid:2');clock++;
 memory.observe(event('new',{type:'enter',receivedAt:clock}));
 await assert.rejects(resolveResearchProfile({room:'1',anchor:'10',subject:'uid:2',epoch:0,ai:{},question:'旧问题',read:async()=>({anchor:'10',audience:memory.snapshot()})}),/人物|画像|观众/);
});
