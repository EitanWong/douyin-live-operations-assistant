import { sessionTime, sessionStart, sessionEnd, sessionDuration } from './live-session-view.js';
import { ANCHOR_PERIODS, selectAnchorPeriod } from './anchor-view-model.js';
import { anchorEscape, anchorNumber, anchorMoney, anchorPercent, statBars, statDistribution, statProgress } from './stat-visuals.js';
import { fanclubNumber, fanclubMemberRows, fanclubActivities } from './fanclub-view.js';

const anchorDateTime = new Intl.DateTimeFormat('zh-CN', {timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const anchorWhen = value => Number.isFinite(value) && value > 0 ? anchorDateTime.format(new Date(value)) : '未采集';
const anchorRankCount = value => value != null && /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) ? Number(value) : null;

export class AnchorDashboard {
  constructor(root, changed) {
    this.root = root; this.changed = changed; this.anchorId = ''; this.period = 'session'; this.sessionId = ''; this.page = 0; this.giftPage = 0; this.giftFilter = 'all';
    this.fanclubPage=0;
    this.onChange = event => {
      if (event.target.matches('[data-anchor-picker]')) { this.anchorId = event.target.value; this.fanclubPage=0; this.sessionId = ''; this.page = this.giftPage = 0; this.changed(); }
      if (event.target.matches('[data-anchor-session-picker]')) { this.sessionId = event.target.value; this.period = 'session'; this.page = 0; this.changed(); }
      if (event.target.matches('[data-anchor-gift-filter]')) { this.giftFilter = event.target.value; this.giftPage = 0; this.changed(); }
    };
    this.onClick = event => {
      const period = event.target.closest('[data-anchor-period]');
      if (period && Object.hasOwn(ANCHOR_PERIODS, period.dataset.anchorPeriod)) { this.period = period.dataset.anchorPeriod; if (this.period === 'session') this.sessionId = ''; this.page = 0; this.changed(); }
      for (const [attribute, property] of [['data-anchor-page','page'],['data-anchor-gift-page','giftPage'],['data-anchor-fanclub-page','fanclubPage']]) {
        const button = event.target.closest(`[${attribute}]`);
        if (button && !button.disabled) { this[property] = Math.max(0, this[property] + Number(button.getAttribute(attribute))); this.changed(); }
      }
    };
    root.addEventListener('change', this.onChange); root.addEventListener('click', this.onClick);
  }
  text(selector, value) { const node = this.root.querySelector(selector); if (node.textContent !== String(value)) node.textContent = String(value); }
  html(selector, value) { const node = this.root.querySelector(selector); if (node.innerHTML !== value) node.innerHTML = value; }
  paginate(rows, property, size, selector) {
    const pages = Math.max(1, Math.ceil(rows.length / size)); this[property] = Math.min(this[property], pages - 1);
    this.text(`[${selector}-note]`, `${rows.length} 条 · ${this[property] + 1} / ${pages} 页`);
    for (const node of this.root.querySelectorAll(`[${selector}]`)) node.disabled = Number(node.getAttribute(selector)) < 0 ? this[property] === 0 : this[property] >= pages - 1;
    return rows.slice(this[property] * size, (this[property] + 1) * size);
  }
  render(engine, {identity, income} = {}) {
    if (!engine?.anchorStats?.report) return;
    const configuredId = String(engine.config.anchorId || identity?.anchor?.id || '');
    const selectedId = this.anchorId || configuredId;
    // Version gating avoids aggregation and serialization for unrelated live events.
    const stats = engine.anchorStats;
    const date = new Date((stats.now?.() ?? Date.now()) + 8 * 3600000).toISOString().slice(0,10);
    const signature = JSON.stringify([stats.revision,date,Math.floor((stats.now?.() ?? Date.now()) / 60000),configuredId,selectedId,identity?.anchor?.name,engine.config.incomeEnabled,this.period,this.sessionId,this.fanclubPage,this.page,this.giftPage,this.giftFilter]);
    if (this.stats === stats && this.signature === signature && this.income === income) return;
    this.stats = stats; this.signature = signature; this.income = income;
    const known = new Map((engine.anchorStats.anchors?.() || []).map(item => [String(item.anchorId),item]));
    if (configuredId && !known.has(configuredId)) known.set(configuredId,{anchorId:configuredId,name:identity?.anchor?.name || ''});
    this.html('[data-anchor-picker]', '<option value="">当前主播</option>' + [...known.values()].map(item => `<option value="${anchorEscape(item.anchorId)}">${anchorEscape(item.name || item.anchorId)} · ${anchorEscape(item.anchorId)}</option>`).join(''));
    const picker = this.root.querySelector('[data-anchor-picker]'); if (picker.value !== this.anchorId) picker.value = this.anchorId;
    const report = engine.anchorStats.report(selectedId,{days:30});
    let sessionIncome = income?.anchorId === selectedId && selectedId === configuredId ? income : null;
    const matchingIncome = engine.config.incomeEnabled ? sessionIncome : null;
    if (sessionIncome && !matchingIncome) {
      const boundary = row => row ? {id:row.id,roomId:row.roomId,startAt:row.startAt,endAt:row.endAt,startSource:row.startSource,endSource:row.endSource} : null;
      sessionIncome = {...sessionIncome,allSessions:(sessionIncome.allSessions || sessionIncome.sessions || []).map(boundary),currentSession:boundary(sessionIncome.currentSession)};
    }
    const selection = selectAnchorPeriod(report,this.period,sessionIncome,this.sessionId), summary = selection.summary;
    this.matchingIncome = matchingIncome;
    this.report = {...report,selection};
    this.text('[data-anchor-report-name]', `主播：${report.name || known.get(selectedId)?.name || selectedId || '未知'}`);
    this.text('[data-anchor-scope]', selectedId === configuredId ? '当前直播间 · 本机已观测' : '本机已观测');
    this.text('[data-anchor-period-note]', `${selection.label} · ${selection.range} · 北京时间`);
    for (const node of this.root.querySelectorAll('[data-anchor-period]')) node.setAttribute('aria-pressed',String(node.dataset.anchorPeriod === this.period));
    for (const node of this.root.querySelectorAll('[data-anchor-period-label]')) node.textContent = selection.label;
    this.root.querySelector('.anchor-metrics').setAttribute('aria-label',`主播${selection.label}核心数据`);
    this.html('[data-anchor-session-picker]', '<option value="">当前 / 最近场次</option>' + selection.allSessions.map(session => `<option value="${anchorEscape(session.id)}">${anchorEscape(sessionTime(session.startAt))} · ${session.endAt ? '已下播' : '直播中'}</option>`).join(''));
    const sessionPicker = this.root.querySelector('[data-anchor-session-picker]');
    sessionPicker.value = selection.allSessions.some(session => session.id === this.sessionId) ? this.sessionId : '';
    sessionPicker.disabled = !selection.allSessions.length;
    const session = selection.selectedSession;
    this.text('[data-anchor-start]',sessionStart(session));
    this.text('[data-anchor-end]',sessionEnd(session));
    this.text('[data-anchor-duration]',sessionDuration(session,stats.now?.() ?? Date.now()));
    this.renderLikes(report,selection,sessionIncome,identity,selectedId,configuredId,stats);
    this.renderFanclub(report,stats);
    const totals = matchingIncome && selection.sessions.length ? selection.sessions.reduce((sum, row) => ({estimatedIncome:sum.estimatedIncome + row.estimatedIncome, unknownCount:sum.unknownCount + (row.unknownCount || 0)}),{estimatedIncome:0,unknownCount:0}) : null;
    this.text('[data-anchor-stat="income"]',totals ? anchorMoney(totals.estimatedIncome) : '未知');
    this.text('[data-anchor-income-note]', !engine.config.incomeEnabled ? '收入统计未启用，可在运行规则中开启。' : totals ? `${selection.label}收入按已采集礼物及榜单去重补差估算，不代表平台结算。${totals.unknownCount ? ` ${totals.unknownCount} 件礼物单价未知，未直接计入礼物金额。` : ''}` : '尚无与所选主播 UID 匹配的直播场次，收入保持未知；旧版日汇总可在收入账本查看。');
    this.text('[data-anchor-stat="winRate"]',anchorPercent(summary.winRate));
    this.text('[data-anchor-stat="battles"]',summary.battles ? anchorNumber(summary.battles) : '未知');
    this.text('[data-anchor-stat="score"]',anchorNumber(summary.totalScore));
    for (const key of ['wins','losses','draws','pending']) this.text(`[data-anchor-stat="${key}"]`,summary.battles ? anchorNumber(summary[key]) : '未知');
    this.text('[data-anchor-results-note]',`${summary.decided} 场明确终局 · ${summary.pending} 场待确认`);
    this.html('[data-anchor-results]',statDistribution(summary));
    this.text('[data-anchor-pk-note]',`${summary.scoreBattles} 场终局分数 · ${summary.unknownScoreBattles} 场未计分`);
    this.html('[data-anchor-trend]',statBars(selection.trend.map(row=>({date:new Date(row.startAt).toISOString(),label:sessionTime(row.startAt),value:row.totalScore,note:`${row.battles} 场，${row.scoreBattles} 场终局分数`})),{label:'各直播场次 PK 总分'}));
    const rank = report.rank?.afterRank || report.rank?.beforeRank;
    this.text('[data-anchor-rank]',rank ? rank.detail || rank.name || (rank.level != null ? `等级 ${rank.level}` : '已采集') : '未知');
    this.text('[data-anchor-rank-score]',rank ? [rank.scoreDisplay,rank.score != null ? `${rank.score} 分` : '',rank.starCount != null ? `${rank.starCount} 星` : ''].filter(Boolean).join(' · ') || '已收到段位事件' : report.rankUnknown?.length ? `${report.rankUnknown.length} 条段位消息未关联 UID` : '等待段位事件');
    this.text('[data-anchor-rank-at]',anchorWhen(report.rank?.observedAt));
    this.html('[data-anchor-rank-progress]',rank && (rank.starCount != null || rank.targetStarCount != null) ? statProgress('段位星数',anchorRankCount(rank.starCount),anchorRankCount(rank.targetStarCount)) : '');
    const retention = report.exhibitionRetention;
    const retentionNote = retention ? `展馆保级：${retention.name} · 还差${retention.remaining}款${retention.stale ? ' · 数据已过期' : ''}。` : '';
    this.text('[data-anchor-rank-note]',retentionNote || (report.rank?.afterRank ? '展示最近一次已确认归属该主播的段位。' : report.rank?.beforeRank ? '变更后段位尚未返回，当前展示变更前观测。' : '段位只展示页面明确关联到该主播 UID 的观察。'));
    const exhibition = report.exhibition;
    this.text('[data-anchor-exhibition-level]',exhibition ? [exhibition.level != null ? `等级 ${exhibition.level}` : '',exhibition.floor != null ? `${exhibition.floor} 层` : ''].filter(Boolean).join(' · ') || '未知' : '未知');
    this.text('[data-anchor-exhibition-lit]',anchorNumber(exhibition?.lightedCount));
    this.text('[data-anchor-exhibition-total]',anchorNumber(exhibition?.totalCount));
    this.text('[data-anchor-exhibition-stars]',exhibition?.stars ? `${anchorNumber(exhibition.stars.current)} / ${anchorNumber(exhibition.stars.target)}` : '未知');
    this.text('[data-anchor-exhibition-at]',anchorWhen(exhibition?.updatedAt));
    this.html('[data-anchor-stars-progress]',exhibition?.stars ? statProgress('展馆星数',exhibition.stars.current,exhibition.stars.target) : '');
    this.html('[data-anchor-lighted-progress]',exhibition ? statProgress('礼物点亮',exhibition.lightedCount,exhibition.totalCount) : '');
    this.text('[data-anchor-exhibition-note]',exhibition ? `${exhibition.title || exhibition.name || '展馆接口数据'} · ${exhibition.truncated || exhibition.partial ? '列表未完整返回，仅显示已采集部分。' : '按接口已返回的礼物统计。'}` : '等待展馆接口返回；未登录或接口不可用时不填充猜测值。');
    const items = (exhibition?.items || []).filter(item => this.giftFilter === 'all' || this.giftFilter === 'tasks' && item.task || this.giftFilter === 'lighted' && item.lighted === true || this.giftFilter === 'unlighted' && item.lighted === false);
    const gifts = this.paginate(items,'giftPage',12,'data-anchor-gift-page');
    this.html('[data-anchor-gifts]',gifts.length ? `<ul class="anchor-gifts">${gifts.map(item=>`<li><div class="anchor-gift-name"><strong>${anchorEscape(item.name || item.giftId)}</strong><span data-lighted="${item.lighted}">${item.lighted === true ? '已点亮' : item.lighted === false ? '未点亮' : '状态未知'}</span></div>${statProgress('收集数量',item.received,item.threshold)}${item.task ? `<div class="anchor-task">${statProgress('进阶任务',item.task.current,item.task.target)}<small>${item.task.finished === true ? '已完成' : item.task.finished === false ? '未完成' : '状态未知'} · 奖励 ${anchorNumber(item.task.rewardStars)} 星</small></div>` : ''}</li>`).join('')}</ul>` : '<p class="empty">暂无符合条件的已采集礼物</p>');
    this.html('[data-anchor-income-trend]',statBars((matchingIncome ? selection.sessions.slice(0,30).reverse() : []).map(row=>({date:new Date(row.startAt).toISOString(),label:sessionTime(row.startAt),value:row.estimatedIncome,note:row.endAt ? `下播 ${sessionTime(row.endAt)}` : '直播中'})),{label:'各直播场次收入',format:anchorMoney}));
    const battles = this.paginate(selection.rows,'page',20,'data-anchor-page');
    this.html('[data-anchor-battles]',battles.length ? battles.map(row=>`<tr><td>${anchorEscape(anchorWhen(row.endedAt || row.startedAt))}</td><td>${anchorEscape(row.opponents?.map(item=>item.name || item.anchorId).join(' / ') || '未知')}</td><td>${anchorNumber(row.score)}${row.score != null && !row.scoreFinal ? '（赛中）' : ''}</td><td>${{win:'胜',loss:'负',draw:'平',active:'进行中',pending:'待确认'}[row.outcome || row.status] || '未知'}</td></tr>`).join('') : '<tr><td colspan="4">所选范围暂无场次</td></tr>');
    this.text('[data-anchor-basis]','按直播开播至下播划分场次，PK 按开局时间归属，跨日不拆场。累计包含尚未关联直播场次的历史 PK，趋势最多显示最近 30 场。胜率=胜/(胜+负+平)，仅明确终局比分计入胜负和总分。时间不完整时按已观测边界统计。');
    this.root.querySelector('[data-action="export-anchor"]').disabled = !selectedId;
  }
  renderLikes(report,selection,sessionIncome,identity,selectedId,configuredId,stats) {
    const likeSession=this.period==='session' ? selection.selectedSession : sessionIncome?.currentSession;
    const likeRoom=likeSession?.roomId || (selectedId===configuredId ? identity?.live?.roomId : '');
    const likes=likeRoom ? report.likes?.find(row=>row.roomId===likeRoom) : !likeSession ? report.likes?.[0] : null;
    this.text('[data-anchor-likes]',likes ? likes.approximate ? likes.display : anchorNumber(likes.total) : '未知');
    this.text('[data-anchor-likes-at]',anchorWhen(likes?.observedAt));
    this.text('[data-anchor-likes-scope]',this.period==='session' ? '所选场次累计点赞' : '最近观测场次累计点赞');
    this.text('[data-anchor-likes-note]',likes ? `${likes.approximate ? '原生页面缩略值，非精确计数' : likes.source==='websocket' ? '平台点赞推送累计值' : '原生页面累计值'} · 直播 ID ${likes.roomId}${(stats.now?.() ?? Date.now())-likes.observedAt>120000 ? ' · 超过 2 分钟未更新' : ''}。单场观测不按日、周或月累加。` : '等待所选直播场次的点赞数据；未采集的场次保持未知。');
  }
  renderFanclub(report,stats) {
    const club=report.fanclub,now=stats.now?.() ?? Date.now();
    this.text('[data-anchor-fanclub-title]',club?.title || club?.name || '等待粉丝团数据');
    this.text('[data-anchor-fanclub-count]',fanclubNumber(club?.fansCount));
    this.text('[data-anchor-fanclub-lighted]',fanclubNumber(club?.lightedCount));
    this.text('[data-anchor-fanclub-loaded]',club?.members?.length || 0);
    this.text('[data-anchor-fanclub-level]',club?.viewer?.level ?? '未知');
    this.text('[data-anchor-fanclub-at]',anchorWhen(club?.observedAt));
    this.text('[data-anchor-fanclub-viewer]',club?.viewer ? `打开成员页时账号 ${club.viewer.userId || '未知'} · 勋章${club.viewer.lighted===true ? '已点亮' : club.viewer.lighted===false ? '未点亮' : '状态未知'}${club.clubId ? ` · 粉丝团 ID ${club.clubId}` : ''}` : '账号等级和点亮状态在打开原生成员页时采集，独立于主播的粉丝团人数。');
    this.text('[data-anchor-fanclub-note]',club?.membersAt ? `${club.hiddenInactive ? '原生页提示不活跃成员已隐藏；' : ''}当前保存 ${club.members.length} 位已加载成员${club.truncated ? '，名单达到采集上限' : ''}。名单更新 ${anchorWhen(club.membersAt)}${now-club.membersAt>120000 ? '（超过 2 分钟未更新）' : ''}；亲密度带万/亿时保留原生缩略值。人数是最近观测总量，不按所选日期累加。` : '打开直播间的原生粉丝团成员页后自动保存人数和成员明细；尚未采集的字段显示未知。');
    this.html('[data-anchor-fanclub-members]',fanclubMemberRows(this.paginate(club?.members || [],'fanclubPage',20,'data-anchor-fanclub-page')));
    this.html('[data-anchor-fanclub-activities]',fanclubActivities(club?.activities));
  }
  exportReport() {
    if (!this.report?.anchorId) throw new Error('请先识别或选择主播');
    const {selection, today, month, total, ...report} = this.report;
    return JSON.parse(JSON.stringify({...report,version:2,exportedAt:new Date().toISOString(),period:selection.period,periodLabel:selection.label,
      range:selection.range,summary:selection.summary,battles:selection.rows,trend:selection.trend,sessions:selection.sessions,session:selection.selectedSession,
      basis:this.root.querySelector('[data-anchor-basis]').textContent,
      income:this.matchingIncome ? {sessions:selection.sessions,monthBasis:'session-start',basis:'本地礼物估算，不代表平台结算；按直播场次统计，跨日不拆场。'} : null}));
  }
  destroy() { this.root.removeEventListener('change',this.onChange); this.root.removeEventListener('click',this.onClick); }
}
