import {formatDiamonds} from '../../core/auto-gift.js';

const views=new WeakMap();
function option(panel,label,value) {
  const node=panel.root.ownerDocument.createElement('option');node.textContent=label;node.value=value;return node;
}
function selection(panel,state) {
  const select=panel.root.querySelector('[data-auto-gift=giftId]');
  const gift=state.gifts?.find(gift=>gift.id===select.value);
  panel.text('[data-auto-gift-selection]',gift ? `${gift.name} · ${formatDiamonds(gift.priceUnits)} 钻 / 个${gift.available?'':` · ${gift.reason}`}`:'请选择要发送的礼物');
  panel.disabled('[data-action=auto-gift-start]',!gift?.available || state.loading || Boolean(state.pending) || ['starting','running','stopping'].includes(state.phase));
}
function catalog(panel,state) {
  const root=panel.root,select=root.querySelector('[data-auto-gift=giftId]'),category=root.querySelector('[data-auto-gift-category]'),search=root.querySelector('[data-auto-gift-search]');
  const previous=views.get(panel),gifts=state.gifts || [];
  const filter=()=>{
    const id=select.value || views.get(panel)?.selected || '',query=search.value.trim().toLowerCase();
    const visible=gifts.filter(gift=>(!category.value || gift.categories?.includes(category.value)) && `${gift.id} ${gift.name}`.toLowerCase().includes(query));
    select.replaceChildren(option(panel,visible.length ? '请选择礼物' : '没有匹配的礼物',''));
    for(const gift of visible)select.append(option(panel,`${gift.name} · ${formatDiamonds(gift.priceUnits)} 钻${gift.available?'':` · ${gift.reason}`}`,gift.id));
    select.value=visible.some(gift=>gift.id===id)?id:'';
    views.set(panel,{gifts,selected:id});selection(panel,state);
    panel.text('[data-auto-gift-count]',`共 ${gifts.length} 种 · 当前显示 ${visible.length} 种`);
  };
  search.oninput=filter;category.onchange=filter;
  select.onchange=()=>{views.set(panel,{gifts,selected:select.value});selection(panel,state);};
  if(previous?.gifts!==gifts){
    const current=category.value;category.replaceChildren(option(panel,'全部分类',''));
    for(const name of new Set(gifts.flatMap(gift=>gift.categories || [])))category.append(option(panel,name,name));
    category.value=current;filter();
  } else selection(panel,state);
}
export const autoGiftView={
  template:()=>`<section class="page" role="tabpanel" id="page-auto-gift" aria-labelledby="tab-auto-gift" data-page="auto-gift" hidden>
    <h2>自动送礼</h2><p class="intro">使用当前登录账号，向当前直播间的主播定时送礼。点击开始后立即送出第一批，消耗账户钻石。</p>
    <div class="actions"><button type="button" data-action="auto-gift-refresh">读取礼物与余额</button><strong data-auto-gift-balance aria-live="polite">钻石余额：未读取</strong></div>
    <p class="hint" data-auto-gift-updated>请先打开网页礼物面板，再读取最新目录。</p>
    <div class="grid">
      <label class="field"><span>搜索礼物名称或 ID</span><input type="search" data-auto-gift-search placeholder="例如：小心心、嘉年华"></label>
      <label class="field"><span>礼物分类</span><select data-auto-gift-category><option value="">全部分类</option></select></label>
    </div>
    <label class="field"><span>本次发送的礼物</span><select data-auto-gift="giftId" aria-describedby="auto-gift-selection"><option value="">请先读取礼物目录</option></select></label>
    <p class="hint" data-auto-gift-count>尚未读取目录</p><p id="auto-gift-selection" data-auto-gift-selection>请选择要发送的礼物</p>
    <div class="grid">
      <label class="field"><span>每批数量</span><input type="number" data-auto-gift="batch" value="1" min="1" max="99" step="1"></label>
      <label class="field"><span>批次间隔 / 秒</span><input type="number" data-auto-gift="intervalSec" value="10" min="5" max="3600" step="1"><small>每批结果确认后等待，最少 5 秒。</small></label>
      <label class="field"><span>本次目标数量</span><input type="number" data-auto-gift="target" value="1" min="1" max="100000" step="1"></label>
      <label class="field"><span>本次消费上限 / 钻</span><input type="number" data-auto-gift="budget" placeholder="请填写消费上限" min="0.1" max="1000000" step="0.1"><small>达到目标或上限即停止，最后一批按剩余额度缩减。</small></label>
    </div>
    <div class="actions"><button type="button" class="primary" data-action="auto-gift-start" disabled>开始送礼</button><button type="button" class="danger" data-action="auto-gift-stop" disabled>停止送礼</button></div>
    <p role="status" aria-live="polite" data-auto-gift-status>请先读取礼物与余额</p>
    <p class="hint" data-auto-gift-progress>本次已送出 0 个 · 消费 0 钻 · 0 批</p>
    <div data-auto-gift-pending hidden><p class="hint" data-auto-gift-pending-detail></p><button type="button" data-action="auto-gift-acknowledge">我已核对余额和消费记录，解除待核对状态</button></div>
    <p class="hint">目录来自当前网页，包含普通、特效、粉丝团和等级礼物；解锁条件以平台为准。需选择定制附加项、互动对象的礼物及红包、背包道具会提示使用网页专用流程。每批核对价格与余额；价格变化、余额不足、断线或结果未知即停止。停止后等待在途请求结算，刷新后不会自动续送。</p>
  </section>`,
  update(panel,state) {
    const active=['starting','running','stopping'].includes(state.phase);
    catalog(panel,state);
    for(const node of panel.root.querySelectorAll('[data-auto-gift],[data-auto-gift-search],[data-auto-gift-category]'))node.disabled=active || Boolean(state.loading);
    panel.disabled('[data-action=auto-gift-refresh]',active || state.loading);
    panel.disabled('[data-action=auto-gift-stop]',!active || state.phase==='stopping');
    panel.disabled('[data-action=auto-gift-acknowledge]',active || state.loading);
    panel.text('[data-action=auto-gift-refresh]',state.loading?'正在读取…':'刷新礼物与余额');
    panel.text('[data-auto-gift-balance]',`${panel.demo?'模拟':''}钻石余额：${formatDiamonds(state.balanceUnits)}`);
    panel.text('[data-auto-gift-updated]',state.at?`读取时间：${new Date(state.at).toLocaleTimeString()} · 每批发送前重新核对`:'请先打开网页礼物面板，再读取最新目录。');
    panel.text('[data-auto-gift-status]',`${panel.demo?'模拟演练 · ':''}${state.reason || '请先读取礼物与余额'}`);
    panel.text('[data-auto-gift-progress]',`本次${panel.demo?'模拟':''}已送出 ${state.accepted || 0} 个 · 消费 ${formatDiamonds(state.spentUnits || 0)} 钻 · ${state.batches || 0} 批`);
    panel.root.querySelector('[data-auto-gift-pending]').hidden=!state.pending;
    panel.text('[data-auto-gift-pending-detail]',state.pending?`待核对：${state.pending.name || state.pending.giftId} × ${state.pending.count || '?'}，预计 ${formatDiamonds(state.pending.costUnits)} 钻。解锁后也不会重发此批。`:'');
  },
  actions:{
    refresh:(_,invoke)=>invoke('refresh'),stop:(_,invoke)=>invoke('stop'),acknowledge:(_,invoke)=>invoke('acknowledge'),
    start:async(panel,invoke)=>{
      const inputs=[...panel.root.querySelectorAll('[data-auto-gift]')];
      const value=Object.fromEntries(inputs.map(input=>[input.dataset.autoGift,input.dataset.autoGift==='giftId'?input.value:Number(input.value)]));
      const state=panel.toolStates.get('auto-gift');
      value.priceUnits=state?.gifts?.find(gift=>gift.id===value.giftId)?.priceUnits;
      value.accountId=state?.accountId;value.roomId=state?.roomId;
      panel.disabled('[data-action=auto-gift-start]',true);
      try{await invoke('start',value);}finally{panel.updateToolState('auto-gift',panel.toolStates.get('auto-gift') || {});}
    }
  }
};
