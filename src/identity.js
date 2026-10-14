// 只读取本房间与当前登录账号，不把排行榜/弹幕中的用户猜成主播或自己。
const numericId = value => typeof value === 'string' && /^\d+$/.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : '';
export function parseIdentityJSON(text) {
  if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) throw new Error('身份资料过大或无效');
  // 页面 API 常以数字返回 64 位 ID；在 JSON.parse 前保留原始十进制值。
  return JSON.parse(text.replace(/"(?:\\.|[^"\\])*"|(:\s*)(\d{16,})(?=\s*[,}])/g, (match,prefix,id) => prefix ? `${prefix}"${id}"` : match));
}
export function identityUser(value) {
  if (!value || typeof value !== 'object') return null;
  const id = numericId(value.id_str) || numericId(value.id) || numericId(value.uid);
  if (!id || id === '0') return null;
  return { id, name: String(value.nickname || value.nick_name || value.name || '').slice(0, 60) };
}
function roomAdmins(info, expectedRoom) {
  const roomId = String(info?.web_rid || info?.webRid || '');
  if (!roomId || roomId !== expectedRoom) return null;
  const values = info?.admin_user_ids ?? info?.adminUserIds;
  if (!Array.isArray(values)) return null;
  const ids = values.map(numericId);
  return ids.every(Boolean) ? ids : null;
}
export function roomAdminStatus(self, adminUserIds) {
  return self?.id && Array.isArray(adminUserIds) ? adminUserIds.includes(self.id) : null;
}
export function identityFromResponse(kind, data, room) {
  if (!data || (data.status_code !== undefined && data.status_code !== 0)) return {};
  if (kind === 'self') {
    const user = identityUser(data.data?.user || data.data);
    return user ? { self: user } : {};
  }
  const info = Array.isArray(data.data?.data) ? data.data.data[0] : data.data?.room || data.room;
  const anchor = identityUser(info?.owner || info?.anchor || data.data?.user);
  const rid = String(info?.web_rid || info?.webRid || '');
  if (rid && rid !== room) return {};
  return anchor ? { anchor, title: String(info?.title || '').slice(0, 120), adminUserIds: roomAdmins(info, room) } : {};
}
export class IdentityReader {
  constructor({ page, room, onIdentity = () => {} }) { this.page = page; this.room = room; this.onIdentity = onIdentity; this.value = {}; this.busy = null; this.controllers = new Set(); this.closed = false; }
  publish(next) {
    if (this.closed) return;
    this.value = { ...this.value, ...next }; this.onIdentity({ ...this.value });
  }
  readInitial() {
    for (const name of ['SSR_RENDER_DATA', 'SSR_RENDER_DATA_DOC']) {
      const data = this.page[name];
      if (!data || typeof data !== 'object') continue;
      // 只支持明确的房间/账号资料槽位，不枚举全局变量或 React 内部对象。
      const info = data.roomStore?.roomInfo || data.roomInfo || data.room;
      const rid = String(info?.web_rid || info?.webRid || '');
      if (info && (!rid || rid === this.room)) {
        const anchor = identityUser(info.anchor || info.owner); if (anchor) this.publish({ anchor, adminUserIds: roomAdmins(info, this.room) });
      }
      const self = identityUser(data.userStore?.userInfo || data.currentUser);
      if (self) this.publish({ self });
    }
  }
  async refresh() {
    if (this.closed) return this.value;
    if (this.busy) return this.busy;
    this.readInitial();
    this.busy = (async () => {
      const outcomes = await Promise.allSettled([
        this.read('anchor', `/webcast/room/web/enter/?aid=6383&app_name=douyin_web&device_platform=web&web_rid=${encodeURIComponent(this.room)}`),
        this.read('self', '/webcast/user/me/?aid=6383&app_name=douyin_web&device_platform=web&room_id=0')
      ]);
      const next = { warning: outcomes.some(r => r.status === 'rejected') ? '部分资料暂未识别，可点击重新识别或手动补充' : '' };
      for (const result of outcomes) if (result.status === 'fulfilled') Object.assign(next, result.value);
      // 明确未登录时清掉旧账号，不能继续误用上一登录身份。
      if (!next.self && outcomes[1].status === 'fulfilled') next.self = null;
      this.publish(next); return this.value;
    })().finally(() => { this.busy = null; });
    return this.busy;
  }
  async read(kind, path) {
    if (!this.page.fetch) throw new Error('页面未提供身份查询');
    const controller = new this.page.AbortController(); this.controllers.add(controller);
    const timer = this.page.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.page.fetch(path, { credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error('身份查询失败');
      const data = parseIdentityJSON(await response.text());
      if (data.status_code !== undefined && data.status_code !== 0) throw new Error('身份查询暂不可用');
      return identityFromResponse(kind, data, this.room);
    } finally { this.page.clearTimeout(timer); this.controllers.delete(controller); }
  }
  close() { this.closed = true; for (const controller of this.controllers) controller.abort(); this.controllers.clear(); }
}
