import {GIVEAWAY_DEFAULTS,giveawayAnnouncement,giveawayCSV,giveawayPrizes,giveawaySlots,giveawayWeight,giveawayDrawRules} from '../../core/giveaway.js';
import {giftDate} from '../../data/gifts.js';
import {updateGiftPicker,refreshGiftPicker} from './gift-picker.js';

const esc=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const time=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(value);
const status={running:'进行中',drawn:'已开奖',cancelled:'已取消'};

const editable=panel=>panel.toolStates.get('giveaway')?.rounds?.at(-1)?.status!=='running';
function prizeRow(prize) {
  return `<div class="giveaway-prize-row" data-giveaway-prize><label class="field"><span>奖品名称</span><input type="text" data-prize="name" maxlength="100" value="${esc(prize.name)}" placeholder="例如：签名礼盒"></label><label class="field"><span>中奖人数</span><input type="number" data-prize="count" value="${prize.count}" min="1" max="1000" step="1"></label><button type="button" data-prize-remove>移除奖品</button></div>`;
}
function updatePrizeControls(panel) {
  const rows=[...panel.root.querySelectorAll('[data-giveaway-prize]')],locked=!editable(panel);
  panel.disabled('[data-action=giveaway-add-prize]',locked || rows.length>=20);
  rows.forEach((row,index)=>{
    const button=row.querySelector('[data-prize-remove]');button.disabled=locked || rows.length===1;
    button.setAttribute('aria-label',`移除奖品 ${index+1}`);
    row.querySelector('[data-prize=name]').setAttribute('aria-label',`奖品 ${index+1} 名称`);
    row.querySelector('[data-prize=count]').setAttribute('aria-label',`奖品 ${index+1} 中奖人数`);
    button.onclick=()=>{
      if(!editable(panel) || rows.length===1)return;
      row.remove();updatePrizeControls(panel);panel.root.querySelector('[data-giveaway-prize] [data-prize=name]').focus();
    };
  });
}

function weightRow(row) {
  return `<div class="giveaway-prize-row" data-giveaway-weight><label class="field"><span>观众用户 ID</span><input type="text" data-weight="userId" value="${esc(row.userId)}" maxlength="200" list="giveaway-known-viewers" placeholder="填写 UID，或从最近观众中选择"></label><label class="field"><span>抽取权重</span><input type="number" data-weight="weight" value="${row.weight}" min="0.01" max="1000" step="0.01"></label><button type="button" data-weight-remove>移除权重</button></div>`;
}
function updateWeightControls(panel,rounds) {
  const rows=[...panel.root.querySelectorAll('[data-giveaway-weight]')],locked=!editable(panel);
  panel.disabled('[data-action=giveaway-add-weight]',locked || rows.length>=100);
  rows.forEach((row,index)=>{
    for(const input of row.querySelectorAll('[data-weight]'))input.disabled=locked;
    const button=row.querySelector('[data-weight-remove]');button.disabled=locked;button.setAttribute('aria-label',`移除观众权重 ${index+1}`);
    button.onclick=()=>{if(editable(panel)){row.remove();updateWeightControls(panel,rounds);panel.node('[data-action=giveaway-add-weight]').focus();}};
  });
  const viewers=new Map();
  for(const row of [...rounds.flatMap(round=>round.entrants),...(panel.viewers || []).map(row=>({userId:row.id,userName:row.name}))])if(row.userId)viewers.set(row.userId,row.userName);
  const list=panel.node('[data-giveaway-known-viewers]'),signature=JSON.stringify([...viewers].slice(-100));
  if(panel.giveawayViewerSignature!==signature){list.innerHTML=[...viewers].slice(-100).map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('');panel.giveawayViewerSignature=signature;}
}

function entrantsTable(round) {
  if(!round.entrants.length)return '<p class="hint">本轮尚无参与者。</p>';
  return `<div class="giveaway-scroll" tabindex="0" role="region" aria-label="本轮参与记录"><table class="pk-table"><thead><tr><th scope="col">观众 / 用户 ID</th><th scope="col">参与方式 / 权重</th><th scope="col">结果</th></tr></thead><tbody>${round.entrants.slice(-100).map(row=>`<tr><td>${esc(row.userName)}<small>${esc(row.userId)}</small></td><td>${row.sources.map(source=>source==='chat' ? '弹幕' : '礼物').join('、')}${row.giftCount ? `<small>指定礼物 ×${row.giftCount}</small>` : ''}<small>权重 ×${giveawayWeight(round.config,row.userId)}</small></td><td>${round.awards.some(award=>award.userId===row.userId) ? `<strong>中奖 · ${esc(round.config.prizes[round.awards.find(award=>award.userId===row.userId).prizeIndex].name)}</strong>` : round.status==='drawn' ? '未中奖' : round.status==='cancelled' ? '已取消' : '待开奖'}</td></tr>`).join('')}</tbody></table></div>${round.entrants.length>100 ? '<p class="hint">显示最近 100 位；导出包含全部参与者。</p>' : ''}`;
}

function historyHTML(rounds) {
  if(!rounds.length)return '<p class="hint">第一轮抽奖结束后，这里会保留奖品、规则、参与明细和中奖名单。</p>';
  return rounds.slice(-20).reverse().map(round=>`<details class="giveaway-record" data-round-id="${esc(round.id)}"><summary>${esc(giveawayPrizes(round.config))} · ${status[round.status]} · ${round.entrants.length} 人参与<small>${time(round.startedAt)} · ${round.awards.length} 人中奖</small></summary><p class="hint">${round.config.chatEnabled ? `弹幕「${esc(round.config.keyword)}」` : ''}${round.config.chatEnabled && round.config.giftEnabled ? ' 或 ' : ''}${round.config.giftEnabled ? `指定礼物「${esc(round.config.gifts)}」累计 ${round.config.giftMin} 个` : ''} · 计划抽取 ${giveawaySlots(round.config)} 人 · ${round.config.durationSec} 秒</p><p class="hint">${esc(giveawayDrawRules(round.config))}${round.config.anchorGuaranteed ? ` · 主播 UID ${esc(round.anchorId)}` : ''}</p><p>${esc(giveawayAnnouncement(round) || round.reason || '等待开奖')}</p>${entrantsTable(round)}</details>`).join('')+(rounds.length>20 ? '<p class="hint">显示最近 20 轮；导出包含全部历史轮次。</p>' : '');
}

function hydrate(panel,config) {
  const page=panel.node('[data-page=giveaway]');if(page.dataset.hydrated)return;
  for(const input of page.querySelectorAll('[data-giveaway]')){
    const value=config[input.dataset.giveaway];
    if(input.type==='checkbox')input.checked=value;else input.value=value ?? '';
  }
  panel.node('[data-giveaway-prizes]').innerHTML=config.prizes.map(prizeRow).join('');
  panel.node('[data-giveaway-weights]').innerHTML=config.weights.map(weightRow).join('');
  page.dataset.hydrated='true';
}

function download(panel,state,format) {
  const view=panel.root.ownerDocument.defaultView;
  const content=format==='csv' ? giveawayCSV(state) : JSON.stringify({room:panel.room,exportedAt:Date.now(),...state},null,2);
  const url=view.URL.createObjectURL(new view.Blob([content],{type:format==='csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8'}));
  const link=panel.root.ownerDocument.createElement('a');link.href=url;link.download=`douyin-giveaway-${panel.room}-${giftDate()}.${format}`;link.click();
  view.setTimeout(()=>view.URL.revokeObjectURL(url),1000);panel.toast('抽奖记录已导出');
}

export const giveawayView = {
  template:()=>`<section class="page" role="tabpanel" id="page-giveaway" aria-labelledby="tab-giveaway" data-page="giveaway" hidden>
    <style>
      .giveaway-prize-row{display:grid;grid-template-columns:minmax(0,1fr) 100px auto;gap:10px;align-items:end}.giveaway-prize-row .field{min-width:0}.giveaway-prize-row button{margin-bottom:18px}.giveaway-gift-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 12px;max-height:200px;overflow:auto}.giveaway-gift-option{display:flex;align-items:center;gap:8px;padding:10px 0;min-width:0;font-size:12px;overflow-wrap:anywhere}.giveaway-gift-option input{flex:none;accent-color:var(--accent)}.giveaway-gift-selected{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 14px;font-size:12px;color:var(--muted)}.giveaway-gift-chip{font-size:12px;max-width:100%;overflow-wrap:anywhere}@media (max-width:560px){.giveaway-prize-row{grid-template-columns:minmax(0,1fr) 88px}.giveaway-prize-row button{grid-column:1/-1;justify-self:start;margin:-8px 0 12px}.giveaway-gift-list{grid-template-columns:1fr}}
      .giveaway-history-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin:20px 0 12px}.giveaway-history-head h3{font-size:13px;margin:0}.giveaway-live{margin:18px 0;padding-block:16px;border-block:1px solid var(--line)}.giveaway-live h3{margin:0 0 8px;font-size:15px}.giveaway-live p{margin:6px 0;overflow-wrap:anywhere}.giveaway-clock{font-variant-numeric:tabular-nums;font-weight:600}.giveaway-result{line-height:1.8}.giveaway-record{padding-block:12px;border-bottom:1px solid var(--line)}.giveaway-record summary{cursor:pointer;font-size:13px;overflow-wrap:anywhere}.giveaway-record small,.giveaway-scroll td small{display:block;font-size:11px;color:var(--muted);overflow-wrap:anywhere}.giveaway-scroll{overflow:auto;max-height:300px}.giveaway-scroll table{min-width:300px}.giveaway-scroll td:first-child{max-width:190px;overflow-wrap:anywhere}.giveaway-config{border:0;margin:0;padding:0;min-width:0}.giveaway-config legend{font-size:13px;font-weight:600;margin-bottom:10px}.giveaway-option{display:flex;gap:8px;align-items:center;font-size:13px;margin:4px 0 10px}.giveaway-option input{accent-color:var(--accent)}
    </style>
    <h2>互动抽奖</h2><p class="intro">观众发送指定弹幕或赠送指定礼物即可参与。倒计时结束自动开奖，每人每轮一个名额。</p>
    <fieldset class="giveaway-config"><legend>奖品与开奖时间</legend>
      <div data-giveaway-prizes>${GIVEAWAY_DEFAULTS.prizes.map(prizeRow).join('')}</div>
      <div class="actions"><button type="button" data-action="giveaway-add-prize">添加奖品</button></div>
      <p class="hint">最多 20 项奖品、合计 1000 人。每人最多中一项；人数不足时按列表顺序分配。本轮开始后规则固定。</p>
      <label class="field"><span>倒计时 / 秒</span><input type="number" data-giveaway="durationSec" value="300" min="1" max="86400" step="1"></label>
    </fieldset>
    <fieldset class="giveaway-config"><legend>中奖规则</legend>
      <details data-giveaway-weight-settings><summary>指定观众抽取权重 · 其他观众默认为 1</summary>
        <p class="hint">按用户 ID 设置，权重越高越容易被抽中。范围 0.01～1000，最多两位小数。例如只有两人、权重分别为 1 和 3 时，首个名额概率为 25% 和 75%；多名额会在每次抽取后重新计算。</p>
        <datalist id="giveaway-known-viewers" data-giveaway-known-viewers></datalist><div data-giveaway-weights></div>
        <div class="actions"><button type="button" data-action="giveaway-add-weight">添加观众权重</button></div>
      </details>
      <label class="giveaway-option"><input type="checkbox" data-giveaway="anchorGuaranteed">主播参与必中</label>
      <p class="hint" data-giveaway-anchor>需识别当前主播 UID。主播须先满足参与条件；中奖占用第一项奖品的一个名额。</p>
    </fieldset>
    <fieldset class="giveaway-config"><legend>参与方式 · 满足任意一种即可</legend>
      <label class="giveaway-option"><input type="checkbox" data-giveaway="chatEnabled" checked>发送指定弹幕参与</label>
      <label class="field"><span>参与弹幕</span><input type="text" data-giveaway="keyword" value="参与抽奖" maxlength="100"><small>去除首尾空格后须完全一致；重复发送不增加名额。</small></label>
      <label class="giveaway-option"><input type="checkbox" data-giveaway="giftEnabled">赠送指定礼物直接参与</label>
      <div class="actions"><button type="button" data-action="giveaway-refresh-gifts">读取 / 刷新礼物目录</button></div>
      <p class="hint" data-giveaway-gift-message role="status" aria-live="polite">读取当前直播间礼物目录，无需先打开网页礼物面板；也可手动填写。</p>
      <label class="field"><span>搜索礼物名称或 ID</span><input type="search" data-giveaway-gift-search placeholder="例如：小心心、玫瑰或 463"></label>
      <div class="giveaway-gift-list" data-giveaway-gift-list role="group" aria-label="可选礼物"></div>
      <p class="hint" data-giveaway-gift-count></p>
      <div class="giveaway-gift-selected" data-giveaway-gift-selected role="group" aria-label="已选礼物"></div>
      <div class="grid"><label class="field"><span>已选礼物名称或 ID · 可手动补充</span><input type="text" data-giveaway="gifts" value="小心心" maxlength="1000"><small>勾选目录会填入 ID；手动填写多项时用逗号分隔。指定礼物合并累计。</small></label>
      <label class="field"><span>累计礼物数量</span><input type="number" data-giveaway="giftMin" value="1" min="1" max="100000" step="1"><small>仅累计本轮指定礼物；达到门槛自动入池，无需再发弹幕。</small></label></div>
    </fieldset>
    <fieldset class="giveaway-config"><legend>弹幕反馈</legend>
      <p class="hint">抽奖反馈自动发送到公屏。</p>
      <label class="giveaway-option"><input type="checkbox" data-giveaway="announcePrizeNames" checked>弹幕播报奖品名称</label>
      <p class="hint">播报开轮、报名成功和开奖结果；剩余 5 分钟、1 分钟、30 秒、10 秒时提醒。短轮次跳过不适用节点。报名高峰合并确认，抽奖消息至少间隔 2 秒；过时提醒自动跳过。场控未开启时也会发送，发送模式为“仅预览”时只记录日志。</p>
    </fieldset>
    <div class="actions"><button type="button" class="primary" data-action="giveaway-start">开始抽奖</button><button type="button" class="danger" data-action="giveaway-cancel" disabled>取消本轮</button></div>
    <p class="hint" data-giveaway-status role="status" aria-live="polite">正在读取抽奖记录</p>
    <p class="hint" data-giveaway-feedback role="status" aria-live="polite">开轮后显示弹幕反馈状态</p>
    <p class="hint" data-giveaway-entry-feedback role="status" aria-live="polite"></p>
    <section class="giveaway-live" aria-label="当前抽奖"><h3 data-giveaway-round-title>尚未开始</h3><p class="giveaway-clock" data-giveaway-countdown role="timer" aria-live="off">设置奖品和参与方式，然后开始第一轮抽奖。</p><p class="giveaway-result" data-giveaway-result role="status" aria-live="polite"></p><div class="actions"><button type="button" data-action="giveaway-copy" disabled>复制开奖公告</button></div></section>
    <div class="giveaway-history-head"><h3>抽奖记录</h3><div class="actions"><button type="button" data-action="giveaway-csv" disabled>导出 CSV</button><button type="button" data-action="giveaway-json" disabled>导出 JSON</button></div></div>
    <div data-giveaway-history></div>
    <p class="hint">结果保存在本工具，并自动公布到公屏。记录保存在本机；CSV 可用于表格统计，JSON 保留完整规则、明细与弹幕反馈记录。发送状态和公屏回显可在运行日志查看。请保持直播页打开；刷新后会恢复本轮，关闭期间的互动无法采集。参与人数不足时按奖品列表顺序分配；无人参加时保留空结果。</p>
  </section>`,
  update(panel,state) {
    const rounds=state.rounds || [],round=rounds.at(-1),active=round?.status==='running';
    if(round)hydrate(panel,round.config);
    for(const input of panel.root.querySelectorAll('[data-giveaway],[data-prize]'))input.disabled=active;
    updatePrizeControls(panel);updateWeightControls(panel,rounds);updateGiftPicker(panel);
    panel.text('[data-giveaway-anchor]',`${active ? round.anchorId || '未识别' : state.anchorId || '未识别'} · 当前主播 UID。主播须先满足参与条件；必中占用第一项奖品一个名额，优先于抽取权重。`);
    panel.disabled('[data-action=giveaway-start]',Boolean(active));panel.disabled('[data-action=giveaway-cancel]',!active || state.phase==='readonly');
    panel.disabled('[data-action=giveaway-csv]',!rounds.length);panel.disabled('[data-action=giveaway-json]',!rounds.length);
    panel.disabled('[data-action=giveaway-copy]',round?.status!=='drawn');
    panel.text('[data-giveaway-status]',`${panel.demo ? '模拟抽奖 · ' : ''}${state.reason || '尚未开始抽奖'}`);
    const messages=round?.feedback || [],pending=messages.filter(row=>!row.queued && row.expiresAt>(state.now || Date.now())).length;
    const mode=state.feedbackMode==='preview' ? '仅预览 · 不发公屏' : state.feedbackMode==='demo' ? '模拟发送' : '自动发送';
    panel.text('[data-giveaway-feedback]',state.feedbackError ? `弹幕待重试：${state.feedbackError}` : round ? round.config.feedbackEnabled ? `${mode} · 已交给发送队列 ${messages.filter(row=>row.queued).length} 条${pending ? ` · 待入队 ${pending} 条` : ''}。实际发送及回显请查看运行日志。` : '本轮已关闭公屏反馈；报名和开奖结果仍在工具内显示。' : `${mode} · 开轮后显示弹幕反馈状态`);
    panel.text('[data-giveaway-entry-feedback]',state.entryError || (round?.entrants.length ? `已报名 ${round.entrants.length} 人 · 最近：${round.entrants.slice(-5).map(row=>row.userName).join('、')}` : ''));
    panel.text('[data-giveaway-round-title]',round ? `${giveawayPrizes(round.config)} · ${status[round.status]}` : '尚未开始');
    const seconds=active ? Math.max(0,Math.ceil((round.endsAt-(state.now || Date.now()))/1000)) : 0;
    const clock=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    panel.text('[data-giveaway-countdown]',round ? active ? `剩余 ${clock} · ${round.entrants.length} 人参与 · 抽取 ${giveawaySlots(round.config)} 人` : `${round.entrants.length} 人参与 · ${round.awards.length} 人中奖 · ${round.closedAt ? time(round.closedAt) : ''}` : '设置奖品和参与方式，然后开始第一轮抽奖。');
    panel.text('[data-giveaway-result]',giveawayAnnouncement(round));
    const target=panel.node('[data-giveaway-history]'),signature=JSON.stringify(rounds.slice(-20).map(round=>({...round,giftProgress:undefined,entrants:round.entrants.slice(-100),participantCount:round.entrants.length})));
    if(panel.giveawayHistorySignature!==signature){
      const openIds=[...target.querySelectorAll('details[open]')].map(node=>node.dataset.roundId);
      target.innerHTML=historyHTML(rounds);for(const node of target.querySelectorAll('details'))node.open=openIds.includes(node.dataset.roundId);
      panel.giveawayHistorySignature=signature;
    }
  },
  actions:{
    'add-prize':panel=>{
      if(!editable(panel) || panel.root.querySelectorAll('[data-giveaway-prize]').length>=20)return;
      panel.node('[data-giveaway-prizes]').insertAdjacentHTML('beforeend',prizeRow({name:'',count:1}));
      updatePrizeControls(panel);panel.root.querySelector('[data-giveaway-prize]:last-child [data-prize=name]').focus();
    },
    'refresh-gifts':refreshGiftPicker,
    'add-weight':panel=>{
      if(!editable(panel) || panel.root.querySelectorAll('[data-giveaway-weight]').length>=100)return;
      panel.node('[data-giveaway-weights]').insertAdjacentHTML('beforeend',weightRow({userId:'',weight:1}));
      updateWeightControls(panel,panel.toolStates.get('giveaway')?.rounds || []);panel.root.querySelector('[data-giveaway-weight]:last-child [data-weight=userId]').focus();
    },
    start:async(panel,invoke)=>{
      panel.disabled('[data-action=giveaway-start]',true);
      const value=Object.fromEntries([...panel.root.querySelectorAll('[data-giveaway]')].map(input=>[input.dataset.giveaway,input.type==='checkbox' ? input.checked : input.type==='number' ? Number(input.value) : input.value]));
      value.prizes=[...panel.root.querySelectorAll('[data-giveaway-prize]')].map(row=>({name:row.querySelector('[data-prize=name]').value,count:Number(row.querySelector('[data-prize=count]').value)}));
      value.weights=[...panel.root.querySelectorAll('[data-giveaway-weight]')].map(row=>({userId:row.querySelector('[data-weight=userId]').value.trim(),weight:Number(row.querySelector('[data-weight=weight]').value)}));
      try{await invoke('start',value);panel.toast('本轮抽奖已开始，正在接收参与弹幕和礼物');}
      finally{panel.updateToolState('giveaway',panel.toolStates.get('giveaway') || {});}
    },
    cancel:async(panel,invoke)=>{await invoke('cancel');panel.toast('本轮已取消，参与记录已保留');},
    csv:async(panel,invoke)=>download(panel,await invoke('export'),'csv'),
    json:async(panel,invoke)=>download(panel,await invoke('export'),'json'),
    copy:async panel=>{
      const round=panel.toolStates.get('giveaway')?.rounds?.at(-1),text=giveawayAnnouncement(round);
      if(!text)throw new Error('本轮尚未开奖');
      await panel.root.ownerDocument.defaultView.navigator.clipboard.writeText(text);panel.toast('开奖公告已复制，可粘贴到公屏');
    }
  }
};
