import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAccountMediaAnalyzer,capturePublicWorkSample} from '../../extension/account-media.js';
import {JSDOM} from 'jsdom';
import {mergeConfig} from '../../src/core/engine.js';
const source={url:'https://www.douyin.com/video/70',kind:'work',id:'70'};
const records=[{kind:'work',id:'70',subject:'sec-author',title:'作品',source:source.url,url:source.url}];
test('下载来源来自已绑定详情，不依赖视频出现、可播放或 currentSrc 改写',async()=>{
 const page=new JSDOM('<body><video></video></body>',{url:source.url,runScripts:'outside-only'}).window;
 const media={workId:'70',author:'sec-author',url:'https://v1.example.douyinvod.com/file?signature=original'};
 try{
  let sourceReads=0;page.__liveAssistantPublicAccountV1={mediaSource:value=>{assert.equal(value,undefined);sourceReads++;return media;},mediaMatches:()=>false};
  const sample=page.eval(`(${capturePublicWorkSample.toString()})`);
  assert.equal((await sample({audio:false,video:false,workId:'70'})).mediaSource,media);
  assert.equal((await sample({audio:false,video:false,workId:'71'})).mediaSource,undefined);
  assert.equal(sourceReads,2);
 }finally{page.close();}
});
test('仅明确启用的本地方案采样作品音画；每作一帧/4秒，转写不认证说话人，无云端费用',async()=>{
 const config=mergeConfig({ai:{pipeline:{mode:'local-multimodal'}}}).ai,calls=[];
 const analyzer=createAccountMediaAnalyzer({readAI:async()=>config,capture:async()=>{calls.push('capture');return {frame:'data:image/jpeg;base64,anBlZw==',audio:'wav',positionMs:1200};},transcribe:async()=>{calls.push('asr');return '小雨是阿明的朋友';},recognize:async()=>{calls.push('vision');return {text:'画面中有杯子'};},now:()=>1800000000000});
 const rows=await analyzer({source,records,tabId:1});assert.deepEqual(calls,['capture','asr','vision']);assert.equal(rows.length,2);
 assert.equal(rows[0].kind,'transcript');assert.equal(rows[0].actor,undefined);assert.equal(rows[0].positionMs,1200);assert.equal(rows[1].kind,'visual');assert.match(rows[0].coverage,/4秒/);
 config.pipeline.mode='ali-split';assert.deepEqual(await analyzer({source,records,tabId:1}),[]);assert.equal(calls.length,3);
});
test('播放源经独立回调交给任务，不成为音画文字记录，变更配置丢弃迟到地址',async()=>{
 const ai=mergeConfig({ai:{pipeline:{mode:'local-audio'}}}).ai,media={workId:'70',author:'sec-author'},sources=[];
 const analyzer=createAccountMediaAnalyzer({readAI:async()=>ai,capture:async()=>({mediaSource:media}),onMedia:value=>sources.push(value)});
 assert.deepEqual(await analyzer({source,records,tabId:1}),[]);assert.deepEqual(sources,[media]);
 const late=createAccountMediaAnalyzer({readAI:async()=>ai,capture:async()=>{ai.pipeline.mode='text';return {mediaSource:media};},onMedia:value=>sources.push(value)});
 await late({source,records,tabId:1});assert.equal(sources.length,1);
});
test('缺失、失败和取消不伪造媒体证据，改配置后丢弃迟到结果，保留可用画面',async()=>{
 const config=mergeConfig({ai:{pipeline:{mode:'local-multimodal'}}}).ai;
 const analyzer=createAccountMediaAnalyzer({readAI:async()=>config,capture:async()=>({frame:'data:image/jpeg;base64,anBlZw=='}),transcribe:async()=>{throw Error('missing');},recognize:async()=>({text:'可见文字'}),now:()=>1800000000000});
 assert.equal((await analyzer({source,records,tabId:1}))[0].kind,'visual');
 const late=createAccountMediaAnalyzer({readAI:async()=>config,capture:async()=>{config.pipeline.mode='text';return {frame:'frame'};},recognize:async()=>{throw Error('must not run');}});
 assert.deepEqual(await late({source,records,tabId:1}),[]);
 const c=new AbortController();c.abort();await assert.rejects(analyzer({source,records,tabId:1,signal:c.signal}),/取消/);
});
