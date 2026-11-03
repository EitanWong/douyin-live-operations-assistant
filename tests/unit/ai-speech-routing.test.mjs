import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeAIRequest} from '../../src/services/ai.js';
import {mergeConfig} from '../../src/core/engine.js';
import {hostSpeechInstruction} from '../../src/ai/conversation-policy.js';
test('语音路由由主播接话任务统一判断，不混入观众礼物或默认旁听提示',()=>{
 const request=makeAIRequest({intentRouting:true,searchAvailable:true,target:{type:'speech',text:'大家觉得蓝白搭配好看吗？',speaker:'unverified'},task:{kind:'ai',instruction:hostSpeechInstruction('natural')},maxLength:50},mergeConfig().ai);
 const system=request.messages[0].content;
 assert.doesNotMatch(system,/灯牌名称|data.valueTier|技能：|target.support/u);
 assert.match(system,/unverified.*(?:未自动|自动.*未)/u);assert.match(system,/重叠|同期/u);
 assert.match(system,/背景|连麦|他人/u);assert.match(system,/web-search.*knowledge.*chat.*clarify.*skip/u);
});
test('意图决策关闭聊天采样，查证回答保留用户温度',()=>{
 const config=mergeConfig({ai:{temperature:0.7}}).ai;
 const prompt={target:{type:'speech',text:'主播正在讲解。'},task:{kind:'ai'},maxLength:50};
 assert.equal(makeAIRequest({...prompt,intentRouting:true},config).temperature,0);
 assert.equal(makeAIRequest({...prompt,searchResults:{results:[]}},config).temperature,0.7);
 assert.equal(makeAIRequest({...prompt,target:{type:'chat',text:'你好'},intentRouting:true},config).temperature,0);
});
