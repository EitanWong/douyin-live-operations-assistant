import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine,mergeConfig} from '../../src/core/engine.js';
import {TurnTaking} from '../../src/ai/turn-taking.js';
import {makeAIRequest} from '../../src/services/ai.js';

const flush=()=>new Promise(setImmediate);
function fixture(ai={}){
 let time=1800000000000,serial=0,observations=[];const prompts=[],spoken=[];
 const config=mergeConfig({mode:'preview',ai:{enabled:true,chatEnabled:true,...ai}});
 const engine=new Engine({config,now:()=>time,log:(kind,text)=>{if(kind==='preview')spoken.push(text);},mediaContext:()=>({observations}),
  ai:async prompt=>{prompts.push(prompt);return `回应${prompts.length}`;}});
 engine.setIdentity({self:{id:'self',name:'场控'}});engine.start();
 return {engine,prompts,spoken,advance:ms=>time+=ms,now:()=>time,
  chat:async(text,user='v1',extra={})=>{engine.ingest({type:'chat',id:`c${++serial}`,user:{id:user,name:user},text,...extra});await flush();},
  tick:async()=>{await engine.tick();await flush();},scene:()=>observations=[{kind:'omni',id:String(time),at:time,endedAt:time,text:`主播展示作品${time}`,isFinal:true}]};
}

test('默认克制：公屏连发不逐条接话，也不在冷却结束时补发旧话题',async()=>{
 const f=fixture();await f.chat('这个杯子好看');await f.tick();assert.equal(f.spoken.length,1);
 for(let i=0;i<20;i++)await f.chat('今天直播什么呀',`viewer-${i}`);
 await f.tick();assert.equal(f.spoken.length,1);assert.equal(f.prompts.length,1);
 f.advance(91000);await f.tick();assert.equal(f.spoken.length,1,'旧弹幕已过期，不能排队补刷屏');
 await f.chat('现在这个是怎么做的','other');await f.tick();assert.equal(f.spoken.length,2);
 f.advance(91000);await f.chat('还有什么作品','third');await f.tick();assert.equal(f.spoken.length,2,'十分钟内无点名接话有独立上限');f.engine.stop();
});

test('被点名优先，实际发送有间隔，回复后同一观众可以自然续聊',async()=>{
 const f=fixture();await f.chat('这是什么材质');await f.tick();assert.equal(f.spoken.length,1);
 await f.chat('@场控 能再说具体点吗','v2');await f.tick();assert.equal(f.spoken.length,1);
 f.advance(8000);await f.tick();assert.equal(f.spoken.length,2);
 f.advance(8000);await f.chat('那用热水可以吗','v2');await f.tick();assert.equal(f.spoken.length,3);
 assert.equal(f.prompts.at(-1).task.data.engagement.mode,'continuation');
 assert.ok(f.prompts.at(-1).task.data.engagement.recentTurns.some(row=>row.sameViewer));
 assert.doesNotMatch(JSON.stringify(f.prompts.at(-1).task.data.engagement),/"userKey"|"contextKey"/);f.engine.stop();
});

test('热聊中避让普通公屏，明确点名仍可回应；续聊不抢别人的@对话',async()=>{
 const f=fixture();
 for(let i=0;i<12;i++)f.engine.contextChat.push({at:f.now(),name:`观众${i}`,text:'聊得正热闹'});
 await f.chat('哈哈哈');assert.equal(f.prompts.length,0);
 await f.chat('@场控 这是什么','v1');await f.tick();assert.equal(f.spoken.length,1);
 f.advance(8000);await f.chat('@其他观众 你怎么看','v1',{mentions:['someone-else']});assert.equal(f.prompts.length,1);f.engine.stop();
});

test('模型跳过不占发言额度，但同样的公屏判断不会每条都付费重试',async()=>{
 const f=fixture();f.engine.ai=async prompt=>{f.prompts.push(prompt);return '[SKIP]';};
 await f.chat('哇');for(let i=0;i<10;i++)await f.chat('哈哈','other');assert.equal(f.prompts.length,1);assert.equal(f.spoken.length,0);
 f.advance(31000);await f.chat('这个怎么保养');assert.equal(f.prompts.length,2);f.engine.stop();
});

test('主动看直播不是每段都起话题，回复过观众后也要留出空间',async()=>{
 const f=fixture({proactiveEnabled:true,proactiveIntervalSec:30});
 f.advance(16000);f.scene();await f.tick();assert.equal(f.prompts.length,0,'短暂安静不是起话题机会');
 f.advance(30000);f.scene();await f.tick();await f.tick();assert.equal(f.spoken.length,1);
 assert.equal(f.prompts[0].task.data.engagement.mode,'proactive');
 f.advance(91000);f.scene();await f.tick();assert.equal(f.spoken.length,1,'旧配置30秒也不能绕过克制模式5分钟间隔');
 await f.chat('@场控 这个好清洗吗','v2');await f.tick();assert.equal(f.spoken.length,2);
 f.advance(220000);f.scene();await f.tick();assert.equal(f.spoken.length,2,'最近已回复观众，不跟着另起话题');f.engine.stop();
});

test('按发送记录持久限频，暂停续跑、刷新及切换模式不清零，房间间不串用',async()=>{
 const f=fixture();for(let i=0;i<10;i++){await f.chat(`@场控 问题${i}`,`v${i}`);await f.tick();f.advance(8000);}
 assert.equal(f.spoken.length,10);const snapshot=f.engine.snapshot();f.engine.stop();
 const g=fixture();g.engine.ai=async prompt=>{g.prompts.push(prompt);return `新回应${g.prompts.length}`;};g.advance(80000);assert.equal(g.engine.restore(snapshot),true);await g.chat('@场控 还有个问题','last',{id:'restored-new'});await g.tick();assert.equal(g.spoken.length,0);
 g.engine.config.ai.replyFrequency='natural';await g.tick();assert.equal(g.spoken.length,1,'切换模式沿用记录，再按新额度判断');
 g.engine.config.anchorId='other';await g.chat('@场控 新主播的问题','new',{id:'other-room-new'});await g.tick();assert.equal(g.spoken.length,2);g.engine.stop();
});

test('仅回应点名模式使普通接话和主动互动静默，显式@依然正常',async()=>{
 const f=fixture({replyFrequency:'mentions',proactiveEnabled:true});await f.chat('帮忙看看');f.advance(600000);f.scene();await f.tick();assert.equal(f.prompts.length,0);
 await f.chat('@场控 帮忙看看');await f.tick();assert.equal(f.spoken.length,1);f.engine.stop();
});

test('真实请求同时提供对话归属、近期自身发言与直播语境，先判断轮次再回答',async()=>{
 const f=fixture();await f.chat('主播是铁打的吧，这么能熬');
 const prompt=f.prompts[0],request=makeAIRequest(prompt,f.engine.config.ai),system=request.messages[0].content;
 assert.match(system,/观众之间|观众彼此/);assert.match(system,/留给主播|主播亲自/);assert.match(system,/先.*(?:轮到|接话资格)/);
 assert.match(system,/尚无人回答.*公共问题/);assert.match(system,/需要主播亲自回答/);
 const input=JSON.parse(request.messages[1].content);assert.equal(input.data.engagement.mode,'contextual');assert.equal(input.data.engagement.frequency,'quiet');f.engine.stop();
});


test('仅昵称相同不能获得续聊资格，稳定身份仍可承接',async()=>{
 const f=fixture();await f.chat('@场控 你好','',{user:{name:'同名'}});await f.tick();f.advance(8000);
 await f.chat('好呀','',{user:{name:'同名'}});assert.equal(f.prompts.length,1,'不能把同名当作同一观众绕过普通插话节奏');f.engine.stop();
});

test('发送前再次校验模式；尚未点击的失败不消耗发言额度',async()=>{
 const f=fixture();f.engine.config.mode='auto';let clicks=0;
 f.engine.send=async(text,isCurrent)=>{f.engine.config.ai.replyFrequency='mentions';assert.equal(isCurrent(),false);return {submitted:false,reason:'语境已变'};};
 await f.chat('这个怎么清洗');await f.tick();assert.equal(f.engine.turnTaking.turns.length,0);
 f.engine.send=async(text,isCurrent)=>{assert.equal(isCurrent(),true);clicks++;return {submitted:true};};
 await f.chat('@场控 可以回答吗','direct');await f.tick();assert.equal(clicks,1);assert.equal(f.engine.turnTaking.turns.length,1);f.engine.stop();
});

test('发言窗口过期恢复额度，恢复时丢弃未来和损坏记录并按实际时间排序',()=>{
 const t=new TurnTaking(),now=1800000000000,ai=mergeConfig().ai;
 const row={scope:'room',at:now,mode:'direct',userKey:'u',text:'收到'};
 t.restore({turns:[{...row,at:now-1000},row,{...row,at:now+1},{...row,mode:'bad'},{...row,at:now-600000}]},now);
 assert.equal(t.turns.length,2);assert.equal(t.canSpeak({mode:'direct',scope:'room',now:now+8000,ai}),true);
 for(let i=0;i<10;i++)t.record({kind:'ai',text:'回复',aiChat:{replyMode:'direct'}},'room',now+i*8000);
 assert.equal(t.canSpeak({mode:'direct',scope:'room',now:now+80000,ai}),false);
 assert.equal(t.canSpeak({mode:'direct',scope:'room',now:now+672000,ai}),true);
});


test('点击后结果未知也留出接话间隔，不因发送异常立即再插一句',async()=>{
 const f=fixture();f.engine.config.mode='auto';
 f.engine.send=async()=>{throw Object.assign(new Error('点击后断线'),{clicked:true});};
 await f.chat('@场控 第一个问题');await f.tick();assert.equal(f.engine.turnTaking.turns.length,1);
 await f.chat('@场控 第二个问题','v2');await f.tick();assert.equal(f.engine.turnTaking.turns.length,1);f.engine.stop();
});


test('已保存点击意图但控件明确取消、尚未提交时不消耗发言额度',async()=>{
 const f=fixture();f.engine.config.mode='auto';
 f.engine.send=async(text,isCurrent,{beforeClick})=>{await beforeClick();return {submitted:false,reason:'尚未点击，控件已变'};};
 await f.chat('@场控 帮我看看');await f.tick();assert.equal(f.engine.turnTaking.turns.length,0);f.engine.stop();
});
