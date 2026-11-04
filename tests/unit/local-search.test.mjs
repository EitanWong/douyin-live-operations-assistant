import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLocalReply} from '../../src/services/local-search.js';
test('prepared local replies can ground an explicit web lookup without a cloud-model call',async()=>{
 let searches=0;const reply=createLocalReply({edge:{reply:async p=>{if(p.intentRouting)return JSON.stringify({intent:'web-search',query:'上海明天天气',reply:''});assert.equal(p.searchResults.results[0].title,'官方天气');return '预报是晴天。[1]';}},search:async()=>{searches++;return {results:[{index:1,title:'官方天气',snippet:'预报晴天',url:'https://weather.example'}]};}});
 assert.equal(await reply({target:{text:'联网查一下明天天气'},maxLength:40},{search:{enabled:true}}),'预报是晴天。');assert.equal(searches,1);
});
test('local answers survive missing citations and search failures remain visible',async()=>{
 const edge={reply:async p=>p.intentRouting ? JSON.stringify({intent:'web-search',query:'最新新闻',reply:''}) : p.searchResults.error ? '新闻查询尚不可用，请提供具体事件。' : '本次报道未提到事件日期。'},search=async()=>({results:[{index:1,title:'source'}]});
 const records=[];assert.equal(await createLocalReply({edge,search,onSearch:r=>records.push(r)})({target:{text:'搜索最新新闻'}},{search:{enabled:true}}),'本次报道未提到事件日期。');assert.match(records[0].citationWarning,/引用/);
 let calls=0;assert.match(await createLocalReply({edge,search:()=>calls++})({target:{text:'联网查一下'}},{search:{enabled:false}}),/最新新闻.*没查到/u);assert.equal(calls,0);
});

test('自然天气提问通过意图查证，缺城市先澄清；普通聊天不联网',async()=>{
 for(const [text,intent,reply] of [['上海明天会下雨吗','web-search','上海明天有雨。[1]'],['我想知道今天的天气','clarify','你想查哪个城市？'],['天气真好呀','chat','是呀，适合出去走走。']]){
  let searches=0,reserved=0;
  const local=createLocalReply({edge:{reply:async p=>p.intentRouting ? JSON.stringify({intent,query:intent==='web-search' ? '上海明天天气' : '',reply:intent==='web-search' ? '' : reply}) : reply},search:async q=>{searches++;assert.equal(q,'上海明天天气');return {results:[{index:1,content:'明天有雨'}]};}});
  assert.equal(await local({target:{text},maxLength:50,reserveLocal:()=>{reserved++;return true;}},{search:{enabled:true}}),reply.replace(/\[\d+\]/gu,''));
  assert.equal(searches,intent==='web-search' ? 1 : 0);assert.equal(reserved,searches);
 }
});
