import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProfileInsightUpdater,validProfileInsights} from '../../src/ai/profile-insights.js';
import {AudienceMemory} from '../../src/ai/audience-memory.js';
import {mergeConfig} from '../../src/core/engine.js';

test('自动画像有原话依据、沿用后台模型、幂等更新，遗忘或原文删除立即失效',async()=>{
 const memory=new AudienceMemory({anchor:'10'}),at=Date.now();
 memory.observe({type:'chat',source:'socket',id:'chat-1',text:'我喜欢陶瓷，阿明是我的朋友。',receivedAt:at,user:{id:'2',name:'小雨'}});
 const archive=()=>({anchor:'10',audience:memory.snapshot()});let saved,calls=0;
 const ai=mergeConfig({ai:{assistant:{research:{profileEnabled:true}},taskModels:{research:{enabled:true,endpoint:'https://research.example/chat/completions',model:'research'}}}}).ai;
 const update=createProfileInsightUpdater({read:async key=>key.includes('profile-insights') ? saved : archive(),write:async(_key,value)=>saved=value,reserve:async()=>{},client:async(prompt,config)=>{
  calls++;assert.equal(config.model,'research');assert.equal(prompt.profileConversation.turns[0].text,'我喜欢陶瓷，阿明是我的朋友。');
  return JSON.stringify({facts:[{field:'interests',value:'陶瓷',evidence:[{turn:1,quote:'我喜欢陶瓷'}]}],relationships:[{name:'阿明',predicate:'朋友',negative:false,evidence:[{turn:1,quote:'阿明是我的朋友'}]}],analysis:[{text:'可能愿意交流陶瓷话题',limitations:'仅依据这一句原话，不能确定心理状态。',evidence:[{turn:1,quote:'我喜欢陶瓷'}]}],knowledge:[],reply:'已整理原话。'});
 }});
 const input={room:'1',anchor:'10',subject:'uid:2',ai,guard:async()=>{}};
 await update(input);await update(input);assert.equal(calls,1);
 assert.equal(validProfileInsights(saved,archive()).length,1);
 const changed=archive();changed.audience.viewers[0].statements[0].text='原文已更正';assert.equal(validProfileInsights(saved,changed).length,0);
 memory.forget('uid:2');assert.equal(validProfileInsights(saved,archive()).length,0);
 assert.equal(await update(input),null);assert.equal(calls,1);
});
test('生成期间删除原话或取消，不写入旧画像；无身份的感知不冒充本人原话',async()=>{
 let written=0,archive={anchor:'10',audience:{viewers:[]},perception:{observations:[{kind:'audio',text:'我喜欢陶瓷',at:Date.now()}]}};
 const ai=mergeConfig({ai:{assistant:{research:{profileEnabled:true}}}}).ai;
 const update=createProfileInsightUpdater({read:async()=>archive,write:async()=>written++,client:()=>assert.fail('无稳定主体不调用画像模型')});
 assert.equal(await update({room:'1',anchor:'10',ai}),null);assert.equal(written,0);
});
test('人物模型等待期间，删除投影立即完成，迟到结果不能复活已遗忘的人',async()=>{
 const memory=new AudienceMemory({anchor:'10'});memory.observe({type:'chat',source:'socket',id:'one',text:'我喜欢陶瓷。',receivedAt:Date.now(),user:{id:'2',name:'小雨'}});
 let saved,release,started;const pendingModel=new Promise(r=>started=r),ai=mergeConfig({ai:{assistant:{research:{profileEnabled:true}}}}).ai;
 const update=createProfileInsightUpdater({read:async key=>key.includes('profile-insights') ? saved : {anchor:'10',audience:memory.snapshot()},write:async(_key,value)=>saved=value,client:async()=>{started();return new Promise(r=>release=()=>r(JSON.stringify({facts:[],relationships:[],analysis:[],knowledge:[],reply:'已整理'})));}});
 const pending=update({room:'1',anchor:'10',subject:'uid:2',ai});
 await pendingModel;memory.forget('uid:2');let pruned=false;
 const prune=update.prune('1','10').then(()=>pruned=true);
 try{await new Promise(setImmediate);assert.equal(pruned,true,'原话删除不能等待在途模型');}
 finally{release();await assert.rejects(pending,/原话|变化/);await prune;}
 assert.equal(saved,undefined);
});
