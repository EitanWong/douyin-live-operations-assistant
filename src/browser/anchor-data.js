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
  async refresh() {
    if (this.busy) return false;
    const context = this.context(), client = context && this.sender.client();
    if (!client) return false;
    this.busy = true;
    const snapshotId = `${Date.now()}-${++this.serial}`;
    try {
      for (const kind of ['home','rare']) {
        try {
          const params = {aid:6383,app_name:'douyin_web',room_id:context.roomId,
            ...(kind === 'home' ? {anchor_id:context.anchorId,exhibition_source:1} : {target_uid:context.anchorId})};
          const result = await client.get(`/webcast/gift/exhibition/${kind}/`,{params,timeout:10000});
          const current = this.context();
          if (!current || current.anchorId !== context.anchorId || current.roomId !== context.roomId) return false;
          const response = result?.data;
          this.onStatus(kind,{at:Date.now(),status:response?.status_code === 0 ? 'ok' : 'unavailable',code:response?.status_code ?? null});
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
    const tick = async () => {
      if (this.stopped || this.page.location.pathname !== this.path) return;
      let ready = false;
      try { ready = await this.refresh(); } catch {}
      if (!this.stopped && this.page.location.pathname === this.path) this.timer = this.page.setTimeout(tick,ready ? 60000 : 5000);
    };
    this.timer = this.page.setTimeout(tick,1000);
  }
  stop() { this.stopped = true; this.page.clearTimeout(this.timer); }
}
