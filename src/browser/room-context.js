// URL room key (web_rid or query room_id) is distinct from a broadcast roomId.
export function roomFromURL(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : value.href);
    return url.pathname.match(/^\/(\d+)\/?$/)?.[1] || url.searchParams.get('room_id')?.match(/^\d+$/)?.[0] || null;
  } catch { return null; }
}
export function roomMatchesStore(info, location) {
  const key = roomFromURL(location);
  if (!key) return false;
  const webRid = String(info?.room?.web_rid || info?.web_rid || info?.webRid || '');
  return key === webRid || !/^\/\d+\/?$/.test(location.pathname) && key === String(info?.roomId || info?.room?.id_str || '');
}
export class RoomContext {
  constructor(page) { this.page = page; this.room = roomFromURL(page.location); this.origin = page.location.origin; }
  current() { return this.page.location.origin === this.origin && roomFromURL(this.page.location) === this.room; }
}
