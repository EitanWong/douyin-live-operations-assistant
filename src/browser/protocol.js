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
    const tag = varint(), numberBig = tag >> 3n;
    if (numberBig < 1n) throw new Error('protobuf 字段编号为零');
    if (numberBig > 0x1fffffffn) throw new Error('protobuf 字段编号超出范围');
    const number = Number(numberBig), type = Number(tag & 7n);
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
const messagesAt = (m, n) => (m.get(n) || []).filter(value => value instanceof Uint8Array).map(value => wire(value));
// 字段核对自抖音网页 live-schema-im.e322bd8a.js（详见 docs/research/pk-protocol.zh-CN.md）。
// LinkMicMethod.UserScores 才是累计 PK 分数；Armies 是贡献榜，PlayModeUpdateScore 是单次热度更新。
function battleScores(m, field, finish = false) {
  return messagesAt(m, field).flatMap(score => {
    const anchorId = textAt(score, finish ? 8 : 21) || idAt(score, 2);
    const displays = (finish ? [12, 15] : [4, 7]).map(field => textAt(score, field)).filter(Boolean);
    // 显式 score 是总分；relative/blur 文本和标记也会伴随精确总分出现。
    // 部分更新仅发数字文本；只接受纯数字，不能把“100万+”或“领先…”当作精确分数。
    const numericText = displays.find(value => /^\d+$/.test(value));
    const value = score.has(1) ? numberAt(score, 1)
      : numericText ? Number(numericText) : displays.length || (finish && numberAt(score, 11) === 1) ? null : 0;
    return anchorId && anchorId !== '0' && Number.isSafeInteger(value) && value >= 0 ? [{ anchorId, score: value,
      ...(score.has(finish ? 24 : 17) ? { scoreVersion: idAt(score, finish ? 24 : 17) } : {}),
      ...(score.has(finish ? 23 : 16) ? { contributorCount: numberAt(score, finish ? 23 : 16) } : {}),
      ...(!finish && score.has(15) ? { buffScoreRatio: numberAt(score, 15) } : {})
    }] : [];
  });
}
function battleParticipants(m, field) {
  return messagesAt(m, field).flatMap(entry => {
    const info = nested(entry, 2), user = nested(info, 1);
    const anchorId = textAt(user, 5) || idAt(user, 1) || idAt(entry, 1);
    return anchorId ? [{ anchorId, name: textAt(user, 2), roomId: textAt(info, 13) }] : [];
  });
}
function battleSettings(m, field = 2, dataSettings = false) {
  // webcast.data.BattleSettings 和 webcast.im.BattleSettings 的起始字段不同。
  const settings = nested(m, field), startedAt = numberAt(settings, dataSettings ? 2 : 3), duration = numberAt(settings, dataSettings ? 3 : 4);
  const battleId = textAt(settings, 42) || idAt(settings, dataSettings ? 1 : 2);
  return {
    battleId: battleId === '0' ? '' : battleId,
    ...(startedAt > 0 ? { startedAt } : {}),
    ...(duration > 0 && duration <= 7200 ? { durationMs: duration * 1000, ...(startedAt > 0 ? { endsAt: startedAt + duration * 1000 } : {}) } : {})
  };
}
const validId = value => Boolean(value && value !== '0');
function contributionEntries(m, field, shape) {
  return messagesAt(m, field).flatMap(entry => {
    const value = numberAt(entry, shape === 'linkmic' ? 1 : 2);
    const user = shape === 'legacy'
      ? { id: idAt(entry, 1), name: textAt(entry, 3), fanClubs: [], wealthLevel: null }
      : decodeUser(bytesAt(entry, shape === 'linkmic' ? 4 : 1));
    if (!user.id && shape === 'linkmic') user.id = idAt(entry, 3);
    if (!validId(user.id) || !Number.isSafeInteger(value) || value < 0) return [];
    const rank = shape === 'legacy' ? null : numberAt(entry, shape === 'linkmic' ? 2 : 3);
    return [{ user, score: value, ...(rank > 0 ? { rank } : {}) }];
  });
}
function contributionEvents(event, m, field, shape, settings = {}) {
  return messagesAt(m, field).flatMap(entry => {
    const anchorId = shape === 'v2' ? textAt(entry, 1) : idAt(entry, 1);
    if (!validId(anchorId)) return [];
    const info = nested(entry, 2), contributors = contributionEntries(info, 1, shape);
    const events = [];
    if (contributors.length) events.push({ ...event, ...settings, id: event.id ? `${event.id}:contributors:${anchorId}` : '', type: 'pk-contribution', anchorId, contributors,
      ...(shape === 'v2' && info.has(2) ? { contributorCount: numberAt(info, 2) } : {}) });
    if (shape === 'v2') for (const [index, cardInfo] of messagesAt(info, 3).entries()) {
      for (const [cardIndex, card] of messagesAt(cardInfo, 2).entries()) {
        const startAt = numberAt(card, 3), durationMs = numberAt(card, 4), cardType = numberAt(card, 1) ?? numberAt(cardInfo, 1);
        // 已知生效卡的时间和类型；effect_json 的内部字段没有核对，不据此猜卡名或倍率。
        if (!(startAt > 0 && durationMs > 0 && durationMs <= 7200000 && Number.isSafeInteger(startAt + durationMs))) continue;
        events.push({ ...event, ...settings, id: event.id ? `${event.id}:card:${anchorId}:${index}:${cardIndex}` : '', type: 'pk-effect', effectType: 'card',
          anchorId, cardType, name: '平台生效道具', startAt, endAt: startAt + durationMs, durationMs, status: 'observed' });
      }
    }
    return events;
  });
}
function decodeBattleMessage(method, bytes, outerId) {
  const name = String(method).replace(/^Webcast/, '');
  const known = ['LinkMicMethod','LinkMicMethodMessage','LinkMicBattleMethod','LinkmicBattleMessage','LinkMicBattleFinishMethod','LinkmicBattleFinishMessage',
    'LinkMicArmiesMethod','LinkMicArmies','BattleStateSyncMessage'];
  if (!known.includes(name)) return null;
  const m = wire(bytes), common = nested(m, 1);
  const event = { id: outerId || idAt(common, 2), roomId: idAt(common, 3), at: (numberAt(common, 4) || 0) * 1000, source: 'socket', confidence: 'protocol-field', protocolMethod: method };
  if (name === 'LinkMicMethod' || name === 'LinkMicMethodMessage') {
    const scores = battleScores(m, 17), rawBattleId = textAt(m, 114) || idAt(m, 104), battleId = validId(rawBattleId) ? rawBattleId : '';
    const contributions = contributionEvents(event, m, 22, 'linkmic', { battleId });
    if (!scores.length) return contributions.length ? contributions : null; // 普通连麦不能建立 PK 战局。
    const startedAt = numberAt(m, 26), duration = numberAt(m, 16);
    const results = [{ ...event, type: 'pk-score', battleId, scores,
      ...(startedAt > 0 && duration > 0 && duration <= 7200 ? { startedAt, durationMs: duration * 1000, endsAt: startedAt + duration * 1000 } : {}),
      ...(textAt(m, 82) ? { scoreUpdateId: textAt(m, 82) } : {}) }, ...contributions];
    return results.length === 1 ? results[0] : results;
  }
  if (name === 'LinkMicArmiesMethod' || name === 'LinkMicArmies') {
    const rankList = nested(m, 4), settings = battleSettings(rankList, 3, true);
    const modern = contributionEvents(event, rankList, 1, 'v2', settings);
    // v2 和旧榜单可同时出现，优先使用带主播 key 和完整用户资料的 v2；匿名顺序列表不猜归属。
    const results = modern.length ? modern : contributionEvents(event, m, 2, 'legacy');
    return results.length ? results : null;
  }
  const settings = battleSettings(m);
  if (name === 'BattleStateSyncMessage') return settings.battleId ? { ...event, ...settings, type: 'pk-score', scores: [],
    ...(m.has(5) ? { scoreVersion: idAt(m, 5) } : {}) } : null;
  const finish = /Finish/.test(name), scores = finish ? battleScores(m, 4, true) : [];
  if (!settings.battleId && !scores.length) return null;
  return { ...event, ...settings, type: finish ? 'pk-end' : 'pk-start', scores, participants: battleParticipants(m, finish ? 12 : 6) };
}
export function decodeMessage(method, bytes, outerId = '') {
  if (/^(?:Webcast)?(?:LinkMic|Linkmic|Battle)/.test(method)) return decodeBattleMessage(method, bytes, outerId);
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
      const e = decodeMessage(textAt(m, 1), body, idAt(m, 3)); if (Array.isArray(e)) events.push(...e); else if (e) events.push(e);
    } catch (error) { onError(error); }
  }
  return events;
}
