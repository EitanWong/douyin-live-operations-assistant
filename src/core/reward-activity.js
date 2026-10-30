// A round is identified by the platform room ID and activity ID. A candidate
// count or toast cannot establish that the current account has participated.
const decimal = value => typeof value === 'string' && /^\d{1,20}$/.test(value) ? value : null;
const identifier = value => decimal(value) && BigInt(value) > 0n ? value : null;
const seconds = value => {
  const number = Number(value);
  return value !== '' && value != null && Number.isSafeInteger(number) && number > 0 && Number.isSafeInteger(number * 1000) ? number * 1000 : null;
};
const packetId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
const newerVersion = (next, previous) => previous == null || next != null && BigInt(next) > BigInt(previous);
const ordered = rows => [...rows].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0) || (b.deadline || 0) - (a.deadline || 0));

function lotteryEvent(event) {
  if (event.type === 'room-sync' && event.syncType === 'LotteryInfoSyncData' && event.syncDetails) {
    return {...event.syncDetails, kind:'lottery-sync'};
  }
  if (event.type === 'activity-signal' && ['lottery-start','lottery-candidate','lottery-result'].includes(event.activityKind)) {
    return {...event, kind:event.activityKind};
  }
  return null;
}
function mergeLottery(round, event, account) {
  for (const key of ['prizeCount','luckyCount','candidateCount']) {
    const value = decimal(event[key]); if (value != null) round[key] = value;
  }
  round.startedAt = seconds(event.startedAt) ?? round.startedAt;
  round.deadline = seconds(event.drawAt) ?? round.deadline;
  if (event.kind === 'lottery-start') round.conditions = Array.isArray(event.conditions) ? event.conditions.slice(0, 32) : [];
  if (event.kind === 'lottery-result') {
    round.drawn = true;
    round.reportedUserCount = Array.isArray(event.reportedUserIds) ? event.reportedUserIds.length : null;
  }
  if (event.kind !== 'lottery-candidate' || !account || event.userId !== account || typeof event.participateSuccess !== 'boolean') return;
  const version = decimal(event.version);
  if (version == null && round.participation !== 'unknown') return;
  if (!newerVersion(version, round.candidateVersion)) return;
  round.participation = event.participateSuccess ? 'confirmed' : 'rejected';
  round.candidateVersion = version;
}

export function rewardActivities(events, {roomId = '', account = ''} = {}) {
  const lotteries = new Map(), redPackets = new Map();
  if (!identifier(roomId) || !Array.isArray(events)) return {lotteries:[], redPackets:[]};
  for (const event of events.slice(-512)) {
    if (!event || event.roomId !== roomId) continue;
    const lottery = lotteryEvent(event), id = lottery && identifier(lottery.lotteryId);
    if (id) {
      let round = lotteries.get(id);
      if (!round) {
        round = {kind:'luckyBag', roomId, activityId:id, lotteryId:id, startedAt:null, deadline:null,
          prizeCount:null, luckyCount:null, candidateCount:null, conditions:[], participation:'unknown', candidateVersion:null, drawn:false};
        lotteries.set(id, round);
      }
      mergeLottery(round, lottery, account);
    }
    if (event.type === 'red-packet' && packetId(event.packetId)) {
      redPackets.set(event.packetId, {kind:'redPacket', roomId, activityId:event.packetId, packetId:event.packetId,
        startedAt:seconds(event.startTime), deadline:seconds(event.endTime), count:event.count ?? null, totalAmount:event.totalAmount ?? null});
    }
  }
  return {lotteries:ordered(lotteries.values()).slice(0, 32), redPackets:ordered(redPackets.values()).slice(0, 32)};
}

export function matchRewardActivity(activities, {kind, activityId, deadline}) {
  const rows = kind === 'luckyBag' ? activities.lotteries : activities.redPackets;
  if (activityId) return rows.find(row => row.activityId === activityId) || null;
  if (!Number.isFinite(deadline)) return null;
  const matches = rows.filter(row => row.deadline != null && Math.abs(row.deadline - deadline) < 10000);
  return matches.length === 1 ? matches[0] : null;
}

export function rewardReservation(activity) {
  return {key:`${activity.kind}:${activity.roomId}:${activity.activityId}`, roomId:activity.roomId,
    activityId:activity.activityId, deadline:activity.deadline};
}

export function rewardBlockReason(activity, now) {
  if (!activity) return '';
  const name = activity.kind === 'luckyBag' ? '福袋' : '红包';
  if (activity.drawn) return '福袋已开奖，等待下一轮';
  if (activity.deadline != null && activity.deadline <= now) return `${name}倒计时结束，等待结果`;
  if (activity.startedAt != null && activity.startedAt > now) return `${name}尚未开始，等待活动开始`;
  if (activity.participation === 'confirmed') return '服务器已确认福袋参与成功，等待开奖';
  if (activity.participation === 'rejected') return '服务器回执未确认成功，请在福袋页面检查参与条件';
  return '';
}
