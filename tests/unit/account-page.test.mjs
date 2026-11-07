import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const code=(await build({entryPoints:['extension/account-page.js'],bundle:true,write:false,format:'iife'})).outputFiles[0].text;
test('原页面已请求的评论在作品详情晚到时仍保留，错误作品、外站响应和错误路由不采集',async()=>{
 const dom=new JSDOM('<body></body>',{url:'https://www.douyin.com/video/70',runScripts:'outside-only'}),page=dom.window;
 try{
  const payloads=new Map();page.TextDecoder=TextDecoder;
  page.fetch=async url=>new Response(JSON.stringify(payloads.get(url)));
  const request=async(url,payload)=>{payloads.set(url,payload);await page.fetch(url);await new Promise(setImmediate);};
  page.eval(code);
  const comment={comments:[{cid:'c1',aweme_id:'70',text:'我是阿明的朋友',user:{uid:'1',nickname:'阿青'}}]};
  await request('/aweme/v1/web/comment/list/?aweme_id=70',comment);
  assert.equal(page.__liveAssistantPublicAccountV1.snapshot().length,0);
  page.__INITIAL_STATE__={aweme_detail:{aweme_id:'70',desc:'实际作品',author:{sec_uid:'sec-author',nickname:'作者'},video:{play_addr:{url_list:['https://media.example/selected.mp4']}}}};
  const rows=page.__liveAssistantPublicAccountV1.snapshot();assert.equal(page.__liveAssistantPublicAccountV1.mediaMatches('https://media.example/selected.mp4'),true);assert.equal(page.__liveAssistantPublicAccountV1.mediaMatches('blob:other-video'),false);assert.ok(rows.some(r=>r.kind==='comment' && r.id==='c1'));
  await request('/aweme/v1/web/comment/list/?aweme_id=71',{comments:[{...comment.comments[0],cid:'bad'}]});
  await request('https://other.example/aweme/v1/web/comment/list/?aweme_id=70',{comments:[{...comment.comments[0],cid:'foreign'}]});
  assert.ok(!page.__liveAssistantPublicAccountV1.snapshot().some(r=>['bad','foreign'].includes(r.id)));
  await request('/aweme/v1/web/danmaku/get/?item_id=70',{danmaku_list:[{danmaku_id:'d1',text:'阿明和小雨是搭档',offset_time:1200}]});
  assert.ok(page.__liveAssistantPublicAccountV1.snapshot().some(r=>r.kind==='danmaku'));
  page.history.replaceState(null,'','/video/71');assert.equal(page.__liveAssistantPublicAccountV1.snapshot().length,0);
 }finally{page.close();}
});
test('下载描述只绑定当前作品和作者的已播放 CDN，过期路由与冲突身份不返回媒体',()=>{
 const dom=new JSDOM('<body></body>',{url:'https://www.douyin.com/video/70',runScripts:'outside-only'}),page=dom.window;
 const url='https://v1.example.douyinvod.com/video/file.mp4?__vid=70';
 try{
  page.fetch=async()=>new Response('{}');page.eval(code);
  page.__INITIAL_STATE__={aweme_detail:{aweme_id:'70',desc:'实际作品',author:{uid:'2',sec_uid:'sec-author',nickname:'作者'},video:{duration:8400,play_addr:{url_list:[url]}}}};
  page.__liveAssistantPublicAccountV1.snapshot();
  const value=page.__liveAssistantPublicAccountV1.mediaSource(url);
  assert.equal(value.workId,'70');assert.equal(value.author,'sec-author');assert.equal(value.authorUid,'2');assert.equal(value.durationMs,8400);
  assert.equal(value.expiresAt-value.observedAt,300000);
  assert.equal(page.__liveAssistantPublicAccountV1.mediaSource('https://127.0.0.1/clip?__vid=70'),null);
  assert.equal(page.__liveAssistantPublicAccountV1.mediaSource(url.replace('__vid=70','__vid=71')),null);
  page.__INITIAL_STATE__.aweme_detail.author.uid='3';page.__liveAssistantPublicAccountV1.snapshot();
  assert.equal(page.__liveAssistantPublicAccountV1.mediaSource(url),null,'同一作品冲突 UID 不能选择最后一条');
  page.history.replaceState(null,'','/video/71');assert.equal(page.__liveAssistantPublicAccountV1.mediaSource(url),null);
 }finally{page.close();}
});
