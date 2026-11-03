import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLocalReply} from '../../src/services/local-search.js';
test('prepared local replies can ground an explicit web lookup without a cloud-model call',async()=>{
 let searches=0;const reply=createLocalReply({edge:{reply:async p=>{assert.equal(p.searchResults.results[0].title,'官方天气');return '预报是晴天。[1]';}},search:async()=>{searches++;return {results:[{index:1,title:'官方天气',snippet:'预报晴天',url:'https://weather.example'}]};}});
 assert.equal(await reply({target:{text:'联网查一下明天天气'},maxLength:40},{search:{enabled:true}}),'预报是晴天。[1]');assert.equal(searches,1);
});
test('local ungrounded citations and unavailable web search never turn into claimed search facts',async()=>{
 const edge={reply:async()=> '随便说一个结果'},search=async()=>({results:[{index:1,title:'source'}]});
 assert.match(await createLocalReply({edge,search})({target:{text:'搜索最新新闻'}},{search:{enabled:true}}),/无法确认/);
 let calls=0;assert.match(await createLocalReply({edge:{reply:async()=>calls++}})({target:{text:'联网查一下'}},{search:{enabled:false}}),/未启用/);assert.equal(calls,0);
});
