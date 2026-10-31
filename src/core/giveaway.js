export const GIVEAWAY_DEFAULTS = Object.freeze({prize:'直播周边',winners:1,durationSec:300,chatEnabled:true,keyword:'参与抽奖',giftEnabled:false,gifts:'小心心',giftMin:1});

const boundedText = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= limit;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
export const giftRules = config => config.gifts.split(/[,，、;；\n]/).map(value=>value.trim()).filter(Boolean);

export function validateGiveawayConfig(value) {
  if (!value || !boundedText(value.prize,100)) throw new Error('请填写奖品，最多 100 字');
  if (!integer(value.winners,1,1000)) throw new Error('中奖人数须为 1～1000 的整数');
  if (!integer(value.durationSec,1,86400)) throw new Error('倒计时须为 1～86400 秒的整数');
  if (typeof value.chatEnabled !== 'boolean' || typeof value.giftEnabled !== 'boolean' || !value.chatEnabled && !value.giftEnabled) throw new Error('请至少开启一种参与方式');
  if (value.chatEnabled && !boundedText(value.keyword,100)) throw new Error('请填写参与弹幕，最多 100 字');
  if (value.giftEnabled && (!boundedText(value.gifts,1000) || !giftRules(value).length)) throw new Error('请填写可参与的礼物名称或 ID');
  if (value.giftEnabled && !integer(value.giftMin,1,100000)) throw new Error('礼物数量须为 1～100000 的整数');
  return {prize:value.prize.trim(),winners:value.winners,durationSec:value.durationSec,chatEnabled:value.chatEnabled,
    keyword:String(value.keyword || '').trim(),giftEnabled:value.giftEnabled,gifts:String(value.gifts || '').trim(),giftMin:value.giftEnabled ? value.giftMin : 1};
}

// A round fixes its rules at creation; entrants always represent people, not tickets.
export function createGiveaway(config,{id,room,broadcastId='',now}) {
  config=validateGiveawayConfig(config);
  return {id,room,broadcastId,status:'running',startedAt:now,endsAt:now+config.durationSec*1000,closedAt:null,
    config,entrants:[],giftProgress:[],winnerIds:[],reason:''};
}

function eligibleEvent(round,event,now) {
  if (round.status !== 'running' || now >= round.endsAt || !['chat','gift'].includes(event?.type)) return false;
  if (round.broadcastId && event.roomId && event.roomId !== round.broadcastId) return false;
  const at=event.at ?? event.receivedAt ?? now;
  return Number.isFinite(at) && at >= round.startedAt && at < round.endsAt && at <= now;
}

function accumulateGift(round,event,userId) {
  if (!round.config.giftEnabled || event.source === 'dom' || !integer(event.count,1,1000000000)) return null;
  const matches=giftRules(round.config).some(rule=>rule === event.giftName || rule === event.giftId);
  const group=event.groupId || event.id;
  if (!matches || !group) return null;
  const key=JSON.stringify([userId,event.giftId || event.giftName,group]);
  const previous=round.giftProgress.find(row=>row.key===key);
  if (previous && previous.count >= event.count) return null;
  const progress=round.giftProgress.filter(row=>row.key!==key).concat({key,userId,count:event.count});
  return {progress,count:progress.filter(row=>row.userId===userId).reduce((sum,row)=>sum+row.count,0)};
}

export function enterGiveaway(round,event,now) {
  if (!eligibleEvent(round,event,now)) return round;
  const userId=String(event.user?.id || (event.user?.secUid ? `sec:${event.user.secUid}` : ''));
  if (!userId || userId==='0') return round;
  let updated=round,source,giftCount=0;
  if (event.type==='chat' && round.config.chatEnabled && typeof event.text==='string' && event.text.trim()===round.config.keyword) source='chat';
  if (event.type==='gift') {
    const gift=accumulateGift(round,event,userId);
    if (!gift) return round;
    updated={...round,giftProgress:gift.progress};giftCount=gift.count;
    if (giftCount >= round.config.giftMin) source='gift';
  }
  if (!source) return updated;
  const existing=updated.entrants.find(row=>row.userId===userId);
  if (existing?.sources.includes(source) && giftCount<=existing.giftCount) return updated;
  const entrant=existing ? {...existing,sources:[...new Set([...existing.sources,source])],giftCount:Math.max(existing.giftCount,giftCount)}
    : {userId,userName:String(event.user.name || userId).slice(0,100),sources:[source],enteredAt:now,giftCount};
  return {...updated,entrants:updated.entrants.filter(row=>row.userId!==userId).concat(entrant)};
}

export function secureRandomInt(max) {
  const range=0x100000000,limit=range-range%max,buffer=new Uint32Array(1);
  do { crypto.getRandomValues(buffer); } while (buffer[0]>=limit);
  return buffer[0]%max;
}

export function drawGiveaway(round,now,randomInt=secureRandomInt) {
  if (round.status!=='running' || now<round.endsAt) return round;
  const pool=round.entrants.map(row=>row.userId),count=Math.min(round.config.winners,pool.length);
  for(let index=0;index<count;index++) {
    const pick=index+randomInt(pool.length-index);
    [pool[index],pool[pick]]=[pool[pick],pool[index]];
  }
  return {...round,status:'drawn',closedAt:now,winnerIds:pool.slice(0,count),reason:pool.length ? '倒计时结束，已开奖' : '倒计时结束，无人参与'};
}

// Read storage once at the boundary. Corruption must never silently discard history.
export function parseGiveawayState(value,room) {
  if (value == null) return {version:1,rounds:[]};
  if (value.version!==1 || !Array.isArray(value.rounds)) throw new Error('抽奖记录格式无效，请保留原数据并检查存储');
  for(const round of value.rounds) {
    if (!round || !boundedText(round.id,100) || round.room!==room || !['running','drawn','cancelled'].includes(round.status)
      || !Number.isFinite(round.startedAt) || !Number.isFinite(round.endsAt) || round.endsAt<=round.startedAt
      || !Array.isArray(round.entrants) || !Array.isArray(round.giftProgress) || !Array.isArray(round.winnerIds)) throw new Error('抽奖轮次记录无效');
    validateGiveawayConfig(round.config);
    if (round.entrants.some(row=>!row || !boundedText(row.userId,200) || typeof row.userName!=='string' || !Array.isArray(row.sources)
      || !row.sources.length || row.sources.some(source=>!['chat','gift'].includes(source)) || !Number.isFinite(row.enteredAt) || !integer(row.giftCount,0,Number.MAX_SAFE_INTEGER))
      || new Set(round.entrants.map(row=>row.userId)).size!==round.entrants.length
      || round.giftProgress.some(row=>!row || typeof row.key!=='string' || typeof row.userId!=='string' || !integer(row.count,1,1000000000))
      || round.winnerIds.some(id=>!round.entrants.some(row=>row.userId===id)) || new Set(round.winnerIds).size!==round.winnerIds.length) throw new Error('抽奖参与记录无效');
  }
  if (value.rounds.filter(round=>round.status==='running').length>1 || new Set(value.rounds.map(round=>round.id)).size!==value.rounds.length) throw new Error('抽奖轮次状态冲突');
  return structuredClone(value);
}

export function giveawayAnnouncement(round) {
  if (!round || round.status!=='drawn') return '';
  const names=round.winnerIds.map(id=>round.entrants.find(row=>row.userId===id)?.userName || id);
  return names.length ? `【抽奖结果】${round.config.prize}，恭喜：${names.join('、')}。共 ${round.entrants.length} 人参与。` : `【抽奖结果】${round.config.prize}：本轮无人参与，未产生中奖者。`;
}

const csvCell = value => '"'+String(value ?? '').replace(/^[=+\-@\t\r\n]/,"'$&").replaceAll('"','""')+'"';
export function giveawayCSV(state) {
  const rows=[['轮次ID','直播间','直播场次','奖品','计划中奖人数','倒计时秒数','参与弹幕','参与礼物','礼物门槛','开始时间','截止时间','开奖时间','状态','参与人数','用户ID','昵称','参与方式','入池时间','指定礼物数量','结果']];
  for(const round of state.rounds) {
    const c=round.config;
    const base=[round.id,round.room,round.broadcastId,c.prize,c.winners,c.durationSec,c.chatEnabled ? c.keyword : '',c.giftEnabled ? c.gifts : '',c.giftEnabled ? c.giftMin : '',new Date(round.startedAt).toISOString(),new Date(round.endsAt).toISOString(),round.closedAt ? new Date(round.closedAt).toISOString() : '',{running:'进行中',drawn:'已开奖',cancelled:'已取消'}[round.status],round.entrants.length];
    if (!round.entrants.length) rows.push([...base,'','','','','','无人参与']);
    for(const row of round.entrants) rows.push([...base,row.userId,row.userName,row.sources.map(source=>source==='chat' ? '弹幕' : '礼物').join('、'),new Date(row.enteredAt).toISOString(),row.giftCount,round.winnerIds.includes(row.userId) ? '中奖' : round.status==='drawn' ? '未中奖' : round.status==='cancelled' ? '已取消' : '待开奖']);
  }
  return '\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
