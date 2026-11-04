import {test} from 'node:test';
import assert from 'node:assert/strict';
import {researchQueries,collectResearch,reviewResearch} from '../../src/services/web-research.js';
import {createSearchClient,SEARCH_DEFAULTS} from '../../src/services/search.js';
import {makeAIRequest} from '../../src/services/ai.js';
import {mergeConfig} from '../../src/core/engine.js';
const source=(url,content,index=1)=>({index,url,title:'PK资料',content,publishedAt:null});
const plan={query:'抖音直播PK规则',freshness:'rules'};
test('PK查证覆盖计分、时长与加成，同时检索官方；普通天气仅一次搜索',()=>{
 const queries=researchQueries('抖音直播PK规则',plan);
 assert.equal(queries.length,2);assert.match(queries[0],/时长/);assert.match(queries[0],/首送|首翻/);assert.match(queries[0],/加成/);
 assert.match(queries[1],/site:streamingtool.douyin.com/);
 assert.deepEqual(researchQueries('上海天气',{query:'上海明天天气'}),['上海明天天气']);
 assert.ok(researchQueries('PK规则',{query:'词'.repeat(300)}).every(q=>[...q].length<=300));
});
test('两个检索并行，去重与重新编号；单路失败仍使用另一组资料',async()=>{
 const waiting=[];const search=(query,config,options)=>new Promise((resolve,reject)=>waiting.push({query,resolve,reject,options}));
 const signal=new AbortController().signal;
 const pending=collectResearch({question:'抖音PK规则',plan,config:{maxResults:3},search,signal,timeout:8000});
 assert.equal(waiting.length,2);assert.equal(waiting[0].options.signal,signal);
 waiting[0].reject(Error('HTTP 429'));
 waiting[1].resolve({provider:'bocha',searchedAt:10,results:[source('https://streamingtool.douyin.com/docs/guide_72891','多人PK需要选择参与主播。')]});
 const found=await pending;
 assert.equal(found.results.length,1);assert.equal(found.results[0].index,1);assert.equal(found.searches.length,2);
 assert.match(found.searches[0].error,/429/);assert.equal(found.error,undefined);
});
test('网页发布在抖音不等于官方；摘要不能证明视频或当前场次规则',()=>{
 const found=reviewResearch('抖音直播PK规则',{results:[
  source('https://www.douyin.com/video/7365735781748444457','评论：首翻丢卡保底2倍，其他时候55%概率1.5倍。'),
  source('https://streamingtool.douyin.com/docs/guide_72891','多人PK需要选择主播。',2),
  source('https://streamingtool.douyin.com.evil.test/docs/rules','这是官方规则',3)
 ]});
 assert.equal(found.evidence[0].kind,'user-content');assert.equal(found.evidence[1].kind,'official-document');
 assert.equal(found.evidence[2].kind,'third-party');assert.match(found.evidence[0].caution,/评论|摘要/);
});
test('排除把短视频播放量当成直播PK积分的资料，保留其他来源和原编号',()=>{
 const found=reviewResearch('抖音直播PK规则',{results:[
  source('https://seo.example/rule','PK前30秒视频播放量翻倍，按总播放量排名。'),
  source('https://guide.example/pk','本活动按礼物PK分结算。',2)
 ]});
 assert.deepEqual(found.results.map(r=>r.index),[2]);assert.equal(found.excluded.length,1);
 assert.match(found.excluded[0].reason,/播放量/);
 assert.equal(reviewResearch('短视频播放量翻倍是什么',{results:[source('https://a.test','视频播放量翻倍')]}).results.length,1);
 assert.equal(reviewResearch('抖音PK规则',{results:[source('https://a.test','PK并非按视频播放量排名，而应看本局PK分。')]}).results.length,1);
});
test('合并来源尊重数量限制，官方优先但不把官方身份当作结论证明',async()=>{
 const found=await collectResearch({question:'PK规则',plan,config:{maxResults:2},search:async query=>({provider:'bocha',searchedAt:10,results:query.includes('site:') ? [source('https://streamingtool.douyin.com/docs/guide_72891','只说明发起多人PK的操作。')] : [source('https://a.test','玩法说明'),source('https://a.test','重复链接',2),source('https://b.test','其他玩法',3)]})});
 assert.equal(found.results.length,2);assert.match(found.results[0].url,/streamingtool/);assert.deepEqual(found.results.map(r=>r.index),[1,2]);
 assert.match(found.evidence[0].caution,/实际支持/);
});
test('取消后不发起检索；失败记录保留且不会伪造来源',async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(collectResearch({question:'PK规则',plan,config:{maxResults:3},signal:controller.signal,search:()=>{calls++;}}),/取消/);assert.equal(calls,0);
 const found=await collectResearch({question:'PK规则',plan,config:{maxResults:3},search:async()=>{throw Error('offline');}});
 assert.equal(found.results.length,0);assert.match(found.error,/offline/);assert.equal(found.searches.length,2);
});
test('两路并行检索共享真实搜索客户端额度，第二路被限额时保留第一路答案资料',async()=>{
 let calls=0;const config={...SEARCH_DEFAULTS,enabled:true,maxPerHour:1};
 const search=createSearchClient({getKey:()=> 'test',request:details=>{calls++;details.onload({status:200,responseText:JSON.stringify({code:200,data:{webPages:{value:[{name:'玩法',url:'https://guide.example/pk',summary:'本玩法按PK分结算。'}]}}})});}});
 const found=await collectResearch({question:'抖音PK规则',plan,config,search});
 assert.equal(calls,1);assert.equal(found.results.length,1);assert.match(found.searches[1].error,/额度/);assert.equal(found.error,undefined);
});
test('没有来源的PK问题仍保留事实边界，普通天气不附带无关PK专用指令',()=>{
 const ai=mergeConfig().ai;
 const make=(question)=>makeAIRequest({target:{text:question},task:{kind:'ai'},maxLength:50,searchResults:reviewResearch(question,{results:[]})},ai).messages[0].content;
 assert.match(make('抖音PK规则是什么'),/首翻\/首送加成/);
 assert.doesNotMatch(make('上海明天天气'),/首翻\/首送加成/);
});
