import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseRedPacketCatalog,validateRedPacket,selectRedPacket,redPacketForm} from '../../src/core/red-packet.js';
import {validateGiveawayConfig,createGiveaway,parseGiveawayState,drawGiveaway,giveawayCSV} from '../../src/core/giveaway.js';

export const packet={metaId:'1009',diamondCount:20,packNum:15,delayTime:300,accountId:'987654321',roomId:'7705062446398376730',anchorId:'3804784440654216',voucher:false};
export const meta=()=>({box_meta_info:[{box_type:0,tabs:[{tab_type:0,disable_send:false,tab_delay_at_sec:[0,300],tab_box_list:[{same_diamond_box_list:[{id:1009,diamond_count:20,pack_num:15}]}]}]}],expand_award:{caijing_voucher:{activity_id:'current-activity',setting_switcher:1,activity_title:'可选活动'}}});
test('红包奖品固定套餐和账号房间，旧自定义奖品保持原样，刷新不丢类型',()=>{
 const config={prizes:[{type:'red-packet',count:1,redPacket:packet}],durationSec:30,chatEnabled:true,keyword:'参与',giftEnabled:false};
 const parsed=validateGiveawayConfig(config);
 assert.equal(parsed.prizes[0].type,'red-packet');assert.match(parsed.prizes[0].name,/20.*15/);
 assert.deepEqual(validateGiveawayConfig({...config,prizes:[{name:'礼盒',count:1}]}).prizes,[{name:'礼盒',count:1}]);
 const round=createGiveaway(config,{id:'r',room:'123',now:1000});
 assert.deepEqual(parseGiveawayState({version:2,rounds:[round]},'123').rounds[0].config.prizes,parsed.prizes);
 const finished={...drawGiveaway(round,31000),redPacketDeliveries:[{status:'sent',reason:'已发放',boxId:'7705119625705048859'}]};
 assert.deepEqual(parseGiveawayState({version:2,rounds:[finished]},'123').rounds[0].redPacketDeliveries,finished.redPacketDeliveries);
 const csv=giveawayCSV({rounds:[finished]});assert.match(csv,/红包发放状态/);assert.match(csv,/7705119625705048859/);assert.doesNotMatch(csv,/无人参与/);
 for(const change of [{metaId:'bad'},{diamondCount:0},{packNum:0},{delayTime:-1},{accountId:''},{voucher:1}])assert.throws(()=>validateRedPacket({...packet,...change}));
 assert.throws(()=>validateGiveawayConfig({...config,prizes:[{type:'other',name:'奖品',count:1}]}));
});
test('实时目录仅提供普通钻石红包，变价/禁用/等待选项变化均拒绝发送',()=>{
 const catalog=parseRedPacketCatalog(meta());assert.equal(catalog.packages.length,1);
 assert.equal(selectRedPacket(catalog,packet).diamondCount,20);
 for(const mutate of [m=>m.box_meta_info[0].tabs[0].disable_send=true,m=>m.box_meta_info[0].tabs[0].tab_delay_at_sec=[0],m=>m.box_meta_info[0].tabs[0].tab_box_list[0].same_diamond_box_list[0].diamond_count=30]){
  const value=meta();mutate(value);assert.throws(()=>selectRedPacket(parseRedPacketCatalog(value),packet));
 }
 assert.throws(()=>parseRedPacketCatalog({}));
 const form=new URLSearchParams(redPacketForm(packet,catalog));
 assert.equal(form.get('box_meta_id'),'1009');assert.equal(form.get('room_id'),packet.roomId);
 assert.equal(form.get('caijing_voucher_swither'),'2');assert.equal(form.get('caijing_voucher_activity_id'),'current-activity');
 assert.equal(new URLSearchParams(redPacketForm({...packet,voucher:true},catalog)).get('caijing_voucher_activity_id'),'current-activity');
 assert.equal(new URLSearchParams(redPacketForm({...packet,voucher:true},catalog)).get('caijing_voucher_swither'),'1');
 assert.equal(new URLSearchParams(redPacketForm(packet,{...catalog,activity:null})).has('caijing_voucher_swither'),false);
});
