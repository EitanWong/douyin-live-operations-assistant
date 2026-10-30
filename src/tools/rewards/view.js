export const rewardsView = {
  template:() => `<section class="page" role="tabpanel" id="page-rewards" aria-labelledby="tab-rewards" data-page="rewards" hidden>
            <h2>福袋红包</h2><p class="intro">使用当前登录账号，自动打开本直播间的活动并参与。开启并保存设置后开始，独立于场控回复模式。</p>
            <section class="settings-group"><div class="feature-list">
              <div class="feature-row"><div class="feature-title">自动参与<small>按直播间保存；下次打开此直播间会继续等待活动。</small></div><label class="switch" aria-label="自动参与福袋红包"><input type="checkbox" role="switch" data-field="rewards.enabled" aria-label="自动参与福袋红包"><span></span></label></div>
              <div class="feature-row"><div class="feature-title">抢福袋<small>核对本轮参与资格，提交后等待本人服务器回执。</small></div><label class="switch" aria-label="自动抢福袋"><input type="checkbox" role="switch" data-field="rewards.luckyBag" aria-label="自动抢福袋"><span></span></label></div>
              <div class="feature-row"><div class="feature-title">参与口令福袋<small>允许发送本轮活动口令，口令可能出现在公屏。</small></div><label class="switch" aria-label="参与口令福袋"><input type="checkbox" role="switch" data-field="rewards.nativePassword" aria-label="参与口令福袋"><span></span></label></div>
              <div class="feature-row"><div class="feature-title">抢红包<small>出现可用的领取按钮时自动点击。</small></div><label class="switch" aria-label="自动抢红包"><input type="checkbox" role="switch" data-field="rewards.redPacket" aria-label="自动抢红包"><span></span></label></div>
            </div></section>
            <p data-rewards-status role="status">自动参与已关闭</p><p class="hint" data-rewards-activity>等待本直播间的活动信息</p><p class="hint" data-rewards-progress>本页提交参与 0 次 · 页面确认 0 次 · 服务器确认 0 次</p>
            <div class="actions"><button type="button" class="danger" data-action="rewards-stop" disabled>立即停止参与</button></div>
            <p class="hint">同一轮活动只提交一次。福袋核对当前账号的服务器参与回执；红包以网页“已领取”确认为准。结果未确认时保留记录，避免重复参与。关注、粉丝团、付费、验证及尚未支持的条件需手动完成；口令福袋需单独开启。</p>
            <details class="advanced"><summary>福袋入口定位</summary><label class="field"><span>入口 XPath</span><input type="text" data-field="rewards.entryXPath" placeholder="留空使用自动识别"><small>已预填当前页面入口。页面布局变化时可更新；仅匹配福袋入口才点击。</small></label></details>
          </section>`,
  update(panel, state) {
    panel.text('[data-rewards-status]',`${panel.demo ? '模拟器 · ' : ''}${state.reason}`);
    const activity=state.lottery;
    const lotteryText=activity ? `福袋：奖品总量 ${activity.prizeCount ?? '待确认'} · 份数 ${activity.luckyCount ?? '待确认'} · 参与人数 ${activity.candidateCount ?? '待确认'} · ${activity.drawn ? '已开奖' : activity.participation==='confirmed' ? '服务器已确认参与' : activity.remainingSec===0 ? '等待开奖结果' : `剩余 ${activity.remainingSec ?? '待确认'} 秒`}` : '';
    const packetText=state.redPacket ? `红包：${state.redPacket.remainingSec===0 ? '本轮已结束' : `剩余 ${state.redPacket.remainingSec ?? '待确认'} 秒`}，领取结果以页面为准` : '';
    panel.text('[data-rewards-activity]',[lotteryText,packetText].filter(Boolean).join('；') || '等待本直播间的活动信息');
    panel.text('[data-rewards-progress]',`本页提交参与 ${state.submitted || 0} 次 · 页面确认 ${state.confirmed || 0} 次 · 服务器确认 ${state.serverConfirmed || 0} 次`);
    panel.disabled('[data-action=rewards-stop]',['idle','stopped'].includes(state.phase));
  },
  actions:{
    stop:async (panel, invoke) => {
      await invoke('stop');
      panel.config.rewards.enabled=false;panel.node('[data-field="rewards.enabled"]').checked=false;
      panel.toast('福袋红包自动参与已停止');
    }
  }
};
