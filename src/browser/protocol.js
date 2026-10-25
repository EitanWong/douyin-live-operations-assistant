import { parseExhibitionRetention } from './exhibition-retention.js';
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
  function skipGroup(startField) {
    const stack = [startField]; let count = 0;
    while (stack.length) {
      if (++count > 100000) throw new Error('protobuf group 字段数量过多');
      const tag = varint(), fieldBig = tag >> 3n, wireType = Number(tag & 7n);
      if (fieldBig < 1n || fieldBig > 0x1fffffffn) throw new Error('protobuf group 字段编号无效');
      const field = Number(fieldBig);
      if (wireType === 0) varint();
      else if (wireType === 1 || wireType === 5) {
        const length = wireType === 1 ? 8 : 4;
        if (pos + length > bytes.length) throw new Error('protobuf group 定长字段不完整');
        pos += length;
      } else if (wireType === 2) {
        const length = Number(varint());
        if (!Number.isSafeInteger(length) || pos + length > bytes.length) throw new Error('protobuf group 消息长度无效');
        pos += length;
      } else if (wireType === 3) stack.push(field);
      else if (wireType === 4) {
        if (stack.pop() !== field) throw new Error('protobuf group 结束字段不匹配');
      } else throw new Error(`不支持 protobuf group wire type ${wireType}`);
    }
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
    } else if (type === 3) { skipGroup(number); continue; }
    else if (type === 4) throw new Error('protobuf group 缺少起始字段');
    else throw new Error(`不支持 protobuf wire type ${type}`);
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
// Common.createTime is seconds on most methods, but current GiftMessage uses
// milliseconds. Preserve both observed layouts before applying freshness checks.
const commonTime = common => { const value = numberAt(common, 4) || 0; return value < 1e12 ? value * 1000 : value; };
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
  return { id: textAt(m, 1028) || idAt(m, 1), secUid: textAt(m, 46), displayId: textAt(m, 38), name: textAt(m, 3), wealthLevel: numberAt(nested(m, 23), 6), fanClubs,
    ...(m.has(4) ? {gender:[1,2].includes(numberAt(m,4)) ? numberAt(m,4) : null} : {}),
    ...(m.has(7) ? {birthday:idAt(m,7)} : {}),
    ...(m.has(1014) ? {birthdayDescription:textAt(m,1014)} : {}),
    ...(m.has(1015) ? {birthdayValid:numberAt(m,1015) === 1} : {}),
    ...(m.has(1045) ? {ageRange:numberAt(m,1045)} : {})
  };
}
const messagesAt = (m, n) => (m.get(n) || []).filter(value => value instanceof Uint8Array).map(value => wire(value));
const signedInt64At = (m, n) => { const value = intAt(m, n); return value === null ? '' : BigInt.asIntN(64, value).toString(); };
function battleGrade(m) {
  return {
    ...(bytesAt(m, 1) ? { name: textAt(m, 1).slice(0, 200) } : {}),
    ...Object.fromEntries([[2, 'level'], [3, 'starCount'], [4, 'targetStarCount']]
      .filter(([field]) => intAt(m, field) !== null).map(([field, name]) => [name, signedInt64At(m, field)])),
    ...(intAt(m, 6) !== null ? { gradeEnum: numberAt(m, 6) } : {})
  };
}
function battleGradeChange(m) {
  return {
    ...Object.fromEntries([[1, 'star'], [2, 'score'], [4, 'beforeLevel'], [6, 'currentLevel']]
      .filter(([field]) => intAt(m, field) !== null).map(([field, name]) => [name, signedInt64At(m, field)])),
    ...(bytesAt(m, 3) ? { beforeGrade: textAt(m, 3).slice(0, 200) } : {}),
    ...(bytesAt(m, 5) ? { currentGrade: textAt(m, 5).slice(0, 200) } : {})
  };
}
function battleSeasonRank(m) {
  return {
    ...Object.fromEntries([[3, 'detail'], [8, 'scoreDisplay'], [9, 'maxScoreDisplay']]
      .filter(([field]) => bytesAt(m, field)).map(([field, name]) => [name, textAt(m, field).slice(0, 200)])),
    ...Object.fromEntries([[5, 'score'], [6, 'maxScore']]
      .filter(([field]) => intAt(m, field) !== null).map(([field, name]) => [name, signedInt64At(m, field)])),
    ...(intAt(m, 7) !== null ? { level: numberAt(m, 7) } : {})
  };
}
function decodeBattleRankSeason(m, event) {
  const result = nested(m, 2);
  if (!result.size) return null;
  const delta = nested(result, 1), change = nested(result, 2);
  // RankSeasonResult 没有主播 UID，只保留房间来源，不能据当前主播猜测段位归属。
  return { ...event, type: 'pk-rank-season',
    ...(bytesAt(change, 1) ? { beforeRank: battleSeasonRank(nested(change, 1)) } : {}),
    ...(bytesAt(change, 2) ? { afterRank: battleSeasonRank(nested(change, 2)) } : {}),
    ...(intAt(change, 4) !== null ? { changeType: numberAt(change, 4) } : {}),
    ...(bytesAt(delta, 1) ? { deltaScore: textAt(delta, 1).slice(0, 200) } : {}),
    ...(delta.has(2) ? { deltaDetails: messagesAt(delta, 2).slice(0, 50).map(row => ({ name: textAt(row, 1).slice(0, 200), score: textAt(row, 2).slice(0, 200) })) } : {}),
    ...(bytesAt(result, 3) ? { tips: textAt(result, 3).slice(0, 1000) } : {})
  };
}
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
      ...(!finish && score.has(15) ? { buffScoreRatio: numberAt(score, 15) } : {}),
      ...(finish && bytesAt(score, 10) ? { grade: battleGrade(nested(score, 10)) } : {})
    }] : [];
  });
}
function battleParticipants(m, field) {
  return messagesAt(m, field).flatMap(entry => {
    const info = nested(entry, 2), user = nested(info, 1);
    const anchorId = textAt(user, 5) || idAt(user, 1) || idAt(entry, 1);
    const stage = nested(info, 12);
    return anchorId ? [{ anchorId, name: textAt(user, 2), roomId: textAt(info, 13),
      ...(bytesAt(info, 4) ? { grade: battleGrade(nested(info, 4)) } : {}),
      ...(bytesAt(info, 5) ? { gradeChange: battleGradeChange(nested(info, 5)) } : {}),
      ...(bytesAt(stage, 3) ? { pkStageDescription: textAt(stage, 3).slice(0, 200) } : {})
    }] : [];
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
  if (!KNOWN_BATTLE_METHODS.has(name)) return null;
  const m = wire(bytes), common = nested(m, 1);
  const event = { id: outerId || idAt(common, 2), roomId: idAt(common, 3), at: commonTime(common), source: 'socket', confidence: 'protocol-field', protocolMethod: method };
  if (name === 'BattleRankSeasonMessage') return decodeBattleRankSeason(m, event);
  if (name === 'LinkMicMethod' || name === 'LinkMicMethodMessage') {
    const scores = battleScores(m, 17), rawBattleId = textAt(m, 114) || idAt(m, 104), battleId = validId(rawBattleId) ? rawBattleId : '';
    const contributions = contributionEvents(event, m, 22, 'linkmic', { battleId });
    if (!scores.length) return contributions.length ? contributions : null; // 普通连麦不能建立 PK 战局。
    // 中途入场或开局名单迟到时，用已核对的连麦用户字段补全昵称，且只接受比分中的参战 UID。
    const scoreIds = new Set(scores.map(item => item.anchorId)), participants = new Map();
    const users = [...(m.get(45) || []), ...messagesAt(m, 58).map(item => bytesAt(item, 1))];
    for (const bytes of users) {
      if (!(bytes instanceof Uint8Array)) continue;
      const user = decodeUser(bytes);
      if (scoreIds.has(user.id) && user.name) participants.set(user.id, {anchorId:user.id, name:user.name});
    }
    const startedAt = numberAt(m, 26), duration = numberAt(m, 16);
    const results = [{ ...event, type: 'pk-score', battleId, scores,
      ...(participants.size ? {participants:[...participants.values()]} : {}),
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
function decodeRoomUserSeq(m, event) {
  const contributors = field => messagesAt(m, field).slice(0, 20).flatMap(row => {
    const userBytes = bytesAt(row, 2), user = userBytes ? decodeUser(userBytes) : null;
    if (!user || (!user.id && !user.name)) return [];
    return [{ user, score:numberAt(row, 1), rank:numberAt(row, 3), delta:numberAt(row, 4) }];
  });
  return {
    ...event, type:'room-audience',
    onlineCount:numberAt(m, 3), popularity:idAt(m, 6), cumulativeUsers:idAt(m, 7),
    onlineDisplay:textAt(m, 9), cumulativeUsersDisplay:textAt(m, 8),
    anchorOnlineDisplay:textAt(m, 10), anchorPageViewsDisplay:textAt(m, 11),
    ranks:contributors(2), seats:contributors(5)
  };
}
function decodeGiftMenuItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const rawId = item.id ?? item.gift_id;
  const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : '';
  const name = typeof item.name === 'string' ? item.name.slice(0, 100) : '';
  if (!id || id === '0' || id.length > 128 || !name) return null;
  const rawPrice = item.price ?? item.diamond_count;
  const price = Number.isSafeInteger(rawPrice) && rawPrice >= 0 && rawPrice <= 1e9 ? rawPrice : null;
  const icon = typeof item.icon === 'string' && item.icon.length <= 2048 ? item.icon : '';
  return { id, name, price, ...(icon ? { icon } : {}) };
}
function decodeGroupLiveGiftMenu(m, event) {
  const containers = messagesAt(m, 1).filter(row => numberAt(row, 1) === 6);
  return containers.flatMap((row, index) => {
    let payload;
    try { payload = JSON.parse(textAt(row, 3)); } catch { return []; }
    if (!Array.isArray(payload?.data)) return [];
    const items = payload.data.slice(0, 100).map(decodeGiftMenuItem).filter(Boolean);
    return [{ ...event, id:event.id ? `${event.id}:gift-menu:${index}` : '', type:'gift-catalog',
      catalogSource:'group-live-menu', containerType:6, position:textAt(row, 4), itemCount:items.length, items }];
  });
}
function decodeBattleBonus(m, event) {
  const mvp = nested(m, 2);
  const players = messagesAt(m, 3).slice(0, 20).map(row => ({
    user:{ id:idAt(row, 1), name:textAt(row, 2) }, diamondCount:idAt(row, 3)
  })).filter(row => row.user.id || row.user.name);
  const prop = nested(mvp, 3);
  const result = { ...event, type:'battle-bonus',
    mvp:{ user:{id:idAt(mvp, 1),name:textAt(mvp, 2)}, prop:prop.has(4) || prop.has(10) ? { id:idAt(prop, 4), name:textAt(prop, 10), count:numberAt(prop, 9), diamond:idAt(prop, 6) } : null },
    players };
  if (!result.mvp.user.id && !result.mvp.user.name && !players.length) return null;
  return result;
}
function decodeBattleProperty(m, event) {
  const rooms = messagesAt(m, 2).slice(0, 10).map(room => ({
    roomId:idAt(room, 1), properties:messagesAt(room, 2).slice(0, 20).map(row => {
      const prop = nested(row, 1);
      return { id:idAt(prop, 4), name:textAt(prop, 10), count:numberAt(prop, 9), diamond:idAt(prop, 6),
        startAt:idAt(row, 2), durationMs:idAt(row, 3) };
    }).filter(row => row.id || row.name)
  })).filter(room => room.properties.length);
  return rooms.length ? { ...event, type:'battle-property', rooms } : null;
}
function decodeBattleSeasonHonor(m, event) {
  const honors = messagesAt(m, 4).slice(0, 20).map(row => {
    const user = bytesAt(row, 9);
    return { honorType:numberAt(row, 1), name:textAt(row, 2), current:numberAt(row, 5), total:numberAt(row, 6),
      unlocked:numberAt(row, 13) === 1, topUser:user ? decodeUser(user) : null };
  }).filter(row => row.honorType !== null || row.name);
  return honors.length ? { ...event, type:'battle-season-honor', honors } : null;
}
function decodePopularCard(m, event) {
  const info = nested(m, 2);
  return info.size ? { ...event, type:'popular-card', status:numberAt(info, 1), startAt:idAt(info, 2),
    endAt:idAt(info, 3), enterNumber:numberAt(info, 4) } : null;
}
function decodeGroupLiveMembers(m, event) {
  const members = messagesAt(m, 2).slice(0, 100).flatMap(row => {
    const userBytes = bytesAt(row, 1), user = userBytes ? decodeUser(userBytes) : null;
    return user && (user.id || user.name) ? [{user,score:idAt(row, 2),showScore:numberAt(row, 3) === 1}] : [];
  });
  return members.length ? { ...event, type:'group-live-members', members } : null;
}
function decodeGroupLiveIncome(m, event) {
  const members = messagesAt(m, 2).slice(0, 100).flatMap(row => {
    const userBytes = bytesAt(row, 1), user = userBytes ? decodeUser(userBytes) : null;
    if (!user || (!user.id && !user.name)) return [];
    return [{user,income:idAt(row, 2),otherIncome:idAt(row, 3),giftIncome:idAt(row, 4),
      starGuardIncome:idAt(row, 5),starGuardActivatedUsers:idAt(row, 7)}];
  });
  return members.length ? { ...event, type:'group-live-income', calculatedAt:idAt(m, 3), members } : null;
}
function decodeLinkMicPositions(m, event) {
  const content=nested(m, 3), verify=nested(m, 4);
  const positions=messagesAt(content, 1).slice(0, 24).map(row => ({
    position:idAt(row, 1), status:numberAt(row, 2), activeName:textAt(row, 3),
    verifyStatus:numberAt(row, 4), positionType:numberAt(row, 5), clientPosition:idAt(row, 6),
    masked:numberAt(row, 7) === 1, hideStatus:numberAt(row, 8), hiddenName:textAt(row, 9)
  }));
  const verifyPositions=messagesAt(verify, 2).slice(0, 24).map(row => ({
    position:idAt(row, 1), name:textAt(row, 2), status:numberAt(row, 3), positionType:numberAt(row, 4)
  }));
  const finalPositions=messagesAt(verify, 3).slice(0, 24).map(row => ({
    position:idAt(row, 1), status:numberAt(row, 2), activeName:textAt(row, 3),
    verifyStatus:numberAt(row, 4), positionType:numberAt(row, 5), masked:numberAt(row, 7) === 1
  }));
  return positions.length || verifyPositions.length || finalPositions.length
    ? { ...event, type:'linkmic-positions', messageType:numberAt(m, 2), currentVerifyPosition:idAt(verify, 1), positions, verifyPositions, finalPositions }
    : null;
}
function decodeGuestLink(m, event) {
  const messageType=numberAt(m, 2), update=nested(m, 54), channel=nested(update, 1), join=nested(m, 56);
  const linkedUsers=messagesAt(channel, 2).slice(0, 24).flatMap(row => {
    const userBytes=bytesAt(row, 1), user=userBytes ? decodeUser(userBytes) : null;
    return user && (user.id || user.name) ? [{user,score:idAt(row, 2),userRole:numberAt(row, 3),audienceRole:numberAt(row, 4),scoreDisplay:textAt(row, 5),linkType:numberAt(row, 7)}] : [];
  });
  const channelUsers=(channel.get(3) || []).filter(value => value instanceof Uint8Array).slice(0, 24).flatMap(userBytes => {
    const user=decodeUser(userBytes);
    return user.id || user.name ? [user] : [];
  });
  const data={channelId:idAt(channel, 1) || idAt(join, 1), messageType, linkedUsers, channelUsers,
    score:idAt(channel, 4) || idAt(join, 4), callDuration:idAt(channel, 5) || idAt(join, 5),
    startedAt:idAt(channel, 6), channelUserCount:idAt(channel, 9), scoreDisplay:textAt(channel, 10)};
  return data.channelId || linkedUsers.length || channelUsers.length || data.callDuration
    ? { ...event, type:'guest-link-state', ...data }
    : null;
}
function decodeRoomSyncDetails(syncType, bytes) {
  if (!bytes || !['LotteryInfoSyncData','RoomChannelSettingsSyncData','DoubleLikeSyncData','RoomLinkMicSyncData','RoomLinkMicAnchorSettingsSyncData','AudienceGiftSyncData','InteractEffectSyncData'].includes(syncType)) return null;
  let m;
  try { m=wire(bytes); } catch { return null; }
  if (syncType === 'LotteryInfoSyncData') return {
    lotteryId:idAt(m, 1), lotteryType:idAt(m, 5), luckyCount:idAt(m, 2), prizeCount:idAt(m, 6),
    candidateCount:idAt(m, 3), startedAt:idAt(m, 7), drawAt:idAt(m, 8),
    dilutionEnabled:numberAt(m, 9), dilutionActive:numberAt(m, 11) === 1,
    prizeCountBeforeDilution:idAt(m, 12), luckyCountBeforeDilution:idAt(m, 13)
  };
  if (syncType === 'RoomChannelSettingsSyncData') return {
    channelId:idAt(m, 1), linkMicEnabled:numberAt(m, 2) === 1,
    entryApprovalEnabled:numberAt(m, 3) === 1, memberInviteEnabled:numberAt(m, 4) === 1
  };
  if (syncType === 'DoubleLikeSyncData') {
    const status=nested(m, 1);
    return { doubleLikeEnabled:numberAt(status, 1) === 1, sequence:numberAt(status, 2), renewals:numberAt(status, 3), triggers:numberAt(status, 4) };
  }
  if (syncType === 'RoomLinkMicSyncData') {
    const users=messagesAt(m, 1).slice(0, 24).flatMap(row => {
      const userBytes=bytesAt(row, 1), user=userBytes ? decodeUser(userBytes) : null;
      return user && (user.id || user.name) ? [{user,linkStatus:numberAt(row, 4),linkType:numberAt(row, 5),position:numberAt(row, 6),silenceStatus:numberAt(row, 7),role:numberAt(row, 10)}] : [];
    });
    const positionRows=field => messagesAt(m, field).slice(0, 24).map(row => ({
      position:idAt(row, 1), status:numberAt(row, 2), activeName:textAt(row, 3),
      verifyStatus:numberAt(row, 4), positionType:numberAt(row, 5), masked:numberAt(row, 7) === 1
    }));
    return { users, lockedPositions:positionRows(4), positions:positionRows(5), version:idAt(m, 8) };
  }
  if (syncType === 'RoomLinkMicAnchorSettingsSyncData') return {
    settings:messagesAt(m, 1).slice(0, 50).map(row => ({key:numberAt(row, 1),value:numberAt(row, 2)}))
  };
  if (syncType === 'AudienceGiftSyncData') return {
    syncType:idAt(m, 2), recipients:messagesAt(m, 1).slice(0, 24).flatMap(row => {
      const userBytes=bytesAt(row, 1), user=userBytes ? decodeUser(userBytes) : null;
      return user && (user.id || user.name) ? [{user,score:idAt(row, 2),giftAllowed:numberAt(row, 3) === 1,reason:textAt(row, 4).slice(0, 160)}] : [];
    })
  };
  if (syncType === 'InteractEffectSyncData') return {
    anchorId:textAt(m, 1), roomId:textAt(m, 2), stickers:messagesAt(m, 3).slice(0, 50).flatMap(entry => {
      const key=textAt(entry, 1), value=bytesAt(entry, 2);
      return value ? messagesAt(wire(value), 1).slice(0, 50).map(row => ({
        key, effectId:idAt(row, 1), enabled:numberAt(row, 2) === 1, rendering:numberAt(row, 3) === 1
      })).filter(row => row.effectId) : [];
    })
  };
  return null;
}
function richText(bytes) {
  if (!bytes) return '';
  const m = wire(bytes), pieces = [];
  for (const piece of messagesAt(m, 4).slice(0, 100)) {
    const userRef = nested(piece, 4), userBytes = bytesAt(userRef, 1);
    const imageRef = nested(piece, 8), imageBytes = bytesAt(imageRef, 1);
    const imageContent = imageBytes ? nested(imageBytes, 8) : new Map();
    const value = textAt(piece, 3) || (userBytes ? decodeUser(userBytes).name : '')
      || textAt(nested(piece, 7), 2) || textAt(imageContent, 4);
    pieces.push(value);
  }
  return pieces.join('').slice(0, 10000) || textAt(m, 2).slice(0, 10000);
}
function decodeProtocolEvent(method, m, event) {
  if (method === 'GroupLiveContainerChangeMessage') return decodeGroupLiveGiftMenu(m, event);
  if (method === 'WebcastBattleBonusMessage') return decodeBattleBonus(m, event);
  if (method === 'WebcastBattlePropertyMessage') return decodeBattleProperty(m, event);
  if (method === 'BattleSeasonHonorMessage') return decodeBattleSeasonHonor(m, event);
  if (method === 'PopularCardMessage' || method === 'WebcastPopularCardMessage') return decodePopularCard(m, event);
  if (method === 'FansclubStatisticsMessage') return {
    ...event, type:'fansclub-statistics', name:textAt(m, 2), fansCount:idAt(m, 3)
  };
  if (method === 'GroupLiveMemberChangeMessage') return decodeGroupLiveMembers(m, event);
  if (method === 'GroupLiveIncomeChangeMessage') return decodeGroupLiveIncome(m, event);
  if (method === 'LinkMicPositionMessage') return decodeLinkMicPositions(m, event);
  if (method === 'LinkmicGuestLinkMessage') return decodeGuestLink(m, event);
  if (method === 'FansclubV1PushMessage') return {
    ...event, type:'fansclub-push', content:textAt(m, 2).slice(0, 500),
    actionContent:textAt(m, 6).slice(0, 500), actionType:idAt(m, 7), displayDuration:idAt(m, 8), source:textAt(m, 12).slice(0, 100)
  };
  if (method === 'RoomTicketMessage') return {
    ...event, type:'room-ticket', actionType:numberAt(m, 2), lastDuration:numberAt(m, 3), ticketId:idAt(m, 4),
    ownerId:idAt(m, 9), bringProductSwitchStatus:numberAt(m, 11)
  };
  if (method === 'WebcastRoomStatsMessage') return {
    ...event, type:'room-stats', metricType:numberAt(m, 10), displayValue:numberAt(m, 5) ?? numberAt(m, 9),
    displayShort:textAt(m, 2), displayMiddle:textAt(m, 3), displayLong:textAt(m, 4),
    displayVersion:idAt(m, 6), incremental:numberAt(m, 7) === 1, hidden:numberAt(m, 8) === 1
  };
  if (method === 'WebcastRoomUserSeqMessage') return decodeRoomUserSeq(m, event);
  if (method === 'WebcastSocialMessage') {
    const action = numberAt(m, 4);
    return { ...event, type:'social', user:bytesAt(m, 2) ? decodeUser(bytesAt(m, 2)) : null,
      action, actionName:action === 1 ? 'follow' : action === 2 ? 'share' : '',
      shareType:numberAt(m, 3), shareTarget:textAt(m, 5), followCount:numberAt(m, 6),
      shareDisplayStyle:numberAt(m, 7), shareCount:numberAt(m, 8) };
  }
  if (method === 'WebcastFansclubMessage') {
    const action = numberAt(m, 2);
    return { ...event, type:'fansclub', user:bytesAt(m, 4) ? decodeUser(bytesAt(m, 4)) : null,
      action, actionName:action === 1 ? 'upgrade' : action === 2 ? 'join' : '', description:textAt(m, 3) };
  }
  if (method === 'WebcastEmojiChatMessage') return {
    ...event, type:'emoji-chat', user:bytesAt(m, 2) ? decodeUser(bytesAt(m, 2)) : null,
    emojiId:idAt(m, 3), text:richText(bytesAt(m, 4)) || textAt(m, 5), fromIntercom:numberAt(m, 7) === 1
  };
  if (method === 'WebcastScreenChatMessage' || method === 'WebcastPrivilegeScreenChatMessage') {
    const content = textAt(m, 3) || textAt(m, 4);
    const rtf = richText(bytesAt(m, 32));
    return { ...event, type:'screen-chat', user:bytesAt(m, 2) ? decodeUser(bytesAt(m, 2)) : null,
      text:content || rtf, eventTime:idAt(m, m.get(4)?.[0] instanceof Uint8Array ? 3 : 4),
      priorityScore:idAt(m, 12), privilege:method === 'WebcastPrivilegeScreenChatMessage' };
  }
  if (method === 'WebcastRoomMessage') return {
    ...event, type:'room-notice', text:textAt(m, 2), source:numberAt(m, 4), welcome:numberAt(m, 7) === 1,
    durationMs:numberAt(m, 9), subScene:textAt(m, 10)
  };
  if (method === 'WebcastRoomRankMessage') return {
    ...event, type:'room-rank', ranks:messagesAt(m, 2).slice(0, 20).flatMap(row => {
      const userBytes=bytesAt(row, 1), user=userBytes ? decodeUser(userBytes) : null;
      return user && (user.id || user.name) ? [{user,score:textAt(row, 2),profileHidden:numberAt(row, 3) === 1}] : [];
    })
  };
  if (method === 'WebcastRankUpdateMessage') return {
    ...event, type:'rank-update', groupType:numberAt(m, 3), priority:numberAt(m, 5),
    updates:messagesAt(m, 2).slice(0, 20).map(row => ({rankType:numberAt(row, 1),ownerRank:numberAt(row, 2),text:richText(bytesAt(row, 3)),countdown:numberAt(row, 6)}))
  };
  if (method === 'WebcastRoomNotifyMessage') {
    const field2 = textAt(m, 2), scheme = /^(?:sslocal|https?):\/\//.test(field2) ? field2 : '';
    return { ...event, type:'room-notify', scheme, notifyType:numberAt(m, 3), notifySubType:textAt(m, 4),
      extraBytes:(bytesAt(m, 6)?.length || 0) + (scheme ? 0 : bytesAt(m, 2)?.length || 0) };
  }
  if (method === 'WebcastRoomDataSyncMessage' || method === 'RoomDataSyncMessage') return {
    ...event, type:'room-sync', syncType:textAt(m, 3), traceId:textAt(m, 4), requestId:textAt(m, 6),
    syncDataBytes:bytesAt(m, 5)?.length || 0,
    syncDetails:decodeRoomSyncDetails(textAt(m, 3), bytesAt(m, 5))
  };
  if (method === 'WebcastAudioChatMessage') return {
    ...event, type:'audio-chat', user:bytesAt(m, 2) ? decodeUser(bytesAt(m, 2)) : null,
    text:textAt(m, 3), durationRaw:idAt(m, 5), hasAudio:Boolean(textAt(m, 4))
  };
  if (method === 'WebcastHighlightCommentMessage') {
    const author = nested(m, 8);
    return { ...event, type:'highlight-comment', messageId:idAt(m, 2), text:textAt(m, 7),
      user:{id:idAt(author, 1),name:textAt(author, 3)}, displayStart:idAt(m, 10), displayEnd:idAt(m, 11) };
  }
  if (method === 'WebcastLightGiftMessage') {
    const gift = nested(m, 7);
    return { ...event, type:'light-gift', userId:idAt(m, 5), messageType:numberAt(m, 2),
      giftId:idAt(gift, 1), unitValue:numberAt(gift, 3), count:numberAt(m, 10), displayStyle:numberAt(m, 9) };
  }
  if (method === 'WebcastLiveShoppingMessage') return {
    ...event, type:'live-shopping', messageType:numberAt(m, 2), promotionId:idAt(m, 4)
  };
  if (method === 'WebcastProductChangeMessage') return {
    ...event, type:'product-change', updateTimestamp:idAt(m, 2), text:textAt(m, 3), total:numberAt(m, 5),
    products:messagesAt(m, 4).slice(0, 20).map(row => ({promotionId:idAt(row, 1),index:numberAt(row, 2),targetFlashIds:(row.get(3)||[]).filter(v=>typeof v==='bigint').slice(0,20).map(v=>v.toString()),explainType:idAt(row, 4)})),
    categories:messagesAt(m, 8).slice(0, 20).map(row => ({id:numberAt(row, 1),name:textAt(row, 2),promotionIds:(row.get(3)||[]).filter(v=>typeof v==='bigint').slice(0,20).map(v=>v.toString()),type:textAt(row, 4)}))
  };
  if (method === 'WebcastInRoomBannerMessage') return {
    ...event, type:'room-banner', bannerType:numberAt(m, 3), bannerBytes:bytesAt(m, 2)?.length || 0
  };
  if (method === 'WebcastRanklistAwardMessage') return {
    ...event, type:'rank-award', rank:numberAt(m, 2), awardType:numberAt(m, 3), category:numberAt(m, 4), value:numberAt(m, 9)
  };
  if (method === 'WebcastChatLikeMessage') return {
    ...event, type:'chat-like', entries:messagesAt(m, 2).slice(0, 100).map(row => ({
      messageId:idAt(row, 1), count:idAt(nested(row, 2), 1), timestamp:idAt(nested(row, 2), 2)
    }))
  };
  if (method === 'WebcastUpdateFanTicketMessage') return {
    ...event, type:'fan-ticket', display:textAt(m, 2), total:idAt(m, 3), forceUpdate:numberAt(m, 4) === 1
  };
  if (method === 'WebcastProfitGameStatusMessage') {
    let title = '';
    try { title = JSON.parse(textAt(m, 10)).title || ''; } catch {}
    return { ...event, type:'room-activity-state', status:numberAt(m, 2), title,
      properties:messagesAt(m, 18).slice(0, 20).map(row => ({key:textAt(row, 1),value:textAt(row, 2)})).filter(row => row.key) };
  }
  if (method === 'WebcastGiftSortMessage') {
    const sceneBytes=bytesAt(m, 4), directScene=sceneBytes ? decoder.decode(sceneBytes) : '';
    const scene=/^[\p{L}\p{N}_-]{1,100}$/u.test(directScene) ? directScene : textAt(nested(m, 4), 1);
    return { ...event, type:'gift-panel-state', sortType:numberAt(m, 2), scene };
  }
  if (method === 'WebcastRoomIndicatorMessage') {
    let contents = [];
    try { contents = messagesAt(nested(m,4),2).slice(0,20).map(row => ({
      type:numberAt(row,1),number:idAt(row,2),text:textAt(row,3).slice(0,200),endText:textAt(row,7).slice(0,200)
    })); } catch { /* 未知业务载荷仍保留外层指标事件。 */ }
    const retention = parseExhibitionRetention(contents.map(row => row.text).join(''));
    return { ...event, type:'room-indicator', indicatorType:numberAt(m,2), subType:numberAt(m,3), dataBytes:bytesAt(m,4)?.length || 0,
      ...(contents.length ? {contents} : {}), ...(retention ? {exhibitionRetention:retention} : {}) };
  }
  if (method === 'WebcastPreviewCjRpMessage') {
    const packet = nested(m, 1);
    return { ...event, type:'red-packet', packetId:textAt(packet, 1), startTime:idAt(packet, 2), endTime:idAt(packet, 3),
      count:numberAt(packet, 4), packetType:numberAt(packet, 5), currency:textAt(packet, 6), status:textAt(packet, 8),
      totalAmount:numberAt(packet, 9), unitAmount:numberAt(packet, 11) };
  }
  const activityKinds = {
    WebcastLotteryDrawResultEventMessage:'lottery-result', WebcastLotteryEventNewMessage:'lottery-start',
    WebcastLuckyBoxMessage:'lucky-box', WebcastLuckyBoxEndMessage:'lucky-box-end',
    WebcastLuckyBoxRewardMessage:'lucky-box-reward', WebcastLuckyBoxTempStatusMessage:'lucky-box-status'
  };
  if (activityKinds[method]) return { ...event, type:'activity-signal', activityKind:activityKinds[method] };
  if (method === 'WebcastPrizeNoticeMessage') return { ...event, type:'activity-signal', activityKind:'prize-notice',
    prizeType:numberAt(m, 2), field6:numberAt(m, 6), field8:numberAt(m, 8) };
  return null;
}
const KNOWN_BATTLE_METHODS = new Set(['LinkMicMethod','LinkMicMethodMessage','LinkMicBattleMethod','LinkmicBattleMessage','LinkMicBattleFinishMethod','LinkmicBattleFinishMessage','LinkMicArmiesMethod','LinkMicArmies','BattleStateSyncMessage','BattleRankSeasonMessage']);
const KNOWN_PROTOCOL_METHODS = new Set(['WebcastChatMessage','WebcastGiftMessage','WebcastLikeMessage','WebcastMemberMessage','WebcastControlMessage','WebcastRoomStatsMessage','WebcastRoomUserSeqMessage','WebcastSocialMessage','WebcastFansclubMessage','WebcastEmojiChatMessage','WebcastScreenChatMessage','WebcastPrivilegeScreenChatMessage','WebcastRoomMessage','WebcastRoomRankMessage','WebcastRankUpdateMessage','WebcastRoomNotifyMessage','WebcastRoomDataSyncMessage','RoomDataSyncMessage','WebcastAudioChatMessage','WebcastHighlightCommentMessage','WebcastLightGiftMessage','WebcastLiveShoppingMessage','WebcastProductChangeMessage','WebcastInRoomBannerMessage','WebcastRanklistAwardMessage','WebcastPreviewCjRpMessage','WebcastLotteryDrawResultEventMessage','WebcastLotteryEventNewMessage','WebcastLuckyBoxMessage','WebcastLuckyBoxEndMessage','WebcastLuckyBoxRewardMessage','WebcastLuckyBoxTempStatusMessage','WebcastPrizeNoticeMessage','WebcastChatLikeMessage','WebcastUpdateFanTicketMessage','WebcastProfitGameStatusMessage','WebcastGiftSortMessage','WebcastRoomIndicatorMessage','GroupLiveContainerChangeMessage','WebcastBattleBonusMessage','WebcastBattlePropertyMessage','BattleSeasonHonorMessage','PopularCardMessage','WebcastPopularCardMessage','FansclubStatisticsMessage','GroupLiveMemberChangeMessage','GroupLiveIncomeChangeMessage','RoomTicketMessage','LinkMicPositionMessage','LinkmicGuestLinkMessage','FansclubV1PushMessage']);
const knownProtocolMethod = method => KNOWN_PROTOCOL_METHODS.has(method) || KNOWN_BATTLE_METHODS.has(String(method).replace(/^Webcast/, ''));
export function decodeMessage(method, bytes, outerId = '') {
  if (KNOWN_BATTLE_METHODS.has(method) || KNOWN_BATTLE_METHODS.has(String(method).replace(/^Webcast/, ''))) return decodeBattleMessage(method, bytes, outerId);
  if (!KNOWN_PROTOCOL_METHODS.has(method)) return null;
  const m = wire(bytes), common = nested(m, method === 'WebcastPreviewCjRpMessage' ? 2 : 1);
  const event = { id: outerId || idAt(common, 2), roomId: idAt(common, 3), at: commonTime(common), source: 'socket' };
  const observed = decodeProtocolEvent(method, m, event);
  if (observed) return observed;
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
export async function decodeFrame(data, onError = () => {}, onUnknownMethod = () => {}, onMessage = () => {}) {
  let bytes;
  if (typeof data === 'string') return []; // 不解析其他业务 socket 的 JSON。
  if (data && typeof data.arrayBuffer === 'function') bytes = new Uint8Array(await data.arrayBuffer());
  else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  else bytes = new Uint8Array(data);
  const frame = wire(bytes), payload = bytesAt(frame, 8);
  let responseBytes = bytes, encoding = '';
  if (payload) {
    if (textAt(frame, 7) && textAt(frame, 7) !== 'msg') return [];
    const headers = new Map((frame.get(5) || []).filter(v => v instanceof Uint8Array).map(v => { const h = wire(v); return [textAt(h, 1), textAt(h, 2)]; }));
    responseBytes = payload;
    encoding = textAt(frame, 6) || headers.get('compress_type') || '';
  }
  // WebSocket uses PushFrame.payload; /webcast/im/fetch/ returns the inner Response directly.
  const response = wire(await inflate(responseBytes, encoding)), events = [];
  for (const message of response.get(1) || []) {
    if (!(message instanceof Uint8Array)) continue;
    // 单条消息的字段变化/损坏不能吞掉同一帧中的其他礼物。
    try {
      const m = wire(message), body = bytesAt(m, 2); if (!body) continue;
      const method = textAt(m, 1), messageId = idAt(m, 3);
      let e;
      try { e = decodeMessage(method, body, messageId); }
      catch (error) {
        try { onMessage({ method, messageId, decodeError:String(error?.message || error).slice(0, 240), decodedTypes:[] }); } catch {}
        throw error;
      }
      if (!knownProtocolMethod(method) && /^[A-Za-z0-9_]{1,120}$/.test(method)) try { onUnknownMethod(method); } catch {}
      try { onMessage({ method, messageId, decodedTypes:(Array.isArray(e) ? e : e ? [e] : []).map(event => event.type).filter(type => typeof type === 'string').slice(0, 16) }); } catch {}
      if (Array.isArray(e)) events.push(...e); else if (e) events.push(e);
    } catch (error) { onError(error); }
  }
  return events;
}
