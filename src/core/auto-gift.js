// Money is stored in tenths of a diamond. Unknown is never converted to zero.
export function diamondUnits(value) {
  if (!['number','string'].includes(typeof value) || !/^\d+(?:\.\d)?$/.test(String(value))) throw new Error('钻石金额无效');
  const [whole, decimal = '0'] = String(value).split('.');
  const units = Number(whole)*10+Number(decimal);
  if (!Number.isSafeInteger(units)) throw new Error('钻石金额超出范围');
  return units;
}
export function walletUnits(data) {
  if (data?.diamond_x10 !== undefined) {
    const value = data.diamond_x10;
    if (!['string','number'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('无法确认钻石余额');
    return Number(value);
  }
  return diamondUnits(data?.diamond);
}
export const formatDiamonds = units => Number.isSafeInteger(units) && units >= 0 ? String(units/10) : '未知';
export const giftId = value => typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value);

function giftRestriction(raw, priceUnits, scene, displayed) {
  if (raw.is_locked || raw.is_gray || raw.gift_preview_info?.lock_status) return String(raw.gift_preview_info?.block_toast || '礼物尚未解锁，请在网页完成解锁').slice(0,120);
  if (!priceUnits || ![1,2,4,13].includes(raw.type) || raw.item_type != null && raw.item_type !== 1) return '此礼物需要网页专用送礼流程';
  if (!displayed || raw.is_displayed_on_panel === false || !Number.isSafeInteger(raw.gift_scene) || !(raw.gift_scene & scene)) return '当前直播场景未开放此礼物';
  if (raw.send_extra_params && raw.send_extra_params !== '{}') return '此礼物需要在网页选择附加参数';
  if (raw.gift_offline_time && Number(raw.gift_offline_time)*1000 <= Date.now()) return '礼物已过期';
  return '';
}
export function parseGiftCatalog(data, scene = 1) {
  const result = new Map();
  const pages = Array.isArray(data?.pages) ? data.pages : [];
  const sources = [...pages.map(page=>({...page,gifts:[...(page.gifts || []),...(page.section_info || []).flatMap(section=>section.gifts || [])]})),
    {page_name:'全部',page_type:1,display:true,gifts:Array.isArray(data?.gifts) ? data.gifts : []}];
  for (const page of sources) for (const [index,raw] of page.gifts.entries()) {
    const id = Number.isSafeInteger(raw?.id) ? String(raw.id) : raw?.id;
    if (!giftId(id) || typeof raw.name !== 'string' || !raw.name.trim()) continue;
    let priceUnits = null; try { priceUnits = diamondUnits(raw.diamond_count); } catch {}
    const reason = giftRestriction(raw,priceUnits,scene,page.display !== false);
    const category = String(page.page_name || '全部').slice(0,40), previous = result.get(id);
    const categories = [...new Set([...(previous?.categories || []),category])];
    const gift = {id,name:raw.name.slice(0,100),priceUnits,type:raw.type,available:!reason,reason,categories,
      sort:index+1,pageType:page.page_type || 1};
    // Prefer an eligible occurrence when the same gift appears on a hidden tab.
    result.set(id,!previous || !previous.available && gift.available ? gift : {...previous,categories});
  }
  return [...result.values()];
}
export function validateAutoGift(value) {
  if (!giftId(value?.giftId) || !Number.isSafeInteger(value.priceUnits) || value.priceUnits <= 0) throw new Error('请先选择可发送的礼物并读取价格');
  const identity={};
  for(const key of ['accountId','roomId'])if(value[key]!=null){if(!giftId(value[key]))throw new Error('报价账号或场次标识无效');identity[key]=value[key];}
  for (const [key,min,max] of [['batch',1,99],['target',1,100000],['intervalSec',5,3600]]) {
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) throw new Error(`送礼${{batch:'每批数量',target:'目标数量',intervalSec:'间隔秒数'}[key]}需为 ${min}～${max} 的整数`);
  }
  const budgetUnits = diamondUnits(value.budget);
  if (!budgetUnits || budgetUnits > 10000000 || !Number.isSafeInteger(value.priceUnits*value.target)) throw new Error('本次消费上限需为 0.1～1000000 钻');
  return {...identity,giftId:value.giftId,priceUnits:value.priceUnits,batch:value.batch,target:value.target,intervalSec:value.intervalSec,budget:value.budget,budgetUnits};
}

export class AutoGift {
  constructor({transport,lock,guard=()=>'',changed=()=>{},schedule=(fn,ms)=>setTimeout(fn,ms),cancel=clearTimeout}) {
    Object.assign(this,{transport,lock,guard,changed,schedule,cancel});this.generation=0;
    this.state={phase:'idle',reason:'请先读取礼物与余额',accepted:0,spentUnits:0,batches:0,balanceUnits:null,gifts:[],pending:null};
  }
  update(values) {Object.assign(this.state,values);this.changed({...this.state});}
  whenIdle() {return this.busy ? new Promise(resolve=>(this.waiters ||= []).push(resolve)) : Promise.resolve();}
  async refresh() {
    if (this.busy || this.loading || this.state.phase==='running') return;
    this.loading=true;this.update({loading:true});
    try {
      const data=await this.transport.giftSnapshot();
      if (!data?.available) throw new Error(data?.reason || '礼物与余额读取失败，请先打开网页礼物面板');
      this.update({gifts:data.gifts,balanceUnits:data.balanceUnits,accountId:data.accountId,roomId:data.roomId,pending:data.pending || null,at:data.at,
        reason:data.pending ? '上次送礼结果待核对，请检查余额和消费记录' : `已读取 ${data.gifts.length} 种礼物，请选择并设置本次消费上限`});
    } catch(error) {this.update({gifts:[],balanceUnits:null,reason:error.message});}
    finally {this.loading=false;this.update({loading:false});}
  }
  async acknowledge() {
    if (!this.state.pending || this.busy || this.state.phase==='running') return;
    const result=await this.transport.acknowledgeGift(this.state.pending.id);
    if (!result?.available) throw new Error(result?.reason || '待核对状态未解除');
    await this.refresh();
  }
  async start(value) {
    if (this.busy || this.loading || ['starting','running','stopping'].includes(this.state.phase)) throw new Error('送礼任务正在处理，请稍候');
    const config=validateAutoGift(value),reason=this.guard();if (reason) throw new Error(reason);
    const generation=++this.generation;this.config=config;this.busy=true;
    this.update({phase:'starting',reason:'正在核对礼物、余额与消费上限…',accepted:0,spentUnits:0,batches:0});
    try {
      if (!await this.lock.acquire()) throw new Error('另一个标签页正在为此直播间送礼');
      if (generation!==this.generation) return;
      const reason=this.guard();if (reason) throw new Error(reason);
      const prepared=await this.transport.prepareGift(config);
      if (generation!==this.generation) {if(prepared?.token)await this.transport.stopGift(prepared.token);return;}
      if (!prepared?.available || typeof prepared.token!=='string') throw new Error(prepared?.reason || '送礼能力不可用');
      this.token=prepared.token;this.sequence=0;
      this.update({phase:'running',balanceUnits:prepared.balanceUnits,pending:null,reason:'正在自动送礼'});
    } catch(error) {if(generation===this.generation){this.stop(error.message);throw error;}}
    finally {this.settle(generation);}
    if (generation===this.generation && this.state.phase==='running') await this.tick();
  }
  check() {if (['starting','running'].includes(this.state.phase)) {const reason=this.guard();if(reason)this.stop(reason);}}
  stop(reason='已手动停止') {
    this.stopReason=reason;++this.generation;this.cancel(this.timer);this.timer=null;
    const token=this.token;this.token=null;
    if(token){try{void Promise.resolve(this.transport.stopGift(token)).catch(()=>{});}catch{}}
    if(!this.busy)this.lock.release();
    this.update({phase:this.busy?'stopping':'stopped',reason:this.busy?`${reason}；等待已提交批次结算`:reason});
  }
  settle(generation) {
    this.busy=false;
    if(generation!==this.generation){this.lock.release();this.update({phase:this.state.phase==='completed'?'completed':'stopped',reason:this.stopReason});}
    for(const resolve of this.waiters?.splice(0) || [])resolve();
  }
  async tick() {
    if(this.busy || this.state.phase!=='running')return;
    const reason=this.guard();if(reason){this.stop(reason);return;}
    const generation=this.generation,config=this.config;
    const count=Math.min(config.batch,config.target-this.state.accepted,Math.floor((config.budgetUnits-this.state.spentUnits)/config.priceUnits));
    if(count<1){this.stop('已达到本次消费上限');this.update({phase:'completed'});return;}
    this.busy=true;
    try {
      const result=await this.transport.commitGift(this.token,count,++this.sequence);
      if(result?.submitted===true && result.count===count && Number.isSafeInteger(result.costUnits))this.update({accepted:this.state.accepted+count,
        spentUnits:this.state.spentUnits+result.costUnits,batches:this.state.batches+1,balanceUnits:result.balanceUnits ?? null});
      if(result?.unknown)this.update({pending:result.pending || null,balanceUnits:null});
      if(generation!==this.generation)return;
      if(result?.submitted!==true || result.count!==count || result.costUnits!==count*config.priceUnits || result.priceChanged) {
        this.stop(result?.reason || '送礼结果或价格无法确认，已停止，请核对余额');return;
      }
      if(result.balanceUnits==null){this.stop('已送出本批礼物；余额刷新失败，已停止，请重新读取余额');return;}
      if(this.state.accepted>=config.target || this.state.spentUnits+config.priceUnits>config.budgetUnits){
        this.stop(this.state.accepted>=config.target?'已达到本次目标':'已达到本次消费上限');this.update({phase:'completed'});return;
      }
      this.timer=this.schedule(()=>{this.timer=null;return this.tick();},config.intervalSec*1000);
    } catch {if(generation===this.generation){this.update({balanceUnits:null});this.stop('送礼请求异常，已停止；请刷新并核对消费记录');}}
    finally {this.settle(generation);}
  }
}
