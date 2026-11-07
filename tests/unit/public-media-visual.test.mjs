import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPublicMediaVisualAnalyzer} from '../../extension/public-media-visual.js';
import {mergeConfig} from '../../src/core/engine.js';

const job={id:'a'.repeat(64),room:'1',anchor:'10',subject:'uid:2',epoch:0,workId:'70',author:'author-sec',mediaHash:'b'.repeat(64),analysisVersion:'sensevoice-v1+keyframes-v1',knowledgeVersion:0};
const frame={atMs:1000,data:'/9j/2Q=='};
function fixture(text='红色茶杯，杯身文字“冷水”。'){
 let config=mergeConfig({anchorId:'10',ai:{enabled:true,pipeline:{mode:'local-multimodal'},edge:{enabled:true,audioEnabled:true},accountCollection:{enabled:true}}}),epoch=0,allowed=true,version=0,calls=[];
 const binding={subject:'uid:2',sources:['https://www.douyin.com/user/author-sec']};
 const analyzer=createPublicMediaVisualAnalyzer({readConfig:async()=>config,resolveProfile:async()=>({epoch,binding}),checkProfile:async()=>{if(epoch)throw Error('forgotten');},canArchive:()=>allowed,backgroundAllowed:()=>true,readVersion:async()=>version,
  recognize:async(sample,media,options)=>{calls.push({sample,media,options});return {text};}});
 return {analyzer,calls,forget:()=>epoch++,off:()=>allowed=false,clear:()=>version++,mode:mode=>config.ai.pipeline.mode=mode};
}
test('后台关键帧沿用本机视觉配置，保留时间戳，身份/版本/开关不匹配不调用模型',async()=>{
 const f=fixture(),result=await f.analyzer({job,frame});assert.match(result.text,/红色茶杯/);assert.equal(result.model,'qwen2.5vl:3b');
 assert.equal(f.calls[0].sample.at,1000);assert.equal(f.calls[0].sample.data,'data:image/jpeg;base64,/9j/2Q==');assert.equal(f.calls[0].media.localVision,true);
 for(const mutate of [f=>f.forget(),f=>f.off(),f=>f.clear(),f=>f.mode('local-audio')]){const x=fixture();mutate(x);await assert.rejects(x.analyzer({job,frame}));assert.equal(x.calls.length,0);}
 await assert.rejects(f.analyzer({job:{...job,subject:'uid:3'},frame}));
 assert.equal(f.calls.length,1);
});
test('视觉结果按1200个完整Unicode字符截取，可无损传给原生UTF-8存储',async()=>{
 const expected='汉'.repeat(1199)+'😀',f=fixture(expected+'尾部');
 const {text}=await f.analyzer({job,frame});
 assert.equal(text,expected);
 assert.equal(Buffer.from(text).toString('utf8'),text);
 const malformed=await fixture('观察\uD83D').analyzer({job,frame});
 assert.equal(malformed.text,'观察\uFFFD');
 assert.equal(Buffer.from(malformed.text).toString('utf8'),malformed.text);
});
test('取消信号传入既有视觉客户端，迟到结果不通过重新核对',async()=>{
 let finish;const f=fixture(),controller=new AbortController();controller.abort();
 await assert.rejects(f.analyzer({job,frame},{signal:controller.signal}));assert.equal(f.calls.length,0);
 const gate=new Promise(resolve=>finish=resolve);let epoch=0;
 const analyzer=createPublicMediaVisualAnalyzer({readConfig:async()=>mergeConfig({anchorId:'10',ai:{enabled:true,pipeline:{mode:'local-multimodal'},edge:{enabled:true,audioEnabled:true}}}),resolveProfile:async()=>({epoch,binding:{subject:'uid:2',sources:['https://www.douyin.com/user/author-sec']}}),checkProfile:async()=>{},readVersion:async()=>0,recognize:async()=>{await gate;return {text:'late'};}});
 const pending=analyzer({job,frame});await Promise.resolve();epoch=1;finish();await assert.rejects(pending);
});
