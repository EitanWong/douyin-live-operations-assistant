import { AUTO_LIKE_MIN_INTERVAL_SEC } from '../../core/auto-like.js';

export const autoLikeView = {
  template:() => `<section class="page" role="tabpanel" id="page-auto-like" aria-labelledby="tab-auto-like" data-page="auto-like" hidden>
            <h2>自动点赞</h2><p class="intro">使用当前登录账号，为当前直播间批量点赞。点击开始后立即执行，独立于场控回复模式。</p>
            <div class="grid">
              <label class="field"><span>每批点赞数</span><input type="number" data-auto-like="batch" value="20" min="1" max="100" step="1"><small>1～100 次；平台接受点赞请求后计入进度。</small></label>
              <label class="field"><span>批次间隔 / 秒</span><input type="number" data-auto-like="intervalSec" value="2" min="${AUTO_LIKE_MIN_INTERVAL_SEC}" max="60" step="${AUTO_LIKE_MIN_INTERVAL_SEC}"><small>${AUTO_LIKE_MIN_INTERVAL_SEC}～60 秒，0.001 秒 = 1 毫秒；响应后等待，实际间隔受网络和浏览器影响。低于 2 秒为实验设置，遇拒绝即停。</small></label>
              <label class="field"><span>本次目标点赞数</span><input type="number" data-auto-like="target" value="1000" min="1" max="1000000" step="1"><small>达到目标自动停止；刷新后需重新开始。</small></label>
            </div>
            <div class="actions"><button type="button" class="primary" data-action="auto-like-start">开始点赞</button><button type="button" class="danger" data-action="auto-like-stop" disabled>停止点赞</button></div>
            <p role="status" aria-live="polite" data-auto-like-status>尚未开始</p><p class="hint" data-auto-like-progress>本次平台已接受 0 次 · 0 批</p>
            <p class="hint">按网页原生点赞的成功结果累计进度；本人点赞广播可能不返回，不影响继续点赞。进度为平台接受的请求数量，最终展示以直播间为准。平台拒绝或请求结果未知时停止，不自动重试；切换房间、账号、下播或断线后需重新开始。</p>
          </section>`,
  update(panel, state) {
    const active = ['starting','running','stopping'].includes(state.phase);
    panel.disabled('[data-action=auto-like-start]',active);
    panel.disabled('[data-action=auto-like-stop]',!active || state.phase === 'stopping');
    for (const input of panel.root.querySelectorAll('[data-auto-like]')) input.disabled = active;
    panel.text('[data-auto-like-status]',`${panel.demo ? '模拟演练 · ' : ''}${state.reason}`);
    panel.text('[data-auto-like-progress]',`本次${panel.demo ? '模拟接受' : '平台已接受'} ${state.accepted || 0} 次 · ${state.batches || 0} 批`);
  },
  actions:{
    start:async (panel, invoke) => {
      panel.disabled('[data-action=auto-like-start]',true);
      try { await invoke('start',Object.fromEntries([...panel.root.querySelectorAll('[data-auto-like]')].map(input=>[input.dataset.autoLike,Number(input.value)]))); }
      finally { panel.updateToolState('auto-like',panel.toolStates.get('auto-like') || {phase:'idle',accepted:0,batches:0,reason:'尚未开始'}); }
    },
    stop:(panel, invoke) => invoke('stop')
  }
};
