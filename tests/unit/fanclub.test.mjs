import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFanclubMembers,fanclubFrameContext} from '../../src/browser/fanclub.js';
import {Engine} from '../../src/core/engine.js';

const frameURL='https://lf-webcast-gr-sourcecdn.bytegecko.com/obj/byte-gurd-source-gr/webcast/mono/h5/fansclub_h5_douyin/pages/member_list/index.html?anchor_id=123&room_id=456&fandom_id=789&fans_level=6&light_status=1&user_id=321';
const native=`<div class="title-bar-text">一只开心🎀的粉丝团</div><div class="fmlc-hasfans-header-left">共14343位"粉丝"，88位勋章点亮中</div><div class="list-scroll">
<div class="item"><span class="fansclub-list-item-nickname">同名</span><div class="webcast-fansclub-badge" style="border-image-source:url(https://p3-webcast.douyinpic.com/img/webcast/star_guard_advanced_badge_18_xmp.png)"><span class="webcast-fansclub-badge__name">只开心</span></div><span class="fmlchlci-right">160.9万</span></div>
<div class="item"><span class="fansclub-list-item-nickname">同名</span><img class="webcast-fansclub-badge__normal" src="https://p3-webcast.douyinpic.com/img/webcast/fansclub_new_advanced_badge_16_xmp.png"><span class="fmlchlci-right">0</span></div></div><p>不活跃成员已隐藏</p>`;

test('实测粉丝团页保留人数、点亮、名单同名、等级和亲密度缩略精度，过滤隐藏节点',()=>{
  const dom=new JSDOM(native,{url:frameURL});
  try {
    const value=readFanclubMembers(dom.window.document);
    assert.equal(value.fansCount,'14343');assert.equal(value.lightedCount,'88');
    assert.equal(value.title,'一只开心🎀的粉丝团');assert.equal(value.members.length,2);
    assert.equal(value.members[0].level,18);assert.equal(value.members[0].intimacyDisplay,'160.9万');
    assert.equal(value.members[0].intimacyApproximate,true);assert.equal(value.members[1].intimacy,'0');
    assert.equal(value.members[1].level,16);assert.equal(value.hiddenInactive,true);
    dom.window.document.querySelector('.fmlc-hasfans-header-left').hidden=true;
    assert.equal(readFanclubMembers(dom.window.document),null);
    assert.equal(fanclubFrameContext(frameURL).viewer.level,6);
    assert.equal(fanclubFrameContext(frameURL.replace('bytegecko.com','evil.test')),null);
  } finally {dom.window.close();}
});

test('暂停时保存粉丝团快照和推送，人数可下降、零值有效；名单时效独立，按主播隔离并恢复',()=>{
  let now=1800000000000;const engine=new Engine({config:{anchorId:'123'},now:()=>now});
  const dom=new JSDOM(native,{url:frameURL});
  try {
    const event={type:'anchor-fanclub',source:'native-fanclub',...fanclubFrameContext(frameURL),...readFanclubMembers(dom.window.document),receivedAt:now,id:'snapshot'};
    engine.ingest(event);now+=1000;
    engine.ingest({type:'fansclub-statistics',name:'只开心',fansCount:'14000',roomId:'456',receivedAt:now,id:'stats'});
    engine.ingest({type:'fansclub',actionName:'join',user:{id:'321',name:'观众'},roomId:'456',description:'观众加入粉丝团',receivedAt:now,id:'join'});
    engine.ingest({type:'fansclub',actionName:'join',user:{id:'321',name:'观众'},roomId:'456',receivedAt:now,id:'join'});
    let report=engine.anchorStats.report('123').fanclub;
    assert.equal(report.fansCount,'14000');assert.equal(report.members.length,2);
    assert.equal(report.membersAt,event.receivedAt);assert.equal(report.observedAt,now);
    assert.equal(report.activities.length,1);assert.equal(report.viewer.userId,'321');
    engine.ingest({...event,anchorId:'999',id:'other',fansCount:'0',lightedCount:'0',members:[],receivedAt:now});
    engine.ingest({...event,id:'older',fansCount:'99999'});
    const restored=new Engine({config:{anchorId:'123'},now:()=>now});restored.restore(engine.snapshot());
    report=restored.anchorStats.report('123').fanclub;
    assert.equal(report.fansCount,'14000');assert.equal(report.activities.length,1);
    assert.equal(restored.anchorStats.report('999').fanclub.fansCount,'0');
    assert.equal(restored.anchorStats.report('missing').fanclub,null);
  } finally {dom.window.close();}
});

test('成员分块完整后才替换名单；乱序块、重放和旧快照不会丢失或重复成员',()=>{
  const engine=new Engine({config:{anchorId:'123'},now:()=>1800000000000});
  const base={type:'anchor-fanclub',source:'native-fanclub',anchorId:'123',roomId:'456',fansCount:'2',lightedCount:'0',receivedAt:1800000000000,snapshotId:'chunks',chunks:2,totalRows:2};
  const first={...base,chunk:0,members:[{position:1,name:'同名',intimacy:'0'}]},last={...base,chunk:1,members:[{position:2,name:'同名',intimacy:'1'}]};
  engine.ingest(last);assert.equal(engine.anchorStats.report('123').fanclub,null);
  engine.ingest(first);assert.equal(engine.anchorStats.report('123').fanclub.members.length,2);
  engine.ingest(last);engine.ingest(first);
  assert.equal(engine.anchorStats.report('123').fanclub.members.length,2);
  engine.ingest({...first,receivedAt:base.receivedAt-1,snapshotId:'old',chunks:1,totalRows:1});
  assert.equal(engine.anchorStats.report('123').fanclub.members.length,2);
});
