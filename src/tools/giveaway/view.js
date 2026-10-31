import {GIVEAWAY_DEFAULTS,giveawayAnnouncement,giveawayCSV} from '../../core/giveaway.js';
import {giftDate} from '../../data/gifts.js';

const esc=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const time=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(value);
const status={running:'进行中',drawn:'已开奖',cancelled:'已取消'};

function entrantsTable(round) {
  if(!round.entrants.length)return '<p class="hint">本轮尚无参与者。</p>';
  return `<div class="giveaway-scroll" tabindex="0" role="region" aria-label="本轮参与记录"><table class="pk-table"><thead><tr><th scope="col">观众 / 用户 ID</th><th scope="col">参与方式</th><th scope="col">结果</th></tr></thead><tbody>${round.entrants.slice(-100).map(row=>`<tr><td>${esc(row.userName)}<small>${esc(row.userId)}</small></td><td>${row.sources.map(source=>source==='chat' ? '弹幕' : '礼物').join('、')}${row.giftCount ? `<small>指定礼物 ×${row.giftCount}</small>` : ''}</td><td>${round.winnerIds.includes(row.userId) ? '<strong>中奖</strong>' : round.status==='drawn' ? '未中奖' : round.status==='cancelled' ? '已取消' : '待开奖'}</td></tr>`).join('')}</tbody></table></div>${round.entrants.length>100 ? '<p class="hint">显示最近 100 位；导出包含全部参与者。</p>' : ''}`;
}

function historyHTML(rounds) {
  if(!rounds.length)return '<p class="hint">第一轮抽奖结束后，这里会保留奖品、规则、参与明细和中奖名单。</p>';
  return rounds.slice(-20).reverse().map(round=>`<details class="giveaway-record" data-round-id="${esc(round.id)}"><summary>${esc(round.config.prize)} · ${status[round.status]} · ${round.entrants.length} 人参与<small>${time(round.startedAt)} · ${round.winnerIds.length} 人中奖</small></summary><p class="hint">${round.config.chatEnabled ? `弹幕「${esc(round.config.keyword)}」` : ''}${round.config.chatEnabled && round.config.giftEnabled ? ' 或 ' : ''}${round.config.giftEnabled ? `指定礼物「${esc(round.config.gifts)}」累计 ${round.config.giftMin} 个` : ''} · 计划抽取 ${round.config.winners} 人 · ${round.config.durationSec} 秒</p><p>${esc(giveawayAnnouncement(round) || round.reason || '等待开奖')}</p>${entrantsTable(round)}</details>`).join('')+(rounds.length>20 ? '<p class="hint">显示最近 20 轮；导出包含全部历史轮次。</p>' : '');
}

function hydrate(panel,config) {
  const page=panel.node('[data-page=giveaway]');if(page.dataset.hydrated)return;
  for(const input of page.querySelectorAll('[data-giveaway]')){
    const value=config[input.dataset.giveaway];
    if(input.type==='checkbox')input.checked=value;else input.value=value ?? '';
  }
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
      .giveaway-history-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin:20px 0 12px}.giveaway-history-head h3{font-size:13px;margin:0}.giveaway-live{margin:18px 0;padding-block:16px;border-block:1px solid var(--line)}.giveaway-live h3{margin:0 0 8px;font-size:15px}.giveaway-live p{margin:6px 0;overflow-wrap:anywhere}.giveaway-clock{font-variant-numeric:tabular-nums;font-weight:600}.giveaway-result{line-height:1.8}.giveaway-record{padding-block:12px;border-bottom:1px solid var(--line)}.giveaway-record summary{cursor:pointer;font-size:13px;overflow-wrap:anywhere}.giveaway-record small,.giveaway-scroll td small{display:block;font-size:11px;color:var(--muted);overflow-wrap:anywhere}.giveaway-scroll{overflow:auto;max-height:300px}.giveaway-scroll table{min-width:300px}.giveaway-scroll td:first-child{max-width:190px;overflow-wrap:anywhere}.giveaway-config{border:0;margin:0;padding:0;min-width:0}.giveaway-config legend{font-size:13px;font-weight:600;margin-bottom:10px}.giveaway-option{display:flex;gap:8px;align-items:center;font-size:13px;margin:4px 0 10px}.giveaway-option input{accent-color:var(--accent)}
    </style>
    <h2>互动抽奖</h2><p class="intro">观众发送指定弹幕或赠送指定礼物即可参与。倒计时结束自动开奖，每人每轮一个名额。</p>
    <fieldset class="giveaway-config"><legend>奖品与开奖时间</legend><div class="grid">
      <label class="field wide"><span>奖品名称</span><input type="text" data-giveaway="prize" maxlength="100" value="${GIVEAWAY_DEFAULTS.prize}" placeholder="例如：签名礼盒"><small>每位中奖者获得一份；本轮开始后规则固定。</small></label>
      <label class="field"><span>中奖人数</span><input type="number" data-giveaway="winners" value="1" min="1" max="1000" step="1"></label>
      <label class="field"><span>倒计时 / 秒</span><input type="number" data-giveaway="durationSec" value="300" min="1" max="86400" step="1"></label>
    </div></fieldset>
    <fieldset class="giveaway-config"><legend>参与方式 · 满足任意一种即可</legend>
      <label class="giveaway-option"><input type="checkbox" data-giveaway="chatEnabled" checked>发送指定弹幕参与</label>
      <label class="field"><span>参与弹幕</span><input type="text" data-giveaway="keyword" value="参与抽奖" maxlength="100"><small>去除首尾空格后须完全一致；重复发送不增加名额。</small></label>
      <label class="giveaway-option"><input type="checkbox" data-giveaway="giftEnabled">赠送指定礼物直接参与</label>
      <div class="grid"><label class="field"><span>礼物名称或 ID</span><input type="text" data-giveaway="gifts" value="小心心" maxlength="1000"><small>多个用逗号分隔，例如：玫瑰，小心心。按名称或 ID 精确匹配。</small></label>
      <label class="field"><span>累计礼物数量</span><input type="number" data-giveaway="giftMin" value="1" min="1" max="100000" step="1"><small>仅累计本轮指定礼物；达到门槛自动入池，无需再发弹幕。</small></label></div>
    </fieldset>
    <div class="actions"><button type="button" class="primary" data-action="giveaway-start">开始抽奖</button><button type="button" class="danger" data-action="giveaway-cancel" disabled>取消本轮</button></div>
    <p class="hint" data-giveaway-status role="status" aria-live="polite">正在读取抽奖记录</p>
    <section class="giveaway-live" aria-label="当前抽奖"><h3 data-giveaway-round-title>尚未开始</h3><p class="giveaway-clock" data-giveaway-countdown role="timer" aria-live="off">设置奖品和参与方式，然后开始第一轮抽奖。</p><p class="giveaway-result" data-giveaway-result role="status" aria-live="polite"></p><div class="actions"><button type="button" data-action="giveaway-copy" disabled>复制开奖公告</button></div></section>
    <div class="giveaway-history-head"><h3>抽奖记录</h3><div class="actions"><button type="button" data-action="giveaway-csv" disabled>导出 CSV</button><button type="button" data-action="giveaway-json" disabled>导出 JSON</button></div></div>
    <div data-giveaway-history></div>
    <p class="hint">结果在本工具公布，可复制公告到公屏。记录保存在本机；CSV 可用于表格统计，JSON 保留完整规则和明细。请保持直播页打开；刷新后会恢复本轮，关闭期间的互动无法采集。中奖人数不足时全部中奖。</p>
  </section>`,
  update(panel,state) {
    const rounds=state.rounds || [],round=rounds.at(-1),active=round?.status==='running';
    if(round)hydrate(panel,round.config);
    for(const input of panel.root.querySelectorAll('[data-giveaway]'))input.disabled=active;
    panel.disabled('[data-action=giveaway-start]',Boolean(active));panel.disabled('[data-action=giveaway-cancel]',!active || state.phase==='readonly');
    panel.disabled('[data-action=giveaway-csv]',!rounds.length);panel.disabled('[data-action=giveaway-json]',!rounds.length);
    panel.disabled('[data-action=giveaway-copy]',round?.status!=='drawn');
    panel.text('[data-giveaway-status]',`${panel.demo ? '模拟抽奖 · ' : ''}${state.reason || '尚未开始抽奖'}`);
    panel.text('[data-giveaway-round-title]',round ? `${round.config.prize} · ${status[round.status]}` : '尚未开始');
    const seconds=active ? Math.max(0,Math.ceil((round.endsAt-(state.now || Date.now()))/1000)) : 0;
    const clock=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
    panel.text('[data-giveaway-countdown]',round ? active ? `剩余 ${clock} · ${round.entrants.length} 人参与 · 抽取 ${round.config.winners} 人` : `${round.entrants.length} 人参与 · ${round.winnerIds.length} 人中奖 · ${round.closedAt ? time(round.closedAt) : ''}` : '设置奖品和参与方式，然后开始第一轮抽奖。');
    panel.text('[data-giveaway-result]',giveawayAnnouncement(round));
    const target=panel.node('[data-giveaway-history]'),signature=JSON.stringify(rounds.slice(-20).map(round=>({...round,giftProgress:undefined,entrants:round.entrants.slice(-100),participantCount:round.entrants.length})));
    if(panel.giveawayHistorySignature!==signature){
      const openIds=[...target.querySelectorAll('details[open]')].map(node=>node.dataset.roundId);
      target.innerHTML=historyHTML(rounds);for(const node of target.querySelectorAll('details'))node.open=openIds.includes(node.dataset.roundId);
      panel.giveawayHistorySignature=signature;
    }
  },
  actions:{
    start:async(panel,invoke)=>{
      panel.disabled('[data-action=giveaway-start]',true);
      const value=Object.fromEntries([...panel.root.querySelectorAll('[data-giveaway]')].map(input=>[input.dataset.giveaway,input.type==='checkbox' ? input.checked : input.type==='number' ? Number(input.value) : input.value]));
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
