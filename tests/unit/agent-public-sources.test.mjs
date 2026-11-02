import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractPublicText,validatePublicURL,readPublicPage} from '../../src/ai/public-sources.js';
test('公开资料正文提取删除脚本导航，保留来源，视频页仅承认可读文字',()=>{
 const content='<html><head><title>公开茶具笔记</title></head><body><nav>登录 广告</nav><article><h1>陶瓷茶具保养</h1>'+('<p>陶瓷茶具要用温水清洗，避免骤冷骤热。这是作者公开发布的茶具保养说明。</p>'.repeat(15))+'<script>alert(1)</script></article><video src="secret.mp4"></video></body></html>';
 const result=extractPublicText(content,'https://example.com/post');assert.match(result.text,/温水清洗/);assert.ok(!result.text.includes('alert(1)'));assert.match(result.coverage,/text/);assert.equal(result.url,'https://example.com/post');
});
test('公开资料读取只用已授权HTTPS域名，不带Cookie，重定向和过大响应拒绝',async()=>{
 for(const value of ['http://example.com/a','https://localhost/a','https://127.0.0.1/a','https://u:p@example.com/a','https://example.com/a#fragment'])assert.throws(()=>validatePublicURL(value));
 let fetched=0;await assert.rejects(readPublicPage('https://example.com/a',{authorized:async()=>false,fetch:async()=>{fetched++;}}),/授权/);assert.equal(fetched,0);
 const response=await readPublicPage('https://example.com/a',{authorized:async()=>true,fetch:async(url,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return new Response('<html><head><title>公开</title></head><body><main>公开介绍：喜欢陶瓷茶具。</main></body></html>',{headers:{'Content-Type':'text/html'}});}});assert.match(response.text,/陶瓷/);
});

test('纯文本公开资料保留字面内容，过大流被取消，父级取消贯通读取',async()=>{
 const plain='公开介绍：我喜欢<白瓷>，不喜欢骤冷骤热。';
 const result=await readPublicPage('https://example.com/about',{authorized:async()=>true,fetch:async()=>new Response(plain,{headers:{'Content-Type':'text/plain'}})});assert.equal(result.text,plain);
 let cancelled=false;await assert.rejects(readPublicPage('https://example.com/large',{authorized:async()=>true,fetch:async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(262145));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'text/html'}})}),/256KiB/);assert.equal(cancelled,true);
 const controller=new AbortController();controller.abort();await assert.rejects(readPublicPage('https://example.com/about',{authorized:async()=>true,signal:controller.signal,fetch:async(_url,options)=>{assert.equal(options.signal.aborted,true);throw Error('cancelled');}}),/cancelled/);
});
