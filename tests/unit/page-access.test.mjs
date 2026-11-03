import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {accessPage} from '../../extension/page-access.js';

test('Chrome 调用绑定真实 sender 文档和主框架，切房/旧文档/伪造命令被拒绝',async()=>{
  const dom=new JSDOM('',{url:'https://live.douyin.com/?room_id=123',runScripts:'outside-only'}),page=dom.window;
  let calls=0;
  const sender={frameId:0,documentId:'doc-current',url:page.location.href,tab:{id:7,url:page.location.href}};
  const chrome={scripting:{executeScript:async input=>{
    calls++;assert.deepEqual(input.target,{tabId:7,documentIds:['doc-current']});assert.equal(input.world,'MAIN');
    return [{documentId:'doc-current',result:page.eval(`(${input.func.toString()})(...${JSON.stringify(input.args)})`)}];
  }}};
  Object.defineProperty(page,'__douyinAssistantPageV2',{value:Object.freeze({room:'123',call:command=>command.type==='drain'?{events:[{id:'real'}]}:true})});
  try {
    assert.equal((await accessPage(chrome,sender,{type:'drain'})).events[0].id,'real');
    for(const invalid of [{...sender,frameId:2},{...sender,documentId:undefined},{...sender,url:'https://evil.test/123'},{...sender,tab:{id:7,url:'https://live.douyin.com/456'}}])await assert.rejects(accessPage(chrome,invalid,{type:'drain'}));
    await assert.rejects(accessPage(chrome,sender,{type:'publish',event:{id:'fake'}}));assert.equal(calls,1);
    page.history.replaceState({},'','/?room_id=456');await assert.rejects(accessPage(chrome,sender,{type:'drain'}),/切换/);
    await assert.rejects(accessPage({scripting:{executeScript:async()=>[{documentId:'doc-old',result:true}]}},sender,{type:'drain'}),/失效/);
  } finally {page.close();}
});
