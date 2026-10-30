// 当前房间的直播形态独立于历史 PK 比分；连线名单不会创建 PK 战局。
const LIVE_MODE_FRESH_MS = 120000;
const LIVE_MODE_LABELS = {pk:'PK 中',linked:'连线中',solo:'未连线',ended:'已下播',unknown:'待确认'};
export const isLiveModeEvent = event => ['link-state','guest-link-state','start','end','room-state'].includes(event?.type)
  || event?.type === 'room-sync' && event.syncType === 'RoomLinkMicSyncData';

export class LiveModeTracker {
  constructor({now = Date.now} = {}) {
    this.now = now;
    this.roomId = ''; this.boundaryAt = 0; this.endedAt = 0;
    this.link = null; this.battle = null;
  }
  ingest(event = {}, {anchorId = '', pk = null} = {}) {
    const now = this.now(), supplied = Number(event.at) > 0 ? Number(event.at) : Number(event.receivedAt) || now;
    if (!Number.isFinite(supplied) || supplied > now + 60000) return;
    const at = Math.min(now, supplied), roomId = String(event.roomId || '');
    if (event.type === 'start') {
      if (at < Math.max(this.boundaryAt, this.endedAt) || this.endedAt && at === this.endedAt) return;
      if (roomId && roomId !== this.roomId || this.endedAt || Number(event.startAt) > this.boundaryAt) {
        this.link = null; this.battle = null;
      }
      this.roomId = roomId || this.roomId; this.boundaryAt = Math.max(this.boundaryAt, Number(event.startAt) || at); this.endedAt = 0;
      return;
    }
    if (roomId && this.roomId && roomId !== this.roomId) return;
    if (at < this.boundaryAt || this.endedAt && at <= this.endedAt) return;
    if (roomId) this.roomId = roomId;
    if (event.type === 'end') {
      if (at < Math.max(this.link?.at || 0, this.battle?.at || 0)) return;
      this.endedAt = at; this.link = null; this.battle = null; return;
    }
    if (['pk-start','pk-score','pk-end'].includes(event.type)) {
      if (!pk?.key || at < (this.battle?.at || 0)) return;
      if (event.type === 'pk-end') {
        if (this.battle?.active && this.battle.key !== pk.key) return;
        this.battle = {key:pk.key,at,active:false,expiresAt:at};
      } else if (pk.phase === 'active' && (!event.battleId || String(event.battleId) === pk.key)) {
        // 已知倒计时覆盖整局；归零后短暂等待终局，不把旧 PK 永久当作进行中。
        const expiresAt = Number.isFinite(pk.remainingMs) ? now + pk.remainingMs + 15000 : at + LIVE_MODE_FRESH_MS;
        this.battle = {key:pk.key,at,active:true,expiresAt};
      }
      return;
    }
    let linked = null, channelId = String(event.channelId || '');
    const rosterStatus = rows => {
      const ids = new Set((rows || []).map(row => String((row.user || row)?.id || '')).filter(Boolean));
      if (!ids.size) return rows?.length ? null : false;
      if (anchorId) return [...ids].some(id => id !== String(anchorId));
      return ids.size >= 2 ? true : null;
    };
    if (event.type === 'link-state') linked = rosterStatus(event.linkedUsers);
    if (event.type === 'room-sync' && event.syncType === 'RoomLinkMicSyncData' && event.syncDetails) linked = rosterStatus(event.syncDetails.users);
    if (event.type === 'guest-link-state') {
      if (event.channelFinished) linked = false;
      else if (event.channelJoined && channelId && channelId !== '0') linked = true;
      else if (event.channelSnapshot) {
        const count = event.channelUserCount == null ? null : Number(event.channelUserCount);
        linked = count != null && count > 1 ? true : rosterStatus([...(event.linkedUsers || []), ...(event.channelUsers || [])]);
        // 只带频道 ID 的局部更新不能证明已断开。
        if (linked === false && count == null && !event.linkedUsers?.length && !event.channelUsers?.length) linked = null;
      }
    }
    if (linked == null || at < (this.link?.at || 0)) return;
    this.link = {at,linked,channelId,source:event.protocolMethod || event.syncType || event.type};
  }
  current() {
    const now = this.now();
    let mode = 'unknown', at = 0, reason = '等待当前房间的 PK 或连线推送';
    if (this.endedAt) { mode = 'ended'; at = this.endedAt; reason = '已收到当前直播的下播事件'; }
    else if (this.battle?.active && now <= this.battle.expiresAt) {
      mode = 'pk'; at = this.battle.at; reason = '已收到当前房间的 PK 开局或实时比分';
    } else if (this.battle?.active) {
      at = this.battle.at; reason = 'PK 状态已过期，等待新推送确认';
    } else if (this.link && now - this.link.at <= LIVE_MODE_FRESH_MS) {
      mode = this.link.linked ? 'linked' : 'solo'; at = this.link.at;
      reason = this.link.linked ? '已收到当前房间的连线名单或加入频道事件' : '已收到连线结束或空连线名单';
    } else if (this.link) { at = this.link.at; reason = '连线状态已过期，等待新推送确认'; }
    return {mode,label:LIVE_MODE_LABELS[mode],at,reason};
  }
  snapshot() {
    return {version:1,roomId:this.roomId,boundaryAt:this.boundaryAt,endedAt:this.endedAt,link:this.link && {...this.link},battle:this.battle && {...this.battle}};
  }
  restore(saved) {
    if (saved?.version !== 1) return;
    this.roomId = String(saved.roomId || '');
    this.boundaryAt = Number.isFinite(saved.boundaryAt) ? saved.boundaryAt : 0;
    this.endedAt = Number.isFinite(saved.endedAt) ? saved.endedAt : 0;
    this.link = Number.isFinite(saved.link?.at) && typeof saved.link.linked === 'boolean' ? {...saved.link} : null;
    this.battle = Number.isFinite(saved.battle?.at) && Number.isFinite(saved.battle?.expiresAt) && typeof saved.battle.active === 'boolean' ? {...saved.battle} : null;
  }
}
