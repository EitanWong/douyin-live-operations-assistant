import { parseExhibitionRetention, readExhibitionRetention, retentionFromIndicatorResponse } from './exhibition-retention.js';
import { readRoomLikes } from './room-likes.js';

// Fields verified against the live web exhibition response. Keep request
// credentials, presentation schemas and unrelated response fields out of events.
const exhibitionText = value => typeof value === 'string' ? value.slice(0, 120) : '';
const exhibitionId = value => typeof value === 'string' && /^\d{1,30}$/.test(value) ? value
  : Number.isSafeInteger(value) && value >= 0 ? String(value) : '';
const exhibitionNumber = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
function exhibitionGift(item) {
  const giftId = exhibitionId(item?.gift?.gift_id);
  if (!giftId) return null;
  const naming = item.naming_user;
  return {
    giftId, name:exhibitionText(item.gift.name), diamonds:exhibitionNumber(item.gift.diamond_count),
    lighted:typeof item.is_lighted === 'boolean' ? item.is_lighted : null,
    received:exhibitionNumber(item.received_count), threshold:exhibitionNumber(item.lighted_threshold),
    totalReceived:exhibitionNumber(item.total_received_count),
    task:item.advanced_task ? {groupId:exhibitionId(item.advanced_task.group_id),taskId:exhibitionId(item.advanced_task.task_id),
      current:exhibitionNumber(item.advanced_task.current_count),target:exhibitionNumber(item.advanced_task.threshold),
      rewardStars:exhibitionNumber(item.advanced_task.reward_star_count),finished:typeof item.advanced_task.is_finished === 'boolean' ? item.advanced_task.is_finished : null} : null,
    namingUser:naming && !naming.hide && !naming.mystery ? {id:exhibitionId(naming.user_id_str) || exhibitionId(naming.user_id),name:exhibitionText(naming.nickname)} : null
  };
}

export function exhibitionEvents(kind, response, context, capturedAt = Date.now(), snapshotId = String(capturedAt)) {
  if (response?.status_code !== 0 || !response.data || !exhibitionId(context?.anchorId) || !exhibitionId(context?.roomId)) return [];
  const data = response.data;
  if (data.anchor_id != null && exhibitionId(data.anchor_id) !== context.anchorId) return [];
  const summary = kind === 'home' ? {name:exhibitionText(data.anchor_name),title:exhibitionText(data.title),
    level:exhibitionNumber(data.level),gradeLevel:exhibitionNumber(data.grade_level),gapToNextLevel:exhibitionNumber(data.gap_to_next_level),
    exhibitionType:exhibitionNumber(data.exhibition_type),keepTarget:exhibitionNumber(data.keep_exhibition_type_target_count),
    allCollected:typeof data.is_all_collected === 'boolean' ? data.is_all_collected : null,
    stars:data.star_info ? {current:exhibitionNumber(data.star_info.current_count),target:exhibitionNumber(data.star_info.threshold),completedStage:exhibitionNumber(data.star_info.completed_stage)} : null} : undefined;
  const lists = kind === 'home' ? ['lighted_items','unlighted_items','all_normal_items','lighted_rare_gifts','unlighted_rare_gifts'] : kind === 'rare' ? ['rare_gifts'] : [];
  const events = [];
  for (const section of lists) {
    if (!Array.isArray(data[section])) continue; // Missing is unknown, never an empty snapshot.
    const original = data[section], items = original.slice(0, 1000).map(row => exhibitionGift(section === 'rare_gifts' ? row?.gift_item : row)).filter(Boolean);
    const chunks = Math.max(1, Math.ceil(items.length / 10));
    for (let chunk = 0; chunk < chunks; chunk++) events.push({type:'anchor-exhibition',source:'web-exhibition',
      anchorId:context.anchorId,roomId:context.roomId,receivedAt:capturedAt,at:capturedAt,
      id:`exhibition:${snapshotId}:${kind}:${section}:${chunk}`,snapshotId,section,chunk,chunks,
      totalItems:original.length,truncated:original.length > 1000 || items.length < original.length,
      ...(summary ? {summary} : {}),items:items.slice(chunk * 10, chunk * 10 + 10)});
  }
  return events;
}

// Only read explicit labels inside a visible native task panel. Chat text,
// assistant shadow DOM and a closed/missing task panel cannot establish tasks.
export function readPKTasks(document) {
  const values = {valid:new Set(),wins:new Set(),firstWin:new Set()};
  const excluded = node => node.closest('#chatroom, [data-e2e*="chat-message"], [data-live-assistant]');
  const visible = node => {
    for (let el=node; el && el.nodeType===1; el=el.parentElement) {
      if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
      const style = document.defaultView?.getComputedStyle(el);
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
  };
  const labelPattern = /^(?:每日|今日)(?:(?:有效PK次数)|(?:首胜)|(?:首场胜利)|(?:[0-9]{1,4}场有效PK(?:胜利)?))/i;
  const readRow = text => {
    const normalized = text.replace(/\s/g,'').replace(/（/g,'(').replace(/）/g,')');
    const label = normalized.match(labelPattern)?.[0];
    if (!label) return;
    const value = normalized.slice(label.length);
    const first = /首胜|首场胜利/.test(label);
    if (first && /^(已完成|未完成)$/.test(value)) {values.firstWin.add(value === '已完成');return;}
    const match = value.match(/^(?:\((\d{1,4})\/(\d{1,4})\)|(\d{1,4})\/(\d{1,4}))(?:次|场)?$/);
    if (!match) return;
    const current = Number(match[1] ?? match[3]), target = Number(match[2] ?? match[4]);
    if (!target || current > target || current > 10000 || target > 10000) return;
    const statedTarget = label.match(/(\d+)场/);
    if (statedTarget && Number(statedTarget[1]) !== target) return;
    if (first) {if (target === 1) values.firstWin.add(current === 1);}
    else values[/胜利/.test(label) ? 'wins' : 'valid'].add(`${current}/${target}`);
  };
  const selector = '[data-e2e*="task"], [class*="taskPanel"], [role="dialog"], [class*="profile"], [class*="Profile"], [class*="pkSeason"], [class*="PKSeason"]';
  for (const panel of [...document.querySelectorAll(selector)].slice(0, 60)) {
    if (excluded(panel) || !visible(panel)) continue;
    const text = panel.textContent || '';
    if (text.length > 6000 || !/PK任务|每日任务|每日PK任务|PK段位|观众英雄榜/i.test(text)) continue;
    for (const label of [...panel.querySelectorAll('span,p,dt,label,div,li')].slice(0, 300)) {
      if (excluded(label) || !visible(label)) continue;
      if (!labelPattern.test((label.textContent || '').replace(/\s/g,''))) continue;
      // Read a compact row, including split label/progress spans. Never include
      // hidden children or a neighbouring task when walking to its parent.
      let row = label;
      for (let depth=0; row && row !== panel && depth<3; depth++,row=row.parentElement) {
        if (row.textContent.length > 100 || !visible(row) || excluded(row)) break;
        const parts = [...row.querySelectorAll('*')];
        if (parts.some(node => !visible(node) || excluded(node))) continue;
        readRow(row.textContent);
      }
    }
  }
  const single = set => set.size === 1 ? [...set][0] : null;
  const progress = set => single(set)?.split('/').map(Number) || [null,null];
  const [valid,target] = progress(values.valid), [validWins,winTarget] = progress(values.wins);
  const result = {valid,target,firstWin:single(values.firstWin),validWins,winTarget};
  return Object.values(result).some(value => value !== null) ? result : null;
}

export class AnchorDataCollector {
  constructor({page,sender,onEvent,onStatus = () => {}}) {
    this.page = page; this.sender = sender; this.onEvent = onEvent; this.onStatus = onStatus;
    this.path = page.location.pathname; this.stopped = false; this.serial = 0;
  }
  context() {
    if (this.stopped || this.page.location.pathname !== this.path) return null;
    const current = this.sender.context();
    if (!current) return null;
    const info = this.page.__STORE__?.roomStore?.roomInfo;
    const owner = info?.anchor || info?.owner || info?.room?.owner;
    const anchorId = exhibitionId(owner?.id_str) || exhibitionId(owner?.id) || exhibitionId(new URL(this.page.location.href).searchParams.get('anchor_id'));
    return anchorId ? {anchorId,roomId:current.roomId} : null;
  }
  async collectTasks(snapshotId = `dom-${Date.now()}`) {
    const context = this.context();
    if (!context) return;
    const tasks = readPKTasks(this.page.document), capturedAt = Date.now();
    const key = JSON.stringify([context,tasks]);
    if (key === this.taskKey && (!tasks || capturedAt-this.taskAt < 30000)) return;
    this.taskKey = key; this.taskAt = capturedAt;
    // Publish an unknown snapshot on panel removal, without producing an
    // identical journal entry every few seconds while no panel is open.
    await this.onEvent({type:'anchor-pk-tasks',source:'native-task-panel',...context,
      id:`pk-tasks:${snapshotId}`,at:capturedAt,receivedAt:capturedAt,
      ...(tasks || {valid:null,target:null,firstWin:null,validWins:null,winTarget:null})});
  }
  async collectLikes() {
    const context=this.context(),likes=context && readRoomLikes(this.page.document),now=Date.now();
    if (!likes) return;
    const key=JSON.stringify([context,likes]);
    if (key===this.likesKey && now-this.likesAt<30000) return;
    await this.onEvent({type:'room-likes',source:'native-room',...context,...likes,id:`room-likes:${now}:${++this.serial}`,receivedAt:now,at:now});
    this.likesKey=key;this.likesAt=now;
  }
  async refresh() {
    if (this.busy) return false;
    const context = this.context(), client = context && this.sender.client();
    if (!context) return false;
    this.busy = true;
    const snapshotId = `${Date.now()}-${++this.serial}`;
    try {
      await this.collectLikes();
      await this.collectTasks(snapshotId);
      const capturedAt = Date.now();
      const retention = readExhibitionRetention(this.page.document);
      if (retention) await this.onEvent({type:'anchor-exhibition-retention',source:'native-indicator',...context,
        id:`retention:${snapshotId}`,receivedAt:capturedAt,...retention});
      if (!client) return false;
      try {
        const result = await client.get('/webcast/gift/play/indicator/',{params:{aid:6383,app_name:'douyin_web',activity_id:'exhibition_section',room_id:context.roomId,anchor_id:context.anchorId},timeout:10000});
        const current = this.context(), retention = retentionFromIndicatorResponse(result?.data);
        if (!current || current.anchorId !== context.anchorId || current.roomId !== context.roomId) return false;
        if (retention) await this.onEvent({type:'anchor-exhibition-retention',source:'web-exhibition',...context,id:`retention:indicator:${snapshotId}`,receivedAt:Date.now(),...retention});
      } catch { this.onStatus('retention',{at:Date.now(),status:'failed'}); }
      for (const kind of ['home','rare']) {
        try {
          const params = {aid:6383,app_name:'douyin_web',room_id:context.roomId,
            ...(kind === 'home' ? {anchor_id:context.anchorId,exhibition_source:1} : {target_uid:context.anchorId})};
          const result = await client.get(`/webcast/gift/exhibition/${kind}/`,{params,timeout:10000});
          const current = this.context();
          if (!current || current.anchorId !== context.anchorId || current.roomId !== context.roomId) return false;
          const response = result?.data;
          this.onStatus(kind,{at:Date.now(),status:response?.status_code === 0 ? 'ok' : 'unavailable',code:response?.status_code ?? null});
          const retention = kind === 'home' && response?.status_code === 0 && parseExhibitionRetention(response.data?.title);
          if (retention && (response.data.anchor_id == null || exhibitionId(response.data.anchor_id) === context.anchorId)) await this.onEvent({
            type:'anchor-exhibition-retention',source:'web-exhibition',...context,id:`retention:response:${snapshotId}`,receivedAt:Date.now(),...retention});
          for (const event of exhibitionEvents(kind,response,context,Date.now(),snapshotId)) {
            if (!this.context()) return false;
            await this.onEvent(event);
          }
        } catch { this.onStatus(kind,{at:Date.now(),status:'failed'}); }
      }
      return true;
    } finally { this.busy = false; }
  }
  start() {
    if (this.started) return;
    this.started = true;
    // Task/profile popovers can close before the slower exhibition HTTP poll.
    this.taskTimer = this.page.setInterval(()=>{void this.collectTasks().catch(()=>{});void this.collectLikes().catch(()=>{});},3000);
    const tick = async () => {
      if (this.stopped || this.page.location.pathname !== this.path) return;
      let ready = false;
      try { ready = await this.refresh(); } catch {}
      if (!this.stopped && this.page.location.pathname === this.path) this.timer = this.page.setTimeout(tick,ready ? 60000 : 5000);
    };
    this.timer = this.page.setTimeout(tick,1000);
  }
  stop() { this.stopped = true; this.page.clearTimeout(this.timer); this.page.clearInterval(this.taskTimer); }
}
