import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeAIRequest,generatePhrases} from '../../src/services/ai.js';
import {Engine,mergeConfig} from '../../src/core/engine.js';

const config=mergeConfig({});
const prompt={persona:config.ai.persona,knowledge:'',context:[],maxLength:50};

test('普通问答、后台研究及直接回复共用常识与个人事实边界，不再要求所有事实只取主播资料',()=>{
  for(const task of [undefined,{kind:'ai'},{kind:'agent'}]){
    for(const intentRouting of [false,true]){
      const request=makeAIRequest({...prompt,task,intentRouting,target:{text:'主播睡觉吗？'}},config.ai);
      const system=request.messages[0].content;
      assert.match(system,/日常打趣中的显然常识可以直接回答/);
      assert.match(system,/常识不能证明个人的具体情况/);
      assert.doesNotMatch(system,/事实仅使用提供的主播资料和事件数据|资料不足时自然引导询问主播|未命中不等于不存在，也不表示可用常识补造/);
      assert.match(system,/具体作息、当前状态、健康、经历和安排/);
      assert.equal(JSON.parse(request.messages[1].content).target.text,'主播睡觉吗？');
    }
  }
});

test('问答指令先答能确定的部分，闲聊走chat，知识自动查证且保留个人事实边界',()=>{
  const request=makeAIRequest({...prompt,task:{kind:'ai'},intentRouting:true,target:{text:'主播睡觉吗？一般几点睡？'}},config.ai);
  const system=request.messages[0].content;
  assert.match(system,/日常寒暄、显然的生活打趣和无害玩笑使用 chat/);
  assert.match(system,/先回答能确定的部分/);
  assert.match(system,/实质性的常识问答和外部知识问题/);
  assert.match(system,/应主动查证/);
  assert.doesNotMatch(system,/常识可直接简答|稳定常识可以直接回答/);
  assert.match(system,/不因缺少具体资料而把整句都推回主播/);
  assert.match(system,/对象不明且确实影响答案时才澄清/);
  assert.match(system,/不嘲讽、不训人/);
  assert.match(system,/不假装是真人/);
});

test('关键词话术生成也复用同一事实边界，不把常识问题交回主播',async()=>{
  let request;
  const phrases=await generatePhrases(async(value,settings)=>{
    request=makeAIRequest(value,settings);
    return '["当然睡呀，主播也得休息。"]';
  },config,{kind:'keyword',keywords:['睡觉']});
  assert.deepEqual(phrases,['当然睡呀，主播也得休息。']);
  const system=request.messages[0].content;
  assert.match(system,/日常打趣中的显然常识可以直接回答/);
  assert.doesNotMatch(system,/事实只取主播资料|就引导询问主播/);
  assert.match(system,/具体作息、当前状态、健康、经历和安排/);
});

test('问答先承接意图和语境，观点感受不强求举证，只有影响答案的歧义才澄清',()=>{
  const system=makeAIRequest({...prompt,task:{kind:'ai'},target:{text:'你这回答也太官方了吧'}},config.ai).messages[0].content;
  assert.match(system,/先接住对方这句话的意思/);
  assert.match(system,/观点、感受和善意调侃不需要事实举证/);
  assert.match(system,/只有不同理解会实质改变答案/);
  assert.match(system,/已有清楚的指代就直接承接/);
  assert.match(system,/情绪先用一句贴切的话回应/);
  assert.match(system,/风格只调整表达/);
});

test('新默认人设适用于对话，历史默认值升级且幂等，自定义风格保留',()=>{
  const old='你在直播间帮忙做简单招呼。说话简短、平常，欢迎或谢谢一句就够。把注意力留给主播，不主动找话题，不自称主持，不说帮忙转达或安排，没有必要就不插话。';
  const migrated=mergeConfig({ai:{persona:old}});
  assert.equal(migrated.ai.persona,config.ai.persona);
  assert.match(migrated.ai.persona,/听懂对方的意思/);
  assert.doesNotMatch(migrated.ai.persona,/欢迎或谢谢一句就够/);
  assert.deepEqual(mergeConfig(migrated),migrated);
  const custom='直爽一点，回答可以有轻松的幽默。';
  assert.equal(mergeConfig({ai:{persona:custom}}).ai.persona,custom);
});

test('路由同时生成最终回复时尊重用户温度，审核和PK继续使用各自参数',()=>{
  const settings={...config.ai,temperature:0.85};
  const value={...prompt,task:{kind:'ai'},intentRouting:true,target:{text:'晚上好呀'}};
  assert.equal(makeAIRequest(value,settings).temperature,0.85);
  assert.equal(makeAIRequest({...value,task:{kind:'moderation'}},settings).temperature,0);
  assert.equal(makeAIRequest({...value,task:{kind:'pk'}},settings).temperature,0.2);
});

test('普通弹幕任务不再按反问或感叹一律静默，仍按对话归属判断是否接话',async()=>{
  let request;
  const engine=new Engine({config:mergeConfig({mode:'preview',ai:{enabled:true,chatEnabled:true}}),
    ai:async value=>{request=makeAIRequest(value,config.ai);return '[SKIP]';}});
  engine.setIdentity({self:{id:'self',name:'场控'}});engine.start();
  try{
    engine.ingest({type:'chat',id:'joke',user:{id:'viewer',name:'观众'},text:'主播是铁打的吧，这么能熬'});
    await new Promise(setImmediate);
    const system=request.messages[0].content;
    assert.match(system,/反问、玩笑、感叹本身不是跳过理由/);
    assert.match(system,/data.addressedToOther=true/);
    assert.doesNotMatch(system,/反问、起哄、随口感叹、重复已答问题/);
  }finally{engine.stop();}
});
