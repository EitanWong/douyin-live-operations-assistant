import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestJSON} from '../../src/services/search.js';
const request=(responseText,options={})=>requestJSON(d=>{d.onload({status:200,responseText});},{url:'https://example.com/chat/completions',body:{},stream:true,...options});
test('SSE 使用协议事件边界解析多行 data、注释、CRLF 与 BOM，保留完整完成校验',async()=>{
 const text='\uFEFF: keepalive\r\n\r\ndata: {"choices":[\r\ndata: {"delta":{"content":"你好"}}]}\r\n\r\ndata: {"choices":[{"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n';
 assert.equal((await request(text)).choices[0].message.content,'你好');
 for(const raw of ['data: {"choices":[{"delta":{"content":"截断"}}]}\n\n','data: {"error":{"message":"bad"}}\n\n','data: {"choices":[{"delta":{"content":123},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'])await assert.rejects(request(raw));
});
test('取消在途请求只中止一次并拒绝迟到响应，预先取消不发请求',async()=>{
 const c=new AbortController();let handle,aborted=0,sent=0;
 const pending=requestJSON(d=>{sent++;handle=d;return {abort(){aborted++;d.onabort();}};},{url:'https://example.com/chat/completions',body:{},signal:c.signal});
 c.abort();handle.onload({status:200,responseText:'{}'});await assert.rejects(pending,/取消/);assert.equal(aborted,1);
 await assert.rejects(requestJSON(()=>{sent++;},{url:'https://example.com/chat/completions',body:{},signal:c.signal}),/取消/);assert.equal(sent,1);
});

test('意图分支契约拒绝自相矛盾的跳过、搜索和直接回复计划',async()=>{
 const {parseAIIntent}=await import('../../src/services/intent.js');
 for(const plan of [{intent:'skip',query:'',reply:'仍然回复'},{intent:'web-search',query:'北京天气',reply:'假装查过'},{intent:'chat',query:'偷偷搜索',reply:'你好'}])assert.throws(()=>parseAIIntent(JSON.stringify(plan),50));
 assert.deepEqual(parseAIIntent('{intent:"chat",query:"",reply:" 你好 "}',50),{intent:'chat',query:'',reply:'你好'});
});
