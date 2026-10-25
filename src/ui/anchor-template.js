import { anchorEscape } from './stat-visuals.js';
import { giftDate } from '../data/gifts.js';

export function anchorPageTemplate(room) {
  return `          <section class="page" role="tabpanel" id="page-anchor" aria-labelledby="tab-anchor" data-page="anchor" hidden>
            <h2>主播数据</h2><p class="intro">按直播场次查看主播表现和礼物账本，开播与下播时间均为北京时间。</p>
            <div class="anchor-views" role="group" aria-label="主播数据视图"><button type="button" data-anchor-view="overview" aria-pressed="true" aria-controls="anchor-overview">数据概览</button><button type="button" data-anchor-view="income" aria-pressed="false" aria-controls="anchor-income">收入账本</button></div>
            <div id="anchor-overview" data-anchor-content="overview">
            <div class="status"><strong data-anchor-report-name>正在识别主播…</strong><span class="badge" data-anchor-scope>本机已观测</span></div>
<div class="anchor-controls">
            <div class="anchor-filter"><label class="field"><span>统计主播</span><select data-anchor-picker aria-label="统计主播"><option value="">当前主播</option></select></label><button type="button" data-action="refresh-anchor">刷新统计</button></div>
            <div class="anchor-toolbar"><div class="anchor-periods" role="group" aria-label="直播场次统计范围">${[['session','当前场次'],['7','近 7 场'],['30','近 30 场'],['all','累计']].map(([value,label]) => `<button type="button" data-anchor-period="${value}" aria-pressed="${value === 'session'}">${label}</button>`).join('')}</div><button type="button" data-action="export-anchor">导出统计</button></div>
</div>
            <label class="field"><span>查看直播场次</span><select data-anchor-session-picker aria-label="查看直播场次"><option value="">当前 / 最近场次</option></select></label>
            <p class="choice-hint" data-anchor-period-note>当前场次 · 北京时间</p>
            <dl class="anchor-session-times"><div><dt>开播时间</dt><dd data-anchor-start>未采集</dd></div><div><dt>下播时间</dt><dd data-anchor-end>未采集</dd></div><div><dt>直播时长</dt><dd data-anchor-duration>未知</dd></div></dl>
            <div class="anchor-metrics" aria-label="主播当前场次核心数据">
              <div><b data-anchor-stat="income">未知</b><span><span data-anchor-period-label>当前场次</span>收入估算</span></div><div><b data-anchor-stat="winRate">未知</b><span><span data-anchor-period-label>当前场次</span> PK 胜率</span></div><div><b data-anchor-stat="battles">未知</b><span><span data-anchor-period-label>当前场次</span> PK 场数</span></div><div><b data-anchor-stat="score">未知</b><span><span data-anchor-period-label>当前场次</span> PK 总分</span></div>
            </div>
            <p class="choice-hint" data-anchor-income-note>收入按已采集礼物估算，不代表平台结算。</p>
<div class="anchor-workspace">            <section class="anchor-section anchor-trend-section"><div class="anchor-section-head"><h3>各直播场次 PK 总分</h3><span data-anchor-pk-note>等待明确终局样本</span></div><div class="anchor-bars" data-anchor-trend aria-label="各直播场次已确认终局比分趋势"><p class="empty">暂无已观测场次</p></div></section>
            <section class="anchor-section"><div class="anchor-section-head"><h3>PK 结果分布</h3><span data-anchor-results-note></span></div><div data-anchor-results></div><div class="anchor-kpis"><span>胜 <b data-anchor-stat="wins">未知</b></span><span>负 <b data-anchor-stat="losses">未知</b></span><span>平 <b data-anchor-stat="draws">未知</b></span><span>待确认 <b data-anchor-stat="pending">未知</b></span></div></section>
            <section class="anchor-section"><div class="anchor-section-head"><h3>各直播场次收入</h3><span>本地礼物账本</span></div><div class="anchor-income-bars" data-anchor-income-trend><p class="empty">等待收入账本</p></div></section>
            <section class="anchor-section"><div class="anchor-section-head"><h3>段位</h3><span data-anchor-rank-at>未采集</span></div><div class="anchor-rank"><strong data-anchor-rank>未知</strong><span data-anchor-rank-score>等待段位事件</span></div><div data-anchor-rank-progress></div><p class="hint" data-anchor-rank-note>段位只展示页面明确关联到该主播 UID 的观察；赛季消息没有 UID 时会标注为未知归属。</p></section>
            <section class="anchor-section"><div class="anchor-section-head"><h3>展馆进度</h3><span data-anchor-exhibition-at>未采集</span></div><div class="anchor-exhibition-grid"><div><b data-anchor-exhibition-level>未知</b><span>层数 / 等级</span></div><div><b data-anchor-exhibition-lit>未知</b><span>已点亮礼物</span></div><div><b data-anchor-exhibition-total>未知</b><span>已知礼物总数</span></div><div><b data-anchor-exhibition-stars>未知</b><span>展馆星数</span></div></div><div data-anchor-stars-progress></div><div data-anchor-lighted-progress></div><p class="hint" data-anchor-exhibition-note>等待展馆接口返回；未登录或接口不可用时不填充猜测值。</p><details class="anchor-gift-details"><summary>展馆礼物与进阶任务</summary><label class="field"><span>礼物状态</span><select data-anchor-gift-filter><option value="all">全部礼物</option><option value="lighted">已点亮</option><option value="unlighted">未点亮</option><option value="tasks">进阶任务</option></select></label><div data-anchor-gifts></div><div class="anchor-pagination"><span data-anchor-gift-page-note></span><div class="actions"><button type="button" data-anchor-gift-page="-1">上一页</button><button type="button" data-anchor-gift-page="1">下一页</button></div></div></details></section>
            <details class="anchor-section anchor-battles-section" data-adaptive-details><summary>PK 场次明细</summary><div class="pk-data-scroll"><table class="pk-table"><thead><tr><th>北京时间</th><th>对手</th><th>已观测比分</th><th>结果</th></tr></thead><tbody data-anchor-battles><tr><td colspan="4">暂无场次</td></tr></tbody></table></div><div class="anchor-pagination"><span data-anchor-page-note></span><div class="actions"><button type="button" data-anchor-page="-1">上一页</button><button type="button" data-anchor-page="1">下一页</button></div></div></details>
</div>            <p class="pk-note" data-anchor-basis>统计仅代表当前浏览器已采集到的数据；明确终局前的场次会保留为待确认，不会被算入胜率和总分。</p>
            </div>
            <div id="anchor-income" data-anchor-content="income" hidden>
              <p class="mode-note" data-income-paused hidden>收入采集已关闭，历史账本仍可查看和导出。<button type="button" class="text-button" data-go="features">前往功能开关</button></p>
            <section class="anchor-section income-dashboard" data-income-dashboard aria-labelledby="income-dashboard-title">
              <div class="anchor-section-head"><h3 id="income-dashboard-title">月度收入统计</h3><button type="button" class="text-button" data-action="export-income" disabled>导出当月</button></div>
              <p class="choice-hint">按开播月份筛选直播场次，跨日、跨月直播的收入整场计入开播月份。</p><div class="income-controls"><label class="field"><span>统计直播间</span><select data-income-room><option value="${anchorEscape(room)}">当前直播间 ${anchorEscape(room)}</option></select></label><label class="field"><span>统计月份 · 北京时间</span><input type="month" data-income-month value="${giftDate().slice(0,7)}"></label></div>
              <p class="income-error" data-income-error role="status" hidden></p>
<div class="income-workspace"><div class="income-summary">
              <section class="income-hero" aria-label="月度礼物收入"><span data-income-period>所选月份收入估算</span><b data-income-total>¥0.00</b><div class="income-meta"><span>礼物面值 <strong data-income-diamonds>0 钻</strong></span><span>礼物数量 <strong data-income-count>0</strong></span><span>直播场次 <strong data-income-sessions>0</strong></span></div><p class="hint" data-income-calibration>在线贡献榜估值：暂无可识别用户</p></section>
</div><div class="income-records">
              <div class="income-toolbar"><h3>直播场次明细</h3></div><div data-income-daily><p class="empty">正在读取本地账本…</p></div>
              <p class="hint" data-income-coverage></p><p class="hint" data-income-calibration-status>在线榜单：等待自动采样</p>
</div></div>
              <details><summary>统计口径与数据范围</summary><p class="hint">在线榜估值按经验锚点线性折算：1000 分约 ¥100，单独显示，不与礼物收入相加；只接受 UID 可唯一识别的用户。该换算尚未用长期直播样本校准，不代表平台结算或实际到账。榜单只采集页面当前可见的用户。</p><p class="hint">每次开播至下播计为一场，刷新页面不会拆场。平台未返回开播时间时显示首次观测时间，未收到下播信号时保留直播中；推定边界会单独标注。旧版日汇总单独保留，不计入直播场次数。礼物统计只包含工具在线时采集到的事件；每笔按采集时保存的元/钻比例计算。未知单价不计入金额。数据保存在当前浏览器，卸载扩展或清除其数据会移除账本。</p></details>
            </section>
            </div>
          </section>
`;
}
