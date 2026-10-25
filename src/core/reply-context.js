import { sharedLiveContext } from './live-context.js';
// 礼物价值使用平台钻石面值，不使用主播收入估算比例。
export function giftReplyContext(items) {
  const gifts = items.map(item => ({
    giftName: item.name, count: item.count,
    unitDiamonds: Number.isFinite(item.price) && item.price > 0 ? item.price : null
  }));
  const knownTotalDiamonds = gifts.reduce((sum, item) => sum + item.count * (item.unitDiamonds ?? 0), 0);
  const totalDiamonds = gifts.every(item => item.unitDiamonds !== null) ? knownTotalDiamonds : null;
  const valueTier = totalDiamonds === null ? 'unknown' : totalDiamonds < 10 ? 'small'
    : totalDiamonds < 100 ? 'modest' : totalDiamonds < 1000 ? 'medium' : totalDiamonds < 10000 ? 'large' : 'exceptional';
  return {
    gifts, giftName: gifts.map(item => item.giftName).join('、'),
    count: gifts.reduce((sum, item) => sum + item.count, 0),
    unitDiamonds: gifts.length === 1 ? gifts[0].unitDiamonds : null,
    totalDiamonds, knownTotalDiamonds, valueTier
  };
}

export function audienceReplyContext(user, anchorId) {
  const club = anchorId && user?.fanClubs?.find(item => item.anchorId === anchorId);
  return {
    wealthLevel: Number.isFinite(user?.wealthLevel) ? user.wealthLevel : null,
    fanLevel: Number.isFinite(club?.level) ? club.level : null,
    fanClubLit: Number.isFinite(club?.status) ? club.status === 1 : null
  };
}

const shortText = value => typeof value === 'string' ? [...value].slice(0, 160).join('') : '';
const knownNumber = value => Number.isFinite(value) ? value : null;

// 仅保留现场语境所需的展示字段；不把原始协议、UID、链接或请求凭据发给模型。
export function observedReplyEvent(event, now) {
  if (!['gift','enter','like','social','fansclub','room-notice','room-notify','audio-chat','highlight-comment','live-shopping','product-change','room-banner','red-packet','room-activity-state','end'].includes(event.type)) return null;
  return {
    type:event.type, at:now, name:shortText(event.user?.name),
    text:shortText(event.text || event.description || event.title || event.display || event.actionName),
    ...(event.type === 'gift' ? {gift:shortText(event.giftName), count:knownNumber(event.count), unitDiamonds:knownNumber(event.unitValue), cumulative:true} : {}),
    ...(event.type === 'like' ? {count:knownNumber(event.count)} : {})
  };
}

export const liveReplyContext = sharedLiveContext;

// 仅拦截明确的代主持、征集话题和停留决策措辞，不凭长度判定语气。
export function isIntrusiveReply(text) {
  const wording = String(text).replace(/[\s\u200b\ufeff]+/gu, '');
  return /(?:我(?:来|会|可以|帮(?:你们?|大家)?|替(?:你们?|大家)?)|由我|交给我).{0,8}(?:转达|转告|安排|主持|带动|组织)|(?:帮|替)(?:大家|你们?).{0,8}(?:转达|转告|问问主播)/u.test(wording)
    || /(?:决定|考虑|选择)是否(?:继续)?(?:停留|留下|观看)/u.test(wording)
    || /(?:想听|想聊).{0,8}话题.{0,16}(?:公屏|弹幕)|(?:有(?:什么|啥)|想听|想聊).{0,12}(?:话题|聊什么|听什么).{0,16}(?:公屏|弹幕)|(?:公屏|弹幕).{0,16}(?:想聊|想听|聊什么|听什么|想问主播)/u.test(wording)
    || /大家.{0,6}(?:看过来|听我说|跟我刷)|(?:我是|作为|身为)(?:这里的|本直播间的|直播间的)?(?:场控|主持|小助手)/u.test(wording);
}
