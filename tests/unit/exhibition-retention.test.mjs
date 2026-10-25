import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {parseExhibitionRetention, readExhibitionRetention, retentionFromIndicatorResponse} from '../../src/browser/exhibition-retention.js';
import {AnchorDataCollector, exhibitionEvents} from '../../src/browser/anchor-data.js';
import {AnchorStats} from '../../src/core/anchor-stats.js';

test('展馆保级只解析明确款数，DOM 排除聊天、隐藏内容和冲突值',()=>{
  assert.deepEqual(parseExhibitionRetention('甄选展馆 差1款保级'),{name:'甄选展馆',remaining:1,text:'甄选展馆差1款保级'});
  assert.equal(parseExhibitionRetention('钻石段位还差1分保级'),null);
  assert.equal(parseExhibitionRetention('甄选展馆还差1款升级'),null);
  const dom=new JSDOM('<body><div id="room_info_bar"><div><span>甄选展馆</span><span>差1款保级</span></div><div hidden>甄选展馆差9款保级</div></div><div id="chatroom">甄选展馆差8款保级</div></body>');
  try {
    assert.equal(readExhibitionRetention(dom.window.document).remaining,1);
    dom.window.document.querySelector('#room_info_bar').insertAdjacentHTML('beforeend','<div>甄选展馆差3款保级</div>');
    assert.equal(readExhibitionRetention(dom.window.document),null);
  } finally {dom.window.close();}
});

test('指标接口仅读取当前用户角色与生效 banner，不从其他角色、错误响应或过期提示取值',()=>{
  const now=1800000000000;
  const response={status_code:0,data:{role:'user',banner_detail:{role2views:{
    user:{banners:[{component:'task',task_props:{elementlist_props:[{level_text:'甄选展馆',condition_text:'差1款保级'}]}}]},
    anchor:{banners:[{props:{activityName:'甄选展馆',description:'差9款保级'}}]}
  }}}};
  assert.equal(retentionFromIndicatorResponse(response,now).remaining,1);
  assert.equal(retentionFromIndicatorResponse({...response,status_code:20003},now),null);
  response.data.banner_detail.role2views.user.banners[0].end_time=now-1;
  assert.equal(retentionFromIndicatorResponse(response,now),null);
});

test('优先协议及响应保级数据，网页仅作后备，保留主播隔离、时效与快照恢复',()=>{
  let now=1800000000000;const stats=new AnchorStats({now:()=>now});
  const event={type:'anchor-exhibition-retention',anchorId:'123',roomId:'456',name:'甄选展馆',remaining:1,text:'甄选展馆差1款保级',receivedAt:now,source:'web-exhibition'};
  stats.ingest(event);now+=1000;
  assert.equal(stats.ingest({...event,source:'native-indicator',remaining:3,receivedAt:now}),false);
  assert.equal(stats.retentionFor('123').remaining,1);assert.equal(stats.retentionFor('other'),null);
  stats.ingest({type:'pk-rank-season',anchorId:'123',receivedAt:now,afterRank:{detail:'钻石'}});
  assert.equal(stats.report('123').rank.afterRank.detail,'钻石');
  assert.equal(stats.report('123').rank.exhibitionRetention.remaining,1);
  const restored=new AnchorStats({now:()=>now});restored.restore(stats.snapshot());
  assert.equal(restored.retentionFor('123').source,'web-exhibition');
  now+=120001;assert.equal(restored.retentionFor('123').stale,true);
  assert.equal(restored.ingest({...event,source:'native-indicator',remaining:0,receivedAt:now}),true);
  assert.equal(restored.retentionFor('123').remaining,0);
});

test('采集器通过已存在的页面客户端请求指标接口，响应保级字段与展馆目标完整保存',async()=>{
  const dom=new JSDOM('',{url:'https://live.douyin.com/456?anchor_id=123'}),events=[],calls=[];
  const client={get:async(path,options)=>{
    calls.push({path,params:options.params});
    return {data:path.includes('/play/indicator/') ? {status_code:0,data:{banner_detail:{role2views:{user:{banners:[{props:{title:'甄选展馆',text:'差1款保级'}}]}}}}}
      : {status_code:0,data:{anchor_id:'123',title:'甄选展馆',keep_exhibition_type_target_count:18,gap_to_next_level:2,exhibition_type:3,lighted_items:[]}}};
  }};
  const collector=new AnchorDataCollector({page:dom.window,sender:{context:()=>({roomId:'456'}),client:()=>client},onEvent:e=>events.push(e)});
  try {
    await collector.refresh();
    assert.equal(calls[0].path,'/webcast/gift/play/indicator/');
    assert.equal(calls[0].params.activity_id,'exhibition_section');
    assert.equal(events.find(e=>e.type==='anchor-exhibition-retention').remaining,1);
    const stats=new AnchorStats();for(const event of events)stats.ingest(event);
    assert.equal(stats.exhibitionFor('123').keepTarget,18);
    assert.equal(stats.exhibitionFor('123').gapToNextLevel,2);
    assert.equal(stats.exhibitionFor('123').exhibitionType,3);
    const restored=new AnchorStats();restored.restore(stats.snapshot());assert.equal(restored.exhibitionFor('123').keepTarget,18);
    assert.equal(exhibitionEvents('home',{status_code:0,data:{anchor_id:'789',lighted_items:[]}},{anchorId:'123',roomId:'456'}).length,0);
  } finally {collector.stop();dom.window.close();}
});
