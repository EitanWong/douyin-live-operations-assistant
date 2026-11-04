import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine,mergeConfig} from '../../src/core/engine.js';
import {MediaEvidence} from '../../src/services/media.js';
import {makeAIRequest,createAIClient} from '../../src/services/ai.js';
const flush=()=>new Promise(setImmediate);
function fixture(ai={}){
 let now=1800000000000,serial=0;const prompts=[],spoken=[],evidence=new MediaEvidence({now:()=>now});
 const engine=new Engine({config:mergeConfig({mode:'preview',ai:{enabled:true,proactiveEnabled:true,...ai}}),now:()=>now,mediaContext:()=>evidence.context(60),ai:async p=>{prompts.push(p);return '蓝色和这个花纹挺搭的。';},log:(kind,text)=>{if(kind==='preview')spoken.push(text);}});
 engine.setIdentity({self:{id:'self',name:'场控'}});engine.start();
 return {engine,prompts,spoken,evidence,now:()=>now,advance:ms=>now+=ms,
  speech:(text='大家觉得蓝色还是绿色好看？')=>evidence.add({kind:'audio',id:`a${++serial}`,text,at:now-1000,endedAt:now,isFinal:true}),
  visual:(text='主播手里并排拿着蓝色和绿色的杯子。',age=0)=>evidence.add({kind:'omni',id:`o${++serial}`,text,at:now-age-1000,endedAt:now-age,isFinal:true}),
  assess:async()=>{engine.requestProactive(now);await flush();},tick:async()=>{await engine.tick();await flush();}};
}

test('完成语音自动进入主播接话判断，不等45秒冷场；回复同时获得原话与当前画面',async()=>{
 const f=fixture();f.advance(2000);f.visual();f.speech();await f.assess();assert.equal(f.prompts.length,1);
 const p=f.prompts[0];assert.equal(p.target.type,'speech');assert.equal(p.target.text,'大家觉得蓝色还是绿色好看？');assert.equal(p.target.memory,undefined);
 assert.equal(p.task.data.interactionMode,'speech');assert.equal(p.task.data.engagement.mode,'speech');
 const request=makeAIRequest(p,f.engine.config.ai),input=JSON.parse(request.messages[1].content);
 assert.ok(input.media_context.observations.some(row=>row.text.includes('并排拿着')));assert.equal(input.media_context.moment.alignment,'overlapping');
 assert.match(request.messages[0].content,/先接住对方这句话的意思/);assert.match(request.messages[0].content,/歌词|背景音乐/);
 await f.tick();assert.deepEqual(f.spoken,['蓝色和这个花纹挺搭的。']);f.engine.stop();
});

test('同一句语音不重复判断；SKIP不占发言，刷新保留语音判断冷却',async()=>{
 const f=fixture();f.engine.ai=async p=>{f.prompts.push(p);return '[SKIP]';};f.advance(2000);f.speech('今天先把花纹画完。');await f.assess();assert.equal(f.prompts.length,1);assert.equal(f.engine.queue.length,0);
 f.advance(21000);f.speech('今天先把花纹画完。');await f.assess();assert.equal(f.prompts.length,1);
 f.advance(1000);f.speech('大家更喜欢哪一款？');await f.assess();assert.equal(f.prompts.length,2);
 const snapshot=f.engine.snapshot();f.engine.stop();const g=fixture();g.engine.ai=async p=>{g.prompts.push(p);return '[SKIP]';};g.advance(24000);g.engine.restore(snapshot);g.speech('大家更喜欢哪一款？');await g.assess();assert.equal(g.prompts.length,0);
 g.advance(21000);g.speech('这个颜色搭什么好呢？');await g.assess();assert.equal(g.prompts.length,1);g.advance(91000);g.speech('这个颜色搭什么好呢？');await g.assess();assert.equal(g.prompts.length,2,'隔了一段时间重新询问，仍应结合新语境判断');g.engine.stop();
});

for(const [label,ai,prepare] of [
 ['关闭互动',{proactiveEnabled:false},()=>{}],['仅回应@',{replyFrequency:'mentions'},()=>{}],
 ['观众热聊',{},f=>{for(let i=0;i<8;i++)f.engine.contextChat.push({at:f.now(),text:'大家正在聊',name:'观众'});}],
 ['已有排队消息',{},f=>f.engine.enqueue('gift','谢谢礼物')]
])test(`语音入口尊重节奏与开关：${label}`,async()=>{
 const f=fixture(ai);f.advance(2000);f.speech();prepare(f);await f.assess();assert.equal(f.prompts.length,0);f.engine.stop();
});

test('只有画面、过期或未完成的语音不会伪装成主播发问',async()=>{
 const f=fixture();f.advance(2000);f.visual();await f.assess();assert.equal(f.prompts.length,0);
 f.evidence.add({kind:'audio',id:'partial',text:'大家觉得',at:f.now(),endedAt:f.now(),isFinal:false});await f.assess();assert.equal(f.prompts.length,0);
 f.speech();f.advance(31000);await f.assess();assert.equal(f.prompts.length,0);f.engine.stop();
});

test('新语音改变话题后撤销生成中及排队的旧回应，点击前也重新核对',async()=>{
 for(const queued of [false,true]){
  const f=fixture();let answer;f.engine.ai=p=>{f.prompts.push(p);return new Promise(resolve=>answer=resolve);};
  f.advance(2000);f.speech();await f.assess();assert.equal(f.prompts.length,1);
  if(queued){answer('蓝色更搭。');await flush();assert.equal(f.engine.queue.length,1);}
  f.advance(1000);f.speech('算了，已经决定用绿色了。');assert.equal(f.prompts[0].isCurrent(),false);
  if(!queued){answer('蓝色更搭。');await flush();}await f.tick();assert.equal(f.spoken.length,0);assert.equal(f.engine.queue.length,0);f.engine.stop();
 }
});

test('回应主播也计入无点名发言额度；明确@仍可正常对话',async()=>{
 const f=fixture({chatEnabled:true});f.advance(2000);
 for(let i=0;i<3;i++){f.speech(`大家觉得第${i}款好看吗？`);await f.assess();f.engine.ai=async p=>{f.prompts.push(p);return `第${i}款颜色挺协调。`;};await f.tick();f.advance(21000);}
 assert.equal(f.spoken.length,2);assert.equal(f.prompts.length,2);
 f.engine.ingest({type:'chat',id:'direct',user:{id:'viewer',name:'小雨'},text:'@场控 能帮我看看吗'});await flush();await f.tick();assert.equal(f.spoken.length,3);f.engine.stop();
});

test('语音问题沿用现有联网和知识库路由；音画时间不重叠时明确区分',async()=>{
 const f=fixture({search:{enabled:true},memory:{enabled:true,entries:[{id:'color',title:'茶杯配色',content:'蓝色茶杯搭配白色花纹。',source:'主播确认',enabled:true,updatedAt:1767225600000,expiresOn:''}]}});
 const requests=[],queries=[];
 f.engine.ai=createAIClient({getKey:()=> 'test-key',search:async query=>{queries.push(query);return {results:[{index:1,title:'配色资料',snippet:'蓝色和白色搭配',url:'https://example.org/color'}]};},request:d=>{const body=JSON.parse(d.data);requests.push(body);const content=requests.length===1 ? '{"intent":"web-search","query":"蓝色茶杯配色","reply":""}' : '蓝白搭配挺清爽。[1]';d.onload({status:200,responseText:body.stream ? `data: ${JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n` : JSON.stringify({choices:[{message:{content}}]})});}});
 f.advance(22000);f.visual('此前手中有红色的杯子。',20000);f.speech('蓝色茶杯怎么配色，帮我查查？');await f.assess();await f.tick();
 assert.equal(queries.length,1);assert.equal(requests.length,2);const input=JSON.parse(requests[0].messages[1].content);
 assert.equal(input.target.type,'speech');assert.equal(input.media_context.moment.alignment,'separate');assert.ok(input.evidence_context.memories.some(row=>row.id==='color'));
 assert.deepEqual(f.spoken,['蓝白搭配挺清爽。']);f.engine.stop();
});


test('音画模式先短暂等候同一片段画面；上一段音画不能靠时间边沿冒充同步',async()=>{
 const f=fixture({pipeline:{mode:'omni-llm',workspaceId:'workspace'}});f.advance(2000);f.speech('看看这两个杯子哪个好看？');await f.assess();assert.equal(f.prompts.length,0);
 f.advance(1000);f.visual(undefined,1000);await f.assess();assert.equal(f.prompts.length,1,'同一语音片段画面到达即进入判断');f.engine.stop();
 const g=fixture({pipeline:{mode:'omni-llm',workspaceId:'workspace'}});g.advance(2000);g.visual('上一片段主播背对画面。',1000);g.speech('看看这两个杯子哪个好看？');await g.assess();assert.equal(g.prompts.length,0);
 g.advance(3001);await g.assess();assert.equal(g.prompts.length,1,'画面缺失不会无限阻塞，只按可用证据回应');
 const input=JSON.parse(makeAIRequest(g.prompts[0],g.engine.config.ai).messages[1].content);assert.equal(input.media_context.moment.alignment,'separate');g.engine.stop();
});
