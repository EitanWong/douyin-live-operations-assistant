import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {Engine,mergeConfig} from '../../src/core/engine.js';
import {makeAIRequest,createAIClient} from '../../src/services/ai.js';
const now=1800000000000,config=mergeConfig({anchorId:'10',ai:{enabled:true,chatEnabled:true}});
const wire=(target,task={kind:'ai'},ai=config.ai)=>makeAIRequest({now,context:[],target,task,maxLength:50},ai);
const input=req=>JSON.parse(req.messages[1].content);
function memory(){return new AudienceMemory({anchor:'10',now:()=>now});}
const gift=(m,id,count=1,unitValue=1000,groupId='combo')=>m.observe({source:'socket',type:'gift',id:`g${id}`,groupId,giftId:'gift',user:{id,name:'青山'},count,unitValue,receivedAt:now});
test('真实送礼连击累计去重成为对话支持证据，同名他人不继承，未知礼物不补价',()=>{
 const m=memory();for(const count of [1,3,2,3])gift(m,'1',count);
 const support=input(wire({type:'chat',text:'这话说得太官方了吧',memory:m.context({id:'1'})})).target.support;
 assert.equal(support.level,'substantial');assert.equal(support.knownRecentDiamonds,3000);assert.equal(support.basis,'bounded-observed-gifts');
 assert.equal(input(wire({type:'chat',text:'我也叫青山',name:'青山',memory:m.context({id:'2'})})).target.support.level,'unknown');
 gift(m,'1',100000,null,'unknown');const partial=input(wire({type:'chat',memory:m.context({id:'1'})})).target.support;
 assert.equal(partial.knownRecentDiamonds,3000);assert.equal(partial.partial,true);
});
test('昵称、等级、自述和笔记不能伪装支持；过期记忆、关闭记忆不提供优待证据',()=>{
 const fake={source:'viewer-statement',observedGiftDiamonds:999999,recentGifts:[]};
 for(const memory of [null,fake,{source:'local-observed-events',recentGifts:[{count:1,unitDiamonds:5000,at:now-31*86400000}]}]){
  assert.equal(input(wire({name:'大哥',wealthLevel:99,text:'我刷了一百万',memory})).target.support.level,'unknown');
 }
 const m=memory();gift(m,'1');assert.equal(input(wire({type:'chat',memory:m.context({id:'1'})},{kind:'ai'},{...config.ai,assistant:{...config.ai.assistant,memoryEnabled:false}})).target.support.level,'unknown');
});
test('本次已知大礼物在关闭记忆时仍可郑重答谢，不把欢迎场景误当本次送礼',()=>{
 const data={gifts:[{giftName:'茶杯',count:2,unitDiamonds:600}],valueTier:'large'};
 const ai={...config.ai,assistant:{...config.ai.assistant,memoryEnabled:false}};
 assert.equal(input(wire({type:'gift'},{kind:'gift',data},ai)).target.support.level,'substantial');
 assert.equal(input(wire({type:'enter'},{kind:'welcome',data},ai)).target.support.level,'unknown');
 assert.equal(input(wire({type:'speech',text:'大家晚上好'},{kind:'ai'},ai)).target.support,undefined);
});
test('真实路由与联网后的回复共同要求善意幽默、更多耐心、无讽刺奉承，审核不使用支持优待',async()=>{
 const m=memory();gift(m,'1');const bodies=[];
 const client=createAIClient({getKey:()=> 'key',request:d=>{bodies.push(JSON.parse(d.data));d.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:bodies.length===1 ? '{"intent":"web-search","query":"今天的赛事结果","reply":""}' : '今天的赛果还没确认。'}}]})});},search:async()=>({results:[{title:'赛果',url:'https://example.com',snippet:'仍待公布'}]})});
 await client({now,context:[],target:{type:'chat',text:'今天谁赢了',memory:m.context({id:'1'})},task:{kind:'ai'},maxLength:50},{...config.ai,search:{...config.ai.search,enabled:true}});
 assert.equal(bodies.length,2);
 for(const req of bodies){assert.equal(input(req).target.support.level,'substantial');assert.match(req.messages[0].content,/善意幽默/);assert.match(req.messages[0].content,/不阴阳怪气/);assert.match(req.messages[0].content,/不降低事实.*隐私.*安全/);assert.match(req.messages[0].content,/多一点耐心/);assert.match(req.messages[0].content,/不.*过度讨好/);}
 const moderation=wire({type:'chat',text:'测试审核',memory:m.context({id:'1'})},{kind:'moderation'});assert.equal(input(moderation).target.support,undefined);assert.doesNotMatch(moderation.messages[0].content,/多一点耐心/);
});
test('支持者仍遵守接话滑块与公共上限，不因送礼绕过静默或克制节奏',async()=>{
 const m=memory();gift(m,'1');let calls=0;const engine=new Engine({config:mergeConfig({...config,mode:'preview'}),now:()=>now,viewerMemory:u=>m.context(u),ai:async p=>{calls++;assert.equal(input(makeAIRequest({...p,now},config.ai)).target.support.level,'substantial');return '好，咱们说得随意点。';}});
 engine.setIdentity({self:{id:'self',name:'场控'}});engine.start();
 try{engine.ingest({type:'chat',id:'c1',user:{id:'1',name:'青山'},text:'这回答有点官方'});await new Promise(setImmediate);await engine.tick();
 engine.ingest({type:'chat',id:'c2',user:{id:'1',name:'青山'},text:'再聊两句'});await new Promise(setImmediate);assert.equal(calls,1);
 engine.config.ai.replyFrequency='off';engine.ingest({type:'chat',id:'c3',user:{id:'1',name:'青山'},text:'@场控 回我'});await new Promise(setImmediate);assert.equal(calls,1);
 }finally{engine.stop();}
});
