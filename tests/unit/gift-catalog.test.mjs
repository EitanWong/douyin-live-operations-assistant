import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diamondUnits, walletUnits, parseGiftCatalog, validateAutoGift} from '../../src/core/auto-gift.js';

test('钻石用十分之一整数记账，未知余额不能当作零，优先读取 diamond_x10',()=>{
  assert.equal(diamondUnits('12.3'),123);assert.equal(walletUnits({diamond_x10:'123',diamond:999}),123);
  assert.equal(walletUnits({diamond:'12'}),120);assert.equal(walletUnits({diamond:0}),0);
  for(const value of [null,{},'',-1,Infinity,0.01,'1e3',true])assert.throws(()=>diamondUnits(value));
  for(const value of [{},{diamond_x10:null,diamond:3},{diamond_x10:'invalid'},{diamond_x10:1.1}])assert.throws(()=>walletUnits(value));
});

test('目录跨页去重、保留各类礼物与原始顺序，不把定制能力误判为必须定制',()=>{
  const gift=(id,name,extra={})=>({id,name,type:2,diamond_count:1,is_displayed_on_panel:true,gift_scene:1,...extra});
  const catalog=parseGiftCatalog({pages:[{page_type:1,page_name:'推荐',display:true,gifts:[gift(463,'小心心'),gift(789,'嘉年华',{diamond_count:30000,type:13,for_custom:true}),gift(8888,'红包',{type:3,diamond_count:0})]},
    {page_type:2,page_name:'粉丝团',display:true,gifts:[gift(463,'小心心'),gift(685,'灯牌',{type:4,gift_preview_info:{lock_status:1,block_toast:'请点亮粉丝团'}})]}]});
  assert.equal(catalog.length,4);assert.deepEqual(catalog[0].categories,['推荐','粉丝团']);
  assert.equal(catalog[1].priceUnits,300000);assert.equal(catalog[1].available,true);
  assert.match(catalog[2].reason,/网页/);assert.match(catalog[3].reason,/点亮/);assert.equal(catalog[0].sort,1);
});

test('目录边界拒绝坏价格、未知场景、背包和需额外参数的礼物，配置绑定价格与明确预算',()=>{
  const raw={id:2,name:'玫瑰',type:1,diamond_count:1,is_displayed_on_panel:true,gift_scene:1};
  for(const extra of [{diamond_count:NaN},{is_locked:true},{gift_scene:2},{send_extra_params:'{"unknown":1}'},{item_type:2}]) {
    const [gift]=parseGiftCatalog({gifts:[{...raw,...extra}]});assert.equal(gift.available,false);
  }
  const config={giftId:'2',priceUnits:10,batch:1,target:3,intervalSec:5,budget:3};
  assert.equal(validateAutoGift(config).budgetUnits,30);
  for(const extra of [{budget:0},{budget:0.01},{batch:0},{intervalSec:0},{priceUnits:0},{giftId:'url'}])assert.throws(()=>validateAutoGift({...config,...extra}));
});
