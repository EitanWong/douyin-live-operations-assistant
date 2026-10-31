import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGiveaway,enterGiveaway,drawGiveaway,parseGiveawayState,giveawayCSV,giveawayAnnouncement,validateGiveawayConfig} from '../../src/core/giveaway.js';

const config={prizes:[{name:'签名礼盒',count:1},{name:'纪念杯',count:2}],durationSec:2,chatEnabled:true,keyword:'参与抽奖',giftEnabled:false};
function round(ids=['1','2','3','4']) {
  let result=createGiveaway(config,{id:'multi',room:'123',now:1000});
  for(const id of ids)result=enterGiveaway(result,{type:'chat',text:'参与抽奖',at:1500,user:{id,name:`观众${id}`}},1500);
  return result;
}
test('多奖品按各自名额分配，同轮观众最多中一个，已保存奖品对应关系不重抽',()=>{
  const input=structuredClone(config),r=createGiveaway(input,{id:'r',room:'123',now:1000});input.prizes[0].name='已改';
  assert.equal(r.config.prizes[0].name,'签名礼盒');
  const drawn=drawGiveaway(round(),3000,()=>0);
  assert.deepEqual(drawn.awards,[{userId:'1',prizeIndex:0},{userId:'2',prizeIndex:1},{userId:'3',prizeIndex:1}]);
  assert.equal(drawGiveaway(drawn,4000,()=>{throw Error('不可重抽');}),drawn);
  assert.deepEqual(parseGiveawayState({version:2,rounds:[drawn]},'123').rounds[0].awards,drawn.awards);
});
test('人数不足按奖品顺序分配，无人参与保留空结果，公告及导出标明实际奖品',()=>{
  assert.deepEqual(drawGiveaway(round(['1','2']),3000,()=>0).awards,[{userId:'1',prizeIndex:0},{userId:'2',prizeIndex:1}]);
  assert.deepEqual(drawGiveaway(round([]),3000,()=>0).awards,[]);
  const drawn=drawGiveaway(round(),3000,()=>0),text=giveawayAnnouncement(drawn),csv=giveawayCSV({version:2,rounds:[drawn]});
  assert.match(text,/签名礼盒.*观众1/);assert.match(text,/纪念杯.*观众2、观众3/);
  assert.match(csv,/所获奖品/);assert.match(csv,/"观众1"[^\r\n]*"签名礼盒"/);assert.match(csv,/"观众2"[^\r\n]*"纪念杯"/);
});
test('奖品数组边界与持久中奖映射校验，不能重复领奖或超出各奖品名额',()=>{
  for(const prizes of [[],[{name:'',count:1}],[{name:'奖品',count:0}],[{name:'奖品',count:1.5}],[{name:'A',count:1000},{name:'B',count:1}],Array.from({length:21},()=>({name:'A',count:1}))]) {
    assert.throws(()=>validateGiveawayConfig({...config,prizes}));
  }
  const drawn=drawGiveaway(round(),3000,()=>0);
  for(const awards of [[{userId:'1',prizeIndex:0},{userId:'1',prizeIndex:1}],[{userId:'1',prizeIndex:0},{userId:'2',prizeIndex:0}],[{userId:'1',prizeIndex:2}],[{userId:'unknown',prizeIndex:0}]]) {
    assert.throws(()=>parseGiveawayState({version:2,rounds:[{...drawn,awards}]},'123'));
  }
});
test('旧版单奖品运行中和已开奖数据在入口迁移，旧中奖者及奖品保留且不改写输入',()=>{
  const legacy=state=>({version:1,rounds:[{...round(['1','2']),config:{prize:'旧礼盒',winners:1,durationSec:2,chatEnabled:true,keyword:'参与抽奖',giftEnabled:false,gifts:'',giftMin:1},awards:undefined,winnerIds:state==='drawn'?['2']:[],status:state,closedAt:state==='drawn'?3000:null}]});
  for(const status of ['running','drawn']){
    const original=legacy(status),result=parseGiveawayState(original,'123');
    assert.equal(result.version,2);assert.deepEqual(result.rounds[0].config.prizes,[{name:'旧礼盒',count:1}]);
    assert.deepEqual(result.rounds[0].awards,status==='drawn'?[{userId:'2',prizeIndex:0}]:[]);
    assert.equal(original.version,1);assert.equal(original.rounds[0].config.prize,'旧礼盒');
  }
});
test('主播必中只对已入池的主播 UID 生效，占用首项奖品名额；未报名不补入',()=>{
  const make=()=>createGiveaway({...config,anchorGuaranteed:true},{id:'host',room:'123',anchorId:'9',now:1000});
  let r=make();for(const id of ['1','2','3','9'])r=enterGiveaway(r,{type:'chat',text:'参与抽奖',at:1500,user:{id,name:id==='9'?'主播':'观众'}},1500);
  const drawn=drawGiveaway(r,3000,()=>0);
  assert.deepEqual(drawn.awards[0],{userId:'9',prizeIndex:0});assert.equal(drawn.awards.filter(row=>row.userId==='9').length,1);
  assert.equal(drawn.awards.length,3);assert.match(giveawayAnnouncement(drawn),/主播参与必中/);
  assert.deepEqual(drawGiveaway(make(),3000,()=>0).awards,[]);
  assert.throws(()=>createGiveaway({...config,anchorGuaranteed:true},{id:'host',room:'123',now:1000}),/主播/);
});
test('指定观众权重控制抽取区间，其他观众默认 1，抽中后不重复进入下一奖品',()=>{
  const base=round(['1','2']),r={...base,config:validateGiveawayConfig({...config,prizes:[{name:'奖品',count:1}],weights:[{userId:'2',weight:3}]})};
  const wins={'1':0,'2':0};
  for(let ticket=0;ticket<400;ticket++)wins[drawGiveaway(r,3000,max=>{assert.equal(max,400);return ticket;}).awards[0].userId]++;
  assert.deepEqual(wins,{'1':100,'2':300});
  const multi={...round(),config:validateGiveawayConfig({...config,weights:[{userId:'2',weight:10}]})};
  const drawn=drawGiveaway(multi,3000,max=>max-1);assert.equal(new Set(drawn.awards.map(award=>award.userId)).size,3);
  assert.match(giveawayAnnouncement(drawn),/观众权重/);assert.match(giveawayCSV({version:2,rounds:[drawn]}),/抽取权重/);
});
test('权重为正数且最多两位小数，拒绝重复 UID；不能用昵称识别或设置无效权重',()=>{
  for(const weights of [[{userId:'1',weight:0}],[{userId:'1',weight:1001}],[{userId:'1',weight:0.001}],[{userId:'昵称',weight:2}],[{userId:'1',weight:2},{userId:'1',weight:3}]])assert.throws(()=>validateGiveawayConfig({...config,weights}));
  const c=validateGiveawayConfig({...config,weights:[{userId:'1',weight:0.5}]});assert.equal(c.weights[0].weight,0.5);
});
