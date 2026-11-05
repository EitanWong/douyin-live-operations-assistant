import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAIClient,makeAIRequest} from '../../src/services/ai.js';
import {createLocalReply} from '../../src/services/local-search.js';
import {makeEdgeMessages} from '../../src/ai/edge-prompt.js';
import {mergeConfig} from '../../src/core/engine.js';

const config=mergeConfig({ai:{search:{enabled:true}}}).ai;
const at=Date.parse('2026-11-04T16:05:06Z');
const prompt={task:{kind:'ai',data:{replyMode:'direct'}},target:{text:'@Eitan 横店今天天气怎么样'},maxLength:80,getNow:()=>at};
const plan={intent:'weather',location:'横店',region:'浙江',date:'today',period:'day'};
const found={provider:'open-meteo',query:'浙江横店2026-11-05天气',searchedAt:at,results:[{index:1,title:'浙江横店天气预报',url:'https://api.open-meteo.com/v1/forecast?latitude=29.15698&longitude=120.31478',content:'浙江横店2026-11-05天气预报：小雨，15至21℃。',publishedAt:null}]};

test('横店天气优先查询定位后的天气数据，搜索关闭也能回答并保留来源',async()=>{
 const records=[];let lookups=0,calls=0;
 const client=createAIClient({generate:async p=>{calls++;if(p.intentRouting)return JSON.stringify(plan);assert.equal(p.searchResults.provider,'open-meteo');return '{"answer":"浙江横店今天小雨，15至21℃。","sources":[1]}';},weather:async(request,options)=>{lookups++;assert.equal(request.location,'横店');assert.equal(options.now,at);return found;},search:()=>assert.fail('不需要网页搜索'),onSearch:r=>records.push(r)});
 assert.equal(await client(prompt,{...config,search:{...config.search,enabled:false}}),'浙江横店今天小雨，15至21℃。');
 assert.equal(lookups,1);assert.equal(calls,2);assert.deepEqual(records[0].citationIndices,[1]);
});
test('天气接口失败后使用限定地点日期的网页补查，不把相似地名当作依据',async()=>{
 const queries=[],records=[];
 const client=createAIClient({generate:async p=>p.intentRouting ? JSON.stringify(plan) : '{"answer":"横店今天小雨，15至21℃。","sources":[1]}',weather:async()=>{throw Error('weather offline');},search:async q=>{queries.push(q);return {query:q,searchedAt:at,results:queries.length===1 ? [{index:1,title:'横山天气',url:'https://weather.example/hengshan',content:'横山2026-11-05晴，横峰2026-11-05晴。'}] : found.results};},onSearch:r=>records.push(r)});
 assert.equal(await client(prompt,config),'横店今天小雨，15至21℃。');assert.equal(queries.length,2);
 assert.ok(queries.every(q=>q.includes('横店') && q.includes('2026-11-05')));assert.equal(records[0].results.length,1);assert.match(records[0].excluded[0].reason,/地点/u);
});
test('同名地点确实有歧义才澄清，不能擅用另一个地点的天气',async()=>{
 let calls=0;
 const client=createAIClient({generate:async()=>{calls++;return JSON.stringify({...plan,region:''});},weather:async()=>({clarification:'你问的是浙江横店还是湖北横店？'}),search:()=>assert.fail()});
 assert.match(await client(prompt,config),/浙江横店.*湖北横店/u);assert.equal(calls,1);
});
test('时间直接使用当前时钟与指定时区，下一次提问刷新时间，不搜索或复用缓存',async()=>{
 let now=at;const client=createAIClient({generate:async()=>'{"intent":"clock","timeZone":"Asia/Shanghai"}',search:()=>assert.fail(),knowledge:{revision:async()=>1,candidates:async()=>[],find:()=>assert.fail()}});
 const question={...prompt,target:{text:'现在北京时间几点，几号星期几？'},getNow:()=>now};
 assert.match(await client(question,config),/2026年11月5日.*星期四.*00:05:06/u);
 now+=61000;assert.match(await client(question,config),/00:06:07/u);
 const local=createLocalReply({edge:{reply:async()=>'{"intent":"clock","timeZone":"America/New_York"}'}});
 assert.match(await local(question,config),/America\/New_York.*2026年11月4日.*11:06:07/u);
});
test('云端、端侧与搜索回答均得到明确日期时区，不依赖模型猜今天',()=>{
 for(const p of [prompt,{...prompt,searchResults:found}]){
  for(const request of [makeAIRequest(p,config),{messages:makeEdgeMessages(p,config)}]){
   const data=JSON.parse(request.messages[1].content);assert.equal(data.current_time.timeZone,'Asia/Shanghai');assert.equal(data.current_time.date,'2026-11-05');assert.equal(data.current_time.time,'00:05:06');
  }
 }
});
test('取消和后续额度继续约束天气查询，取消不交付晚到数据',async()=>{
 let current=true,calls=0;
 const client=createAIClient({generate:async()=>JSON.stringify(plan),weather:async()=>{calls++;current=false;return found;}});
 assert.equal(await client({...prompt,isCurrent:()=>current},config),'[SKIP]');assert.equal(calls,1);
 assert.match(await client({...prompt,canFollowup:()=>false},config),/暂时还答不了/u);assert.equal(calls,1);
});
test('网页备用资料即使地名日期相同，行政区域不符也不能据此回答',async()=>{
 const records=[];let queries=0;
 const client=createAIClient({generate:async p=>p.intentRouting ? JSON.stringify(plan) : '{"answer":"横店晴，35℃。","sources":[]}',weather:async()=>{throw Error('offline');},search:async()=>{queries++;return {results:[{index:1,title:'湖北横店天气',url:'https://weather.example/hubei',content:'湖北横店2026-11-05晴，35℃。'}]};},onSearch:r=>records.push(r)});
 assert.doesNotMatch(await client(prompt,config),/35|晴/u);assert.equal(queries,2);assert.equal(records[0].results.length,0);assert.match(records[0].excluded[0].reason,/行政区域/u);
});
