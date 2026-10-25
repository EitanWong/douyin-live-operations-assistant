import { icon } from './icons.js';

const broadcastSwitch = (key, label) => `<label class="switch"><input id="pk-broadcast-${key}" type="checkbox" role="switch" data-field="pkOperations.${key}" aria-label="${label}"><span aria-hidden="true"></span></label>`;
const intervalInput = (key, label, min, max) => `<label class="pk-broadcast-interval"><span>每隔</span><span class="pk-broadcast-number"><input type="number" data-field="pkOperations.${key}" aria-label="${label}" min="${min}" max="${max}" step="1"><span>秒</span></span><span>播报</span></label>`;
const timeInput = (key, label, min, max, hint) => `<label class="field"><span>${label}</span><span class="pk-broadcast-number"><input type="number" data-field="pkOperations.${key}" min="${min}" max="${max}" step="1"><span>秒</span></span><small>${hint}</small></label>`;

export function pkSettingsTemplate() {
  return `<details id="pk-broadcast-settings" class="pk-broadcast" data-pk-settings>
    <summary class="pk-broadcast-summary">
      <span class="pk-broadcast-icon">${icon('sliders-horizontal')}</span>
      <span class="pk-broadcast-heading"><span class="pk-broadcast-title">PK 播报设置</span><span class="pk-broadcast-description" data-pk-settings-summary>开局、结算、每日任务与战局提醒</span></span>
      <span class="pk-broadcast-state" data-pk-settings-state>已关闭</span>
      <svg class="pk-broadcast-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
    </summary>
    <div class="pk-broadcast-body">
      <div class="pk-broadcast-master">
        <div><label class="pk-broadcast-title" for="pk-broadcast-enabled">启用 PK 消息播报</label><p data-summary="pk-broadcast"></p></div>
        ${broadcastSwitch('enabled','启用 PK 消息播报')}
      </div>
      <p class="pk-broadcast-save-hint">保存并开始场控后生效；仅预览模式不会发送。修改后请在底部保存设置。</p>
      <fieldset class="pk-broadcast-options" data-pk-broadcast-options aria-label="播报内容与频率">
        <div class="pk-broadcast-option">
          <div class="pk-broadcast-copy"><h3><label for="pk-broadcast-announceLifecycle">开局与结算</label></h3><p>PK 开始和结束时，自动播报对手、比分与结果。</p></div>
          ${broadcastSwitch('announceLifecycle','播报 PK 开始与结束')}
        </div>
        <div class="pk-broadcast-option">
          <div class="pk-broadcast-copy"><h3><label for="pk-broadcast-reportEnabled">每日任务与展馆</label></h3><p>定时汇报每日任务进度与展馆状态。</p></div>
          ${intervalInput('reportSec','汇报间隔 / 秒',30,86400)}
          ${broadcastSwitch('reportEnabled','定时汇报每日任务与展馆')}
        </div>
        <div class="pk-broadcast-option">
          <div class="pk-broadcast-copy"><h3><label for="pk-broadcast-aiEnabled">实时战局播报</label></h3><p data-pk-strategy-mode>使用新鲜比分，播报剩余时间与领先、落后情况。</p></div>
          ${intervalInput('aiIntervalSec','战局播报间隔 / 秒',15,600)}
          ${broadcastSwitch('aiEnabled','启用实时战局播报（AI 优先）')}
        </div>
        <div class="pk-broadcast-option">
          <div class="pk-broadcast-copy"><h3><label for="pk-broadcast-midnightEnabled">跨零点开局提醒</label></h3><p>按北京时间计算，在零点前提醒你手动开局。</p></div>
          ${broadcastSwitch('midnightEnabled','提醒跨零点 PK 开局')}
          <div class="pk-broadcast-midnight" data-pk-midnight-settings hidden>
            <div class="pk-broadcast-times">
              ${timeInput('durationSec','预计 PK 时长',30,3600,'30–3600 秒，不含匹配等待')}
              ${timeInput('crossMidnightSec','零点后结束余量',1,120,'1–120 秒，小于 PK 时长')}
              ${timeInput('preparationSec','提前准备提醒',10,600,'10–600 秒')}
            </div>
            <p class="pk-broadcast-plan" data-pk-plan-preview aria-live="polite"></p>
            <p class="pk-broadcast-fine-print">实际匹配和结算时间可能变化，首胜归属以平台任务为准。</p>
          </div>
        </div>
      </fieldset>
      <details class="pk-broadcast-help"><summary>播报方式与固定格式示例</summary>
        <p>有管理员弹幕权限时优先使用，否则发送普通弹幕。AI 可用时结合共享直播上下文生成；服务关闭、繁忙、额度不足或生成失败时使用固定格式，不对未知数据作推测。</p>
        <button type="button" class="text-button" data-go="ai">配置 AI 服务</button>
        <p>以下为格式示例；发送时填入实际观测值，未采集字段标为未知。</p>
        <ul><li>PK开始，本场第3场，对手小明，剩余300秒。</li><li>PK结束，获胜，己方120分，对手100分。</li><li>平台任务：有效PK 2/5，首胜未完成。</li><li>PK剩余30秒，己方120分，领先20分。</li></ul>
        <p>开局、结算与任务播报在 AI 服务开启时也会优先生成，失败后保留固定播报。</p>
      </details>
    </div>
  </details>`;
}
