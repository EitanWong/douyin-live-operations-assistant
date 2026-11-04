import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAIClient,makeAIRequest} from '../../src/services/ai.js';
import {mergeConfig} from '../../src/core/engine.js';
import {makeEdgeMessages,fitEdgeMessages} from '../../src/ai/edge-prompt.js';
import {FACTUAL_LOOKUP_INSTRUCTION,TURN_TAKING_INSTRUCTION} from '../../src/ai/conversation-policy.js';

const config=mergeConfig({ai:{search:{enabled:true},pipeline:{contextBudgetChars:16000}}}).ai;
const found={provider:'bocha',query:'赤鹤星观测周期',searchedAt:1800000000000,results:Array.from({length:3},(_,i)=>({index:i+1,title:`观测资料${i+1}`,url:`https://observatory.example/${i+1}`,content:'背景说明。'.repeat(200)+(i===2 ? '赤鹤星观测周期为73天。' : '尚无周期测量值。'),publishedAt:null}))};
const prompt={target:{text:'赤鹤星观测周期是多少？',address:'小鱼'},task:{kind:'ai',instruction:TURN_TAKING_INSTRUCTION,data:{replyMode:'contextual'}},context:[],knowledge:'本场资料。'.repeat(2000),maxLength:50};

test('长直播资料下搜索正文仍进入最终请求，回复使用仅存在于第三条来源末尾的事实',async()=>{
  let calls=0,searches=0,answerInput;
  const client=createAIClient({getKey:()=> 'key',search:async()=>{searches++;return structuredClone(found);},request:details=>{
    const input=JSON.parse(JSON.parse(details.data).messages[1].content);calls++;
    let output=JSON.stringify({intent:'web-search',query:found.query,reply:''});
    if(calls===2){
      answerInput=input;
      const source=input.web_search?.results.find(row=>/观测周期为\d+天/u.test(row.content));
      const days=source?.content.match(/观测周期为(\d+)天/u)?.[1];
      output=days ? `观测周期为${days}天。[${source.index}]` : '没有周期资料。';
    }
    details.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:output}}]})});
  }});
  assert.equal(await client(prompt,config),'观测周期为73天。');
  assert.deepEqual(answerInput.web_search.results,found.results);
  assert.equal(answerInput.web_search.searches.length,1);
  assert.ok(JSON.stringify(answerInput).length<=16000);
  assert.equal(answerInput.evidence_context,undefined,'查证阶段不再发送无关直播背景，完整来源无需挤占裁剪预算');
  assert.equal(calls,2);assert.equal(searches,1);
});

test('搜索完成后只整理已有来源，移除初次路由和接话判断指令',()=>{
  const request=makeAIRequest({...prompt,searchResults:found},config),system=request.messages[0].content;
  assert.ok(!system.includes(FACTUAL_LOOKUP_INSTRUCTION));
  assert.ok(!system.includes(TURN_TAKING_INSTRUCTION));
  assert.match(system,/查证阶段已经完成/u);
  assert.match(system,/先给出来源支持的具体答案/u);
  assert.match(system,/资料不足或矛盾/u);
  assert.match(system,/\[1\]/u);
  assert.doesNotMatch(system,/或 \[SKIP\]|不适合回复时输出 \[SKIP\]|没有必要回复时输出 \[SKIP\]/u);
  assert.deepEqual(JSON.parse(request.messages[1].content).web_search,found);
});
test('事实查证使用低温生成减少补充猜测，普通聊天仍保留用户温度',()=>{
 const ai={...config,temperature:0.9};
 assert.equal(makeAIRequest({...prompt,searchResults:found},ai).temperature,0.2);
 assert.equal(makeAIRequest({...prompt,task:{kind:'ai'}},ai).temperature,0.9);
 assert.equal(makeAIRequest({...prompt,searchResults:found},{...ai,temperature:0.1}).temperature,0.1);
});

test('固定任务与搜索依据无法同时容纳时拒绝请求，不发送失去来源的答案请求',()=>{
  assert.throws(()=>makeAIRequest({...prompt,task:{kind:'ai',data:{reference:'固定'.repeat(7000)}},searchResults:found},config),/预算/u);
});
test('资料答案超出公屏预算时只压缩一次，不重复搜索，压缩调用也必须预留额度',async()=>{
 let calls=0,reserves=0,searches=0;
 const client=createAIClient({search:async()=>{searches++;return found;},generate:async p=>{
  calls++;if(p.intentRouting)return JSON.stringify({intent:'web-search',query:found.query});
  if(p.answerDraft){assert.match(p.answerDraft,/73天/);return '{"answer":"周期73天。","sources":[3]}';}
  return JSON.stringify({answer:'根据本次提供的观测资料，'.repeat(5)+'赤鹤星观测周期为73天。',sources:[3]});
 }});
 const answer=await client({...prompt,searchMaxLength:30,reserveFollowup:()=>{reserves++;return true;}},config);
 assert.equal(answer,'周期73天。');assert.equal(calls,3);assert.equal(reserves,2);assert.equal(searches,1);
});
test('压缩不绕过异步额度、不无限重试，端侧保留同一来源和待压缩答案',async()=>{
 for(const allow of [false,true]){
  let calls=0,reserves=0;
  const client=createAIClient({search:async()=>found,generate:async p=>{calls++;return p.intentRouting ? '{"intent":"web-search","query":"周期"}' : JSON.stringify({answer:'超长答案'.repeat(30),sources:[3]});}});
  await assert.rejects(client({...prompt,reserveFollowup:async()=>++reserves===1 || allow},config),allow ? /仍超过/ : /额度不足/);
  assert.equal(calls,allow ? 3 : 2);assert.equal(reserves,2);
 }
 const messages=makeEdgeMessages({...prompt,searchResults:found,answerDraft:'周期73天，但这句话太长。'},config);
 assert.equal(JSON.parse(messages[1].content).answer_draft,'周期73天，但这句话太长。');assert.match(messages[0].content,/核心结论/);
});
test('知识缓存只有不适用的PK资料时必须重新查证，不把过滤后的空缓存当作已完成研究',async()=>{
 let searches=0;
 const invalid={query:'PK规则',results:[{index:1,url:'https://seo.example/pk',title:'PK',content:'PK视频播放量翻倍，按总播放量排名。'}]};
 const client=createAIClient({knowledge:{revision:async()=>0,candidates:async()=>[],find:async()=>invalid,remember:async()=>{}},search:async query=>{searches++;return {query,results:[{index:1,url:'https://guide.example/pk',title:'规则',content:'本玩法按PK分结算。'}]};},generate:async p=>p.intentRouting ? '{"intent":"web-search","query":"PK规则"}' : '{"answer":"本玩法按PK分结算。","sources":[1]}'});
 assert.equal(await client({...prompt,target:{text:'抖音PK规则'}},config),'本玩法按PK分结算。');assert.equal(searches,2);
});

test('端侧搜索保留所有来源正文及末尾事实，预算不足时明确拒绝而非静默丢依据',async()=>{
  const messages=makeEdgeMessages({...prompt,searchResults:found},config);
  const data=JSON.parse(messages[1].content);
  assert.deepEqual(data.web_search,found.results);
  assert.match(messages[0].content,/查证阶段已经完成/u);
  assert.ok(!messages[0].content.includes(FACTUAL_LOOKUP_INSTRUCTION));
  const measure=async rows=>JSON.stringify(rows).length;
  const fitted=await fitEdgeMessages(messages,measure,10000);
  assert.deepEqual(JSON.parse(fitted[1].content).web_search,data.web_search);
  await assert.rejects(fitEdgeMessages(messages,measure,1500),/预算/u);
});

test('生成与精简均保留多对象范围，复合问题不能为凑20字丢掉核心结论',()=>{
 const input={...prompt,target:{text:'不同玩法时长和胜负怎么算？'},searchResults:{...found,topic:'live-pk'},maxLength:44};
 for(const messages of [makeAIRequest(input,config).messages,makeEdgeMessages(input,config),makeAIRequest({...input,answerDraft:'玩法甲三分钟，玩法乙十分钟，均按PK分结算。'},config).messages]){
  assert.doesNotMatch(messages[0].content,/开头保留“本玩法”|必须用“本玩法”|尽量20字/u);
  assert.match(messages[0].content,/多个(?:对象|玩法)/u);
  assert.match(messages[0].content,/逐项/u);
 }
});

test('查证与缓存回复发现无依据的倍率优先级时共用一次修订额度，不能把不能叠加推成取高',async()=>{
 const evidence={topic:'live-pk',query:'PK加成',results:[{index:1,title:'规则',url:'https://example.org/pk',content:'测试活动首送双倍，任务完成后1.5倍，不能叠加；未说明相遇时采用哪种加成。'}]};
 for(const cached of [false,true]){
  let calls=0,reserves=0,searches=0;
  const candidate={...evidence,id:'4f73b1b7-eed2-4df2-843f-25ce93281ace',freshness:'rules'};
  const knowledge=cached ? {revision:async()=>0,candidates:async()=>[candidate],find:async()=>candidate,remember:async()=>{}} : undefined;
  const client=createAIClient({knowledge,search:async()=>{searches++;return evidence;},generate:async p=>{
   calls++;if(p.intentRouting)return cached ? '{"intent":"knowledge","query":"4f73b1b7-eed2-4df2-843f-25ce93281ace","reply":"本活动不能叠加，取较高者200分。","sources":[1]}' : '{"intent":"web-search","query":"PK加成"}';
   if(p.answerDraft){assert.match(p.answerIssues.join(' '),/优先级/);return '{"answer":"本测试活动不能叠加，同时触发如何处理未说明。","sources":[1]}';}
   return '{"answer":"本活动不能叠加，取较高者200分。","sources":[1]}';
  }});
  const answer=await client({...prompt,target:{text:'PK加成同时触发怎么算？'},reserveFollowup:async()=>{reserves++;return true;}},config);
  assert.match(answer,/未说明/);assert.doesNotMatch(answer,/取较高/);assert.equal(calls,cached ? 2 : 3);assert.equal(reserves,cached ? 1 : 2);assert.equal(searches,cached ? 0 : 2);
 }
});


test('规则校验仅按实际引用来源判断高风险断言，支持明确优先级，拒绝跨玩法与无依据否定',async()=>{
 const {ruleAnswerIssues}=await import('../../src/services/search-answer.js');
 const found={topic:'live-pk',results:[{index:1,content:'测试玩法A为3/5分钟，玩法B为10分钟，不能叠加。'},{index:2,content:'另一个活动取较高倍率。'}]};
 assert.ok(ruleAnswerIssues('不能叠加，取较高者。',found,[1]).length);
 assert.deepEqual(ruleAnswerIssues('取较高倍率。',found,[2]),[]);
 assert.ok(ruleAnswerIssues('本玩法可选3、5或10分钟。',found,[1]).length);
 assert.deepEqual(ruleAnswerIssues('测试示例A为3/5分钟，B为10分钟。',found,[1]),[]);
 assert.ok(ruleAnswerIssues('没有统一标准。',found,[1]).length);
 assert.deepEqual(ruleAnswerIssues('没有统一标准。',{...found,results:[{index:1,content:'这个活动没有统一标准。'}]},[1]),[]);
 assert.deepEqual(ruleAnswerIssues('本玩法可选3、5或10分钟。',{...found,topic:null},[1]),[]);
});

test('规则修订不能无限重试或透支额度，修订再次臆造时明确失败',async()=>{
 for(const allow of [false,true]){
  let calls=0,reserves=0;
  const client=createAIClient({search:async()=>({query:'PK',results:[{index:1,content:'测试活动不能叠加。',url:'https://example.org/pk',title:'PK'}]}),generate:async p=>{calls++;return p.intentRouting ? '{"intent":"web-search","query":"直播PK规则"}' : '{"answer":"取较高倍率。","sources":[1]}';}});
  await assert.rejects(client({...prompt,target:{text:'直播PK叠加规则'},reserveFollowup:async()=>++reserves===1 || allow},config),allow ? /仍有无依据/ : /额度不足/);
  assert.equal(calls,allow ? 3 : 2);assert.equal(reserves,2);
 }
});

test('测试规则必须保留来源范围，评论不能推出平台未公开或跨玩法倍率差异',async()=>{
 const {ruleAnswerIssues}=await import('../../src/services/search-answer.js');
 const example={topic:'live-pk',results:[{index:1,content:'对照测试资料，不是抖音通用规则：玩法A三分钟，玩法B十分钟，按PK分结算。'}]};
 assert.ok(ruleAnswerIssues('时长可选三或十分钟，按PK分结算。',example,[1]).length);
 assert.deepEqual(ruleAnswerIssues('按测试示例，两种玩法时长不同，均按PK分结算。',example,[1]),[]);
 const comment={topic:'live-pk',results:[{index:1,content:'网友评论首翻2倍。'}]};
 assert.ok(ruleAnswerIssues('抖音未公开此通用倍率细则。',comment,[1]).length);
 assert.ok(ruleAnswerIssues('不同玩法倍率和概率各异。',comment,[1]).length);
 assert.deepEqual(ruleAnswerIssues('网友评论不足以证明通用规则。',comment,[1]),[]);
});
