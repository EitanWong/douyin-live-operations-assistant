import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
const code=(await build({entryPoints:['extension/account-page.js'],bundle:true,write:false,format:'iife'})).outputFiles[0].text;

// Controlled response fixtures exercise the page observer; these are not captured platform bodies.
const mediaURL='https://v1.example.douyinvod.com/video/file.mp4?__vid=70';
const detail=()=>({aweme_detail:{aweme_id:'70',desc:'公开作品',author:{uid:'2',sec_uid:'sec-author',nickname:'作者'},video:{duration:8400,play_addr:{url_list:[mediaURL]}}}});
function observer(transport){
 const dom=new JSDOM('<body></body>',{url:'https://www.douyin.com/video/70',runScripts:'outside-only'}),page=dom.window;
 let payload;page.TextDecoder=TextDecoder;
 page.fetch=async()=>new Response(JSON.stringify(payload));
 page.XMLHttpRequest=class extends page.EventTarget{
  open(){}
  send(){this.response=payload;this.responseText=JSON.stringify(payload);this.dispatchEvent(new page.Event('load'));return 'native-send';}
 };
 page.eval(code);
 return {page,close:()=>page.close(),records:page.__liveAssistantPublicAccountV1,async request(url,value){
  payload=value;
  if(transport==='fetch'){
   const response=await page.fetch(url);assert.deepEqual(await response.json(),value,'页面原响应仍可读取');
   await new Promise(setImmediate);
  }else{
   const xhr=new page.XMLHttpRequest();xhr.responseType=transport==='xhr-json' ? 'json' : '';
   xhr.open('GET',url);assert.equal(xhr.send(),'native-send');assert.equal(xhr.response,payload);
  }
 }};
}
test('后台来源直接选择同作品的原始详情 CDN，播放器改写不能参与匹配',async()=>{
 const view=observer('fetch'),raw='https://v1.example.douyinvod.com/signed/file?cquery=original&l=trace';
 try{
  const payload=detail();payload.aweme_detail.video.play_addr.url_list=[raw];
  await view.request('/aweme/v1/web/aweme/detail/?aweme_id=70',payload);
  const selected=view.records.mediaSource();assert.ok(selected);assert.equal(selected.url,raw);assert.equal(selected.authorUid,'2');
  assert.equal(view.records.mediaSource(raw).url,raw);
  assert.equal(view.records.mediaMatches(raw+'&temp=player&__vid=70'),false);
  assert.equal(view.records.mediaSource(raw+'&temp=player&__vid=70'),null);
  assert.equal(JSON.stringify(view.records.snapshot()).includes('cquery='),false);
  view.page.history.replaceState(null,'','/video/71');assert.equal(view.records.mediaSource(),null);
 }finally{view.close();}
});
test('不同 CDN 地址不能掩盖同一作品 UID、作者或时长冲突',async()=>{
 for(const change of [{author:{uid:'3',sec_uid:'sec-author',nickname:'作者'}},{author:{uid:'2',sec_uid:'sec-other',nickname:'作者'}},{duration:8500}]){
  const view=observer('fetch');
  try{
   await view.request('/aweme/v1/web/aweme/detail/?aweme_id=70',detail());
   assert.ok(view.records.mediaSource(),'冲突前存在已绑定下载来源');
   const changed=detail();if(change.author)changed.aweme_detail.author=change.author;if(change.duration)changed.aweme_detail.video.duration=change.duration;
   changed.aweme_detail.video.play_addr.url_list=[mediaURL.replace('file.mp4','other.mp4')];
   await view.request('/aweme/v1/web/aweme/detail/?aweme_id=70',changed);
   assert.equal(view.records.mediaSource(),null);assert.equal(view.records.mediaSource(mediaURL),null);
  }finally{view.close();}
 }
});
test('缓存详情重读不续期下载地址，只有页面新响应能刷新来源',async()=>{
 const view=observer('fetch');let clock=1800000000000;view.page.Date.now=()=>clock;
 try{
  view.page.__INITIAL_STATE__=detail();view.records.snapshot();assert.ok(view.records.mediaSource(mediaURL));
  clock+=300001;view.records.snapshot();assert.equal(view.records.mediaSource(mediaURL),null);
  await view.request('/aweme/v1/web/aweme/detail/?aweme_id=70',detail());
  assert.equal(view.records.mediaSource(mediaURL).observedAt,clock);
 }finally{view.close();}
});
test('同一响应内重复作品的不同 UID 也不能生成默认下载来源',async()=>{
 const view=observer('fetch');
 try{
  const first=detail().aweme_detail,second=detail().aweme_detail;second.author.uid='3';second.video.play_addr.url_list=[mediaURL.replace('file.mp4','duplicate.mp4')];
  await view.request('/aweme/v1/web/aweme/detail/?aweme_id=70',{aweme_list:[first,second]});
  assert.equal(view.records.mediaSource(),null);assert.equal(view.records.mediaSource(mediaURL),null);
 }finally{view.close();}
});
test('已有公开详情后，错误状态和嵌套私有内容不提供新的下载地址',async()=>{
 const view=observer('fetch');
 try{
  await view.request('/aweme/v1/web/aweme/detail/?aweme_id=70',detail());
  for(const change of [{status_code:1},{work:{is_private:1}},{work:{is_deleted:1}},{author:{status:{is_private:1}}},{author:{secret:1}}]){
   const payload=detail(),url=mediaURL.replace('file.mp4',`invalid-${Object.keys(change)[0]}.mp4`);
   payload.aweme_detail.video.play_addr.url_list=[url];
   if(change.status_code)payload.status_code=change.status_code;
   Object.assign(payload.aweme_detail,change.work);Object.assign(payload.aweme_detail.author,change.author);
   await view.request('/aweme/v1/web/aweme/detail/?aweme_id=70',payload);
   assert.equal(view.records.mediaSource(url),null,JSON.stringify(change));
  }
 }finally{view.close();}
});
for(const transport of ['fetch','xhr-text','xhr-json']){
 test(`${transport} 采集两个准确 HTTPS 平台来源的详情并绑定作品、UID/secUID 和下载描述`,async()=>{
  for(const origin of ['https://www.douyin.com','https://www-hj.douyin.com']){
   const view=observer(transport);
   try{
    await view.request(`${origin}/aweme/v1/web/comment/list/?aweme_id=70`,{comments:[{cid:'c1',aweme_id:'70',text:'公开评论',user:{uid:'1',nickname:'观众'}}]});
    assert.equal(view.records.snapshot().length,0);
    await view.request(`${origin}/aweme/v1/web/aweme/detail/?aweme_id=70`,detail());
    const rows=view.records.snapshot(),work=rows.find(r=>r.kind==='work');
    assert.ok(work,origin);assert.equal(work.id,'70');assert.equal(work.actor.uid,'2');assert.equal(work.actor.secUid,'sec-author');
    assert.equal(work.subject,'sec-author');assert.equal(work.url,'https://www.douyin.com/video/70');
    assert.ok(rows.some(r=>r.kind==='comment' && r.id==='c1'),'详情晚到后仍保留同作品评论');
    const media=view.records.mediaSource(mediaURL);
    assert.ok(media);assert.equal(media.workId,'70');assert.equal(media.authorUid,'2');assert.equal(media.author,'sec-author');assert.equal(media.durationMs,8400);
    assert.equal(JSON.stringify(rows).includes('douyinvod.com'),false,'短期下载地址不进入资料');
    view.page.history.replaceState(null,'','/video/71');assert.equal(view.records.snapshot().length,0);assert.equal(view.records.mediaSource(mediaURL),null);
   }finally{view.close();}
  }
 });
 test(`${transport} 详情入口拒绝近似来源、非 HTTPS、端口、认证信息和错误作品或路径`,async()=>{
  const view=observer(transport);
  try{
   for(const url of [
    'https://other.example/aweme/v1/web/aweme/detail/?aweme_id=70',
    'https://www-hj.douyin.com.other.example/aweme/v1/web/aweme/detail/?aweme_id=70',
    'https://other.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=70',
    'http://www-hj.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=70',
    'https://www-hj.douyin.com:8443/aweme/v1/web/aweme/detail/?aweme_id=70',
    'https://name:secret@www-hj.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=70',
    'https://name:secret@www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=70',
    'https://www-hj.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=71',
    'https://www-hj.douyin.com/aweme/v1/web/aweme/detail/?item_id=71',
    'https://www-hj.douyin.com/aweme/v1/web/aweme/detail/extra?aweme_id=70'
   ]){
    await view.request(url,detail());assert.equal(view.records.snapshot().length,0,url);assert.equal(view.records.mediaSource(mediaURL),null,url);
   }
  }finally{view.close();}
 });
 test(`${transport} 别名来源仍拒绝私有、非目标详情和冲突作者下载来源`,async()=>{
  const view=observer(transport),url='https://www-hj.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=70';
  try{
   for(const patch of [{aweme_id:'71'},{secret:1},{status:{is_private:1}},{status:{is_delete:1}},{author:{uid:'2',sec_uid:'sec-author',is_private:1}}]){
    const payload=detail();Object.assign(payload.aweme_detail,patch);await view.request(url,payload);
    assert.equal(view.records.snapshot().length,0);assert.equal(view.records.mediaSource(mediaURL),null);
   }
   await view.request(url,detail());assert.ok(view.records.mediaSource(mediaURL));
   const changed=detail();changed.aweme_detail.author.uid='3';await view.request(url,changed);
   assert.equal(view.records.mediaSource(mediaURL),null,'冲突 UID 不选择最后一条');
  }finally{view.close();}
 });
}
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
