import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveLiveStream,streamCandidates,validateStreamURL,createDirectStreamSource} from '../../src/browser/live-stream.js';

const flv='https://pull-flv-l1.douyincdn.com/live/stream.flv?expire=9999999999&sign=private';
const hls='https://pull-hls-l1.douyincdn.com/live/stream.m3u8?sign=private';
const response=(web='123',id='987')=>({status_code:0,data:{data:[{id_str:id,web_rid:web,status:2,stream_url:{flv_pull_url:{FULL_HD1:flv},hls_pull_url_map:{SD1:hls}}}]}});
const location={href:'https://live.douyin.com/123',origin:'https://live.douyin.com'};

test('解析当前直播间原始流，优先 H264 标清 FLV，签名原样保留并校验房间',async()=>{
  const data=response();data.data.data[0].stream_url.flv_pull_url.SD1=flv.replace('stream.flv','low.flv');
  const result=streamCandidates(data,'123');assert.equal(result[0].format,'flv');assert.ok(result[0].url.includes('low.flv?expire='));
  assert.equal(result[0].roomId,'987');assert.equal(streamCandidates(response('456'),'123').length,0);
  const initial=JSON.stringify({roomStore:{roomInfo:{room:response().data.data[0]}}});
  const page={location,document:{getElementById:()=>({textContent:initial})},fetch:()=>assert.fail('初始数据已含本房流')};
  const resolved=await resolveLiveStream({page,room:'123'});assert.equal(resolved[0].url,flv);
  let path,options;page.document.getElementById=()=>null;page.fetch=async(url,init)=>{path=url;options=init;return {ok:true,text:async()=>JSON.stringify(response())};};
  assert.equal((await resolveLiveStream({page,room:'123'}))[0].url,flv);assert.match(path,/web_rid=123/);assert.equal(options.credentials,'same-origin');
  page.fetch=async()=>({ok:true,text:async()=>JSON.stringify(response('456'))});await assert.rejects(()=>resolveLiveStream({page,room:'123'}),/当前直播间/);
});

test('解析新版 sdk_data 的 H264 流，拒绝站外地址、凭据、非媒体和已结束房间',()=>{
  const room=response().data.data[0];room.stream_url={live_core_sdk_data:{pull_data:{stream_data:JSON.stringify({data:{sd:{main:{flv,hls,vcodec:'h264'}},hd:{main:{flv:flv.replace('stream.flv','hevc.flv'),vcodec:'h265'}}}})}}};
  assert.deepEqual(streamCandidates({data:{data:[room]}},'123').map(s=>s.format),['flv','hls']);
  for(const url of ['http://pull-flv-l1.douyincdn.com/a.flv','https://evil.test/a.flv','https://douyincdn.com.evil.test/a.flv','https://user:pass@pull-flv-l1.douyincdn.com/a.flv','https://pull-flv-l1.douyincdn.com/room','https://127.0.0.1/a.flv'])assert.throws(()=>validateStreamURL(url),/直播流地址/);
  room.status=4;assert.equal(streamCandidates({data:{data:[room]}},'123').length,0);
});

test('直接拉流只创建独立解码器，不请求选屏；停止幂等清理解码器、轨道与 DOM',async()=>{
  const listeners=new Map();let removed=0,stopped=0,destroyed=0,shared=0,resumed=0,disconnected=0,audioClosed=0;
  const tracks=[{kind:'audio',stop:()=>stopped++,addEventListener(){}},{kind:'video',stop:()=>stopped++,addEventListener(){}}];
  const stream={getTracks:()=>tracks,getAudioTracks:()=>[tracks[0]],getVideoTracks:()=>[tracks[1]]};
  const video={readyState:2,videoWidth:640,videoHeight:360,currentTime:1,style:{},setAttribute(){},addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name),play:async()=>{},pause(){},captureStream:()=>stream,remove:()=>removed++,removeAttribute(){},load(){}};
  const env={AudioContext:class {state='running';resume(){resumed++;return Promise.resolve();}createMediaElementSource(v){assert.equal(v,video);return {connect:target=>assert.equal(target.stream,stream),disconnect:()=>disconnected++};}createMediaStreamDestination(){return {stream};}close(){audioClosed++;return Promise.resolve();}},MediaStream:class {constructor(list){assert.deepEqual(list,tracks);return stream;}},document:{createElement:name=>name==='video'?video:{getContext:()=>({drawImage(){},getImageData(){}})},body:{append(){}}},navigator:{mediaDevices:{getDisplayMedia:()=>shared++}}};
  const source=createDirectStreamSource({page:{location},env,resolve:async()=>[{url:flv,format:'flv',roomId:'987'}],loadCodecs:async()=>({attach:async(v,c)=>{assert.equal(v,video);assert.equal(c.url,flv);return {destroy:()=>destroyed++};}})});
  const capture=await source({config:{videoEnabled:true,audioEnabled:true},isCurrent:()=>true,onEnded(){},onError:assert.fail});
  assert.equal(capture.stream,stream);assert.equal(capture.source,'direct');assert.equal(shared,0);assert.equal(video.crossOrigin,'anonymous');assert.equal(video.muted,false);assert.equal(resumed,1);
  capture.stop();capture.stop();assert.equal(stopped,2);assert.equal(destroyed,1);assert.equal(removed,1);assert.equal(disconnected,1);assert.equal(audioClosed,1);
});

test('取消等待流时及时拒绝，迟到解码器释放；拉流失败不改用屏幕共享且不泄露签名',async()=>{
  let resolveAttach,destroyed=0;const pending=new Promise(r=>resolveAttach=r),controller=new AbortController();
  const video={readyState:0,style:{},setAttribute(){},addEventListener(){},removeEventListener(){},pause(){},remove(){},removeAttribute(){},load(){}};
  const source=createDirectStreamSource({page:{location},env:{document:{createElement:()=>video,body:{append(){}}}},resolve:async()=>[{url:flv,format:'flv'}],loadCodecs:async()=>({attach:()=>pending})});
  const start=source({config:{videoEnabled:true},signal:controller.signal,onEnded(){},onError(){}});
  await new Promise(setImmediate);controller.abort();await assert.rejects(start,/停止/);resolveAttach({destroy:()=>destroyed++});await new Promise(setImmediate);assert.equal(destroyed,1);
  const fail=createDirectStreamSource({page:{location},env:{document:{createElement:()=>video,body:{append(){}}}},resolve:async()=>[{url:flv,format:'flv'}],loadCodecs:async()=>({attach:async()=>{throw new Error(flv);}})});
  await assert.rejects(()=>fail({config:{videoEnabled:true},onEnded(){},onError(){}}),error=>!error.message.includes('private') && /拉流/.test(error.message));
});

test('直接拉流的解码启动有总超时，即使 play 永不完成也会清理',async()=>{
  let destroyed=0,removed=0;
  const video={style:{},setAttribute(){},addEventListener(){},removeEventListener(){},play:()=>new Promise(()=>{}),pause(){},remove:()=>removed++,removeAttribute(){},load(){}};
  const source=createDirectStreamSource({env:{document:{createElement:()=>video,body:{append(){}}}},resolve:async()=>[{url:flv}],loadCodecs:async()=>({attach:()=>({destroy:()=>destroyed++})}),setupTimeoutMs:20});
  const start=source({config:{videoEnabled:true}});
  await assert.rejects(()=>Promise.race([start,new Promise((_,reject)=>setTimeout(()=>reject(new Error('test deadline')),200))]),/拉流失败/);
  assert.equal(destroyed,1);assert.equal(removed,1);
});

test('房间接口按请求绑定 web_rid，兼容响应省略 web_rid，仍拒绝明确的跨房间数据',async()=>{
  const data=response();delete data.data.data[0].web_rid;
  assert.equal(streamCandidates(data,'123').length,0,'未绑定来源的页面数据不能猜测房间');
  const page={location,document:{getElementById:()=>null},fetch:async()=>({ok:true,text:async()=>JSON.stringify(data)})};
  assert.equal((await resolveLiveStream({page,room:'123'}))[0].roomId,'987');
  data.data.data[0].web_rid='456';await assert.rejects(()=>resolveLiveStream({page,room:'123'}),/当前直播间/);
});
