// 字段编号参考 TikTokLiveJava webcast.proto 与 opedium/douyin-live-proto；atUser 为字段 12。
// 独立实现 protobuf wire reader；不加载第三方脚本，不使用 Number 保存 64 位 UID。
const decoder = new TextDecoder('utf-8', { fatal: false });
const MAX_BYTES = 8 * 1024 * 1024;
export function wire(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_BYTES) throw new Error('消息体超过 8 MB');
  const fields = new Map(); let pos = 0, count = 0;
  function varint() {
    let value = 0n;
    for (let shift = 0; shift < 70; shift += 7) {
      if (pos >= bytes.length) throw new Error('protobuf varint 不完整');
      const b = bytes[pos++];
      if (shift === 63 && b > 1) throw new Error('protobuf varint 溢出');
      value |= BigInt(b & 127) << BigInt(shift);
      if (!(b & 128)) return value;
    }
    throw new Error('protobuf varint 过长');
  }
  while (pos < bytes.length) {
    if (++count > 100000) throw new Error('protobuf 字段数量过多');
    const tag = Number(varint()), number = Math.floor(tag / 8), type = tag & 7;
    if (!number) throw new Error('protobuf 字段编号为零');
    let value;
    if (type === 0) value = varint();
    else if (type === 2) {
      const length = Number(varint()); if (!Number.isSafeInteger(length) || pos + length > bytes.length) throw new Error('protobuf 消息长度无效');
      value = bytes.subarray(pos, pos + length); pos += length;
    } else if (type === 1 || type === 5) {
      const length = type === 1 ? 8 : 4; if (pos + length > bytes.length) throw new Error('protobuf 定长字段不完整');
      value = bytes.subarray(pos, pos + length); pos += length;
    } else throw new Error(`不支持 protobuf wire type ${type}`);
    if (!fields.has(number)) fields.set(number, []);
    fields.get(number).push(value);
  }
  return fields;
}
const bytesAt = (m, n) => { const v = m.get(n)?.[0]; return v instanceof Uint8Array ? v : null; };
const textAt = (m, n) => { const v = bytesAt(m, n); return v ? decoder.decode(v) : ''; };
const intAt = (m, n) => { const v = m.get(n)?.[0]; return typeof v === 'bigint' ? v : null; };
const numberAt = (m, n) => { const v = intAt(m, n); return v === null || v > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(v); };
const idAt = (m, n) => intAt(m, n)?.toString() || '';
const nested = (m, n) => wire(bytesAt(m, n) || new Uint8Array());
function decodeClub(bytes) {
  const m = wire(bytes);
  return { name: textAt(m, 1), level: numberAt(m, 2), status: numberAt(m, 3), anchorId: idAt(m, 6) };
}
export function decodeUser(bytes) {
  const m = wire(bytes || new Uint8Array()), clubs = nested(m, 24), fanClubs = [];
  if (bytesAt(clubs, 1)) fanClubs.push(decodeClub(bytesAt(clubs, 1)));
  for (const entry of clubs.get(2) || []) {
    if (!(entry instanceof Uint8Array)) continue;
    const value = bytesAt(wire(entry), 2); if (value) fanClubs.push(decodeClub(value));
  }
  return { id: textAt(m, 1028) || idAt(m, 1), secUid: textAt(m, 46), displayId: textAt(m, 38), name: textAt(m, 3), wealthLevel: numberAt(nested(m, 23), 6), fanClubs };
}
export function decodeMessage(method, bytes, outerId = '') {
  if (!['WebcastChatMessage', 'WebcastGiftMessage', 'WebcastLikeMessage', 'WebcastMemberMessage', 'WebcastControlMessage'].includes(method)) return null;
  const m = wire(bytes), common = nested(m, 1);
  const event = { id: outerId || idAt(common, 2), roomId: idAt(common, 3), at: (numberAt(common, 4) || 0) * 1000, source: 'socket' };
  if (method === 'WebcastChatMessage') {
    const atUser = bytesAt(m, 12) ? decodeUser(bytesAt(m, 12)) : null;
    return { ...event, type: 'chat', user: decodeUser(bytesAt(m, 2)), text: textAt(m, 3), atUser, mentions: atUser?.id ? [atUser.id] : [] };
  }
  if (method === 'WebcastMemberMessage') {
    const action = numberAt(m, 10);
    if (action !== null && action !== 0 && action !== 1) return null;
    return { ...event, type: 'enter', user: decodeUser(bytesAt(m, 2)), action };
  }
  if (method === 'WebcastControlMessage') return numberAt(m, 2) === 3 ? { ...event, type: 'end' } : null;
  if (method === 'WebcastLikeMessage') return { ...event, type: 'like', user: decodeUser(bytesAt(m, 5)), count: numberAt(m, 2) || 1, total: numberAt(m, 3) };
  const gift = nested(m, 15), count = numberAt(m, 5) || numberAt(m, 6) || numberAt(m, 4) || numberAt(m, 44) || 1;
  // GiftStruct.type 是字段 11，字段 10 是 combo 标记。显式的零分组不是连击 ID。
  const giftType = numberAt(gift, 11), combo = giftType === 1 || (giftType === null && numberAt(gift, 10) === 1);
  const rawGroup = idAt(m, 11), groupId = rawGroup === '0' ? '' : rawGroup;
  return {
    ...event, type: 'gift', user: decodeUser(bytesAt(m, 7)), giftId: idAt(m, 2) || idAt(gift, 5),
    giftName: textAt(gift, 16) || textAt(gift, 2) || '礼物', unitValue: numberAt(gift, 12),
    count, groupId: groupId || (!combo && event.id ? `single:${event.id}` : ''), final: numberAt(m, 9) === 1 || (giftType !== null && !combo)
  };
}
async function inflate(bytes, encoding) {
  const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!gzip && !['gzip', 'deflate'].includes(encoding)) return bytes;
  if (typeof DecompressionStream === 'undefined') throw new Error('浏览器不支持解压，请使用新版 Chrome / Edge');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(gzip ? 'gzip' : encoding)).getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > MAX_BYTES) throw new Error('解压后的消息超过 8 MB'); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const result = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
  return result;
}
export async function decodeFrame(data, onError = () => {}) {
  let bytes;
  if (typeof data === 'string') return []; // 不解析其他业务 socket 的 JSON。
  if (data && typeof data.arrayBuffer === 'function') bytes = new Uint8Array(await data.arrayBuffer());
  else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  else bytes = new Uint8Array(data);
  const frame = wire(bytes), payload = bytesAt(frame, 8);
  if (!payload || (textAt(frame, 7) && textAt(frame, 7) !== 'msg')) return [];
  const headers = new Map((frame.get(5) || []).filter(v => v instanceof Uint8Array).map(v => { const h = wire(v); return [textAt(h, 1), textAt(h, 2)]; }));
  const encoding = textAt(frame, 6) || headers.get('compress_type') || '';
  const response = wire(await inflate(payload, encoding)), events = [];
  for (const message of response.get(1) || []) {
    if (!(message instanceof Uint8Array)) continue;
    // 单条消息的字段变化/损坏不能吞掉同一帧中的其他礼物。
    try {
      const m = wire(message), body = bytesAt(m, 2); if (!body) continue;
      const e = decodeMessage(textAt(m, 1), body, idAt(m, 3)); if (e) events.push(e);
    } catch (error) { onError(error); }
  }
  return events;
}
