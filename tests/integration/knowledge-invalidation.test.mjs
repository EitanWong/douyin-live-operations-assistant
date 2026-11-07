import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeCorpus} from '../../src/ai/knowledge-corpus.js';
import {sourcePassages} from '../../src/ai/source-evidence.js';
import {createKnowledgeMemory} from '../../src/services/automatic-knowledge.js';
import {createWebKnowledge} from '../../src/services/web-knowledge.js';
import {createAIClient,makeAIRequest} from '../../src/services/ai.js';
import {createLocalReply} from '../../src/services/local-search.js';
import {makeEdgeMessages} from '../../src/ai/edge-prompt.js';
import {parseAIIntent} from '../../src/services/intent.js';
import {mergeConfig} from '../../src/core/engine.js';

const question='整个夏天和贝雷帽',query='视频 整个夏天 贝雷帽 公开音画资料';
const config=mergeConfig({ai:{search:{enabled:true,rememberKnowledge:true}}}).ai;
const prompt={task:{kind:'ai'},target:{text:question,name:'私密昵称',memory:{key:'uid:3'}},context:[{text:'无关私密背景'}],maxLength:100};
const fresh={query,results:[{index:1,url:'https://example.org/new',title:'新资料',content:'公开音画资料仍需核实。'}]};
const missing='这部分资料已变化，暂时还不能确定。';
const route=c=>JSON.stringify({intent:'knowledge',query:c.id,reply:'旧音轨和画面结论。',sources:[1]});
async function fixture(){
 const now=Date.now(),values={},corpus=createKnowledgeCorpus({read:async k=>values[k],write:async(k,v)=>{values[k]=structuredClone(v);}});
 await corpus.remember('1','10',[
  {url:'https://example.org/video',title:'音轨',content:'整个夏天由未知说话人唱出。',coverage:'0–4000ms机器转录待核实，说话人未知'},
  {url:'https://example.org/video',title:'画面',content:'单帧贝雷帽，人物身份未知。',coverage:'单帧9400ms，不能推断帧外事件'}
 ].map(r=>({...r,at:now-1000,expiresAt:now+60000,evidenceKind:'public-media'})),{subject:'uid:10'});
 let rows=await corpus.list('1','10');const cache=createWebKnowledge({indexedDB:null});
 const memory=createKnowledgeMemory({cache,anchor:()=> '10',transport:async action=>action==='list' ? rows : 0});
 return {memory,close:()=>cache.close(),change:fn=>{rows=fn(rows);}};
}
const changes={deleted:rows=>rows.slice(1),expired:rows=>rows.map(r=>({...r,expiresAt:Date.now()-1})),scope:rows=>rows.map(r=>({...r,subject:'uid:99'})),content:rows=>rows.map(r=>({...r,text:r.text.replace('贝雷帽','棒球帽')})),coverage:rows=>rows.map(r=>({...r,coverage:'原范围已撤回，当前身份未知'}))};

for(const mode of ['cloud','edge'])for(const [kind,change] of Object.entries(changes))test(`${mode} ${kind}：失效复合知识重新提取语义搜索词，内部标识和私密上下文不出站`,async()=>{
 const f=await fixture(),queries=[],intents=[],records=[];let calls=0,reserves=0;
 try{
  const options={knowledge:f.memory,onIntent:p=>intents.push(p.intent),onSearch:r=>records.push(r),search:async q=>{queries.push(q);return fresh;},generate:async p=>{
   calls++;const messages=mode==='cloud' ? makeAIRequest(p,config).messages : makeEdgeMessages(p,config),data=JSON.parse(messages[1].content);
   if(calls===1){f.change(change);return route(p.knowledgeCandidates[0]);}
   if(p.intentRouting){
    assert.deepEqual(data.knowledge_candidates,[]);assert.equal(data.answer_draft,undefined);
    assert.doesNotMatch(JSON.stringify(data),/旧音轨和画面结论|corpus:/u);
    assert.match(messages[0].content,/失效|已变化/u);
    return JSON.stringify({intent:'web-search',query});
   }
   return JSON.stringify({answer:'公开音画资料仍需核实。',sources:[1]});
  }};
  const client=mode==='cloud' ? createAIClient(options) : createLocalReply({...options,edge:{reply:options.generate}});
  const reserve=async()=>{reserves++;return true;};
  assert.equal(await client({...prompt,reserveFollowup:reserve,reserveLocal:reserve},config),'公开音画资料仍需核实。');
  assert.deepEqual(queries,[query]);assert.deepEqual(intents,['knowledge','web-search']);assert.equal(calls,3);assert.equal(reserves,2);
  assert.equal(records.length,1);assert.equal(records[0].results[0].url,fresh.results[0].url);
 }finally{f.close();}
});

for(const [kind,change] of Object.entries(changes))test(`修订期间 ${kind}：合法编号也不能交付失效原文的旧结论`,async()=>{
 const f=await fixture(),records=[];let calls=0;
 try{
  const client=createAIClient({knowledge:f.memory,onSearch:r=>records.push(r),search:()=>assert.fail('修订失效后不能泄露旧查询'),generate:async p=>{
   calls++;if(p.intentRouting)return JSON.stringify({...JSON.parse(route(p.knowledgeCandidates[0])),sources:[99]});
   for(const messages of [makeAIRequest(p,config).messages,makeEdgeMessages(p,config)]){
    const found=JSON.parse(messages[1].content).web_search;
    assert.deepEqual(found.results,p.searchResults.results);assert.equal(sourcePassages(found.results[0]).length,2);
    assert.ok(sourcePassages(found.results[0]).every(s=>s.sourceId && s.coverage));
   }
   f.change(change);return JSON.stringify({answer:'已删除的旧结论。',sources:[1]});
  }});
  assert.equal(await client({...prompt,reserveFollowup:()=>true},config),missing);assert.equal(calls,2);assert.deepEqual(records,[]);
 }finally{f.close();}
});

test('原文有效时保持一次生成且不占后续额度；修订后原文仍有效可正常交付',async()=>{
 for(const refine of [false,true]){
  const f=await fixture();let calls=0,reserves=0;
  try{
   const client=createAIClient({knowledge:f.memory,generate:async p=>{
    calls++;return p.intentRouting ? JSON.stringify({...JSON.parse(route(p.knowledgeCandidates[0])),sources:refine ? [99] : [1]}) : JSON.stringify({answer:'原文仍有效。',sources:[1]});
   }});
   assert.equal(await client({...prompt,reserveFollowup:()=>{reserves++;return true;}},config),refine ? '原文仍有效。' : '旧音轨和画面结论。');
   assert.equal(calls,refine ? 2 : 1);assert.equal(reserves,refine ? 1 : 0);
  }finally{f.close();}
 }
});

test('知识重新路由只有一次，取消、两种额度拒绝及再次选择失效知识均有界停止',async()=>{
 for(const stop of ['canFollowup','reserveFollowup','abort-reservation','abort-generation','knowledge']){
  const f=await fixture(),controller=new AbortController();let calls=0,reserves=0,candidate;
  try{
   const client=createAIClient({knowledge:f.memory,search:()=>assert.fail('不得搜索内部标识'),generate:async p=>{
    calls++;if(calls===1){candidate=p.knowledgeCandidates[0];f.change(changes.deleted);return route(candidate);}
    if(stop==='abort-generation')controller.abort();return route(candidate);
   }});
   const answer=await client({...prompt,signal:controller.signal,canFollowup:()=>stop!=='canFollowup',reserveFollowup:async()=>{reserves++;if(stop==='abort-reservation')controller.abort();return stop!=='reserveFollowup';}},config);
   assert.equal(answer,stop.startsWith('abort') ? '[SKIP]' : stop==='knowledge' ? missing : '这次暂时还答不了，晚点再问我吧。');
   assert.equal(calls,['knowledge','abort-generation'].includes(stop) ? 2 : 1);assert.equal(reserves,stop==='canFollowup' ? 0 : 1);
  }finally{f.close();}
 }
});

test('重新路由复用 clock、weather、public-data、live-data、clarify、skip 分派；搜索关闭仍可澄清',async()=>{
 const plans=[{intent:'clock',timeZone:'Asia/Shanghai'},{intent:'weather',location:'横店',region:'浙江',date:'today',period:'day'},{intent:'public-data',call:{tool:'geocode',location:'横店'}},{intent:'live-data',reply:'现场信息不足。'},{intent:'clarify',reply:'你问的是哪段公开视频？'},{intent:'skip'}];
 for(const plan of plans){
  const f=await fixture();let calls=0,tools=0,live=0;
  try{
   const tool=async()=>{tools++;return fresh;};
   const client=createAIClient({knowledge:f.memory,weather:tool,publicData:tool,search:()=>assert.fail('关闭搜索不出站'),generate:async p=>{
    calls++;if(calls===1){f.change(changes.deleted);return route(p.knowledgeCandidates[0]);}
    return JSON.stringify(p.intentRouting ? plan : {answer:'工具已核对。',sources:[1]});
   }});
   const answer=await client({...prompt,maxLength:120,getNow:()=>Date.parse('2026-11-07T08:00:00Z'),reserveFollowup:()=>true,onLiveFacts:()=>live++},{...config,search:{...config.search,enabled:false}});
   if(plan.intent==='clock')assert.match(answer,/2026年11月7日.*16:00:00/u);
   else assert.equal(answer,plan.reply || (plan.intent==='skip' ? '[SKIP]' : '工具已核对。'));
   assert.equal(calls,tools ? 3 : 2);assert.equal(tools,['weather','public-data'].includes(plan.intent) ? 1 : 0);assert.equal(live,plan.intent==='live-data' ? 1 : 0);
  }finally{f.close();}
 }
});

test('web-search 输入边界拒绝任何携带内部 corpus 引用的搜索词',()=>{
 const ref=`corpus:${'a'.repeat(64)}:0-12`;
 for(const query of [ref,`搜索 ${ref}`,`CORPUS:${'a'.repeat(64)}:0-12`])assert.throws(()=>parseAIIntent(JSON.stringify({intent:'web-search',query}),100),/无效/u);
 assert.equal(parseAIIntent(JSON.stringify({intent:'web-search',query:'贝雷帽 公开资料'}),100).query,'贝雷帽 公开资料');
});

test('交付复核期间取消不通知旧来源，重新路由伪造搜索引用不能到达搜索器',async()=>{
 for(const kind of ['cancel-delivery','bad-query']){
  const f=await fixture(),controller=new AbortController(),records=[];let calls=0,reads=0,candidate;
  const memory={...f.memory,find:async(...args)=>{const found=await f.memory.find(...args);if(++reads===2 && kind==='cancel-delivery')controller.abort();return found;}};
  try{
   const client=createAIClient({knowledge:memory,onSearch:r=>records.push(r),search:()=>assert.fail('内部引用不能到达搜索器'),generate:async p=>{
    calls++;if(calls===1){candidate=p.knowledgeCandidates[0];if(kind==='bad-query')f.change(changes.deleted);return route(candidate);}
    return JSON.stringify({intent:'web-search',query:candidate.id});
   }});
   const result=client({...prompt,signal:controller.signal,reserveFollowup:()=>true},config);
   if(kind==='cancel-delivery')assert.equal(await result,'[SKIP]');else await assert.rejects(result,/无效/u);
   assert.equal(calls,kind==='cancel-delivery' ? 1 : 2);assert.deepEqual(records,[]);
  }finally{f.close();}
 }
});
