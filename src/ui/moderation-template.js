export function moderationTemplate(panel) {
  const actions=[['notify','仅提醒'],['mute','自动禁言'],['ban','直播间封禁（拉黑）']];
  return `<section class="page" role="tabpanel" id="page-moderation" aria-labelledby="tab-moderation" data-page="moderation" hidden>
    <h2>内容治理</h2><p class="intro">结合语境检测敏感话题、辱骂和黑粉恶意言论，按严重程度分级处置。</p>
    <div class="rule-summary"><strong>提醒 → 禁言 → 封禁</strong><p data-moderation-summary></p><button type="button" class="text-button" data-go="features">前往功能开关</button></div>
    <div data-moderation-settings class="settings-workspace">
      <section class="settings-column"><section class="settings-group"><h3>检测范围</h3>
        ${panel.select('moderation.detector','判定方式',[['ai','AI 语境判定'],['local','仅本地词库']])}
        <p class="hint">AI 使用“AI 设置”中的接口、模型和密钥。开启后将目标弹幕及最近 8 条聊天文本发送给该服务，不发送观众 UID。普通批评、不同意见和拒绝消费不作为黑粉违规。</p>
        ${[['sensitive','敏感话题'],['abuse','辱骂与人身攻击'],['troll','恶意挑衅与围攻（黑粉言论）']].map(([key,label])=>`<label class="toggle"><input type="checkbox" data-field="moderation.categories.${key}">${label}</label>`).join('')}
        <div class="grid">${panel.input('moderation.minConfidence','AI 最低置信度 / 0.5–1','number')}${panel.input('moderation.maxPerHour','AI 检测每小时上限','number')}</div>
        <p class="hint">低置信度只提醒管理员核查；服务异常、未启用或达到上限时，本地词库仅提醒，不执行自动处置。AI 检测独立于 AI 弹幕问答开关。</p><button type="button" class="text-button" data-go="ai">配置 AI 服务</button>
      </section><section class="settings-group"><h3>检测词库</h3><p class="hint">每行一项。敏感话题同时作为 AI 的直播间规则；本地模式按词匹配，空格和常见标点不能绕过。</p>
        ${panel.area('moderation.sensitiveTerms','敏感话题 / 自定义禁谈内容')}${panel.area('moderation.terms','辱骂词')}${panel.area('moderation.trollTerms','恶意挑衅词句')}${panel.area('moderation.severeTerms','严重违规词句（本地模式直接处置）')}
      </section></section>
      <section class="settings-column"><section class="settings-group"><h3>分级处置</h3><p class="hint">按同一 UID 在滚动时间窗内的违规累计计数；每条弹幕只计一次。</p>
        ${panel.input('moderation.windowSec','违规统计时长 / 秒','number')}
        <div class="grid">${panel.input('moderation.threshold','累计多少次执行处置','number')}${panel.input('moderation.banThreshold','累计多少次升级封禁','number')}</div>
        <label class="toggle"><input type="checkbox" data-field="moderation.escalateBan">持续违规达到上方次数后升级封禁</label>
        ${panel.select('moderation.repeatAction','多次提醒后',actions)}${panel.select('moderation.severeAction','严重违规直接',actions)}
        <p class="hint">封禁对应平台直播间拉黑：对方将无法进入该主播的直播间。禁言时长由平台决定。仅预览模式不会执行管理操作；自动处置需要当前账号有本房管理权限，主播和管理员不自动处罚。结果未知时不自动重试。</p>
      </section><section class="settings-group"><h3>观众提醒</h3><label class="toggle"><input type="checkbox" data-field="moderation.warningsEnabled">在公屏发送文明发言提醒</label>
        ${panel.input('moderation.warningTemplate','提醒话术','text','支持 {user} 和 {count}；实际发送受消息长度限制。')}
      </section></section>
    </div>
    <section class="settings-group"><h3>最近检测与处置</h3><p class="hint">记录保留最近 100 次检测；状态区分仅提醒、预览、平台接受、不可用和结果未知。</p><div data-moderation-records><p class="empty">暂无违规记录。</p></div></section>
  </section>`;
}
