import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRealtimeCapture,createSDPExchange} from '../../src/browser/omni-realtime.js';
const sdp='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
function fixture(){
  const tracks=[{kind:'audio',enabled:true,stop(){this.stopped=true;},addEventListener(){}},{kind:'video',enabled:true,stop(){this.stopped=true;},addEventListener(){}}];
  const low={kind:'video',enabled:true,stop(){this.stopped=true;}};
  const stream={getTracks:()=>tracks,getAudioTracks:()=>tracks.slice(0,1)};
  let peer,channel,sharing;const env={navigator:{mediaDevices:{getDisplayMedia:()=>sharing || Promise.resolve(stream)}},document:{createElement:type=>type==='video' ? {readyState:2,videoWidth:1920,videoHeight:1080,play:async()=>{},pause(){}} : {width:0,height:0,getContext:()=>({drawImage(){}}),captureStream:()=>({getTracks:()=>[low],getVideoTracks:()=>[low]})}},RTCPeerConnection:class{
    constructor(){peer=this;this.iceGatheringState='complete';this.connectionState='new';this.senders=[];}
    addTrack(track){const sender={track,replaceTrack:async value=>sender.track=value};this.senders.push(sender);return sender;}
    createDataChannel(){channel={readyState:'open',sent:[],send(value){this.sent.push(JSON.parse(value));},close(){this.closed=true;}};return channel;}
    createOffer=async()=>({type:'offer',sdp});setLocalDescription=async offer=>{this.localDescription=offer;};setRemoteDescription=async answer=>{this.answer=answer;};close(){this.closed=true;}
  }};
  return {env,tracks,low,stream,get peer(){return peer;},get channel(){return channel;},share:p=>sharing=p};
}
const config={realtimeEndpoint:'https://ws.cn-beijing.maas.aliyuncs.com/api/v1/webrtc/realtime?model=qwen3.8-omni-flash-realtime',realtimeModel:'qwen3.8-omni-flash-realtime',sessionMinutes:1,sessionTokens:1000,maxPerHour:10};
const tick=()=>new Promise(r=>setTimeout(r,0));
async function begin(f,extra={}){
  const observations=[],errors=[],controller=new AbortController();
  const pending=createRealtimeCapture({env:f.env,exchange:async()=>sdp})({config,signal:controller.signal,onObservation:r=>observations.push(r),onEnded(){},onError:e=>errors.push(e),...extra});
  await tick();
  const event=e=>f.channel.onmessage({data:JSON.stringify(e)});
  return {pending,event,observations,errors,controller};
}
async function ready(f,b){b.event({type:'session.created',session:{id:'session-1'}});await tick();const session=f.channel.sent[0].session;b.event({type:'session.updated',session});await b.pending;}
test('WebRTC 配置确认前不发送音视频，成功终态才进入稳定上下文，停止释放所有资源',async()=>{
  const f=fixture(),b=await begin(f);assert.ok(f.peer.senders.every(s=>s.track===null));assert.equal(f.tracks[0].enabled,false);
  await ready(f,b);assert.equal(f.tracks[0].enabled,true);assert.equal(f.peer.senders[1].track,f.low);
  b.event({type:'response.created',response:{id:'r1'}});b.event({type:'response.text.delta',response_id:'r1',delta:'主播在介绍茶具'});assert.equal(b.observations.length,0);
  b.event({type:'response.done',response:{id:'r1',status:'failed'}});assert.equal(b.observations.length,0);
  b.event({type:'response.created',response:{id:'r2'}});b.event({type:'response.done',response:{id:'r2',status:'completed',usage:{total_tokens:20},output:[{type:'message',content:[{type:'text',text:'画面中有茶杯。'}]}]}});
  assert.equal(b.observations[0].text,'画面中有茶杯。');assert.equal(b.observations[0].transport,'webrtc');
  b.event({type:'response.done',response:{id:'r2',status:'completed',output:[]}});assert.equal(b.observations.length,1);
  b.controller.abort();assert.ok(f.peer.closed);assert.ok(f.channel.closed);assert.ok(f.tracks.every(t=>t.stopped));assert.ok(f.low.stopped);
  b.event({type:'conversation.item.input_audio_transcription.completed',item_id:'late',transcript:'迟到'});assert.equal(b.observations.length,1);
});
test('取消选屏时释放迟到流；配置错误、断线与真实 usage 超限关闭会话',async()=>{
  const f=fixture();let release;f.share(new Promise(r=>release=r));const b=await begin(f);b.controller.abort();release(f.stream);await assert.rejects(b.pending,/停止/u);assert.ok(f.tracks.every(t=>t.stopped));
  const g=fixture(),c=await begin(g);await ready(g,c);c.event({type:'response.created',response:{id:'r'}});c.event({type:'response.done',response:{id:'r',status:'completed',usage:{total_tokens:1001}}});assert.ok(g.peer.closed);assert.match(c.errors[0].message,/额度/u);
  const h=fixture(),d=await begin(h);await ready(h,d);h.peer.connectionState='disconnected';h.peer.onconnectionstatechange();assert.ok(h.tracks[0].stopped);
});
test('SDP 交换只经独立后台操作，验证状态和返回地址，不接受 JSON 或重定向',async()=>{
  let details;const exchange=createSDPExchange({getKey:()=> 'private',request:d=>{details=d;d.onload({status:200,responseText:sdp,finalUrl:d.url});}});
  assert.equal(await exchange(config,sdp),sdp);assert.equal(details.operation,'media-sdp');assert.equal(details.headers['Content-Type'],'application/sdp');assert.equal(details.headers.Authorization,'Bearer private');assert.equal(details.data,sdp);
  const bad=createSDPExchange({getKey:()=> 'private',request:d=>d.onload({status:200,responseText:'{}'})});await assert.rejects(bad(config,sdp),/SDP/u);
});

test('重复响应事件不重复计费，text.done 可补齐完成文本，错误配置不会开启媒体',async()=>{
  const f=fixture(),b=await begin(f);await ready(f,b);
  b.event({type:'response.created',response:{id:'same'}});b.event({type:'response.created',response:{id:'same'}});
  b.event({type:'response.text.done',response_id:'same',text:'画面上有茶具'});b.event({type:'response.done',response:{id:'same',status:'completed',usage:{total_tokens:600}}});
  assert.equal(b.observations.length,1);b.event({type:'response.created',response:{id:'same'}});b.event({type:'response.done',response:{id:'same',status:'completed',usage:{total_tokens:600}}});assert.ok(!f.peer.closed);b.controller.abort();
  const g=fixture(),c=await begin(g);c.event({type:'session.created',session:{id:'bad'}});c.event({type:'session.updated',session:{modalities:['audio'],turn_detection:{type:'server_vad'}}});await assert.rejects(c.pending);assert.equal(g.tracks[0].enabled,false);assert.ok(g.peer.closed);
});

test('Omni 可直接使用原始直播流，既有确认门控保留且不调用浏览器选屏',async()=>{
  const f=fixture();let shared=0,released=0;f.env.navigator.mediaDevices.getDisplayMedia=()=>{shared++;assert.fail('直接拉流不应选屏');};
  const factory=createRealtimeCapture({env:f.env,exchange:async()=>sdp,sourceFactory:async()=>({stream:f.stream,source:'direct',stop:()=>released++})});
  const pending=factory({config,onObservation(){},onError:assert.fail,onEnded(){}});await tick();
  assert.ok(f.channel);await f.channel.onmessage({data:JSON.stringify({type:'session.created',session:{id:'direct'}})});await tick();
  const session=f.channel.sent[0].session;await f.channel.onmessage({data:JSON.stringify({type:'session.updated',session})});
  const capture=await pending;assert.equal(shared,0);assert.equal(f.peer.senders.length,2);capture.stop();assert.equal(released,1);
});
