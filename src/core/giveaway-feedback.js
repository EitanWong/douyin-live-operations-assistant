import {giveawaySlots,giveawayPrizes} from './giveaway.js';

export const GIVEAWAY_COUNTDOWNS = [300,60,30,10];
const text=value=>String(value).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim();
const clip=(value,length)=>[...text(value)].slice(0,length).join('');
const size=value=>[...value].length;

function lines(label,value,limit) {
  const chars=[...text(value)],width=limit-size(label),result=[];
  while(chars.length)result.push(label+chars.splice(0,width).join(''));
  return result;
}
function groups(rows,label,limit,mention=false) {
  const result=[];let names=[],userIds=[];
  const flush=()=>{if(names.length)result.push({text:label+names.join('、'),userIds});names=[];userIds=[];};
  for(const row of rows) {
    const name=(mention ? '@' : '')+clip(row.userName || row.userId,Math.min(12,limit-size(label)-(mention ? 1 : 0)));
    if(size(label+[...names,name].join('、'))>limit)flush();
    names.push(name);userIds.push(row.userId);
  }
  flush();return result;
}
function resultLines(round,limit) {
  if(!round.entrants.length)return [{text:'抽奖结束，无人参与'}];
  const result=[];
  for(const [index,prize] of round.config.prizes.entries()) {
    const ids=new Set(round.awards.filter(row=>row.prizeIndex===index).map(row=>row.userId));
    const winners=round.entrants.filter(row=>ids.has(row.userId));
    if(!winners.length)continue;
    const label=`开奖·${text(prize.name)}：恭喜`;
    if(size(label)+4<=limit)result.push(...groups(winners,label,limit,true));
    else {
      result.push(...groups(winners,'恭喜中奖：',limit,true));
      result.push(...lines('奖品：',prize.name,limit).map(text=>({text})));
    }
  }
  return result;
}

function participationLines(config,limit) {
  const methods=[];
  if(config.chatEnabled)methods.push(`发送弹幕“${config.keyword}”即可参与`);
  if(config.giftEnabled)methods.push(`赠送${config.gifts}，累计${config.giftMin}个即可参与`);
  return lines('抽奖进行中：',`${methods.join('；')}。${methods.length>1 ? '满足任一方式即可，' : ''}每人一份机会，欢迎加入！`,limit).map(text=>({text}));
}

// The saved outbox is the source of truth for confirmations and stage deduplication.
// A queued message has a durable sender receipt; it does not claim a platform echo.
export function prepareGiveawayFeedback(round,now,limit=50,{start=false}={}) {
  const feedback=round.feedback || [];
  if(!round.config.feedbackEnabled)return round.feedback ? round : {...round,feedback};
  const next=[...feedback],has=kind=>next.some(row=>row.kind===kind);
  const append=(kind,rows,expiresAt,extra={})=>{
    for(const row of rows)next.push({id:`${kind}:${next.length}`,kind,createdAt:now,expiresAt,queued:false,...extra,...row});
  };
  const liveExpiry=Math.min(round.endsAt,now+30000);
  if(start && round.status==='running' && !has('start')) {
    const messages=lines('抽奖开始：',`${round.config.durationSec}秒后开奖，${giveawaySlots(round.config)}个名额`,limit);
    if(round.config.announcePrizeNames)messages.push(...lines('奖品：',giveawayPrizes(round.config),limit));
    if(round.config.chatEnabled)messages.push(...lines('发送弹幕：',`${round.config.keyword} 即可参抽奖`,limit));
    if(round.config.giftEnabled)messages.push(...lines('参与礼物：',`${round.config.gifts}，累计${round.config.giftMin}个`,limit));
    append('start',messages.map(text=>({text})),liveExpiry);
  }
  if(round.status==='running') {
    const reminder=Math.floor((now-round.startedAt)/60000);
    if(reminder>0 && now<round.endsAt-10000 && !next.some(row=>row.kind==='reminder' && Math.floor((row.createdAt-round.startedAt)/60000)===reminder)) {
      append('reminder',participationLines(round.config,limit),Math.min(liveExpiry,round.endsAt-10000));
    }
    const confirmed=new Set(next.filter(row=>row.kind==='entry').flatMap(row=>row.userIds));
    append('entry',groups(round.entrants.filter(row=>!confirmed.has(row.userId)),'报名成功：',limit,true),round.endsAt);
    for(const seconds of GIVEAWAY_COUNTDOWNS) {
      const at=round.endsAt-seconds*1000;
      if(round.config.durationSec>seconds && now>=at && now<at+1500 && !next.some(row=>row.kind==='countdown' && row.seconds===seconds)) {
        append('countdown',[{text:`抽奖剩余${seconds}秒`}],Math.min(round.endsAt,at+5000),{seconds});
      }
    }
  } else if(round.status==='drawn' && !has('result')) {
    append('result',resultLines(round,limit),now+86400000);
  } else if(round.status==='cancelled' && !has('cancelled')) {
    append('cancelled',lines('抽奖：','本轮已取消，不开奖',limit).map(text=>({text})),now+30000);
  }
  return next.length===feedback.length && round.feedback ? round : {...round,feedback:next};
}
