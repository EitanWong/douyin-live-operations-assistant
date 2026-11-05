const FINAL_STAGES = [120,90,60,30,10,5];

// Early minutes provide regular reassurance; closing stages give more frequent feedback.
export function giveawayCountdownStage(remainingSec) {
  if(remainingSec<=0)return null;
  return remainingSec>120 ? Math.ceil(remainingSec/60)*60 : FINAL_STAGES.findLast(seconds=>remainingSec<=seconds);
}

export function validGiveawayCountdown(seconds) {
  return Number.isSafeInteger(seconds) && seconds>0 && seconds<=86400 && giveawayCountdownStage(seconds)===seconds;
}
