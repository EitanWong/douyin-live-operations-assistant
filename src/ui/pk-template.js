import {pkSettingsTemplate} from './pk-settings-template.js';

export function pkDashboardTemplate(){
 return `            <h3>PK 局势看板</h3><p class="intro">比分、追分速度与贡献者，随直播推送更新。</p>
            ${pkSettingsTemplate()}
              <div class="pk-overview">
            <div class="pk-overview-main">
            <div class="status"><strong data-pk-state>等待 PK 事件</strong><span class="badge" data-slot="tag" data-pk-quality>数据不足</span></div>
            <div class="pk-scoreboard"><div><strong data-pk-self-score>--</strong><span data-pk-self-name>己方</span></div><div class="vs">VS<br><small data-pk-remaining>--</small></div><div><strong data-pk-opponent-score>--</strong><span data-pk-opponent-name>对方</span></div></div>
            <section class="pk-multi" data-pk-multi hidden><h3>多人 PK 排名与夺冠估计</h3><div class="pk-data-scroll"><table class="pk-table"><thead><tr><th>主播</th><th>比分</th><th>夺冠估计</th></tr></thead><tbody data-pk-competitors><tr><td colspan="3">等待完整比分</td></tr></tbody></table></div></section>
            <div class="pk-lead" role="img" aria-label="等待双方比分" data-pk-lead><span style="width:50%"></span><span style="width:50%"></span></div>
            <p class="pk-freshness" data-pk-freshness>等待双方精确比分；未观测的分数保持未知。</p>
            <div class="pk-verdict"><strong data-pk-summary>等待可分析的战局</strong><p data-pk-basis>收到比分后显示领先、追分压力与数据覆盖情况。</p></div>
</div><details class="adaptive-detail pk-outlook" data-adaptive-details><summary>追分推演与数据质量</summary><div class="adaptive-detail-body">
              <div class="pk-reading"><div><span>按近期速度推演的终局分差</span><strong data-pk-projected>--</strong></div><div><span>己方反超所需总分速</span><strong data-pk-required-rate>--</strong></div></div>
            <div class="pk-prob"><div><b data-pk-self-win>未知</b><span>己方获胜估计</span></div><div><b data-pk-opponent-win>未知</b><span>对方获胜估计</span></div></div>
            <div class="grid"><div><span class="choice-hint">近 15 秒速度 · 己 / 对 · 分/秒</span><p><strong data-pk-self-speed>--</strong> / <strong data-pk-opponent-speed>--</strong></p></div><div><span class="choice-hint">近 60 秒速度 · 己 / 对 · 分/秒</span><p><strong data-pk-self-velocity>--</strong> / <strong data-pk-opponent-velocity>--</strong></p></div><div><span class="choice-hint">模型可信程度</span><p><strong data-pk-confidence>--</strong></p></div><div><span class="choice-hint">比分样本与处理延迟</span><p><strong data-pk-sample>--</strong></p></div></div>

</div></details></div>
            <section class="settings-group" aria-label="PK 任务与播报">
              <h3>每日任务与零点计划</h3>
              <p data-pk-task-status>等待原生任务面板数据。</p>
              <p class="hint" data-pk-local-status>本机尚未观测到今日 PK。</p>
              <p data-pk-exhibition-status>展馆等待采集。</p>
              <p data-pk-midnight-plan></p>
              <p class="hint">按北京时间 00:00 计算，提醒你手动开局。实际匹配、延长和结算时间可能变化；有效次数与首胜归属以平台任务为准。</p>
              <h3>实时战局播报</h3><p data-pk-strategy>尚未生成播报。</p>
            </section>
            <div class="pk-workspace">
<section class="pk-visual pk-score-visual">            <div class="pk-chart-head"><h3>比分走势</h3><select data-pk-window aria-label="图表时间范围"><option value="60000">近 1 分钟</option><option value="180000" selected>近 3 分钟</option><option value="0">本场全部</option></select></div>
            <div class="pk-chart" data-pk-chart="scores" hidden role="img" aria-label="PK参战方比分走势"></div><p class="pk-chart-empty">等待本场比分推送，图表不会填充模拟数据。</p>
</section><details class="adaptive-detail pk-visual pk-gap-visual" data-adaptive-details><summary>分差变化 · 正数为己方领先</summary><div class="adaptive-detail-body">
              <div class="pk-chart pk-chart-gap" data-pk-chart="gap" hidden role="img" aria-label="己方分差随时间变化"></div><p class="pk-chart-empty">双方精确比分就绪后，呈现分差。</p>
</div></details>            <section class="pk-visual pk-contribution-visual"><h3>贡献榜 · 双方前 8 名</h3><div class="pk-chart pk-chart-contributions" data-pk-chart="contributions" hidden role="img" aria-label="已观测贡献榜前八名"></div><p class="pk-chart-empty">尚未采集贡献榜；礼物钻石不会替代 PK 贡献分。</p><details class="pk-data-detail"><summary>查看贡献者明细</summary><div class="pk-data-scroll"><table class="pk-table"><thead><tr><th>观众</th><th>阵营</th><th>贡献分</th><th>礼物钻石</th></tr></thead><tbody data-pk-contributors><tr><td colspan="4">暂无贡献者数据</td></tr></tbody></table></div></details></section>
<details class="adaptive-detail pk-visual pk-activity-visual" data-adaptive-details><summary>直播活动 · 最近 10 分钟</summary><div class="adaptive-detail-body">
              <p class="choice-hint">每 10 秒汇总本页观测；暂停场控仍持续采集。</p><div class="pk-chart" data-pk-chart="activity" hidden role="img" aria-label="每10秒的弹幕、进场与礼物件数"></div><p class="pk-chart-empty">等待本页直播互动。</p><p class="choice-hint" data-live-totals>尚无互动数据</p></div></details></div>
            <div class="pk-analysis">
<details class="adaptive-detail " data-adaptive-details><summary>局势因素、送礼与场上加成</summary><div class="adaptive-detail-body">
              <section class="section"><h3>局势因素</h3><ul class="pk-factors" data-pk-factors><li>等待可用比分或礼物事件。</li></ul></section>            <section class="section"><h3>近期送礼活跃度</h3><table class="pk-table"><thead><tr><th>侧</th><th>活跃用户占比</th><th>观测用户</th><th>已观测钻石</th></tr></thead><tbody data-pk-intent><tr><td colspan="4" class="empty">暂无可估计样本</td></tr></tbody></table></section>
            <section class="section"><h3>场上加成与卡片</h3><ul class="pk-effect-list" data-pk-effects><li>尚未采集明确的活动窗口。</li></ul></section>
</div></details><details class="adaptive-detail " data-adaptive-details><summary>对面弹幕与活动经验记录</summary><div class="adaptive-detail-body">
              <section class="section"><h3>对面弹幕信号</h3><p data-pk-chat class="empty">等待已采集的对手房间弹幕。</p><div class="grid"><div><span class="choice-hint">近 60 秒样本</span><p><strong data-pk-chat-recent>--</strong></p></div><div><span class="choice-hint">求援倾向</span><p><strong data-pk-chat-request>--</strong></p></div><div><span class="choice-hint">反超倾向</span><p><strong data-pk-chat-comeback>--</strong></p></div><div><span class="choice-hint">情绪信号</span><p><strong data-pk-chat-sentiment>--</strong></p></div></div></section>
            <section class="section"><h3>活动与卡片经验记录</h3><table class="pk-table"><thead><tr><th>项目</th><th>命中 / 样本</th><th>经验频率</th><th>区间</th></tr></thead><tbody data-pk-rates><tr><td colspan="4" class="empty">尚无已记录样本</td></tr></tbody></table></section>
</div></details></div>
            <details class="pk-data-detail" data-adaptive-details><summary data-pk-score-summary>查看比分明细（最近 20 次）</summary><div class="pk-data-scroll"><table class="pk-table"><thead><tr data-pk-score-header><th>北京时间</th><th>己方</th><th>对方</th><th>分差</th></tr></thead><tbody data-pk-score-rows><tr><td colspan="4">等待比分</td></tr></tbody></table></div></details>
            <p class="pk-note">这是基于当前页面观测和历史样本的估计，不是抖音官方胜率。3 倍加成、卡片和宝箱概率只会按你实际记录的场次给出经验频率与区间；样本不足时保持未知。</p>
`;
}
