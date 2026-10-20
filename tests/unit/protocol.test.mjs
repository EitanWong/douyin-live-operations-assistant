import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { decodeFrame, decodeMessage, decodeUser, wire } from '../../src/browser/protocol.js';
const cat = (...v) => Buffer.concat(v.map(x => Buffer.from(x)));
const varint = input => { let v = BigInt(input); const out = []; while (v > 127n) { out.push(Number(v & 127n) | 128); v >>= 7n; } out.push(Number(v)); return Buffer.from(out); };
const i = (field, value) => cat(varint(field * 8), varint(value));
const b = (field, value) => { const data = Buffer.from(value); return cat(varint(field * 8 + 2), varint(data.length), data); };
const uid = '9007199254740993123';
const club = anchor => cat(b(1, '本房粉丝团'), i(2, 8), i(3, 1), i(6, anchor));
const user = cat(i(1, uid), b(3, '青山'), b(23, i(6, 35)), b(24, cat(b(1, club('1234567890')), b(2, cat(i(1, 99), b(2, club('12345')))))));
const common = cat(i(2, '9876543210123456789'), i(3, '7777777777777777777'), i(4, 1791990000));
test('UID 和房间 ID 保留全部 64 位精度，解析粉丝团 preferData', () => {
  const decoded = decodeUser(user); assert.equal(decoded.id, uid); assert.equal(decoded.wealthLevel, 35); assert.equal(decoded.fanClubs.length, 2); assert.equal(decoded.fanClubs[0].status, 1);
  const e = decodeMessage('WebcastChatMessage', cat(b(1, common), b(2, user), b(3, '直播真好看')));
  assert.equal(e.roomId, '7777777777777777777'); assert.equal(e.id, '9876543210123456789'); assert.equal(e.text, '直播真好看');
});
test('ChatMessage 字段 12 atUser 解析被 @ 用户 UID', () => {
  const e = decodeMessage('WebcastChatMessage', cat(b(1, common), b(2, user), b(3, '请看一下'), b(12, cat(i(1, '12345678901234567890'), b(3, '小助手')))));
  assert.equal(e.atUser.name, '小助手'); assert.deepEqual(e.mentions, ['12345678901234567890']);
});
test('缺失等级和粉丝团不猜测默认达标', () => { const u = decodeUser(cat(i(1, uid), b(3, '未知用户'))); assert.equal(u.wealthLevel, null); assert.deepEqual(u.fanClubs, []); });
test('礼物读取 diamondCount、repeatCount、groupId 与 repeatEnd', () => {
  const gift = cat(i(5, 77), i(10, 1), i(12, 50), b(16, '星星'));
  const e = decodeMessage('WebcastGiftMessage', cat(b(1, common), i(2, 77), i(5, 3), i(6, 3), b(7, user), i(9, 1), i(11, '1234567890123456789'), b(15, gift)));
  assert.equal(e.unitValue, 50); assert.equal(e.count, 3); assert.equal(e.groupId, '1234567890123456789'); assert.equal(e.final, true);
});
test('礼物结构保留大额礼物单价与数量，不因 64 位礼物 ID 丢精度', () => {
  const gift = cat(i(5, 77), i(11, 2), i(12, 11999), b(16, '暮光恋人'));
  const e = decodeMessage('WebcastGiftMessage', cat(b(1, common), i(2, '9007199254740993123'), i(5, 1), b(7, user), i(11, 0), b(15, gift)), '1004');
  assert.equal(e.giftName, '暮光恋人'); assert.equal(e.unitValue, 11999); assert.equal(e.count, 1); assert.equal(e.final, true);
});
test('LikeMessage 读取点赞用户、单条点赞数和累计数', () => {
  const e = decodeMessage('WebcastLikeMessage', cat(b(1, common), i(2, 30), i(3, 900), b(5, user)));
  assert.equal(e.type, 'like'); assert.equal(e.user.id, uid); assert.equal(e.user.name, '青山');
  assert.equal(e.count, 30); assert.equal(e.total, 900);
});
test('RoomStats 保留原始数值、展示格式、版本和隐藏状态', () => {
  const event = decodeMessage('WebcastRoomStatsMessage', cat(b(1, common), b(2, '1万'), b(3, '10,764'), b(4, '10,764 在线观众'), i(5, 10764), i(6, '9007199254740993999'), i(7, 1), i(8, 1), i(9, 10764), i(10, 1)), 'stats-1');
  assert.equal(event.type, 'room-stats'); assert.equal(event.id, 'stats-1'); assert.equal(event.metricType, 1);
  assert.equal(event.displayValue, 10764); assert.equal(event.displayLong, '10,764 在线观众');
  assert.equal(event.displayVersion, '9007199254740993999'); assert.equal(event.incremental, true); assert.equal(event.hidden, true);
});
test('RoomUserSeq 分开在线数/累计用户与贡献榜，并保留 64 位用户 ID', () => {
  const row = cat(i(1, 450), b(2, user), i(3, 1), i(4, 30));
  const event = decodeMessage('WebcastRoomUserSeqMessage', cat(b(1, common), b(2, row), i(3, 18), b(4, '热度 2.1万'), b(5, row), i(6, '9007199254740993999'), i(7, '12345678901234567890'), b(8, '12.3万'), b(9, '18'), b(10, '28'), b(11, '520')));
  assert.equal(event.type, 'room-audience'); assert.equal(event.onlineCount, 18); assert.equal(event.popularity, '9007199254740993999');
  assert.equal(event.cumulativeUsers, '12345678901234567890'); assert.equal(event.onlineDisplay, '18');
  assert.equal(event.ranks[0].user.id, uid); assert.equal(event.ranks[0].score, 450); assert.equal(event.seats[0].rank, 1);
});
test('Social 与 Fansclub 保留原 action、用户和描述，不把未知动作猜成关注', () => {
  const follow = decodeMessage('WebcastSocialMessage', cat(b(1, common), b(2, user), i(4, 1), i(6, 950)));
  assert.equal(follow.type, 'social'); assert.equal(follow.actionName, 'follow'); assert.equal(follow.user.id, uid); assert.equal(follow.followCount, 950);
  const unknown = decodeMessage('WebcastSocialMessage', i(4, 99)); assert.equal(unknown.actionName, ''); assert.equal(unknown.action, 99);
  const club = decodeMessage('WebcastFansclubMessage', cat(b(1, common), i(2, 2), b(3, '青山加入粉丝团'), b(4, user)));
  assert.equal(club.type, 'fansclub'); assert.equal(club.actionName, 'join'); assert.equal(club.description, '青山加入粉丝团'); assert.equal(club.user.id, uid);
});
test('表情弹幕、醒目留言和房间公告按各自 schema 提取文字与状态', () => {
  const text = cat(b(2, '表情内容'), b(4, b(3, '✨')), b(4, b(3, '你好')));
  const emoji = decodeMessage('WebcastEmojiChatMessage', cat(b(1, common), b(2, user), i(3, '9007199254740993999'), b(4, text), b(5, 'fallback')));
  assert.equal(emoji.type, 'emoji-chat'); assert.equal(emoji.text, '✨你好'); assert.equal(emoji.emojiId, '9007199254740993999');
  const screen = decodeMessage('WebcastScreenChatMessage', cat(b(1, common), b(2, user), b(3, '醒目留言'), i(12, '9007199254740993999')));
  assert.equal(screen.type, 'screen-chat'); assert.equal(screen.text, '醒目留言'); assert.equal(screen.priorityScore, '9007199254740993999');
  const variant = decodeMessage('WebcastScreenChatMessage', cat(i(3, 1791990000), b(4, '字段布局变体'), b(32, cat(b(2, 'rtf fallback')))));
  assert.equal(variant.text, '字段布局变体'); assert.equal(variant.eventTime, '1791990000');
  const privilege = decodeMessage('WebcastPrivilegeScreenChatMessage', cat(b(2, user), b(3, '特权留言')));
  assert.equal(privilege.privilege, true); assert.equal(privilege.text, '特权留言');
  const notice = decodeMessage('WebcastRoomMessage', cat(b(1, common), b(2, '欢迎来到直播间'), i(4, 3), i(7, 1), i(9, 5000), b(10, 'recommend')));
  assert.equal(notice.type, 'room-notice'); assert.equal(notice.welcome, true); assert.equal(notice.durationMs, 5000);
});
test('榜单消息解出有限榜单，通知和 WRDS 只保留确认过的外层字段', () => {
  const rank = decodeMessage('WebcastRoomRankMessage', cat(b(1, common), b(2, cat(b(1, user), b(2, '520 分'), i(3, 1)))));
  assert.equal(rank.type, 'room-rank'); assert.equal(rank.ranks[0].score, '520 分'); assert.equal(rank.ranks[0].user.id, uid);
  const update = decodeMessage('WebcastRankUpdateMessage', cat(b(1, common), b(2, cat(i(1, 4), i(2, 2), b(3, cat(b(2, '周榜升至第2名'), b(4, cat(b(1, user))))), i(6, 10))), i(3, 1), i(5, 9)));
  assert.equal(update.type, 'rank-update'); assert.equal(update.updates[0].ownerRank, 2); assert.equal(update.updates[0].text, '周榜升至第2名');
  const notify = decodeMessage('WebcastRoomNotifyMessage', cat(b(1, common), b(2, 'sslocal://webcast_room'), i(3, 3), b(4, 'live_gift_notify'), b(6, Buffer.from([10, 3, 1, 2, 3]))));
  assert.equal(notify.notifySubType, 'live_gift_notify'); assert.equal(notify.extraBytes, 5); assert.equal('notifyExtra' in notify, false);
  const notifyVariant = decodeMessage('WebcastRoomNotifyMessage', cat(b(2, Buffer.from([0,1,2,3])), i(3, 1), b(4, 'live_gift_notify'), b(5, user)));
  assert.equal(notifyVariant.scheme, ''); assert.equal(notifyVariant.extraBytes, 4); assert.equal('user' in notifyVariant, false);
  const sync = decodeMessage('WebcastRoomDataSyncMessage', cat(b(1, common), i(2, '7777777777777777777'), b(3, 'InteractEffectSyncData'), b(4, 'trace'), b(5, Buffer.alloc(128)), b(6, 'request')));
  assert.equal(sync.type, 'room-sync'); assert.equal(sync.syncType, 'InteractEffectSyncData'); assert.equal(sync.syncDataBytes, 128); assert.equal('syncData' in sync, false);
});
test('语音转写隐藏媒体 URL，置顶评论保留用户和显示区间', () => {
  const audio=decodeMessage('WebcastAudioChatMessage',cat(b(1,common),b(2,user),b(3,'谢谢主播'),b(4,'https://media.example/audio'),i(5,3963)));
  assert.equal(audio.type,'audio-chat'); assert.equal(audio.text,'谢谢主播'); assert.equal(audio.hasAudio,true); assert.equal(audio.durationRaw,'3963');
  assert.equal('audioUrl' in audio,false); assert.equal(JSON.stringify(audio).includes('media.example'),false);
  const author=cat(i(1,uid),b(3,'高亮用户'));
  const highlight=decodeMessage('WebcastHighlightCommentMessage',cat(b(1,common),i(2,'9876543210987654321'),i(3,'7777777777777777777'),i(4,1791990000),b(7,'置顶评论内容'),b(8,author),i(10,100),i(11,500)));
  assert.equal(highlight.type,'highlight-comment'); assert.equal(highlight.user.id,uid); assert.equal(highlight.user.name,'高亮用户');
  assert.equal(highlight.displayEnd,'500');
});
test('轻量礼物和商品变化保留价格/商品 ID，不解未知 JSON', () => {
  const light=decodeMessage('WebcastLightGiftMessage',cat(b(1,common),i(2,1),i(3,1),i(5,uid),b(7,cat(i(1,'9007199254740993999'),i(3,0))),i(9,4),i(10,3),b(13,Buffer.from([1,2,3]))));
  assert.equal(light.type,'light-gift'); assert.equal(light.giftId,'9007199254740993999'); assert.equal(light.count,3); assert.equal(light.unitValue,0);
  const product=decodeMessage('WebcastProductChangeMessage',cat(b(1,common),i(2,1791990000000),b(3,'商品已更新'),b(4,cat(i(1,'9007199254740993999'),i(2,2),i(3,123),i(3,456),i(4,1))),i(5,2),b(8,cat(i(1,7),b(2,'礼物'),i(3,123),i(3,456),b(4,'live')))));
  assert.equal(product.type,'product-change'); assert.equal(product.products[0].promotionId,'9007199254740993999');
  assert.deepEqual(product.products[0].targetFlashIds,['123','456']); assert.deepEqual(product.categories[0].promotionIds,['123','456']);
});
test('购物、横幅和榜单奖励消息保留可解释外层字段且不带横幅 payload', () => {
  const shopping=decodeMessage('WebcastLiveShoppingMessage',cat(b(1,common),i(2,3),i(4,'9007199254740993999')));
  assert.equal(shopping.promotionId,'9007199254740993999');
  const banner=decodeMessage('WebcastInRoomBannerMessage',cat(b(1,common),b(2,Buffer.from([1,2,3,4])),i(3,2)));
  assert.equal(banner.bannerType,2); assert.equal(banner.bannerBytes,4); assert.equal('bannerData' in banner,false);
  const award=decodeMessage('WebcastRanklistAwardMessage',cat(b(1,common),i(2,3),i(3,1),i(4,12),i(9,20)));
  assert.equal(award.type,'rank-award'); assert.equal(award.rank,3); assert.equal(award.value,20);
});
test('红包预览使用非标准 common 字段位置，抽奖类信号保留消息种类', () => {
  const packet=cat(b(1,'rp-123'),i(2,1791990000),i(3,1791990300),i(4,5),i(5,2),b(6,'Diamond'),b(7,'https://cdn.example/icon'),b(8,'发放中'),i(9,250),i(11,50));
  const red=decodeMessage('WebcastPreviewCjRpMessage',cat(b(1,packet),b(2,common)));
  assert.equal(red.type,'red-packet'); assert.equal(red.id,'9876543210123456789'); assert.equal(red.count,5);
  assert.equal(red.totalAmount,250); assert.equal('iconUrl' in red,false);
  const lottery=decodeMessage('WebcastLotteryDrawResultEventMessage',b(1,common));
  assert.equal(lottery.type,'activity-signal'); assert.equal(lottery.activityKind,'lottery-result');
  const prize=decodeMessage('WebcastPrizeNoticeMessage',cat(b(1,common),i(2,7424),i(6,3),i(8,35)));
  assert.equal(prize.activityKind,'prize-notice'); assert.equal(prize.prizeType,7424);
});
test('弹幕点赞、粉丝票总量和小游戏状态保留有限结构字段', () => {
  const countInfo=cat(i(1,41),i(2,1791990000));
  const chatLikes=decodeMessage('WebcastChatLikeMessage',cat(b(1,common),b(2,cat(i(1,'12345678901234567890'),b(2,countInfo)))));
  assert.equal(chatLikes.type,'chat-like'); assert.equal(chatLikes.entries[0].messageId,'12345678901234567890'); assert.equal(chatLikes.entries[0].count,'41');
  const ticket=decodeMessage('WebcastUpdateFanTicketMessage',cat(b(1,common),b(2,'1.2万'),i(3,'9007199254740993999'),i(4,1)));
  assert.equal(ticket.type,'fan-ticket'); assert.equal(ticket.total,'9007199254740993999'); assert.equal(ticket.forceUpdate,true);
  const game=decodeMessage('WebcastProfitGameStatusMessage',cat(b(1,common),i(2,2),b(10,'{"title":"游戏连屏中"}'),b(18,cat(b(1,'link_game_id'),b(2,'game-12')))));
  assert.equal(game.type,'room-activity-state'); assert.equal(game.title,'游戏连屏中');
  assert.deepEqual(game.properties,[{key:'link_game_id',value:'game-12'}]);
  const sort=decodeMessage('WebcastGiftSortMessage',cat(b(1,common),i(2,3),b(4,'anchor_exhibition')));
  assert.equal(sort.type,'gift-panel-state'); assert.equal(sort.scene,'anchor_exhibition');
  const nestedSort=decodeMessage('WebcastGiftSortMessage',cat(i(2,3),b(4,cat(b(1,'anchor_exhibition'),i(7,1)))));
  assert.equal(nestedSort.scene,'anchor_exhibition');
  const indicator=decodeMessage('WebcastRoomIndicatorMessage',cat(b(1,common),i(2,9),i(3,3),b(4,Buffer.alloc(32))));
  assert.equal(indicator.type,'room-indicator'); assert.equal(indicator.indicatorType,9); assert.equal(indicator.dataBytes,32);
});
test('新增礼物目录候选与 PK 卡片事件按白名单字段解码', () => {
  const menu = decodeMessage('GroupLiveContainerChangeMessage', cat(
    b(1, common),
    b(1, cat(i(1, 6), b(3, JSON.stringify({data:[
      {id:77,name:'热气球',price:520,icon:'https://cdn.example/gift.png',privateField:'discard'},
      {gift_id:88,name:'鲜花',diamond_count:10,extra:{secret:true}},
      {id:0,name:'无效礼物'}
    ]})), b(4, 'gift-panel')))
  ));
  assert.equal(menu.length, 1); assert.equal(menu[0].type, 'gift-catalog');
  assert.deepEqual(menu[0].items, [
    {id:'77',name:'热气球',price:520,icon:'https://cdn.example/gift.png'},
    {id:'88',name:'鲜花',price:10}
  ]);
  assert.equal(JSON.stringify(menu).includes('privateField'), false);

  const bonus = decodeMessage('WebcastBattleBonusMessage', cat(b(1, common), b(2, cat(
    i(1, uid), b(2, 'MVP'), b(3, cat(i(4, 9), i(6, 520), i(9, 2), b(10, 'PK 宝箱')))
  )), b(3, cat(i(1, 520), b(2, user), i(3, 520)))));
  assert.equal(bonus.type, 'battle-bonus'); assert.equal(bonus.mvp.user.name, 'MVP');
  assert.equal(bonus.mvp.prop.name, 'PK 宝箱'); assert.equal(bonus.players[0].diamondCount, '520');

  const property = decodeMessage('WebcastBattlePropertyMessage', cat(b(1, common), b(2, cat(
    b(1, '700'), b(2, cat(b(1, cat(i(4, 9), i(6, 520), i(9, 2), b(10, 'PK 宝箱'))), i(2, 1000), i(3, 30000)))
  ))));
  assert.equal(property.type, 'battle-property'); assert.equal(property.rooms[0].properties[0].durationMs, '30000');

  const honor = decodeMessage('BattleSeasonHonorMessage', cat(b(1, common), b(4, cat(i(1, 2), b(2, '赛季荣誉'), i(5, 3), i(6, 8), i(13, 1), b(9, user)))));
  assert.equal(honor.type, 'battle-season-honor'); assert.equal(honor.honors[0].topUser.name, '青山');
  const popular = decodeMessage('PopularCardMessage', cat(b(1, common), b(2, cat(i(1, 1), i(2, '9007199254740993999'), i(3, '9007199254740994999'), i(4, 12)))));
  assert.equal(popular.type, 'popular-card'); assert.equal(popular.enterNumber, 12);
});
test('粉丝团人数、团播成员和房票只保留明确字段', () => {
  const stats=decodeMessage('FansclubStatisticsMessage',cat(b(1,common),b(2,'星光团'),i(3,'12345678901234567890')));
  assert.equal(stats.type,'fansclub-statistics'); assert.equal(stats.name,'星光团'); assert.equal(stats.fansCount,'12345678901234567890');
  const member=cat(b(1,user),i(2,'9007199254740993999'),i(3,1),b(4,cat(b(1,'extra'))));
  const members=decodeMessage('GroupLiveMemberChangeMessage',cat(b(1,common),b(2,member)));
  assert.equal(members.type,'group-live-members'); assert.equal(members.members[0].user.id,uid);
  assert.equal(members.members[0].score,'9007199254740993999'); assert.equal(members.members[0].showScore,true);
  assert.equal(JSON.stringify(members).includes('extra_info'),false);
  const income=cat(b(1,user),i(2,1000),i(3,50),i(4,800),i(5,150),i(7,2));
  const incomes=decodeMessage('GroupLiveIncomeChangeMessage',cat(b(1,common),b(2,income),i(3,1791990000)));
  assert.equal(incomes.type,'group-live-income'); assert.equal(incomes.members[0].income,'1000');
  assert.equal(incomes.members[0].giftIncome,'800'); assert.equal(incomes.members[0].starGuardActivatedUsers,'2');
  const ticket=decodeMessage('RoomTicketMessage',cat(b(1,common),i(2,1),i(3,3600),i(4,'1234567890123'),b(6,'https://example.invalid/ticket?token=omit'),i(9,uid),i(11,1)));
  assert.equal(ticket.type,'room-ticket'); assert.equal(ticket.ticketId,'1234567890123');
  assert.equal(ticket.ownerId,uid); assert.equal(ticket.bringProductSwitchStatus,1);
  assert.equal(JSON.stringify(ticket).includes('token'),false);
});
test('连麦席位、嘉宾连麦和粉丝团播报按当前网页 proto 解码', () => {
  const position=cat(i(1,2),i(2,1),b(3,'嘉宾甲'),i(4,1),i(5,2),i(6,8),i(7,1),i(8,0));
  const positions=decodeMessage('LinkMicPositionMessage',cat(b(1,common),i(2,3),b(3,cat(b(1,position)))));
  assert.equal(positions.type,'linkmic-positions'); assert.equal(positions.messageType,3);
  assert.equal(positions.positions[0].activeName,'嘉宾甲'); assert.equal(positions.positions[0].masked,true);
  const linkedUser=cat(b(1,user),i(2,520),i(3,1),i(4,2),b(5,'520分'),i(7,1),b(8,'internal-link-id'));
  const channel=cat(i(1,123),b(2,linkedUser),b(3,user),i(4,1000),i(5,180),i(6,1791990000),i(9,2),b(10,'1000分'));
  const guest=decodeMessage('LinkmicGuestLinkMessage',cat(b(1,common),i(2,54),b(54,cat(b(1,channel),i(3,1791990000)))));
  assert.equal(guest.type,'guest-link-state'); assert.equal(guest.channelId,'123');
  assert.equal(guest.linkedUsers[0].user.id,uid); assert.equal(guest.channelUsers[0].name,'青山');
  assert.equal(guest.scoreDisplay,'1000分'); assert.equal(JSON.stringify(guest).includes('internal-link-id'),false);
  const fansclub=decodeMessage('FansclubV1PushMessage',cat(b(1,common),b(2,'青山点亮粉丝牌'),b(6,'查看粉丝团'),i(7,2),i(8,3000),b(12,'room_card')));
  assert.equal(fansclub.type,'fansclub-push'); assert.equal(fansclub.content,'青山点亮粉丝牌');
  assert.equal(fansclub.actionType,'2'); assert.equal(fansclub.displayDuration,'3000');
});
test('WRDS 仅对已知 sync type 解码连麦、抽奖和频道开关', () => {
  const linked=cat(b(1,user),i(4,2),i(5,1),i(6,4),i(7,1),i(10,3));
  const position=cat(i(1,4),i(2,1),b(3,'主播嘉宾'),i(5,2));
  const roomLink=decodeMessage('WebcastRoomDataSyncMessage',cat(b(1,common),b(3,'RoomLinkMicSyncData'),b(5,cat(
    b(1,linked),b(5,position),i(8,'9007199254740993999')
  ))));
  assert.equal(roomLink.type,'room-sync'); assert.equal(roomLink.syncDetails.users[0].user.id,uid);
  assert.equal(roomLink.syncDetails.users[0].position,4); assert.equal(roomLink.syncDetails.positions[0].activeName,'主播嘉宾');
  assert.equal(roomLink.syncDetails.version,'9007199254740993999');
  const lottery=decodeMessage('RoomDataSyncMessage',cat(b(1,common),b(3,'LotteryInfoSyncData'),b(5,cat(
    i(1,'9007199254740993999'),i(2,5),i(3,100),i(5,2),i(6,4),i(7,1791990000),i(8,1791990300),i(9,1),i(11,1)
  ))));
  assert.equal(lottery.syncDetails.candidateCount,'100'); assert.equal(lottery.syncDetails.prizeCount,'4');
  assert.equal(lottery.syncDetails.dilutionActive,true);
  const settings=decodeMessage('RoomDataSyncMessage',cat(b(3,'RoomChannelSettingsSyncData'),b(5,cat(i(1,44),i(2,1),i(3,1),i(4,0)))));
  assert.equal(settings.syncDetails.channelId,'44'); assert.equal(settings.syncDetails.entryApprovalEnabled,true);
  const sticker=cat(i(1,901),i(2,1),i(3,1));
  const stickers=cat(b(1,sticker));
  const stickerEntry=cat(b(1,'spring'),b(2,stickers));
  const effects=decodeMessage('RoomDataSyncMessage',cat(b(3,'InteractEffectSyncData'),b(5,cat(b(1,'900'),b(2,'901'),b(3,stickerEntry)))));
  assert.equal(effects.syncDetails.anchorId,'900'); assert.equal(effects.syncDetails.stickers[0].effectId,'901');
  assert.equal(effects.syncDetails.stickers[0].enabled,true); assert.equal(effects.syncDetails.stickers[0].rendering,true);
  const unknown=decodeMessage('RoomDataSyncMessage',cat(b(3,'UnknownSyncData'),b(5,Buffer.from([10,2,1,2]))));
  assert.equal(unknown.syncDetails,null); assert.equal(unknown.syncDataBytes,4);
  const malformed=decodeMessage('RoomDataSyncMessage',cat(b(3,'LotteryInfoSyncData'),b(5,Buffer.from([0]))));
  assert.equal(malformed.type,'room-sync'); assert.equal(malformed.syncDetails,null);
});
test('gzip PushFrame 按协议正确解包，忽略未知消息类型', async () => {
  const chat = cat(b(1, common), b(2, user), b(3, '你好'));
  const message = cat(b(1, 'WebcastChatMessage'), b(2, chat), i(3, '1234567890123456789'));
  const response = cat(b(1, message), b(1, cat(b(1, 'WebcastUnknownMessage'), b(2, Buffer.from([0])))));
  const frame = cat(b(6, 'gzip'), b(7, 'msg'), b(8, gzipSync(response)));
  const unknown = [], events = await decodeFrame(frame, () => {}, method => unknown.push(method));
  assert.equal(events.length, 1); assert.equal(events[0].text, '你好'); assert.equal(events[0].id, '1234567890123456789');
  assert.deepEqual(unknown, ['WebcastUnknownMessage']);
});
test('decodeFrame 为未知和已知消息提供可持久化索引', async () => {
  const rawMessages = [
    cat(b(1, 'WebcastChatMessage'), b(2, cat(b(1, common), b(3, '保留内容'))), i(3, '17')),
    cat(b(1, 'WebcastMysteryMessage'), b(2, Buffer.from([8, 1])), i(3, '18'))
  ];
  const frame = cat(b(7, 'msg'), b(8, cat(...rawMessages.map(message => b(1, message)))));
  const indexed = [], events = await decodeFrame(frame, () => {}, () => {}, item => indexed.push(item));
  assert.equal(events[0].text, '保留内容');
  assert.deepEqual(indexed, [
    {method:'WebcastChatMessage',messageId:'17',decodedTypes:['chat']},
    {method:'WebcastMysteryMessage',messageId:'18',decodedTypes:[]}
  ]);
});
test('gzip 魔数可用于缺失 encoding 字段的帧', async () => {
  const response = b(1, cat(b(1, 'WebcastControlMessage'), b(2, cat(b(1, common), i(2, 3)))));
  const events = await decodeFrame(cat(b(7, 'msg'), b(8, gzipSync(response)))); assert.equal(events[0].type, 'end');
});
test('损坏帧明确报错、非二进制消息不参与解析', async () => {
  assert.throws(() => wire(Buffer.from([0]))); assert.throws(() => wire(Buffer.from([10, 5, 1]))); assert.throws(() => wire(Buffer.alloc(8 * 1024 * 1024 + 1)));
  assert.deepEqual(await decodeFrame('{"other":"business"}'), []);
});
test('protobuf tag 在转换为 Number 前校验合法字段编号范围', () => {
  const maxFieldTag = (0x1fffffffn << 3n) | 0n;
  assert.equal(wire(Buffer.concat([varint(maxFieldTag), varint(1)])).get(0x1fffffff)[0], 1n);
  const tooLarge = (0x20000000n << 3n) | 0n;
  assert.throws(() => wire(varint(tooLarge)), /字段编号超出范围/);
});
test('protobuf reader 安全跳过嵌套 legacy groups 并拒绝不匹配结束标记', () => {
  const group = cat(varint(1*8+3), i(2, 123), varint(3*8+3), b(4,'opaque'), varint(3*8+4), varint(1*8+4), i(5, 9));
  assert.equal(wire(group).get(5)[0], 9n);
  assert.throws(() => wire(cat(varint(1*8+3), varint(2*8+4))), /结束字段不匹配/);
});
test('非进场 Member action 被忽略，非下播 Control 不触发暂停', () => {
  assert.equal(decodeMessage('WebcastMemberMessage', cat(b(2, user), i(10, 5))), null);
  assert.equal(decodeMessage('WebcastControlMessage', i(2, 1)), null);
});

test('PK 单次热度更新不把 from_user_id 或 hot_score 当成累计比分', () => {
  const body = cat(
    b(1, common), i(2, 1), i(3, 1128), i(4, '7777777777777777777'),
    i(5, '9007199254740993999'), i(6, 3210), i(7, '9007199254740993888'),
    i(8, 3), i(9, 2), b(10, 'linker_3210_123'), i(11, 1791990000123)
  );
  assert.equal(decodeMessage('WebcastLinkmicPlayModeUpdateScoreMessage', body, '987'), null);
});

const score = (anchor, value, extra = Buffer.alloc(0)) => cat(i(2, anchor), ...(value === null ? [] : [i(1, value)]), extra);
const participant = (anchor, name, room) => cat(i(1, anchor), b(2, cat(b(1, cat(i(1, anchor), b(2, name))), b(13, room))));
test('LinkMicMethod 第 17 字段读取双方总分，保留 UID 精度且不以消息 ID 代替 battle_id', () => {
  const body = cat(b(1, common), b(17, score(12345, 65249, b(7, '65249'))), b(17, score(uid, 0)), i(104, '9007199254740993999'));
  const event = decodeMessage('WebcastLinkMicMethod', body, '987');
  assert.equal(event.type, 'pk-score');
  assert.equal(event.battleId, '9007199254740993999');
  assert.equal(event.roomId, '7777777777777777777');
  assert.deepEqual(event.scores, [{anchorId:'12345',score:65249}, {anchorId:uid,score:0}]);
  const noId = decodeMessage('WebcastLinkMicMethod', b(17, score(uid, 3210)), '999');
  assert.equal(noId.battleId, '');
  assert.equal(decodeMessage('WebcastLinkMicMethod', cat(body, b(114, 'battle-string'))).battleId, 'battle-string');
});
test('比分字段兼容纯数字显示文本、默认零和模糊展示，不猜测模糊文本或越界数值', () => {
  const event = decodeMessage('WebcastLinkMicMethod', cat(
    b(17, score(1, 1273262, b(7, '100万+'))),
    b(17, score(2, null, b(7, '65249'))),
    b(17, score(3, null)),
    b(17, score(4, null, b(7, '100万+'))),
    b(17, score(5, null, b(4, '领先46161'))),
    b(17, score(6, uid)),
    b(17, score(7, null, b(7, uid))),
    b(17, i(1, 30))
  ));
  assert.deepEqual(event.scores, [{anchorId:'1',score:1273262},{anchorId:'2',score:65249},{anchorId:'3',score:0}]);
});
test('PK 开始和结束按 settings、主播映射和 BattleScore 字段解码', () => {
  const settings = cat(i(2, '9007199254740993333'), i(3, 1800000000000), i(4, 300));
  const start = decodeMessage('WebcastLinkMicBattleMethod', cat(b(1, common), b(2, settings), b(6, participant(uid, '己方', 'room-1')), b(6, participant(12345, '对方', 'room-2'))));
  assert.equal(start.type, 'pk-start');
  assert.equal(start.battleId, '9007199254740993333');
  assert.equal(start.durationMs, 300000);
  assert.equal(start.endsAt, 1800000300000);
  assert.deepEqual(start.participants, [{anchorId:uid,name:'己方',roomId:'room-1'},{anchorId:'12345',name:'对方',roomId:'room-2'}]);
  const end = decodeMessage('WebcastLinkMicBattleFinishMethod', cat(b(2, settings),
    b(4, score(uid, 1273262, cat(i(11, 1), b(12, '100万+'), b(15, '100万+'), i(17, 1)))),
    b(4, score(12345, 65249, cat(i(11, 1), b(12, '65249'), b(15, '65249')))),
    b(12, participant(uid, '己方', 'room-1'))));
  assert.equal(end.type, 'pk-end');
  assert.deepEqual(end.scores, [{anchorId:uid,score:1273262},{anchorId:'12345',score:65249}]);
  assert.equal(end.participants[0].anchorId, uid);
});
test('Battle 开始消息完整保留三人及四人 PK 的所有参战主播', () => {
  const settings=cat(i(2,987654),i(3,1800000000000),i(4,300));
  const start=decodeMessage('WebcastLinkMicBattleMethod',cat(b(2,settings),
    b(6,participant(uid,'己方','room-self')),
    b(6,participant(21,'主播乙','room-b')),
    b(6,participant(22,'主播丙','room-c')),
    b(6,participant(23,'主播丁','room-d'))));
  assert.equal(start.participants.length,4);
  assert.deepEqual(start.participants.map(item=>item.anchorId),[uid,'21','22','23']);
});
test('普通连麦、贡献榜和未知 Battle 更新不能建立虚假 PK', () => {
  const body = cat(b(1, common), i(2, 1), i(3, 300), i(4, 10000));
  for (const method of ['WebcastLinkMicMethod','WebcastLinkMicArmies','WebcastBattleUpdateMessage','WebcastLinkMicBattleMethod']) assert.equal(decodeMessage(method, body), null);
});
test('同一 gzip 帧中的弹幕与累计 PK 比分都能解码', async () => {
  const response = cat(
    b(1, cat(b(1, 'WebcastChatMessage'), b(2, cat(b(1, common), b(2, user), b(3, '加油'))), i(3, 101))),
    b(1, cat(b(1, 'WebcastLinkMicMethod'), b(2, cat(b(1, common), b(17, score(uid, 3210)))), i(3, 102)))
  );
  const events = await decodeFrame(cat(b(6, 'gzip'), b(7, 'msg'), b(8, gzipSync(response))));
  assert.deepEqual(events.map(event => event.type), ['chat','pk-score']);
  assert.equal(events[1].scores[0].score, 3210);
});

test('显式零 groupId 的独立礼物不共用连击组，GiftStruct 字段 11 正确判断连击', () => {
  const single = cat(i(5, 77), i(11, 2), i(12, 50), b(16, '星星'));
  const body = cat(i(2, 77), i(5, 1), b(7, user), i(11, 0), b(15, single));
  const a = decodeMessage('WebcastGiftMessage', body, '1001'), c = decodeMessage('WebcastGiftMessage', body, '1002');
  assert.equal(a.groupId, 'single:1001'); assert.notEqual(a.groupId, c.groupId); assert.equal(a.final, true);
  const combo = decodeMessage('WebcastGiftMessage', cat(i(5, 2), i(9, 0), i(11, 88), b(15, cat(i(10, 0), i(11, 1)))));
  assert.equal(combo.final, false); assert.equal(combo.groupId, '88');
  assert.equal(decodeMessage('WebcastGiftMessage', cat(i(44, 7), b(15, single)), '1003').count, 7);
});

test('同一帧一条损坏消息不影响前后礼物，并保留解析错误诊断', async () => {
  const good = id => b(1, cat(b(1, 'WebcastGiftMessage'), b(2, cat(i(5, 3), b(7, user))), i(3, id)));
  const bad = b(1, cat(b(1, 'WebcastChatMessage'), b(2, Buffer.from([10, 5, 1]))));
  const errors = [], events = await decodeFrame(b(8, cat(good(101), bad, good(102))), error => errors.push(error));
  assert.deepEqual(events.map(e => e.id), ['101', '102']); assert.equal(errors.length, 1);
});

test('PK 比分携带已核对的版本、贡献人数和原始 buff 比例，开始时间恢复倒计时', () => {
  const body = cat(b(17, score(uid, 3210, cat(i(15, 150), i(16, 28), i(17, '9007199254740993999')))), i(26, 1800000000000), i(16, 300), b(82, 'score-log'));
  const event = decodeMessage('WebcastLinkMicMethod', body);
  assert.deepEqual(event.scores, [{anchorId:uid,score:3210,buffScoreRatio:150,contributorCount:28,scoreVersion:'9007199254740993999'}]);
  assert.equal(event.endsAt, 1800000300000); assert.equal(event.scoreUpdateId, 'score-log');
  const sync = decodeMessage('WebcastBattleStateSyncMessage', cat(b(2, cat(i(2, 42), i(3, 1800000000000), i(4, 300))), i(5, 12)));
  assert.equal(sync.type, 'pk-score'); assert.deepEqual(sync.scores, []); assert.equal(sync.endsAt, event.endsAt); assert.equal(sync.scoreVersion, '12');
});
const rankUser = (id, value, rank) => cat(b(1, cat(i(1, id), b(3, `观众${rank}`))), i(2, value), i(3, rank));
const v2Anchor = (anchor, ranks, extra = Buffer.alloc(0)) => b(1, cat(b(1, anchor), b(2, cat(...ranks.map(row => b(1, row)), extra))));
const v2Settings = cat(i(1, 42), i(2, 1800000000000), i(3, 300));
test('Armies v2 贡献榜按主播 UID 归属，data settings 独立字段恢复战局与时钟', () => {
  const ranks = cat(v2Anchor(uid, [rankUser('9007199254740993222', 1200, 1)], i(2, 100)), v2Anchor('12345', [rankUser('9007199254740993333', 500, 1)]), b(3, v2Settings));
  const events = decodeMessage('WebcastLinkMicArmiesMethod', cat(b(1, common), b(4, ranks)), '10001');
  assert.equal(events.length, 2); assert.equal(new Set(events.map(event => event.id)).size, 2);
  assert.equal(events[0].type, 'pk-contribution'); assert.equal(events[0].anchorId, uid); assert.equal(events[0].contributors[0].user.id, '9007199254740993222');
  assert.equal(events[0].contributors[0].score, 1200); assert.equal(events[0].contributors[0].rank, 1); assert.equal(events[0].contributorCount, 100);
  assert.equal(events[0].battleId, '42'); assert.equal(events[0].endsAt, 1800000300000); assert.equal(events[0].scores, undefined);
});
test('Armies 旧榜单读取显式主播 map，匿名列表和没有精确分值的用户不猜测', () => {
  const army = cat(i(1, '9007199254740993222'), i(2, 1234), b(3, '支持者'));
  const mapped = b(2, cat(i(1, uid), b(2, b(1, army))));
  const events = decodeMessage('WebcastLinkMicArmiesMethod', cat(b(1, common), mapped));
  assert.equal(events[0].anchorId, uid); assert.equal(events[0].contributors[0].score, 1234);
  assert.equal(decodeMessage('WebcastLinkMicArmiesMethod', b(3, b(1, army))), null);
  assert.equal(decodeMessage('WebcastLinkMicArmiesMethod', b(4, v2Anchor(uid, [b(1, user)]))), null);
});
test('LinkMicMethod 中贡献与总分分别交付，贡献分不得累加替代主播比分', async () => {
  const contributors = b(22, cat(i(1, uid), b(2, b(1, cat(i(1, 100), i(2, 1), i(3, '9007199254740993222'), b(4, user))))));
  const body = cat(b(17, score(uid, 3210)), contributors, i(104, 42));
  const events = decodeMessage('WebcastLinkMicMethod', body, '1002');
  assert.deepEqual(events.map(event => event.type), ['pk-score', 'pk-contribution']);
  assert.equal(events[0].scores[0].score, 3210); assert.equal(events[1].contributors[0].score, 100); assert.notEqual(events[0].id, events[1].id);
  const good = b(1, cat(b(1, 'WebcastLinkMicMethod'), b(2, body), i(3, 1002)));
  const bad = b(1, cat(b(1, 'WebcastLinkMicArmiesMethod'), b(2, Buffer.from([10, 5, 1]))));
  const errors = [], decoded = await decodeFrame(b(8, cat(good, bad, good)), error => errors.push(error));
  assert.deepEqual(decoded.map(event => event.type), ['pk-score','pk-contribution','pk-score','pk-contribution']); assert.equal(errors.length, 1);
});
test('Armies 生效道具只提取官方毫秒窗口，不从未知 JSON 猜倍率或类型名', () => {
  const card = cat(i(1, 7), b(2, '{"multiplier":100}'), i(3, 1800000001000), i(4, 20000));
  const ranks = cat(v2Anchor(uid, [], b(3, cat(i(1, 7), b(2, card)))), b(3, v2Settings));
  const [event] = decodeMessage('WebcastLinkMicArmiesMethod', b(4, ranks), '10003');
  assert.equal(event.type, 'pk-effect'); assert.equal(event.effectType, 'card'); assert.equal(event.cardType, 7);
  assert.equal(event.startAt, 1800000001000); assert.equal(event.endAt, 1800000021000); assert.equal(event.multiplier, undefined);
});
