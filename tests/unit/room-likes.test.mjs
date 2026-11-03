import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readRoomLikes} from '../../src/browser/room-likes.js';
import {AnchorDataCollector} from '../../src/browser/anchor-data.js';
import {Engine} from '../../src/core/engine.js';

test('读取实测原生点赞文本，保留缩略显示，排除聊天、助手、隐藏和冲突数据',()=>{
  const dom=new JSDOM('<div id="room_info_bar"><div class="kFUbYV4V">1.5万本场点赞</div></div><div id="chatroom">999本场点赞</div><div hidden>888本场点赞</div><div data-live-assistant>777本场点赞</div>');
  try {
    assert.deepEqual(readRoomLikes(dom.window.document),{total:15000,display:'1.5万',approximate:true});
    dom.window.document.querySelector('.kFUbYV4V').textContent='0本场点赞';
    assert.deepEqual(readRoomLikes(dom.window.document),{total:0,display:'0',approximate:false});
    dom.window.document.querySelector('#room_info_bar').insertAdjacentHTML('beforeend','<div>1本场点赞</div>');
    assert.equal(readRoomLikes(dom.window.document),null);
  } finally {dom.window.close();}
});

test('采集器不依赖接口客户端采集点赞，重复采样限频且离开房间后停止',async()=>{
  const dom=new JSDOM('<div>1.5万本场点赞</div>',{url:'https://live.douyin.com/260440030123?anchor_id=4007055676415213'});
  const events=[],collector=new AnchorDataCollector({page:dom.window,sender:{context:()=>({roomId:'7701733692930411306'}),client:()=>null},onEvent:e=>events.push(e)});
  try {
    await collector.refresh();await collector.refresh();
    const likes=events.filter(e=>e.type==='room-likes');
    assert.equal(likes.length,1);assert.equal(likes[0].total,15000);
    assert.equal(likes[0].anchorId,'4007055676415213');assert.equal(likes[0].roomId,'7701733692930411306');
    dom.window.history.pushState({},'', '/other');await collector.refresh();
    assert.equal(events.filter(e=>e.type==='room-likes').length,1);
  } finally {collector.stop();dom.window.close();}
});

test('暂停时仍记录累计点赞，推送不相加，精确值不被缩略值覆盖，并按主播场次持久化隔离',()=>{
  const now=1800000000000,engine=new Engine({config:{anchorId:'123'},now:()=>now});
  const event={type:'room-likes',source:'native-room',anchorId:'123',roomId:'456',total:15000,display:'1.5万',approximate:true,receivedAt:now};
  engine.ingest(event);
  engine.ingest({type:'like',roomId:'456',id:'like1',total:15432,count:2,user:{id:'1'},receivedAt:now});
  engine.ingest({...event,id:'dom2'});
  let likes=engine.anchorStats.report('123').likes;
  assert.equal(likes[0].total,15432);assert.equal(likes[0].approximate,false);
  engine.ingest({...event,roomId:'789',total:0,display:'0',approximate:false});
  engine.ingest({...event,anchorId:'999',roomId:'999',total:99});
  engine.ingest({...event,roomId:'bad',total:-1});
  engine.ingest({type:'like',roomId:'456',count:1000,user:{id:'2'},receivedAt:now});
  const restored=new Engine({config:{anchorId:'123'},now:()=>now});restored.restore(engine.snapshot());
  likes=restored.anchorStats.report('123').likes;
  assert.equal(likes.length,2);assert.equal(likes.find(row=>row.roomId==='456').total,15432);
  assert.equal(likes.find(row=>row.roomId==='789').total,0);
  assert.equal(restored.anchorStats.report('999').likes.length,1);
});
