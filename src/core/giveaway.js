export const GIVEAWAY_VERSION = 2;
export const GIVEAWAY_DEFAULTS = Object.freeze({prizes:Object.freeze([Object.freeze({name:'直播周边',count:1})]),weights:Object.freeze([]),anchorGuaranteed:false,feedbackEnabled:true,durationSec:300,chatEnabled:true,keyword:'参与抽奖',giftEnabled:false,gifts:'小心心',giftMin:1});

const boundedText = (value, limit) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= limit;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
export const giftRules = config => config.gifts.split(/[,，、;；\n]/).map(value=>value.trim()).filter(Boolean);
export const giveawaySlots = config => config.prizes.reduce((sum,prize)=>sum+prize.count,0);
export const giveawayPrizes = config => config.prizes.map(prize=>`${prize.name} ×${prize.count}`).join('、');
export const giveawayWeight = (config,userId) => config.weights.find(row=>row.userId===userId)?.weight ?? 1;
export const giveawayDrawRules = config => `${config.weights.length ? `按观众权重抽取（${config.weights.map(row=>`${row.userId} ×${row.weight}`).join('、')}；其他观众 ×1）` : '所有观众权重 ×1'}${config.anchorGuaranteed ? '；主播参与必中，占用首项奖品一个名额' : ''}`;

function validateWeights(weights=[]) {
  if(!Array.isArray(weights) || weights.length>100)throw new Error('最多为 100 位观众设置权重');
  for(const row of weights) {
    if(!row || typeof row.userId!=='string' || !/^(?:[1-9]\d{0,24}|sec:[\w-]{1,196})$/.test(row.userId))throw new Error('权重须填写观众 UID 或 sec: 标识，不能使用昵称');
    if(typeof row.weight!=='number' || !Number.isFinite(row.weight) || row.weight<0.01 || row.weight>1000 || Math.abs(row.weight*100-Math.round(row.weight*100))>1e-8)throw new Error('观众权重须为 0.01～1000，最多两位小数');
  }
  if(new Set(weights.map(row=>row.userId)).size!==weights.length)throw new Error('同一观众只能设置一个权重');
  return weights.map(row=>({userId:row.userId,weight:row.weight}));
}

function validatePrizes(value) {
  // Legacy command callers may still submit one prize; all internal rules use the array.
  const prizes=value?.prizes ?? (value?.prize!==undefined ? [{name:value.prize,count:value.winners}] : null);
  if(!Array.isArray(prizes) || !prizes.length || prizes.length>20)throw new Error('请设置 1～20 项奖品');
  for(const prize of prizes) {
    if(!prize || !boundedText(prize.name,100))throw new Error('请填写每项奖品名称，最多 100 字');
    if(!integer(prize.count,1,1000))throw new Error('每项奖品中奖人数须为 1～1000 的整数');
  }
  if(prizes.reduce((sum,prize)=>sum+prize.count,0)>1000)throw new Error('本轮总中奖人数不能超过 1000 人');
  return prizes.map(prize=>({name:prize.name.trim(),count:prize.count}));
}

export function validateGiveawayConfig(value) {
  const prizes=validatePrizes(value),weights=validateWeights(value.weights);
  if(value.anchorGuaranteed!==undefined && typeof value.anchorGuaranteed!=='boolean')throw new Error('主播必中设置无效');
  if(value.feedbackEnabled!==undefined && typeof value.feedbackEnabled!=='boolean')throw new Error('抽奖弹幕反馈设置无效');
  if (!integer(value.durationSec,1,86400)) throw new Error('倒计时须为 1～86400 秒的整数');
  if (typeof value.chatEnabled !== 'boolean' || typeof value.giftEnabled !== 'boolean' || !value.chatEnabled && !value.giftEnabled) throw new Error('请至少开启一种参与方式');
  if (value.chatEnabled && !boundedText(value.keyword,100)) throw new Error('请填写参与弹幕，最多 100 字');
  if (value.giftEnabled && (!boundedText(value.gifts,1000) || !giftRules(value).length)) throw new Error('请填写可参与的礼物名称或 ID');
  if (value.giftEnabled && !integer(value.giftMin,1,100000)) throw new Error('礼物数量须为 1～100000 的整数');
  return {prizes,weights,anchorGuaranteed:value.anchorGuaranteed ?? false,feedbackEnabled:value.feedbackEnabled ?? false,durationSec:value.durationSec,chatEnabled:value.chatEnabled,
    keyword:String(value.keyword || '').trim(),giftEnabled:value.giftEnabled,gifts:String(value.gifts || '').trim(),giftMin:value.giftEnabled ? value.giftMin : 1};
}

// A round fixes its rules at creation; entrants always represent people, not tickets.
export function createGiveaway(config,{id,room,broadcastId='',anchorId='',now}) {
  config=validateGiveawayConfig(config);
  if(config.anchorGuaranteed && !/^[1-9]\d{0,24}$/.test(anchorId))throw new Error('请先识别当前主播 UID，再开启主播参与必中');
  return {id,room,broadcastId,anchorId,status:'running',startedAt:now,endsAt:now+config.durationSec*1000,closedAt:null,
    config,entrants:[],giftProgress:[],awards:[],feedback:[],reason:''};
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
  if(!integer(max,1,Number.MAX_SAFE_INTEGER))throw new Error('随机抽取范围无效');
  const wide=max>0x100000000,range=wide ? 2**53 : 0x100000000,limit=range-range%max,buffer=new Uint32Array(wide ? 2 : 1);
  let sample;
  do {crypto.getRandomValues(buffer);sample=wide ? (buffer[0]&0x1fffff)*0x100000000+buffer[1] : buffer[0];} while(sample>=limit);
  return sample%max;
}

function drawWinners(round,randomInt) {
  const weights=new Map(round.config.weights.map(row=>[row.userId,Math.round(row.weight*100)]));
  const pool=round.entrants.map(row=>({userId:row.userId,weight:weights.get(row.userId) ?? 100})),winners=[];
  const host=round.config.anchorGuaranteed ? pool.findIndex(row=>row.userId===round.anchorId) : -1;
  if(host>=0)winners.push(pool.splice(host,1)[0].userId);
  const count=Math.min(giveawaySlots(round.config),round.entrants.length);
  while(winners.length<count) {
    const total=pool.reduce((sum,row)=>sum+row.weight,0);let ticket=randomInt(total),pick=0;
    while(ticket>=pool[pick].weight)ticket-=pool[pick++].weight;
    winners.push(pool.splice(pick,1)[0].userId);
  }
  return winners;
}

export function drawGiveaway(round,now,randomInt=secureRandomInt) {
  if (round.status!=='running' || now<round.endsAt) return round;
  const winners=drawWinners(round,randomInt);
  const awards=[];
  for(const [prizeIndex,prize] of round.config.prizes.entries()) {
    const end=Math.min(awards.length+prize.count,winners.length);
    while(awards.length<end)awards.push({userId:winners[awards.length],prizeIndex});
  }
  return {...round,status:'drawn',closedAt:now,awards,reason:round.entrants.length ? '倒计时结束，已开奖' : '倒计时结束，无人参与'};
}

function migrateRound(round) {
  if(!round || !Array.isArray(round.winnerIds) || round.config?.prizes!==undefined)throw new Error('旧版抽奖记录无效');
  const {winnerIds,config,...rest}=round;
  return {...rest,anchorId:round.anchorId ?? '',config:validateGiveawayConfig(config),awards:winnerIds.map(userId=>({userId,prizeIndex:0}))};
}

function validateAwards(round) {
  const awards=round.awards;
  if(round.config.anchorGuaranteed && !/^[1-9]\d{0,24}$/.test(round.anchorId || ''))throw new Error('抽奖主播身份无效');
  if(round.status==='running' ? round.closedAt!==null || awards.length!==0
    : !Number.isFinite(round.closedAt) || round.closedAt<round.startedAt || (round.status==='drawn' ? round.closedAt<round.endsAt || awards.length!==Math.min(giveawaySlots(round.config),round.entrants.length) : awards.length!==0))throw new Error('抽奖结果状态无效');
  if(awards.some(award=>!award || !round.entrants.some(row=>row.userId===award.userId) || !integer(award.prizeIndex,0,round.config.prizes.length-1))
    || new Set(awards.map(award=>award.userId)).size!==awards.length
    || round.config.prizes.some((prize,index)=>awards.filter(award=>award.prizeIndex===index).length>prize.count))throw new Error('抽奖奖品分配无效');
  if(round.status==='drawn' && round.config.anchorGuaranteed && round.entrants.some(row=>row.userId===round.anchorId)
    && !awards.some(award=>award.userId===round.anchorId && award.prizeIndex===0))throw new Error('主播必中结果无效');
}

function validateFeedback(round) {
  round.feedback ??= [];
  const kinds=['start','entry','countdown','result','cancelled'];
  if(!Array.isArray(round.feedback) || round.feedback.some(row=>!row || !boundedText(row.id,100) || !kinds.includes(row.kind)
    || typeof row.text!=='string' || !row.text.trim() || [...row.text].length>50 || typeof row.queued!=='boolean'
    || !Number.isFinite(row.createdAt) || !Number.isFinite(row.expiresAt) || row.expiresAt<=row.createdAt
    || row.attemptedBy!==undefined && !boundedText(row.attemptedBy,100)
    || row.kind==='countdown' && ![300,60,30,10].includes(row.seconds)
    || row.kind==='entry' && (!Array.isArray(row.userIds) || !row.userIds.length || row.userIds.some(id=>!round.entrants.some(entrant=>entrant.userId===id))))
    || new Set(round.feedback.map(row=>row.id)).size!==round.feedback.length)throw new Error('抽奖反馈记录无效');
}

// Read storage once at the boundary. Corruption must never silently discard history.
export function parseGiveawayState(value,room) {
  if (value == null) return {version:GIVEAWAY_VERSION,rounds:[]};
  if (![1,GIVEAWAY_VERSION].includes(value.version) || !Array.isArray(value.rounds)) throw new Error('抽奖记录格式无效，请保留原数据并检查存储');
  const rounds=value.version===1 ? value.rounds.map(migrateRound) : structuredClone(value.rounds);
  for(const round of rounds) {
    if (!round || !boundedText(round.id,100) || round.room!==room || !['running','drawn','cancelled'].includes(round.status)
      || !Number.isFinite(round.startedAt) || !Number.isFinite(round.endsAt) || round.endsAt<=round.startedAt
      || !Array.isArray(round.entrants) || !Array.isArray(round.giftProgress) || !Array.isArray(round.awards)
      || !Array.isArray(round.config?.prizes) || round.winnerIds!==undefined
      || typeof round.anchorId!=='string' || round.anchorId!=='' && !/^[1-9]\d{0,24}$/.test(round.anchorId)) throw new Error('抽奖轮次记录无效');
    round.config=validateGiveawayConfig(round.config);
    if (round.entrants.some(row=>!row || !boundedText(row.userId,200) || typeof row.userName!=='string' || !Array.isArray(row.sources)
      || !row.sources.length || row.sources.some(source=>!['chat','gift'].includes(source)) || !Number.isFinite(row.enteredAt) || !integer(row.giftCount,0,Number.MAX_SAFE_INTEGER))
      || new Set(round.entrants.map(row=>row.userId)).size!==round.entrants.length
      || round.giftProgress.some(row=>!row || typeof row.key!=='string' || typeof row.userId!=='string' || !integer(row.count,1,1000000000))) throw new Error('抽奖参与记录无效');
    validateAwards(round);
    validateFeedback(round);
  }
  if (rounds.filter(round=>round.status==='running').length>1 || new Set(rounds.map(round=>round.id)).size!==rounds.length) throw new Error('抽奖轮次状态冲突');
  return structuredClone({version:GIVEAWAY_VERSION,rounds});
}

export function giveawayAnnouncement(round) {
  if (!round || round.status!=='drawn') return '';
  const results=round.config.prizes.map((prize,index)=>{
    const names=round.awards.filter(award=>award.prizeIndex===index).map(award=>round.entrants.find(row=>row.userId===award.userId)?.userName || award.userId);
    return `${prize.name}：${names.length ? `恭喜 ${names.join('、')}` : '未产生中奖者'}`;
  });
  const rules=[round.config.weights.length ? '按观众权重抽取' : '',round.config.anchorGuaranteed ? '主播参与必中' : ''].filter(Boolean);
  return `【抽奖结果】${results.join('；')}。共 ${round.entrants.length} 人参与。${rules.length ? `本轮规则：${rules.join('；')}。` : ''}`;
}

const csvCell = value => '"'+String(value ?? '').replace(/^(?:\s*[=+\-@]|[\t\r\n]|\d{15,}$)/,"'$&").replaceAll('"','""')+'"';
export function giveawayCSV(state) {
  const rows=[['轮次ID','直播间','直播场次','奖品及名额','计划中奖人数','倒计时秒数','参与弹幕','参与礼物','礼物门槛','开始时间','截止时间','开奖时间','状态','参与人数','用户ID','昵称','参与方式','入池时间','指定礼物数量','结果','所获奖品','抽取规则','主播UID','抽取权重']];
  for(const round of state.rounds) {
    const c=round.config;
    const base=[round.id,round.room,round.broadcastId,giveawayPrizes(c),giveawaySlots(c),c.durationSec,c.chatEnabled ? c.keyword : '',c.giftEnabled ? c.gifts : '',c.giftEnabled ? c.giftMin : '',new Date(round.startedAt).toISOString(),new Date(round.endsAt).toISOString(),round.closedAt ? new Date(round.closedAt).toISOString() : '',{running:'进行中',drawn:'已开奖',cancelled:'已取消'}[round.status],round.entrants.length];
    if (!round.entrants.length) rows.push([...base,'','','','','','无人参与','',giveawayDrawRules(c),round.anchorId,'']);
    for(const row of round.entrants) {
      const award=round.awards.find(award=>award.userId===row.userId);
      rows.push([...base,row.userId,row.userName,row.sources.map(source=>source==='chat' ? '弹幕' : '礼物').join('、'),new Date(row.enteredAt).toISOString(),row.giftCount,award ? '中奖' : round.status==='drawn' ? '未中奖' : round.status==='cancelled' ? '已取消' : '待开奖',award ? c.prizes[award.prizeIndex].name : '',giveawayDrawRules(c),round.anchorId,giveawayWeight(c,row.userId)]);
    }
  }
  return '\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
