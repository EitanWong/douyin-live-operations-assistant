const id=value=>typeof value==='string' && /^[1-9]\d{0,24}$/.test(value);
const positive=value=>Number.isSafeInteger(value) && value>0;
export const isRedPacketGiveaway=config=>config.prizes?.[0]?.type==='red-packet';
export const redPacketName=packet=>`直播间红包 · ${packet.diamondCount}钻 · ${packet.packNum}份`;

export function validateRedPacket(value) {
 if(!value || !['metaId','accountId','roomId','anchorId'].every(key=>id(value[key])) || !positive(value.diamondCount) || value.diamondCount>100000000
  || !positive(value.packNum) || value.packNum>1000000 || !Number.isSafeInteger(value.delayTime) || value.delayTime<0 || value.delayTime>86400 || typeof value.voucher!=='boolean')throw new Error('请选择当前账号和直播间可用的红包套餐');
 const {metaId,diamondCount,packNum,delayTime,accountId,roomId,anchorId,voucher}=value;
 return {metaId,diamondCount,packNum,delayTime,accountId,roomId,anchorId,voucher};
}

export function parseRedPacketCatalog(data) {
 if(!Array.isArray(data?.box_meta_info))throw new Error('红包套餐目录格式无效');
 const packages=[];
 for(const box of data.box_meta_info.filter(box=>box.box_type===0))for(const tab of box.tabs || []) {
  if(tab.tab_type!==0)continue;
  const delays=(tab.tab_delay_at_sec || []).filter(value=>Number.isSafeInteger(value) && value>=0 && value<=86400);
  for(const group of tab.tab_box_list || [])for(const item of group.same_diamond_box_list || []) {
   const metaId=String(item.id);
   if(!id(metaId) || !positive(item.diamond_count) || !positive(item.pack_num) || !delays.length || item.dress_exclusive_box || item.is_popularity_box)continue;
   packages.push({metaId,diamondCount:item.diamond_count,packNum:item.pack_num,delays,available:tab.disable_send===false,reason:String(tab.limit_text || '')});
  }
 }
 if(new Set(packages.map(row=>row.metaId)).size!==packages.length)throw new Error('红包套餐标识重复，请刷新目录');
 const activity=data.expand_award?.caijing_voucher;
 return {packages,activity:activity && typeof activity.activity_id==='string' ? {id:activity.activity_id,title:String(activity.activity_title || '参与平台活动')} : null};
}

export function selectRedPacket(catalog,packet) {
 const selected=catalog.packages.find(row=>row.metaId===packet.metaId);
 if(!selected?.available)throw new Error(selected?.reason || '红包套餐当前不可发送，请刷新套餐');
 if(selected.diamondCount!==packet.diamondCount || selected.packNum!==packet.packNum || !selected.delays.includes(packet.delayTime))throw new Error('红包金额、份数或等待时间已变化，请重新选择');
 if(packet.voucher && !catalog.activity)throw new Error('平台活动已变化，请重新选择');
 return selected;
}

export function redPacketForm(packet,catalog) {
 selectRedPacket(catalog,packet);
 return new URLSearchParams({box_type:'0',box_meta_id:packet.metaId,delay_time:String(packet.delayTime),room_id:packet.roomId,dress_id:'',use_new_panel:'1',box_dress_type:'0',extra:'',
  ...(catalog.activity ? {caijing_voucher_activity_id:catalog.activity.id,caijing_voucher_swither:packet.voucher ? '1' : '2'} : {})}).toString()+'&';
}
