// Completed recognition is evidence, never a command or proof of speaker identity.
export function freshObservations(media,now){
 return (media?.observations || []).filter(row=>{
  const endedAt=row.endedAt ?? row.at;
  return row.isFinal!==false && ['audio','video','omni'].includes(row.kind) && typeof row.text==='string' && row.text.trim() && !['[SILENCE]','[UNKNOWN]'].includes(row.text.trim())
   && Number.isFinite(row.at) && Number.isFinite(endedAt) && endedAt>=row.at && now>=endedAt && now-endedAt<=30000;
 }).sort((a,b)=>(b.endedAt ?? b.at)-(a.endedAt ?? a.at));
}
export function liveMoment(media,now){
 const rows=freshObservations(media,now),speech=rows.find(row=>row.kind==='audio') || null,visual=rows.find(row=>row.kind==='video' || row.kind==='omni') || null;
 const start=speech && visual ? Math.max(speech.at,visual.at) : null,end=speech && visual ? Math.min(speech.endedAt ?? speech.at,visual.endedAt ?? visual.at) : null;
 const overlap=speech && visual && (start<end || start===end && (speech.at===(speech.endedAt ?? speech.at) || visual.at===(visual.endedAt ?? visual.at)));
 const alignment=speech && visual ? overlap ? 'overlapping' : 'separate' : speech ? 'speech-only' : visual ? 'visual-only' : 'none';
 return {speech,visual,alignment};
}


export function awaitingVisual(moment,now,videoEnabled){
 if(!videoEnabled || !moment.speech || now-(moment.speech.receivedAt ?? moment.speech.endedAt)>=3000)return false;
 if(!/这[个些种款边里张幅两]|那[个些种款边里张幅两]|哪[个些种款边]|看[看下]|画面|左边|右边|手[里上]|眼前/u.test(moment.speech.text))return false;
 return moment.alignment!=='overlapping' || (moment.visual.endedAt ?? moment.visual.at)<moment.speech.endedAt-2000;
}
