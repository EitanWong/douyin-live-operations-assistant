import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, DEFAULTS, copy } from '../../src/core/engine.js';

function fixture() {
  let now = 1800000000000;
  const config = copy(DEFAULTS); config.anchorId = '1001';
  const engine = new Engine({config,now:()=>now,send:()=>assert.fail('状态识别不得发送消息')});
  const emit = event => engine.ingest({roomId:'room',at:now,...event});
  return {engine,emit,mode:()=>engine.liveMode.current().mode,advance:ms=>now+=ms};
}

test('暂停时识别主播连线，PK 优先；PK 结束后恢复仍有效的连线状态', () => {
  const {engine,emit,mode} = fixture();
  assert.equal(mode(),'unknown'); assert.equal(engine.running,false);
  emit({type:'link-state',linkedUsers:[{id:'1001'},{id:'rival'}]});
  assert.equal(mode(),'linked'); assert.equal(engine.pk.states.size,0);
  emit({type:'pk-start',battleId:'battle',durationMs:300000});
  assert.equal(mode(),'pk');
  emit({type:'room-sync',syncType:'RoomLinkMicSyncData',syncDetails:{users:[{user:{id:'rival'}}]}});
  assert.equal(mode(),'pk');
  emit({type:'pk-end',battleId:'battle'});
  assert.equal(mode(),'linked'); assert.equal(engine.pk.current().phase,'ended');
  assert.equal(engine.queue.length,0);
});

test('频道开关、邀请信息、空席位和贡献榜不会误判成连线或 PK', () => {
  const {emit,mode} = fixture();
  for (const event of [
    {type:'room-sync',syncType:'RoomChannelSettingsSyncData',syncDetails:{linkMicEnabled:true}},
    {type:'guest-link-state',messageType:51,channelId:'123',callDuration:'180'},
    {type:'linkmic-positions',positions:[{status:1,activeName:'嘉宾'}]},
    {type:'pk-contribution',battleId:'battle',contributors:[{user:{id:'viewer'},score:100}]}
  ]) {emit(event);assert.equal(mode(),'unknown');}
});

test('嘉宾频道加入、快照和结束分别识别，空 WRDS 名单清除旧连线', () => {
  const {emit,mode} = fixture();
  emit({type:'guest-link-state',channelJoined:true,channelId:'123'}); assert.equal(mode(),'linked');
  emit({type:'guest-link-state',channelFinished:true}); assert.equal(mode(),'solo');
  emit({type:'guest-link-state',channelSnapshot:true,channelId:'234',channelUserCount:'2',linkedUsers:[]}); assert.equal(mode(),'linked');
  emit({type:'guest-link-state',channelSnapshot:true,channelId:'234'}); assert.equal(mode(),'linked');
  emit({type:'room-sync',syncType:'RoomLinkMicSyncData',syncDetails:{users:[]}}); assert.equal(mode(),'solo');
  emit({type:'link-state',linkedUsers:[{id:'1001'}]}); assert.equal(mode(),'solo');
});

test('旧帧、对面房间和未来消息不能覆盖状态；下播后不被补推复活', () => {
  const {emit,mode,advance,engine} = fixture();
  emit({type:'link-state',linkedUsers:[{id:'rival'}]}); advance(5000);
  emit({type:'guest-link-state',channelFinished:true}); assert.equal(mode(),'solo');
  emit({type:'link-state',at:engine.now()-4000,linkedUsers:[{id:'rival'}]}); assert.equal(mode(),'solo');
  emit({type:'link-state',roomId:'opponent-room',linkedUsers:[{id:'rival'}]}); assert.equal(mode(),'solo');
  emit({type:'link-state',at:engine.now()+120000,linkedUsers:[{id:'rival'}]}); assert.equal(mode(),'solo');
  emit({type:'end'}); assert.equal(mode(),'ended');
  emit({type:'pk-start',battleId:'old',at:engine.now()-1000}); assert.equal(mode(),'ended');
  advance(1000);emit({type:'start',roomId:'new-room'}); assert.equal(mode(),'unknown');
  emit({type:'link-state',roomId:'new-room',linkedUsers:[{id:'rival'}]}); assert.equal(mode(),'linked');
});

test('跨刷新保留已确认状态，过期回到待确认；已知 PK 时钟不会提前失效', () => {
  const {emit,engine,mode,advance} = fixture();
  emit({type:'link-state',linkedUsers:[{id:'rival'}]});
  const restored = new Engine({config:engine.config,now:engine.now}); restored.restore(engine.snapshot());
  assert.equal(restored.liveMode.current().mode,'linked');
  advance(120001); assert.equal(mode(),'unknown'); assert.equal(restored.liveMode.current().mode,'unknown');
  emit({type:'pk-start',battleId:'battle',durationMs:300000});
  advance(240000); assert.equal(mode(),'pk');
  advance(76000); assert.equal(mode(),'unknown');
  emit({type:'pk-score',battleId:'battle',selfScore:10,opponentScore:20,remainingMs:60000}); assert.equal(mode(),'pk');
});

test('未知主播身份时单人名单不猜连线，双人名单可确认', () => {
  const {engine,emit,mode} = fixture(); engine.config.anchorId = '';
  emit({type:'link-state',linkedUsers:[{id:'one'}]}); assert.equal(mode(),'unknown');
  emit({type:'link-state',linkedUsers:[{id:'one'},{id:'two'}]}); assert.equal(mode(),'linked');
});
