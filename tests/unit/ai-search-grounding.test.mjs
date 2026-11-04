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
  assert.deepEqual(answerInput.web_search,found);
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

test('固定任务与搜索依据无法同时容纳时拒绝请求，不发送失去来源的答案请求',()=>{
  assert.throws(()=>makeAIRequest({...prompt,task:{kind:'ai',data:{reference:'固定'.repeat(7000)}},searchResults:found},config),/预算/u);
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
