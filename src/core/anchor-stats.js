import { RoomLikes } from './room-likes.js';
import { AnchorFanclub } from './fanclub.js';
// 累积页面实际观测的 PK，不受 PKTracker 的运行时场次保留数量影响。
// 每个战局 + 明确主播 UID 只有一行；没有平台终局比分证据的比赛保留待确认。
const DAY = 86400000, OFFSET = 8 * 3600000;
const identity = value => typeof value === 'string' && value && value !== '0' && value.length <= 256 ? value
  : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : '';
const time = value => Number.isFinite(value) && value > 0 && value <= 8640000000000000 - OFFSET ? value : null;
const score = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const copyAnchorStats = value => JSON.parse(JSON.stringify(value));
const recordKey = (battle, anchor) => JSON.stringify([battle, anchor]);
const dateAt = at => time(at) === null ? null : new Date(at + OFFSET).toISOString().slice(0, 10);
const pointAt = state => Math.max(...[state.lastEventAt, state.lastScoreAt, state.endedAt, state.startedAt].map(value => time(value) || 0)) || null;
const text = value => typeof value === 'string' ? value.slice(0, 200) : '';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const snapshotStamp = value => Number(String(value || '').match(/^(\d{10,})/)?.[1] || NaN);
const snapshotOlder = (incoming, current) => {
  const a = snapshotStamp(incoming), b = snapshotStamp(current);
  if (Number.isFinite(a) && Number.isFinite(b)) return a < b || a === b && String(incoming) < String(current);
  return String(incoming) < String(current);
};
const exhibitionPriority = section => ['lighted_items', 'unlighted_items', 'lighted_rare_gifts', 'unlighted_rare_gifts', 'rare_gifts'].includes(section) ? 2 : 1;
function mergeExhibitionItem(previous, next) {
  if (!previous) return {...next, sourcePriority:exhibitionPriority(next.section)};
  const preferNext = exhibitionPriority(next.section) >= (previous.sourcePriority || 0);
  const merged = {...previous};
  for (const key of ['name', 'diamonds', 'received', 'threshold', 'totalReceived', 'task', 'namingUser']) {
    if (preferNext && next[key] != null || merged[key] == null && next[key] != null) merged[key] = next[key];
  }
  if (preferNext && next.lighted != null || merged.lighted == null && next.lighted != null) merged.lighted = next.lighted;
  if (preferNext) { merged.section = next.section; merged.sourcePriority = exhibitionPriority(next.section); }
  return merged;
}
const outcomeOf = (row, rows) => {
  if (!row.scoreFinal || rows.length < 2 || rows.some(item => !item.scoreFinal)) return null;
  const high = Math.max(...rows.map(item => item.score));
  return row.score < high ? 'loss' : rows.filter(item => item.score === high).length > 1 ? 'draw' : 'win';
};
export function summarizeAnchorBattles(rows) {
  const count = outcome => rows.filter(row => row.outcome === outcome).length;
  const wins = count('win'), losses = count('loss'), draws = count('draw'), decided = wins + losses + draws;
  const scored = rows.filter(row => row.phase === 'ended' && row.scoreFinal);
  const sum = scored.reduce((value, row) => value + row.score, 0);
  return { battles: rows.length, active: rows.filter(row => row.phase !== 'ended').length,
    ended: rows.filter(row => row.phase === 'ended').length, pending: rows.length - decided,
    wins, losses, draws, decided, winRate: decided ? wins / decided : null,
    totalScore: scored.length && Number.isSafeInteger(sum) ? sum : null,
    scoreBattles: scored.length, unknownScoreBattles: rows.length - scored.length };
}
function cleanRecord(input) {
  if (!input || typeof input !== 'object') return null;
  const battleKey = identity(input.battleKey), anchorId = identity(input.anchorId);
  if (!battleKey || !anchorId) return null;
  const observed = score(input.score), endedAt = time(input.endedAt);
  const scoreFinal = input.scoreFinal === true && observed !== null;
  const phase = input.phase === 'ended' ? 'ended' : 'active';
  const outcome = scoreFinal && phase === 'ended' && ['win', 'loss', 'draw'].includes(input.outcome) ? input.outcome : null;
  const startedAt = time(input.startedAt);
  return { battleKey, anchorId, name: typeof input.name === 'string' ? input.name.slice(0, 80) : '',
    roomId: identity(input.roomId), provisional: input.provisional === true,
    opponents: Array.isArray(input.opponents) ? input.opponents.flatMap(item => {
      const id = identity(item?.anchorId);
      return id && id !== anchorId ? [{anchorId:id,name:typeof item.name === 'string' ? item.name.slice(0,80) : ''}] : [];
    }) : [], startedAt, endedAt, phase, score: observed, scoreFinal,
    scoreAt: time(input.scoreAt), updatedAt: time(input.updatedAt), outcome,
    date: dateAt(phase === 'ended' ? endedAt : startedAt),
    status: outcome ? 'final' : phase === 'ended' ? 'pending' : 'active' };
}

export class AnchorStats {
  constructor({now = Date.now} = {}) {
    this.now = now; this.revision = 0; this.records = new Map(); this.exhibition = new Map(); this.exhibitionChunks = new Map();
    this.rank = new Map(); this.unknownRanks = []; this.seenRankEvents = new Set();
    this.retention = new Map();
    this.likes = new RoomLikes();
    this.fanclub = new AnchorFanclub();
  }
  ingest(event, context = {}) {
    if (!event || typeof event !== 'object') return false;
    if (['anchor-fanclub','fansclub-statistics','fansclub','fansclub-push'].includes(event.type)) {
      const changed=this.fanclub.ingest(event,context);
      if (changed) this.revision++;
      return changed;
    }
    if (event.type==='room-likes' || event.type==='like') {
      const changed=this.likes.ingest(event,context);
      if (changed) this.revision++;
      return changed;
    }
    if (event.type === 'anchor-exhibition-retention' || event.type === 'room-indicator' && event.exhibitionRetention) return this.ingestRetention(event,context);
    if (event.type === 'anchor-exhibition') return this.ingestExhibition(event, context);
    if (event.type === 'pk-rank-season') return this.ingestRank(event, context);
    return false;
  }
  ingestExhibition(event, context) {
    const anchorId = identity(event.anchorId) || identity(context.anchorId);
    const snapshotId = text(event.snapshotId || event.id);
    const section = text(event.section) || 'items', chunk = count(event.chunk) ?? 0;
    if (!anchorId || !snapshotId || chunk > 1000 || !Array.isArray(event.items)) return false;
    const dedupe = JSON.stringify([anchorId, snapshotId, section, chunk]);
    if (this.exhibitionChunks.has(dedupe)) return false;
    this.exhibitionChunks.set(dedupe, true);
    while (this.exhibitionChunks.size > 1000) this.exhibitionChunks.delete(this.exhibitionChunks.keys().next().value);
    const at = time(event.receivedAt) || time(event.at) || time(this.now()) || null;
    const current = this.exhibition.get(anchorId);
    if (current?.snapshotId && current.snapshotId !== snapshotId && at !== null && current.updatedAt !== null && at <= current.updatedAt && snapshotOlder(snapshotId, current.snapshotId)) return false;
    const snapshotKey = JSON.stringify([anchorId, snapshotId]);
    let aggregate = this.exhibition.get(snapshotKey);
    if (!aggregate || (at && aggregate.updatedAt && at > aggregate.updatedAt)) {
      aggregate = aggregate || {anchorId, snapshotId, updatedAt:at, sections:{}, items:new Map(), summary:{}};
      aggregate.updatedAt = Math.max(aggregate.updatedAt || 0, at || 0) || aggregate.updatedAt;
    }
    const sectionState = aggregate.sections[section] || {totalItems:0,received:0,chunks:0,truncated:false};
    sectionState.totalItems = Math.max(sectionState.totalItems, count(event.totalItems) ?? 0);
    sectionState.received += event.items.length; sectionState.chunks = Math.max(sectionState.chunks, count(event.chunks) ?? 0);
    sectionState.truncated ||= event.truncated === true; aggregate.sections[section] = sectionState;
    for (const raw of event.items.slice(0, 10)) {
      const giftId = identity(raw?.giftId); if (!giftId) continue;
      const item = {giftId,name:text(raw.name),diamonds:count(raw.diamonds),lighted:typeof raw.lighted === 'boolean' ? raw.lighted : null,
        received:count(raw.received),threshold:count(raw.threshold),totalReceived:count(raw.totalReceived),
        task:raw.task && typeof raw.task === 'object' ? {groupId:identity(raw.task.groupId),taskId:identity(raw.task.taskId),current:count(raw.task.current),target:count(raw.task.target),rewardStars:count(raw.task.rewardStars),finished:typeof raw.task.finished === 'boolean' ? raw.task.finished : null} : null,
        namingUser:raw.namingUser && typeof raw.namingUser === 'object' ? {id:identity(raw.namingUser.id),name:text(raw.namingUser.name)} : null, section};
      aggregate.items.set(giftId, mergeExhibitionItem(aggregate.items.get(giftId), item));
    }
    if (event.summary && typeof event.summary === 'object') {
      const summary = event.summary;
      aggregate.summary = {...aggregate.summary,
        ...(count(summary.keepTarget) !== null ? {keepTarget:count(summary.keepTarget)} : {}),
        ...(count(summary.gapToNextLevel) !== null ? {gapToNextLevel:count(summary.gapToNextLevel)} : {}),
        ...(count(summary.exhibitionType) !== null ? {exhibitionType:count(summary.exhibitionType)} : {}),
        ...(text(summary.name) ? {name:text(summary.name)} : {}), ...(text(summary.title) ? {title:text(summary.title)} : {}),
        ...(count(summary.level) !== null ? {level:count(summary.level)} : {}), ...(count(summary.gradeLevel) !== null ? {floor:count(summary.gradeLevel)} : {}),
        ...(summary.stars && typeof summary.stars === 'object' ? {stars:{current:count(summary.stars.current),target:count(summary.stars.target),completedStage:count(summary.stars.completedStage)}} : {})};
    }
    aggregate.lightedCount = [...aggregate.items.values()].filter(item => item.lighted === true).length;
    // The endpoint exposes overlapping lists (for example all_normal_items and
    // lighted_items). Count unique gift IDs so the UI does not inflate totals.
    aggregate.totalCount = aggregate.items.size;
    aggregate.tasks = [...aggregate.items.values()].filter(item => item.task).map(item => ({...item.task,giftId:item.giftId,name:item.name})).slice(0, 500);
    if (!current || !current.snapshotId || !current.updatedAt || (aggregate.updatedAt || 0) >= (current.updatedAt || 0)) this.exhibition.set(anchorId, aggregate);
    this.exhibition.set(snapshotKey, aggregate);
    // Bound retained in-flight snapshots; active per-anchor snapshots stay intact.
    const snapshots = [...this.exhibition.entries()].filter(([key]) => key.startsWith('['));
    for (const [key] of snapshots.slice(0, Math.max(0, snapshots.length - 12))) this.exhibition.delete(key);
    // Keep only the active snapshot per anchor plus a bounded set of in-flight snapshots.
    for (const [key, value] of this.exhibition) if (key.includes('"') && value.anchorId === anchorId && key !== snapshotKey && (value.updatedAt || 0) < (aggregate.updatedAt || 0) - 86400000) this.exhibition.delete(key);
    this.revision++;
    return true;
  }
  ingestRank(event, context) {
    const anchorId = identity(event.anchorId) || identity(context.anchorId), id = text(event.id);
    const dedupe = JSON.stringify([anchorId || '', id, event.roomId || '', event.at || event.receivedAt || '']);
    if (this.seenRankEvents.has(dedupe)) return false;
    this.seenRankEvents.add(dedupe); while (this.seenRankEvents.size > 500) this.seenRankEvents.delete(this.seenRankEvents.values().next().value);
    const observedAt = time(event.receivedAt) || time(event.at) || time(this.now()), value = {anchorId:anchorId || null,roomId:identity(event.roomId),observedAt,
      beforeRank:event.beforeRank && typeof event.beforeRank === 'object' ? copyAnchorStats(event.beforeRank) : null,
      afterRank:event.afterRank && typeof event.afterRank === 'object' ? copyAnchorStats(event.afterRank) : null,
      changeType:count(event.changeType),deltaScore:text(event.deltaScore),deltaDetails:Array.isArray(event.deltaDetails) ? event.deltaDetails.slice(0,50).map(row => ({name:text(row.name),score:text(row.score)})) : [],tips:text(event.tips)};
    if (anchorId) {
      const previous = this.rank.get(anchorId);
      if (previous && (previous.observedAt || 0) > (observedAt || 0)) return false;
      this.rank.set(anchorId, value);
    }
    else { this.unknownRanks.push(value); this.unknownRanks = this.unknownRanks.slice(-100); }
    this.revision++;
    return true;
  }
  ingestRetention(event, context = {}) {
    const anchorId = identity(event.anchorId) || identity(context.anchorId), value = event.exhibitionRetention || event;
    const remaining = count(value.remaining), observedAt = time(event.receivedAt) || time(event.at);
    if (!anchorId || remaining === null || remaining > 10000 || !observedAt) return false;
    const source = event.type === 'room-indicator' ? 'protocol' : event.source;
    if (!['protocol','web-exhibition','native-indicator'].includes(source)) return false;
    const old = this.retention.get(anchorId), priority = s => s === 'native-indicator' ? 0 : 1;
    if (old && (old.observedAt > observedAt || observedAt-old.observedAt < 120000 && priority(old.source) > priority(source))) return false;
    this.retention.set(anchorId,{anchorId,roomId:identity(event.roomId),name:text(value.name),remaining,text:text(value.text),source,observedAt});
    this.revision++;
    return true;
  }
  retentionFor(anchorId) {
    const value = this.retention.get(anchorId);
    return value ? {...value,stale:this.now()-value.observedAt > 120000} : null;
  }
  exhibitionFor(anchorId) {
    const value = this.exhibition.get(anchorId); if (!value) return null;
    const items = value.items instanceof Map ? [...value.items.values()] : Array.isArray(value.items) ? value.items : [];
    return {anchorId:value.anchorId,snapshotId:value.snapshotId,updatedAt:value.updatedAt || null,name:value.summary.name || '',title:value.summary.title || '',
      level:value.summary.level ?? null,floor:value.summary.floor ?? null,stars:value.summary.stars || null,lightedCount:value.lightedCount || 0,totalCount:value.totalCount || 0,
      keepTarget:value.summary.keepTarget ?? null,gapToNextLevel:value.summary.gapToNextLevel ?? null,exhibitionType:value.summary.exhibitionType ?? null,
      sections:copyAnchorStats(value.sections),tasks:copyAnchorStats(value.tasks || []),items:copyAnchorStats(items.slice(0,2000)),truncated:items.length > 2000 || Object.values(value.sections || {}).some(row => row.truncated),partial:Object.values(value.sections || {}).some(row => row.received < row.totalItems)};
  }
  ingestBattle(state) {
    const battleKey = identity(state?.key);
    if (!battleKey || !['active', 'ended'].includes(state.phase)) return false;
    // Compare only rows from this battle. Historical records must not be
    // serialized on every score update.
    const changedKeys = new Set();
    const previousRows = new Map();
    const remember = key => { if (!previousRows.has(key)) previousRows.set(key, JSON.stringify(this.records.get(key) || null)); changedKeys.add(key); };
    const previousRevision = this.revision;
    const participants = new Map();
    const add = (id, name, value, observed, meta, at) => {
      id = identity(id); if (!id) return;
      const old = participants.get(id);
      const valid = score(value), final = valid !== null && meta?.final === true;
      const candidate = {anchorId:id,name:typeof name === 'string' ? name.slice(0,80) : '',
        score:valid !== null && (observed === true || final) ? valid : null,scoreFinal:final,scoreAt:time(at)};
      if (!old || (!old.scoreFinal && final) || (old.scoreFinal === final && (candidate.scoreAt || 0) >= (old.scoreAt || 0))) participants.set(id, {...candidate,name:candidate.name || old?.name || ''});
    };
    const competitors = Array.isArray(state.competitors) ? state.competitors
      : Object.entries(state.competitors || {}).map(([id, row]) => ({...row,anchorId:row?.anchorId || id}));
    const roomId = identity(state.roomId);
    // PK participant grades are explicitly keyed by anchor UID. Preserve them
    // as rank observations without inferring ownership from room or nickname.
    for (const competitor of competitors) {
      const anchorId = identity(competitor?.anchorId);
      if (!anchorId || (!competitor.grade && !competitor.gradeChange && !competitor.pkStageDescription)) continue;
      const rankId = `pk-grade:${battleKey}:${anchorId}:${JSON.stringify([competitor.grade || null, competitor.gradeChange || null, competitor.pkStageDescription || ''])}`;
      this.ingestRank({type:'pk-rank-season', id:rankId, anchorId, roomId, receivedAt:pointAt(state),
        beforeRank:competitor.gradeChange ? {detail:competitor.gradeChange.beforeGrade, level:competitor.gradeChange.beforeLevel, score:competitor.gradeChange.score} : null,
        afterRank:competitor.grade ? {...competitor.grade, detail:competitor.grade.name || competitor.pkStageDescription || undefined} : competitor.pkStageDescription ? {detail:competitor.pkStageDescription} : null,
        changeType:null, deltaScore:competitor.gradeChange?.score || '', deltaDetails:[], tips:''}, {anchorId, roomId});
    }
    for (const row of competitors) add(row.anchorId, row.name, row.score, row.scoreObserved, row.scoreMeta, row.scoreAt);
    add(state.anchorId, state.anchorName, state.selfScore, state.selfScoreObserved, state.selfScoreMeta, state.selfScoreAt);
    add(state.opponentId, state.opponentName, state.opponentScore, state.opponentScoreObserved, state.opponentScoreMeta, state.opponentScoreAt);
    if (!participants.size) return false;
    const startedAt = time(state.startedAt), updatedAt = pointAt(state);
    // PKTracker 会把同房间临时 key 升级为服务端 battle_id。仅在房间、开局时间和 UID 都吻合时迁移。
    if (state.provisional === false && roomId && startedAt) {
      for (const [key, row] of this.records) {
        if (row.provisional && row.roomId === roomId && row.startedAt === startedAt && participants.has(row.anchorId) && row.battleKey !== battleKey) {
          const target = recordKey(battleKey, row.anchorId);
          remember(key); remember(target);
          if (!this.records.has(target)) this.records.set(target, {...row,battleKey,provisional:false});
          this.records.delete(key);
        }
      }
    }
    for (const item of participants.values()) {
      const key = recordKey(battleKey, item.anchorId), old = this.records.get(key);
      remember(key);
      const fresh = !old || (updatedAt || 0) >= (old.updatedAt || 0);
      const phase = old?.phase === 'ended' || state.phase === 'ended' ? 'ended' : 'active';
      const endedAt = old?.endedAt || (state.phase === 'ended' ? time(state.endedAt) : null);
      const acceptScore = !old?.scoreFinal && item.score !== null && (!old || item.scoreFinal || (item.scoreAt || updatedAt || 0) >= (old.scoreAt || old.updatedAt || 0));
      const row = cleanRecord({battleKey,anchorId:item.anchorId,name:fresh && item.name ? item.name : old?.name || item.name,
        roomId:old?.roomId || roomId,provisional:old?.provisional === false ? false : state.provisional === true,
        opponents:[...participants.values()].filter(other => other.anchorId !== item.anchorId).map(other => ({anchorId:other.anchorId,name:other.name})),
        startedAt:old?.startedAt || startedAt,endedAt,phase,
        score:acceptScore ? item.score : old?.score ?? null,scoreFinal:old?.scoreFinal || (acceptScore && item.scoreFinal),
        scoreAt:acceptScore ? item.scoreAt : old?.scoreAt,updatedAt:Math.max(old?.updatedAt || 0,updatedAt || 0) || null,
        outcome:old?.outcome});
      if (old?.opponents?.length) {
        const known = new Map(old.opponents.map(other => [other.anchorId, other]));
        for (const other of row.opponents) known.set(other.anchorId, {anchorId:other.anchorId,name:other.name || known.get(other.anchorId)?.name || ''});
        row.opponents = [...known.values()];
      }
      this.records.set(key, row);
    }
    const rows = [...this.records.values()].filter(row => row.battleKey === battleKey);
    for (const row of rows) remember(recordKey(battleKey, row.anchorId));
    // 必须所有已知参战 UID 都有终局比分；赛中预测与单独 pk-end 不构成比分证据。
    for (const row of rows) {
      if (!row.outcome && row.phase === 'ended' && row.opponents.every(other => rows.some(candidate => candidate.anchorId === other.anchorId))) row.outcome = outcomeOf(row, rows);
      row.status = row.outcome ? 'final' : row.phase === 'ended' ? 'pending' : 'active';
    }
    const changed = [...changedKeys].some(key => previousRows.get(key) !== JSON.stringify(this.records.get(key) || null));
    if (changed) this.revision++;
    return changed || previousRevision !== this.revision;
  }
  snapshot() { return {version:1,fanclub:this.fanclub.snapshot(),likes:this.likes.snapshot(),records:copyAnchorStats([...this.records.values()]),exhibition:copyAnchorStats([...this.exhibition.entries()].filter(([key]) => !key.includes('"')).map(([key]) => [key,this.exhibitionFor(key)])),rank:copyAnchorStats([...this.rank.entries()]),retention:copyAnchorStats([...this.retention.entries()]),unknownRanks:copyAnchorStats(this.unknownRanks)}; }
  restore(saved) {
    if (saved?.version !== 1 || !Array.isArray(saved.records)) return false;
    const records = new Map();
    for (const input of saved.records) {
      const row = cleanRecord(input); if (!row) continue;
      const key = recordKey(row.battleKey, row.anchorId), old = records.get(key);
      if (!old || (!old.scoreFinal && row.scoreFinal) || (!old.scoreFinal && (row.updatedAt || 0) >= (old.updatedAt || 0))) records.set(key, row);
    }
    this.records = records;
    this.likes.restore(saved.likes);
    this.fanclub.restore(saved.fanclub);
    this.exhibition.clear(); this.exhibitionChunks.clear(); this.rank.clear(); this.retention.clear(); this.unknownRanks = [];
    for (const item of saved.exhibition || []) if (Array.isArray(item) && identity(item[0]) && item[1]) {
      const savedValue = item[1], value = {...savedValue, summary:{name:savedValue.name || '',title:savedValue.title || '',level:savedValue.level ?? null,floor:savedValue.floor ?? null,stars:savedValue.stars || null,keepTarget:savedValue.keepTarget ?? null,gapToNextLevel:savedValue.gapToNextLevel ?? null,exhibitionType:savedValue.exhibitionType ?? null},
        sections:savedValue.sections || {}, items:new Map((savedValue.items || []).slice(0,2000).map(row => [row.giftId,row]))};
      this.exhibition.set(item[0], value);
      if (value.snapshotId) this.exhibition.set(JSON.stringify([item[0],value.snapshotId]), value);
    }
    for (const item of saved.rank || []) if (Array.isArray(item) && identity(item[0]) && item[1]) this.rank.set(item[0], item[1]);
    for (const item of saved.retention || []) if (Array.isArray(item) && identity(item[0]) && item[1]) this.ingestRetention({...item[1],type:'anchor-exhibition-retention',anchorId:item[0],receivedAt:item[1].observedAt});
    this.unknownRanks = Array.isArray(saved.unknownRanks) ? saved.unknownRanks.slice(-100) : [];
    this.revision++;
    return true;
  }
  anchors() {
    const anchors = new Map();
    for (const row of this.records.values()) {
      const old = anchors.get(row.anchorId) || {anchorId:row.anchorId,name:'',lastAt:null,battles:0};
      if (row.name && (!old.name || (row.updatedAt || 0) >= (old.lastAt || 0))) old.name = row.name;
      old.lastAt = Math.max(old.lastAt || 0,row.updatedAt || 0) || null; old.battles++;
      anchors.set(row.anchorId,old);
    }
    for (const row of this.likes.snapshot()) if (!anchors.has(row.anchorId)) anchors.set(row.anchorId,{anchorId:row.anchorId,name:'',lastAt:row.observedAt,battles:0});
    for (const row of this.fanclub.snapshot()) if (!anchors.has(row.anchorId)) anchors.set(row.anchorId,{anchorId:row.anchorId,name:'',lastAt:row.observedAt,battles:0});
    // An exhibition or rank can arrive before the first PK.
    for (const [anchorId, rank] of this.rank) if (!anchors.has(anchorId)) anchors.set(anchorId, {anchorId,name:'',lastAt:rank.observedAt,battles:0});
    for (const [anchorId, retention] of this.retention) if (!anchors.has(anchorId)) anchors.set(anchorId,{anchorId,name:'',lastAt:retention.observedAt,battles:0});
    for (const [anchorId, exhibition] of this.exhibition) {
      if (anchorId !== exhibition.anchorId) continue;
      const old = anchors.get(anchorId) || {anchorId,name:'',lastAt:null,battles:0};
      old.name ||= exhibition.summary?.name || ''; old.lastAt = Math.max(old.lastAt || 0,exhibition.updatedAt || 0) || null;
      anchors.set(anchorId,old);
    }
    return [...anchors.values()].sort((a,b)=>(b.lastAt || 0)-(a.lastAt || 0) || a.anchorId.localeCompare(b.anchorId));
  }
  report(anchorId, {now = this.now(), days = 7} = {}) {
    anchorId = identity(anchorId);
    const today = dateAt(now), month = today?.slice(0,7) || null;
    const rows = [...this.records.values()].filter(row => row.anchorId === anchorId).sort((a,b)=>(b.endedAt || b.startedAt || 0)-(a.endedAt || a.startedAt || 0) || a.battleKey.localeCompare(b.battleKey));
    const dayCount = Number.isFinite(days) ? Math.min(366,Math.max(1,Math.floor(days))) : 7;
    const midnight = time(now) === null ? null : Math.floor((now + OFFSET) / DAY) * DAY - OFFSET;
    const buckets = new Map();
    for (const row of rows) { if (!buckets.has(row.date)) buckets.set(row.date, []); buckets.get(row.date).push(row); }
    const trend = midnight === null ? [] : Array.from({length:dayCount},(_,index) => {
      const date = dateAt(midnight - (dayCount - index - 1) * DAY);
      return {date,...summarizeAnchorBattles(buckets.get(date) || [])};
    });
    const name = this.anchors().find(anchor => anchor.anchorId === anchorId)?.name || '';
    return {anchorId,name,timeZone:'Asia/Shanghai',fanclub:this.fanclub.forAnchor(anchorId),likes:this.likes.forAnchor(anchorId),exhibition:this.exhibitionFor(anchorId),exhibitionRetention:this.retentionFor(anchorId),rank:this.rank.get(anchorId) ? {...copyAnchorStats(this.rank.get(anchorId)),exhibitionRetention:this.retentionFor(anchorId)} : null,
      rankUnknown:copyAnchorStats(this.unknownRanks.slice(-20)),today:{date:today,...summarizeAnchorBattles(rows.filter(row => row.date && row.date === today))},
      month:{month,...summarizeAnchorBattles(rows.filter(row => row.date && row.date.startsWith(month || '!')))},total:summarizeAnchorBattles(rows),trend,battles:copyAnchorStats(rows),
      basis:'仅统计本机已观测场次；按北京时间结束日归属，未结束按开始日。胜率=胜场/(胜+负+平)，平局计入分母、不计胜场；多人场最高分并列者记平局，其余记负。仅明确终局比分计入 PK 总分及胜负，未知保留待确认。'};
  }
}
