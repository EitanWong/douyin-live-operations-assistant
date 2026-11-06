import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeConfig} from '../../src/core/engine.js';
import {createAIPlayground,AI_TEST_CASES} from '../../src/services/ai-playground.js';

const respond=(d,text)=>d.onload({status:200,responseText:JSON.stringify({choices:[{message:{content:text}}]})});
const plan=(intent,reply='',query='')=>JSON.stringify({intent,reply,query});
function fixture(options={}){
 let config=mergeConfig({ai:{search:{enabled:true},edge:{enabled:false}}}),now=1800000000000;
 const requests=[];
 const service=createAIPlayground({getConfig:()=>config,getContext:()=>({context:[{text:'真实现场话题'}],liveContext:{income:{totalDiamonds:80}},mediaContext:null}),getKey:()=> 'test-key',now:()=>now,
  request:d=>{requests.push(JSON.parse(d.data));respond(d,plan('chat','你好。'));},...options});
 return {service,requests,config,update:value=>config=mergeConfig(value),advance:ms=>now+=ms};
}
test('问答使用已保存模型、真实现场和测试对话，AI关闭也可测试且不产生发送任务',async()=>{
 const f=fixture();const before=structuredClone(f.config);
 const result=await f.service.run({question:'你好',turns:[{question:'上一问',answer:'上一答',contextRevision:1}]});
 assert.equal(result.answer,'你好。');assert.equal(result.status,'succeeded');assert.equal(result.intent,'chat');
 assert.equal(result.model,f.config.ai.model);assert.equal(result.provider,'cloud');assert.equal(result.calls.cloud,1);
 const input=JSON.parse(f.requests[0].messages[1].content);
 assert.equal(input.task,'ai');assert.equal(input.data.replyMode,'direct');assert.equal(input.live_context.income.totalDiamonds,80);
 assert.ok(input.recent_chat.some(row=>row.text==='上一问'));assert.ok(input.recent_replies.includes('上一答'));
 assert.deepEqual(f.config,before);assert.equal(result.checks.every(c=>c.pass),true);
});
test('搜索后的最终答案、查询、来源、缓存标记与用量同时返回，测试不写入自动知识',async()=>{
 let remembers=0,calls=0;const progress=[];
 const found={query:'赤鹤星周期',provider:'bocha',searchedAt:100,results:[{index:1,title:'测量',url:'https://observatory.example/',content:'周期73天。'}]};
 const f=fixture({knowledge:{revision:async()=>0,candidates:async()=>[],find:async()=>null,remember:async()=>remembers++},search:async()=>found,
  request:d=>respond(d,++calls===1 ? plan('web-search','','赤鹤星周期') : '周期73天。[1]')});
 const result=await f.service.run({question:'周期是多少',onProgress:r=>progress.push(r)});
 assert.equal(result.answer,'周期73天。');assert.deepEqual(result.citationIndices,[1]);assert.equal(result.query,'赤鹤星周期');assert.deepEqual(result.sources,found.results);
 assert.equal(result.calls.cloud,2);assert.equal(result.cached,false);assert.equal(remembers,0);assert.ok(progress.some(r=>r.stage==='search'));
 assert.equal(result.checks.every(c=>c.pass),true);
 assert.deepEqual(result.trace.map(row=>row.stage),['context','model','intent','search','sources','model','provider','checks','complete']);
 assert.ok(result.trace.every(row=>typeof row.label==='string' && row.elapsedMs>=0));
 assert.ok(progress.some(row=>row.trace?.some(event=>event.stage==='search')),'进行中也投影真实链路');
 assert.ok(!JSON.stringify(result.trace).includes('test-key'),'链路不包含请求凭据或完整提示词');
});
test('PK问答测试记录两路查询、来源性质和排除原因，供扩展内检查实际依据',async()=>{
 let calls=0;const f=fixture({search:async()=>({results:[
  {index:1,title:'错误文章',url:'https://seo.example/pk',content:'PK视频播放量翻倍，按播放量排名。'},
  {index:2,title:'玩法',url:'https://guide.example/pk',content:'本玩法按PK分结算。'}
 ]}),request:d=>respond(d,++calls===1 ? plan('web-search','','抖音PK规则') : '{"answer":"本玩法按PK分结算。","sources":[1]}')});
 const result=await f.service.run({question:'抖音PK规则'});
 assert.equal(result.queries.length,2);assert.equal(result.excludedSources.length,1);assert.equal(result.sourceReview[0].kind,'third-party');
 assert.ok(result.trace.some(row=>row.stage==='verification' && /排除1/u.test(row.detail)));
 assert.equal(result.checks.every(row=>row.pass),true);
});
test('可绕过缓存重查，有效缓存也可复用且标原采集时间',async()=>{
 let searches=0,calls=0;const found={id:'00000000-0000-4000-8000-000000000000',cached:true,query:'规则',searchedAt:123,results:[{index:1,content:'已核实规则',url:'https://rules.example/'}]};
 const f=fixture({knowledge:{revision:async()=>0,candidates:async()=>[found],find:async()=>found},
  search:async()=>{searches++;return {...found,cached:false};},request:d=>{calls++;respond(d,calls===1 ? plan('knowledge','已核实规则。[1]',found.id) : calls===2 ? plan('web-search','','规则') : '已核实规则。[1]');}});
 const cached=await f.service.run({question:'规则是什么'});assert.equal(cached.cached,true);assert.equal(cached.searchedAt,123);assert.equal(searches,0);
 const fresh=await f.service.run({question:'规则是什么',fresh:true});assert.equal(fresh.cached,false);assert.equal(searches,1);
});
test('重复运行串行限制；取消中止请求，迟到成功不能变成有效测试结果',async()=>{
 let pending,aborts=0;const f=fixture({request:d=>{pending=d;return {abort:()=>aborts++};}}),controller=new AbortController();
 const running=f.service.run({question:'你好',signal:controller.signal});
 await assert.rejects(f.service.run({question:'重复'}),/进行中/u);
 await new Promise(setImmediate);controller.abort();const result=await running;
 respond(pending,'迟到回复');assert.equal(result.status,'cancelled');assert.equal(result.answer,'');assert.equal(aborts,1);
 assert.equal(result.trace.at(-1).stage,'cancelled');assert.ok(!result.trace.some(row=>row.stage==='complete'));
});
test('配置切换后迟到结果失效，失败原因与联网异常可见',async()=>{
 let pending;const f=fixture({request:d=>{pending=d;}});
 const running=f.service.run({question:'你好'});await new Promise(setImmediate);f.update({ai:{model:'different-model'}});respond(pending,plan('chat','旧回复'));
 assert.equal((await running).status,'cancelled');
 const bad=fixture({request:d=>d.onload({status:401,responseText:'{}'})});assert.match((await bad.service.run({question:'你好'})).error,/认证|API Key/u);
 const offline=fixture({search:async()=>{throw Error('HTTP 429');},request:d=>respond(d,plan('web-search','','测试'))});
 const result=await offline.service.run({question:'查资料'});assert.match(result.searchError,/429/u);assert.ok(result.status==='failed' || result.checks.some(c=>!c.pass));
});
test('测试额度按真实模型请求计数，搜索后第二次请求也计费，过一小时可继续',async()=>{
 let calls=0;const f=fixture({request:d=>respond(d,++calls%2 ? plan('web-search','','规则') : '规则。[1]'),search:async()=>({results:[{index:1,content:'规则'}]})});
 f.config.ai.maxPerHour=2;
 assert.equal((await f.service.run({question:'规则'})).calls.cloud,2);
 assert.match((await f.service.run({question:'规则'})).error,/额度/u);assert.equal(calls,2);
 f.advance(3600001);assert.equal((await f.service.run({question:'规则'})).status,'succeeded');
});
test('准备好的端侧模型沿用联网路由，显示实际提供回复的本地模型',async()=>{
 const f=fixture({edge:{ready:async()=>true,reply:async p=>p.intentRouting ? plan('chat','本地回答。') : '本地回答。'}});
 f.config.ai.edge.enabled=true;f.config.ai.edge.localOnly=true;
 const result=await f.service.run({question:'你好',mode:'contextual'});
 assert.equal(result.answer,'本地回答。');assert.equal(result.provider,'edge');assert.equal(result.calls.local,1);
});
test('基本检查发现超长、代主持和缺来源；预设场景只检查流程，不宣称事实正确',async()=>{
 for(const answer of ['长'.repeat(100),'我来转达。']){
  const f=fixture({request:d=>respond(d,plan('chat',answer))});
  const result=await f.service.run({question:'你好'});assert.ok(result.status==='failed' || result.checks.some(c=>!c.pass));
 }
 const skip=fixture({request:d=>respond(d,plan('skip'))});assert.equal((await skip.service.run({question:'噪声'})).status,'skipped');
 assert.equal(AI_TEST_CASES.length,15);assert.ok(AI_TEST_CASES.every(c=>c.fixture && c.criteria.length));
});
test('非法输入不调用模型，断开的页面不能继续测试',async()=>{
 const f=fixture();for(const question of ['', '字'.repeat(1001)])await assert.rejects(f.service.run({question}),/问题/u);
 assert.equal(f.requests.length,0);
 const closed=fixture({isCurrent:()=>false});assert.equal((await closed.service.run({question:'你好'})).status,'cancelled');assert.equal(closed.requests.length,0);
});

test('无效的已保存组合不会锁死测试入口，修正配置后可重试',async()=>{
 const f=fixture();f.config.ai.pipeline.mode='omni-only';
 await assert.rejects(f.service.run({question:'你好'}),/业务空间/u);
 f.config.ai.pipeline.mode='text';assert.equal((await f.service.run({question:'你好'})).status,'succeeded');
});

test('切换主播或已保存配置后不带入此前测试对话',async()=>{
 const f=fixture(),first=await f.service.run({question:'上一主播的问题'});
 f.update({anchorId:'different-anchor'});
 const second=await f.service.run({question:'当前问题',turns:[first]});
 const input=JSON.parse(f.requests.at(-1).messages[1].content);
 assert.equal(second.contextRevision,2);assert.ok(!input.recent_chat.some(row=>row.text===first.question));assert.ok(!input.recent_replies.includes(first.answer));
});

test('固定评测使用隔离资料和实际模型请求，不读取现场、不调用搜索服务且评分答案不泄露',async()=>{
 for(const answer of ['上海11月5日小雨，18至23℃。[2]','上海11月5日晴，35至40℃。[1]']){
  let count=0;const bodies=[];
  const f=fixture({getContext:()=>assert.fail('固定评测不能读取现场'),search:()=>assert.fail('不能调用外部搜索'),request:d=>{
   bodies.push(JSON.parse(JSON.parse(d.data).messages[1].content));respond(d,++count===1 ? plan('web-search','','上海2026年11月5日天气') : answer);
  }});
  const testCase=AI_TEST_CASES.find(c=>c.id==='weather');
  const result=await f.service.run({question:testCase.question,testCase});
  assert.equal(result.controlled,true);assert.equal(result.calls.cloud,2);assert.equal(result.sources.length,2);
  assert.equal(result.checks.every(c=>c.pass),answer.includes('小雨'));
  assert.ok(!JSON.stringify(bodies).includes('选对日期与天气'));
  assert.ok(!JSON.stringify(bodies).includes('citationIndices'));
  assert.equal(f.config.ai.search.rememberKnowledge,true);
 }
});

test('引用修订仍失败在问答测试内显示真实原因，不会被判成完全达标',async()=>{
 let count=0;const f=fixture({search:async()=>({results:[{index:1,content:'上海小雨。'}]}),request:d=>respond(d,++count===1 ? plan('web-search','','上海天气') : '上海小雨。')});
 const result=await f.service.run({question:'上海天气'});
 assert.equal(result.status,'failed');assert.equal(result.answer,'');assert.match(result.error,/引用/);assert.equal(result.calls.cloud,3);assert.equal(result.trace.at(-1).status,'failed');
});

test('关系问答共用预览额度，围绕指定人物证据回答且不受公屏短字数截断',async()=>{
 const answer='小雨与阿明的朋友关系来自本人自述，仍待核实。'.repeat(8);
 const bodies=[],f=fixture({request:d=>{bodies.push(JSON.parse(d.data));respond(d,plan('chat',answer));}});const graph={entities:[{id:'p',name:'小雨'}],relations:[],focus:{entityIds:['p'],names:['小雨']},policy:'没有原话不能编造关系'};
 const result=await f.service.run({question:'他有哪些关系？',mode:'relationships',relationshipContext:graph});
 assert.equal(result.status,'succeeded');const input=JSON.parse(bodies[0].messages[1].content);
 assert.deepEqual(input.evidence_context.relationships.focus.entityIds,['p']);assert.equal(input.data.replyMode,'relationships');
 assert.ok(JSON.stringify(bodies[0]).includes('不能编造'));assert.equal(result.calls.cloud,1);
 assert.equal(result.answer,answer);assert.ok(result.checks.every(c=>c.pass));
 await assert.rejects(f.service.run({question:'没有证据',mode:'relationships'}),/人物证据/);
});

test('工作台人物证据超过模型预算时明确失败，不让无证据回答冒充梳理结果',async()=>{
 const f=fixture();f.config.ai.pipeline.contextBudgetChars=16000;
 const result=await f.service.run({question:'他们是什么关系',mode:'relationships',relationshipContext:{entities:[{name:'阿明',evidence:[{text:'原话'.repeat(20000)}]}],relations:[]}});
 assert.equal(result.status,'failed');assert.match(result.error,/人物证据.*预算/);assert.equal(f.requests.length,0);
});
