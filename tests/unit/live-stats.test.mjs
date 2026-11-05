import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Engine, DEFAULTS, copy, mergeConfig, validateConfig} from '../../src/core/engine.js';

function setup(mode='auto') {
  let now=1800000000000;
  const config=copy(DEFAULTS);config.anchorId='123';config.mode=mode;
  const income={id:'current',anchorId:'123',startAt:now-1000,endAt:0,totalDiamonds:1200,
    audience:[{userId:'uid:1',name:'榜首观众',totalDiamonds:1200}]};
  const sent=[];
  const engine=new Engine({config,now:()=>now,send:async text=>{sent.push(text);return {submitted:true};},liveData:()=>({income})});
  return {engine,sent,advance:ms=>now+=ms};
}

test('开始场控及经过多个旧播报周期都不播报贡献榜，正常礼物感谢仍可发送或预览',async()=>{
  for(const mode of ['auto','preview']) {
    const h=setup(mode), {engine}=h;
    engine.start();
    for(const elapsed of [0,300000,300000,1800000]) {h.advance(elapsed);await engine.tick();}
    assert.deepEqual(h.sent,[]);assert.equal(engine.stats.previews,0);assert.equal(engine.queue.length,0);
    engine.enqueue('gift','感谢观众送来的礼物');await engine.tick();
    assert.deepEqual(h.sent,mode==='auto' ? ['感谢观众送来的礼物'] : []);
    assert.equal(engine.stats.previews,mode==='preview' ? 1 : 0);
  }
});

test('导入旧配置丢弃已移除的播报开关和间隔，保留其他配置',()=>{
  for(const audienceBroadcast of [{enabled:true,intervalSec:300},{enabled:false,intervalSec:0},'旧版无效值']) {
    const config=validateConfig(mergeConfig({anchorId:'123',audienceBroadcast,incomeEnabled:true}));
    assert.equal(Object.hasOwn(config,'audienceBroadcast'),false);
    assert.equal(config.anchorId,'123');assert.equal(config.incomeEnabled,true);
  }
});

test('升级恢复撤销手动和自动贡献榜队列及失败重试，保留其他待发送互动',async()=>{
  const h=setup(), {engine}=h;
  const snapshot=engine.snapshot(), created=engine.now();
  const job=(id,kind,text,extra={})=>({id,kind,text,created,expires:Infinity,priority:85,...extra});
  const manual=job(1,'live-stats','本场观众贡献榜第1名：榜首观众。',{liveGiftSession:'current',liveStatsVersion:2});
  const automatic=job(2,'live-stats','本场千票贡献榜人数：1 人。',{liveGiftSession:'current',liveStatsVersion:2,liveStatsAutomatic:true});
  const gift=job(3,'gift','感谢观众送来的礼物');
  snapshot.queue=[manual,automatic,gift];snapshot.serial=6;
  snapshot.audienceBroadcast={sessionKey:'["123","current"]',lastAt:created,retryAt:0};
  snapshot.deliveries=['prepared','failed'].map((state,index)=>({id:`${created}-${index+1}`,state,createdAt:created,requiresClickCheckpoint:true,text:manual.text,jobs:[{...manual,id:4+index}]}));
  snapshot.inFlight={text:manual.text,jobs:[{...manual,id:6}],startedAt:created};
  assert.equal(engine.restore(snapshot),true);
  assert.deepEqual(engine.queue.map(row=>row.text),[gift.text]);
  assert.equal(Object.hasOwn(engine.snapshot(),'audienceBroadcast'),false);
  engine.start();
  for(const elapsed of [1000,300000,300000]) {h.advance(elapsed);await engine.tick();}
  assert.deepEqual(h.sent,[gift.text]);assert.equal(engine.queue.length,0);
});
