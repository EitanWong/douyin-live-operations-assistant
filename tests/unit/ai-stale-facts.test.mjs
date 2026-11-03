import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine,mergeConfig} from '../../src/core/engine.js';
import {createAIClient} from '../../src/services/ai.js';

test('数据问答在排队期间汇总变化会停止发送，普通弹幕和时钟不会使相同事实失效',async()=>{
  let now=Date.now(),diamonds=100;
  const ai=createAIClient({getKey:()=> 'test',request:d=>d.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:JSON.stringify({intent:'live-data',query:'',reply:'本场已采集100钻。'})}}]})})});
  const engine=new Engine({ai,now:()=>now,config:mergeConfig({anchorId:'123',mode:'preview',ai:{enabled:true,chatEnabled:true}}),liveData:()=>({income:{anchorId:'123',at:now,totalDiamonds:diamonds,giftCount:1}})});
  engine.setIdentity({self:{id:'self',name:'助手'}});engine.start();
  engine.ingest({type:'chat',id:'question',user:{id:'viewer',name:'观众'},text:'@助手 本场多少钻石'});await new Promise(setImmediate);
  const job=engine.queue[0];assert.ok(job);assert.equal(engine.validChatReply(job),true);
  now+=1000;engine.contextChat.push({at:now,name:'观众',text:'你好'});assert.equal(engine.validChatReply(job),true);
  diamonds=200;assert.equal(engine.validChatReply(job),false);await engine.tick(false);assert.equal(engine.queue.length,0);
});
