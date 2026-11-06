import {formatDiamonds} from '../../core/auto-gift.js';
import {isRedPacketGiveaway,validateRedPacket} from '../../core/red-packet.js';

const views=new WeakMap();
const stateFor=panel=>{if(!views.has(panel))views.set(panel,{packages:[],available:false,loading:false,message:'切换到直播间红包后自动读取套餐与余额。'});return views.get(panel);};
const locked=panel=>panel.toolStates.get('giveaway')?.rounds?.at(-1)?.status==='running';
const mode=panel=>panel.node('[data-packet-type]').value==='red-packet';
const affordable=(state,row)=>state.available && !state.pending && row.available && Number.isSafeInteger(state.balanceUnits) && row.diamondCount*10<=state.balanceUnits;
function options(select,rows,placeholder) {
 const signature=JSON.stringify(rows);
 if(select.dataset.options===signature)return;
 const value=select.value;select.replaceChildren();
 for(const row of [{value:'',label:placeholder},...rows]) {
  const option=select.ownerDocument.createElement('option');option.value=row.value;option.textContent=row.label;option.disabled=Boolean(row.disabled);select.append(option);
 }
 select.value=rows.some(row=>row.value===value) ? value : '';select.dataset.options=signature;
}
export function hydratePacketPicker(panel,config) {
 const packet=config.prizes[0]?.redPacket;
 panel.node('[data-packet-type]').value=isRedPacketGiveaway(config) ? 'red-packet' : 'custom';
 if(!packet)return;
 const state=stateFor(panel);state.saved=packet;
 panel.node('[data-packet-timing]').value=config.scheduledAt ? 'scheduled' : 'countdown';
 if(config.scheduledAt) {
  const date=new Date(config.scheduledAt),pad=value=>String(value).padStart(2,'0');
  panel.node('[data-packet-at]').value=`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
 }
 panel.node('[data-packet-voucher]').checked=packet.voucher;
}
export function updatePacketPicker(panel) {
 const state=stateFor(panel),active=locked(panel),packetMode=mode(panel),type=panel.node('[data-packet-type]');
 type.disabled=active;
 type.onchange=()=>{
  if(locked(panel))return;
  updatePacketPicker(panel);
  if(mode(panel))void refreshPacketPicker(panel,action=>panel.callbacks.toolAction?.('giveaway',action));
 };
 for(const node of panel.root.querySelectorAll('[data-custom-prizes],[data-custom-participation]'))node.hidden=packetMode;
 panel.node('[data-packet-settings]').hidden=!packetMode;
 const timing=panel.node('[data-packet-timing]');timing.disabled=active;timing.onchange=()=>updatePacketPicker(panel);
 panel.node('[data-packet-scheduled]').hidden=!packetMode || timing.value!=='scheduled';
 panel.node('[data-giveaway=durationSec]').closest('label').hidden=packetMode && timing.value==='scheduled';
 const select=panel.node('[data-packet-meta]'),rows=state.packages.map(row=>({value:row.metaId,label:`${row.diamondCount}钻 · ${row.packNum}份${!row.available ? ' · 平台不可用' : !affordable(state,row) ? ' · 余额不足或有待核对记录' : ''}`,disabled:!affordable(state,row)}));
 if(!rows.length && state.saved)rows.push({value:state.saved.metaId,label:`${state.saved.diamondCount}钻 · ${state.saved.packNum}份 · 待读取`,disabled:true});
 options(select,rows,'请选择红包额度');
 if(!select.value && state.saved)select.value=state.saved.metaId;
 select.disabled=active || state.loading;select.onchange=()=>updatePacketPicker(panel);
 const selected=state.packages.find(row=>row.metaId===select.value),delay=panel.node('[data-packet-delay]');
 options(delay,(selected?.delays || (state.saved ? [state.saved.delayTime] : [])).map(value=>({value:String(value),label:value ? `${value}秒后可领取` : '立即可领取'})),'请选择领取等待时间');
 if(!delay.value)delay.value=String(state.saved?.delayTime ?? (selected?.delays.includes(300) ? 300 : selected?.delays[0] ?? ''));
 delay.disabled=active || state.loading;
 panel.node('[data-packet-activity]').hidden=!state.activity;
 panel.node('[data-packet-voucher]').disabled=active || state.loading;
 panel.text('[data-packet-activity-title]',state.activity?.title || '参与平台活动');
 panel.node('[data-packet-at]').disabled=active;
 panel.disabled('[data-action=giveaway-refresh-packets]',active || state.loading);
 panel.text('[data-packet-balance]',state.loading ? '正在读取当前账号钻石余额与红包套餐…' : state.available ? `当前余额 ${formatDiamonds(state.balanceUnits)}钻${selected ? ` · 本次消费 ${selected.diamondCount}钻` : ''}${state.pending ? ' · 有付费记录待核对，请前往自动送礼核对' : ''}` : state.message);
 panel.disabled('[data-action=giveaway-start]',active || packetMode && (state.loading || !selected || !affordable(state,selected)));
 panel.text('[data-action=giveaway-start]',packetMode ? '开始红包任务' : '开始抽奖');
 if(!panel.toolStates.get('giveaway')?.rounds?.length) {
  panel.text('[data-giveaway-round-title]',packetMode ? '红包任务未开始' : '尚未开始');
  panel.text('[data-giveaway-countdown]',packetMode ? '选择红包额度和发放时间，然后开始任务。' : '设置奖品和参与方式，然后开始第一轮抽奖。');
  if(packetMode){panel.text('[data-giveaway-status]','尚未开始红包任务');panel.text('[data-giveaway-feedback]','全直播间可领取，无需产生中奖者。');}
 }
 // Reuse host ticks for visible quotes, without owning a second timer or
 // refreshing hidden pages. Throttle failures as well as successful reads.
 if(packetMode && !active && panel.open && panel.activeTab==='giveaway' && !state.loading && Date.now()-(state.lastRead || 0)>=30000) {
  void refreshPacketPicker(panel,action=>panel.callbacks.toolAction?.('giveaway',action));
 }
}
export async function refreshPacketPicker(panel,invoke) {
 const state=stateFor(panel);if(state.loading || locked(panel))return;
 state.loading=true;state.lastRead=Date.now();updatePacketPicker(panel);
 try {
  const result=await invoke('packets');
  if(!result?.available)throw new Error(result?.reason || '红包套餐读取失败，请刷新重试');
  Object.assign(state,result);
  if(!state.packages.length)state.message='当前没有可用的钻石红包套餐';
 }catch(error){state.available=false;state.message=`读取失败：${error.message}`;}
 finally{state.loading=false;updatePacketPicker(panel);}
}
export function packetConfig(panel) {
 if(!mode(panel))return null;
 const state=stateFor(panel),selected=state.packages.find(row=>row.metaId===panel.node('[data-packet-meta]').value);
 if(!selected || !affordable(state,selected))throw new Error('请选择余额足够且可发送的红包额度');
 const packet=validateRedPacket({...selected,delayTime:Number(panel.node('[data-packet-delay]').value),accountId:state.accountId,roomId:state.roomId,anchorId:state.anchorId,voucher:Boolean(state.activity && panel.node('[data-packet-voucher]').checked)});
 if(!selected.delays.includes(packet.delayTime))throw new Error('请选择领取等待时间');
 const scheduled=panel.node('[data-packet-timing]').value==='scheduled';
 const scheduledAt=scheduled ? new Date(panel.node('[data-packet-at]').value).getTime() : undefined;
 return {prizes:[{type:'red-packet',count:1,redPacket:packet}],...(scheduled ? {scheduledAt} : {})};
}
